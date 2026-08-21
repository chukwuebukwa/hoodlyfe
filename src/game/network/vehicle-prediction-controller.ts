import type {
  VehicleInputBatchMessage,
  VehicleInputMoveMessage
} from '../../../shared/protocol/vehicle-input.ts';
import {
  VEHICLE_SIMULATION_STEP_SECONDS,
  vehicleMechanicalStepModifiers,
  type VehicleMotionState,
  type VehicleStepModifiers
} from '../../../shared/simulation/vehicle-step.ts';

const MAX_HISTORY_TICKS = 24;
const MAX_FRAME_TICKS = 4;
const HARD_POSITION_ERROR = 180;
const HARD_ANGLE_ERROR = 1.2;
const VISUAL_CORRECTION_DECAY = 14;
const EPSILON = 0.001;

export interface VehiclePredictionAuthority extends VehicleMotionState {
  readonly playerId: string;
  readonly vehicleId: string;
  readonly kind: string;
  readonly surfaceId: string;
  readonly alive: boolean;
  readonly playerVehicleId: string;
  readonly playerVehicleSeat: number;
  readonly driverId: string;
  readonly destroyed: boolean;
  readonly airborne: boolean;
  readonly engineDamage: number;
  readonly tyreDamageMask: number;
  readonly onFire: boolean;
  readonly lastVehicleInputSequence: number;
}

export interface VehiclePredictionMovement {
  readonly x: number;
  readonly y: number;
  readonly handbrake: boolean;
}

export interface VehiclePredictionPose extends VehicleMotionState {
  readonly vehicleId: string;
  readonly kind: string;
  readonly surfaceId: string;
}

export interface VehiclePredictionWorld {
  step(
    pose: VehiclePredictionPose,
    movement: VehiclePredictionMovement,
    modifiers: VehicleStepModifiers
  ): VehiclePredictionPose;
}

export interface VehiclePredictionSnapshot {
  readonly active: boolean;
  readonly streaming: boolean;
  readonly sequence: number;
  readonly acknowledgedSequence: number;
  readonly pendingInputs: number;
  readonly replayedInputs: number;
  readonly correctionErrorPx: number;
  readonly angularErrorRad: number;
  readonly corrections: number;
  readonly resets: number;
  readonly reason: string;
}

interface PendingMove {
  readonly message: VehicleInputMoveMessage;
  readonly modifiers: VehicleStepModifiers;
  readonly predicted: VehiclePredictionPose;
}

export class VehiclePredictionController {
  private accumulatorSeconds = 0;
  private sequence = 0;
  private acknowledgedSequence = 0;
  private pending: PendingMove[] = [];
  private predicted?: VehiclePredictionPose;
  private visualOffsetX = 0;
  private visualOffsetY = 0;
  private visualOffsetAngle = 0;
  private authoritySignature = '';
  private replayedInputs = 0;
  private correctionErrorPx = 0;
  private angularErrorRad = 0;
  private corrections = 0;
  private resets = 0;
  private reason = 'waiting';
  private streaming = false;

  constructor(private readonly world: VehiclePredictionWorld) {}

  update(
    authority: VehiclePredictionAuthority | undefined,
    movement: VehiclePredictionMovement,
    deltaSeconds: number,
    enabled: boolean
  ): VehicleInputBatchMessage | undefined {
    const unavailable = streamingUnavailableReason(authority, enabled);
    if (unavailable || !authority) {
      this.deactivate(unavailable ?? 'waiting-authority', authority?.lastVehicleInputSequence);
      return undefined;
    }
    this.streaming = true;
    const canPredict = !authority.airborne && Boolean(authority.surfaceId);
    this.decayVisualCorrection(deltaSeconds);
    if (canPredict) this.activateOrReconcile(authority);
    else this.suspendVisualPrediction(authority, 'airborne-authority');

    const generated: VehicleInputMoveMessage[] = [];
    this.accumulatorSeconds = Math.min(
      this.accumulatorSeconds + finiteClamp(deltaSeconds, 0, 0.05),
      VEHICLE_SIMULATION_STEP_SECONDS * MAX_FRAME_TICKS
    );
    let ticks = 0;
    while (
      this.accumulatorSeconds + Number.EPSILON >= VEHICLE_SIMULATION_STEP_SECONDS &&
      ticks < MAX_FRAME_TICKS
    ) {
      this.accumulatorSeconds -= VEHICLE_SIMULATION_STEP_SECONDS;
      ticks++;
      const message: VehicleInputMoveMessage = Object.freeze({
        sequence: ++this.sequence,
        x: finiteClamp(movement.x, -1, 1),
        y: finiteClamp(movement.y, -1, 1),
        ...(movement.handbrake ? {handbrake: true} : {})
      });
      generated.push(message);
      if (this.predicted) {
        const modifiers = vehicleMechanicalStepModifiers(
          authority.engineDamage,
          authority.onFire,
          authority.tyreDamageMask
        );
        this.predicted = this.world.step(this.predicted, movement, modifiers);
        this.pending.push(Object.freeze({message, modifiers, predicted: {...this.predicted}}));
        if (this.pending.length > MAX_HISTORY_TICKS) {
          this.pending.splice(0, this.pending.length - MAX_HISTORY_TICKS);
        }
      }
    }
    if (canPredict) this.reason = 'predicting';
    return generated.length > 0 ? {vehicleId: authority.vehicleId, moves: generated} : undefined;
  }

