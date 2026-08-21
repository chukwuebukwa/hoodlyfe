import type {
  OnFootInputBatchMessage,
  OnFootInputMoveMessage
} from '../../../shared/protocol/on-foot-input.ts';
import {
  ON_FOOT_SIMULATION_STEP_SECONDS,
  onFootMovementScale,
  type OnFootPose
} from '../../../shared/simulation/on-foot-step.ts';

const MAX_HISTORY_TICKS = 24;
const MAX_FRAME_TICKS = 4;
const POSITION_EPSILON = 0.001;
const HARD_CORRECTION_DISTANCE = 120;
const VISUAL_CORRECTION_DECAY = 14;

export interface OnFootPredictionAuthority extends OnFootPose {
  readonly alive: boolean;
  readonly vehicleId: string;
  readonly airborne: boolean;
  readonly action: string;
  readonly weapon: string;
  readonly attackCombo: number;
  readonly lastInputSequence: number;
}

export interface OnFootPredictionMovement {
  readonly x: number;
  readonly y: number;
}

export interface OnFootPredictionWorld {
  step(
    pose: OnFootPose,
    movement: OnFootPredictionMovement,
    movementScale: number
  ): OnFootPose;
}

export interface OnFootPredictionSnapshot {
  readonly active: boolean;
  readonly sequence: number;
  readonly acknowledgedSequence: number;
  readonly pendingInputs: number;
  readonly replayedInputs: number;
  readonly correctionErrorPx: number;
  readonly corrections: number;
  readonly resets: number;
  readonly reason: string;
}

interface PendingMove {
  readonly message: OnFootInputMoveMessage;
  readonly movementScale: number;
  readonly predicted: OnFootPose;
}

export class OnFootPredictionController {
  private accumulatorSeconds = 0;
  private sequence = 0;
  private acknowledgedSequence = 0;
  private pending: PendingMove[] = [];
  private predicted?: OnFootPose;
  private visualOffsetX = 0;
  private visualOffsetY = 0;
  private authoritySignature = '';
  private replayedInputs = 0;
  private correctionErrorPx = 0;
  private corrections = 0;
  private resets = 0;
  private reason = 'waiting';

  constructor(private readonly world: OnFootPredictionWorld) {}

  update(
    authority: OnFootPredictionAuthority | undefined,
    movement: OnFootPredictionMovement,
    deltaSeconds: number,
    enabled: boolean
  ): OnFootInputBatchMessage | undefined {
    const reason = predictionUnavailableReason(authority, enabled);
    if (reason || !authority) {
      this.deactivate(reason ?? 'waiting', authority?.lastInputSequence);
      return undefined;
    }

    this.decayVisualCorrection(deltaSeconds);
    this.activateOrReconcile(authority);
    const generated: OnFootInputMoveMessage[] = [];
    this.accumulatorSeconds = Math.min(
      this.accumulatorSeconds + finiteClamp(deltaSeconds, 0, 0.05),
      ON_FOOT_SIMULATION_STEP_SECONDS * MAX_FRAME_TICKS
    );
    let ticks = 0;
    while (
      this.accumulatorSeconds + Number.EPSILON >= ON_FOOT_SIMULATION_STEP_SECONDS &&
      ticks < MAX_FRAME_TICKS
    ) {
      this.accumulatorSeconds -= ON_FOOT_SIMULATION_STEP_SECONDS;
      ticks++;
      const message = Object.freeze({
        sequence: ++this.sequence,
        x: finiteClamp(movement.x, -1, 1),
        y: finiteClamp(movement.y, -1, 1)
      });
      const movementScale = onFootMovementScale(
        authority.action,
        authority.weapon,
        authority.attackCombo
      );
      this.predicted = this.world.step(this.predicted ?? authority, movement, movementScale);
      this.pending.push(Object.freeze({
        message,
        movementScale,
        predicted: {...this.predicted}
      }));
      if (this.pending.length > MAX_HISTORY_TICKS) {
        this.pending.splice(0, this.pending.length - MAX_HISTORY_TICKS);
      }
      generated.push(message);
    }
    this.reason = 'predicting';
    return generated.length > 0 ? {moves: generated} : undefined;
  }

  pose(): OnFootPose | undefined {
    return this.predicted ? {
      ...this.predicted,
      x: this.predicted.x + this.visualOffsetX,
      y: this.predicted.y + this.visualOffsetY
    } : undefined;
  }

  snapshot(): OnFootPredictionSnapshot {
    return Object.freeze({
      active: Boolean(this.predicted),
      sequence: this.sequence,
      acknowledgedSequence: this.acknowledgedSequence,
      pendingInputs: this.pending.length,
      replayedInputs: this.replayedInputs,
      correctionErrorPx: round(this.correctionErrorPx, 2),
      corrections: this.corrections,
      resets: this.resets,
      reason: this.reason
    });
  }

  reset(reason = 'reset'): void {
    this.deactivate(reason);
  }