  pose(): VehiclePredictionPose | undefined {
    return this.predicted ? {
      ...this.predicted,
      x: this.predicted.x + this.visualOffsetX,
      y: this.predicted.y + this.visualOffsetY,
      angle: normalizeAngle(this.predicted.angle + this.visualOffsetAngle)
    } : undefined;
  }

  snapshot(): VehiclePredictionSnapshot {
    return Object.freeze({
      active: Boolean(this.predicted),
      streaming: this.streaming,
      sequence: this.sequence,
      acknowledgedSequence: this.acknowledgedSequence,
      pendingInputs: this.pending.length,
      replayedInputs: this.replayedInputs,
      correctionErrorPx: round(this.correctionErrorPx),
      angularErrorRad: round(this.angularErrorRad),
      corrections: this.corrections,
      resets: this.resets,
      reason: this.reason
    });
  }

  reset(reason = 'reset'): void {
    this.deactivate(reason);
  }

  private activateOrReconcile(authority: VehiclePredictionAuthority): void {
    const acknowledged = safeSequence(authority.lastVehicleInputSequence);
    if (!this.predicted || this.predicted.vehicleId !== authority.vehicleId) {
      this.sequence = Math.max(this.sequence, acknowledged);
      this.acknowledgedSequence = acknowledged;
      this.pending = [];
      this.predicted = poseFromAuthority(authority);
      this.clearVisualCorrection();
      this.authoritySignature = authorityPoseSignature(authority, acknowledged);
      return;
    }
    if (acknowledged < this.acknowledgedSequence) {
      this.hardReset(authority, acknowledged, 'authority-rewind');
      return;
    }
    const oldestSequence = this.pending[0]?.message.sequence;
    if (
      acknowledged > this.sequence ||
      (oldestSequence !== undefined && acknowledged < oldestSequence - 1)
    ) {
      this.hardReset(authority, acknowledged, 'history-gap');
      return;
    }
    const signature = authorityPoseSignature(authority, acknowledged);
    if (signature === this.authoritySignature) return;
    if (acknowledged === this.acknowledgedSequence) {
      this.authoritySignature = signature;
      return;
    }
    const before = this.pose() ?? this.predicted;
    const historical = this.pending.find(({message}) => message.sequence === acknowledged)?.predicted;
    const compared = historical ?? this.predicted;
    this.authoritySignature = signature;
    this.acknowledgedSequence = acknowledged;
    this.sequence = Math.max(this.sequence, acknowledged);
    this.pending = this.pending.filter(({message}) => message.sequence > acknowledged);
    let replayed = poseFromAuthority(authority);
    this.pending = this.pending.map((pending) => {
      replayed = this.world.step(replayed, {
        x: pending.message.x,
        y: pending.message.y,
        handbrake: pending.message.handbrake === true
      }, pending.modifiers);
      return Object.freeze({
        ...pending,
        predicted: {...replayed}
      });
    });
    this.replayedInputs = this.pending.length;
    this.correctionErrorPx = Math.hypot(compared.x - authority.x, compared.y - authority.y);
    this.angularErrorRad = Math.abs(shortestAngle(compared.angle, authority.angle));
    if (this.correctionErrorPx > EPSILON || this.angularErrorRad > EPSILON) this.corrections++;
    const hardCorrection =
      compared.surfaceId !== replayed.surfaceId ||
      this.correctionErrorPx > HARD_POSITION_ERROR ||
      this.angularErrorRad > HARD_ANGLE_ERROR;
    this.predicted = replayed;
    if (hardCorrection) this.clearVisualCorrection();
    else {
      this.visualOffsetX = before.x - replayed.x;
      this.visualOffsetY = before.y - replayed.y;
      this.visualOffsetAngle = shortestAngle(replayed.angle, before.angle);
    }
  }

  private hardReset(authority: VehiclePredictionAuthority, acknowledged: number, reason: string): void {
    this.accumulatorSeconds = 0;
    this.sequence = acknowledged;
    this.acknowledgedSequence = acknowledged;
    this.pending = [];
    this.predicted = poseFromAuthority(authority);
    this.clearVisualCorrection();
    this.authoritySignature = authorityPoseSignature(authority, acknowledged);
    this.replayedInputs = 0;
    this.correctionErrorPx = 0;
    this.angularErrorRad = 0;
    this.resets++;
    this.reason = reason;
  }

  private suspendVisualPrediction(authority: VehiclePredictionAuthority, reason: string): void {
    this.sequence = Math.max(this.sequence, safeSequence(authority.lastVehicleInputSequence));
    this.acknowledgedSequence = safeSequence(authority.lastVehicleInputSequence);
    this.pending = [];
    this.predicted = undefined;
    this.authoritySignature = '';
    this.clearVisualCorrection();
    this.reason = reason;
  }

  private deactivate(reason: string, acknowledged?: number): void {
    const wasActive = this.streaming || Boolean(this.predicted) || this.pending.length > 0;
    this.accumulatorSeconds = 0;
    this.streaming = false;
    this.pending = [];
    this.predicted = undefined;
    this.authoritySignature = '';
    this.clearVisualCorrection();
    this.replayedInputs = 0;
    this.correctionErrorPx = 0;
    this.angularErrorRad = 0;
    if (acknowledged !== undefined) {
      this.sequence = Math.max(this.sequence, safeSequence(acknowledged));
      this.acknowledgedSequence = safeSequence(acknowledged);
    }
    if (wasActive) this.resets++;
    this.reason = reason;
  }

  private decayVisualCorrection(deltaSeconds: number): void {
    const decay = Math.exp(-VISUAL_CORRECTION_DECAY * finiteClamp(deltaSeconds, 0, 0.05));
    this.visualOffsetX *= decay;
    this.visualOffsetY *= decay;
    this.visualOffsetAngle *= decay;
  }

  private clearVisualCorrection(): void {
    this.visualOffsetX = 0;
    this.visualOffsetY = 0;
    this.visualOffsetAngle = 0;
  }
}

function streamingUnavailableReason(
  authority: VehiclePredictionAuthority | undefined,
  enabled: boolean
): string | undefined {
  if (!enabled) return 'rollout-disabled';
  if (!authority) return 'waiting-authority';
  if (!authority.alive) return 'dead';
  if (!authority.playerVehicleId) return 'on-foot';
  if (authority.playerVehicleSeat !== 0) return 'passenger';
  if (authority.driverId !== authority.playerId) return 'not-driver';
  if (authority.destroyed) return 'destroyed';
  return undefined;
}

function poseFromAuthority(authority: VehiclePredictionAuthority): VehiclePredictionPose {
  return {
    vehicleId: authority.vehicleId,
    kind: authority.kind,
    surfaceId: authority.surfaceId,
    x: authority.x,
    y: authority.y,
    angle: authority.angle,
    speed: authority.speed,
    linvelX: authority.linvelX,
    linvelY: authority.linvelY,
    angvel: authority.angvel
  };
}

function authorityPoseSignature(authority: VehiclePredictionAuthority, acknowledged: number): string {
  return [
    authority.vehicleId, authority.surfaceId, acknowledged,
    authority.x, authority.y, authority.angle, authority.speed,
    authority.linvelX, authority.linvelY, authority.angvel
  ].join(':');
}

function safeSequence(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function shortestAngle(from: number, to: number): number {
  return normalizeAngle(to - from);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