  private activateOrReconcile(authority: OnFootPredictionAuthority): void {
    const acknowledged = safeSequence(authority.lastInputSequence);
    if (!this.predicted) {
      this.sequence = Math.max(this.sequence, acknowledged);
      this.acknowledgedSequence = acknowledged;
      this.pending = this.pending.filter(({message}) => message.sequence > acknowledged);
      this.predicted = poseFromAuthority(authority);
      this.visualOffsetX = 0;
      this.visualOffsetY = 0;
      this.authoritySignature = authorityPoseSignature(authority, acknowledged);
      this.reason = 'predicting';
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
    const historical = this.pending.find(({message}) => (
      message.sequence === acknowledged
    ))?.predicted;
    const compared = historical ?? this.predicted;
    this.authoritySignature = signature;
    this.acknowledgedSequence = acknowledged;
    this.sequence = Math.max(this.sequence, acknowledged);
    this.pending = this.pending.filter(({message}) => message.sequence > acknowledged);
    let replayed = poseFromAuthority(authority);
    this.pending = this.pending.map((pending) => {
      replayed = this.world.step(replayed, {
        x: pending.message.x,
        y: pending.message.y
      }, pending.movementScale);
      return Object.freeze({
        ...pending,
        predicted: {...replayed}
      });
    });
    this.replayedInputs = this.pending.length;
    this.correctionErrorPx = Math.hypot(
      compared.x - authority.x,
      compared.y - authority.y
    );
    if (this.correctionErrorPx > POSITION_EPSILON) this.corrections++;
    const hardCorrection =
      compared.spaceId !== replayed.spaceId ||
      compared.surfaceId !== replayed.surfaceId ||
      this.correctionErrorPx > HARD_CORRECTION_DISTANCE;
    this.predicted = replayed;
    this.visualOffsetX = hardCorrection ? 0 : before.x - replayed.x;
    this.visualOffsetY = hardCorrection ? 0 : before.y - replayed.y;
  }

  private hardReset(
    authority: OnFootPredictionAuthority,
    acknowledged: number,
    reason: string
  ): void {
    this.accumulatorSeconds = 0;
    this.sequence = acknowledged;
    this.acknowledgedSequence = acknowledged;
    this.pending = [];
    this.predicted = poseFromAuthority(authority);
    this.visualOffsetX = 0;
    this.visualOffsetY = 0;
    this.authoritySignature = authorityPoseSignature(authority, acknowledged);
    this.replayedInputs = 0;
    this.correctionErrorPx = 0;
    this.resets++;
    this.reason = reason;
  }

  private deactivate(reason: string, acknowledged?: number): void {
    const wasActive = Boolean(this.predicted) || this.pending.length > 0;
    this.accumulatorSeconds = 0;
    this.pending = [];
    this.predicted = undefined;
    this.visualOffsetX = 0;
    this.visualOffsetY = 0;
    this.authoritySignature = '';
    this.replayedInputs = 0;
    this.correctionErrorPx = 0;
    if (acknowledged !== undefined) {
      this.sequence = Math.max(this.sequence, safeSequence(acknowledged));
      this.acknowledgedSequence = safeSequence(acknowledged);
    }
    if (wasActive) this.resets++;
    this.reason = reason;
  }

  private decayVisualCorrection(deltaSeconds: number): void {
    const decay = Math.exp(
      -VISUAL_CORRECTION_DECAY * finiteClamp(deltaSeconds, 0, 0.05)
    );
    this.visualOffsetX *= decay;
    this.visualOffsetY *= decay;
    if (Math.abs(this.visualOffsetX) < POSITION_EPSILON) this.visualOffsetX = 0;
    if (Math.abs(this.visualOffsetY) < POSITION_EPSILON) this.visualOffsetY = 0;
  }
}

function predictionUnavailableReason(
  authority: OnFootPredictionAuthority | undefined,
  enabled: boolean
): string | undefined {
  if (!enabled) return 'rollout-disabled';
  if (!authority) return 'waiting-authority';
  if (!authority.alive) return 'dead';
  if (authority.vehicleId) return 'vehicle-authority';
  if (authority.airborne) return 'airborne-authority';
  if (authority.spaceId !== 'street') return 'interior-authority';
  if (!authority.surfaceId) return 'missing-surface';
  if (authority.action && authority.action !== 'melee') return `action-${authority.action}`;
  return undefined;
}

function poseFromAuthority(authority: OnFootPredictionAuthority): OnFootPose {
  return {
    x: authority.x,
    y: authority.y,
    spaceId: authority.spaceId,
    ...(authority.surfaceId ? {surfaceId: authority.surfaceId} : {})
  };
}

function authorityPoseSignature(authority: OnFootPredictionAuthority, acknowledged: number): string {
  return [
    acknowledged,
    authority.x,
    authority.y,
    authority.spaceId,
    authority.surfaceId ?? '',
    authority.action,
    authority.weapon,
    authority.attackCombo
  ].join('|');
}

function safeSequence(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
