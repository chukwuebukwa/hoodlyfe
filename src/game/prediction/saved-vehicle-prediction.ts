import type {MovementVector} from '../input/client-input-policy.ts';
import {
  predictVehiclePoseWithWorldCollision,
  type PredictedVehiclePose
} from './vehicle-prediction-policy.ts';
import {
  VEHICLE_SIMULATION_HZ,
  VEHICLE_SIMULATION_STEP_SECONDS,
  type VehicleStepModifiers
} from '../../../shared/simulation/vehicle-step.ts';

export const VEHICLE_PREDICTION_HZ = VEHICLE_SIMULATION_HZ;
export const VEHICLE_PREDICTION_STEP_SECONDS = VEHICLE_SIMULATION_STEP_SECONDS;

export interface VehicleInputMove extends MovementVector {
  sequence: number;
}

interface SavedVehicleMove extends VehicleInputMove {
  predicted: PredictedVehiclePose;
}

export interface VehiclePredictionAdvance {
  pose: PredictedVehiclePose;
  outboundMoves: VehicleInputMove[];
}

export interface VehiclePredictionCorrection {
  pose: PredictedVehiclePose;
  positionError: number;
  angularError: number;
  speedError: number;
  resimulated: boolean;
  hardCorrection: boolean;
  pendingMoveCount: number;
}

export interface VehiclePredictionReplaySample {
  readonly sequence: number;
  readonly pose: PredictedVehiclePose;
}

type OccupancyQuery = (x: number, y: number, radius: number) => boolean;

// One committed fixed step of local vehicle motion. The default is the shared
// handling kernel; when the server simulates vehicles in the physics world, an
// engine-backed stepper mirrors it so predictions match the authority's model.
export type VehiclePoseStepper = (
  pose: PredictedVehiclePose,
  movement: MovementVector,
  kind: string,
  deltaSeconds: number,
  canOccupy: OccupancyQuery,
  modifiers: VehicleStepModifiers
) => PredictedVehiclePose;

const MAX_HISTORY_MOVES = 96;
const MAX_STEPS_PER_FRAME = 4;
const HARD_CORRECTION_DISTANCE = 180;
const RESIMULATE_POSITION_ERROR = 2;
const RESIMULATE_ANGLE_ERROR = 0.02;
const RESIMULATE_SPEED_ERROR = 3;

export class SavedVehiclePrediction {
  private history: SavedVehicleMove[] = [];
  private physicsPose?: PredictedVehiclePose;
  private accumulatorSeconds = 0;
  private nextSequence = 0;
  private lastAcknowledgedSequence = 0;

  constructor(
    private readonly stepper: VehiclePoseStepper = predictVehiclePoseWithWorldCollision
  ) {}

  initialize(pose: PredictedVehiclePose, acknowledgedSequence = 0): void {
    this.physicsPose = {...pose};
    this.history = [];
    this.accumulatorSeconds = 0;
    this.lastAcknowledgedSequence = validSequence(acknowledgedSequence);
    this.nextSequence = this.lastAcknowledgedSequence;
  }

  advance(
    movement: MovementVector,
    kind: string,
    elapsedSeconds: number,
    canOccupy: OccupancyQuery,
    modifiers: VehicleStepModifiers = {}
  ): VehiclePredictionAdvance {
    if (!this.physicsPose) throw new Error('Vehicle prediction must be initialized first.');
    this.accumulatorSeconds += clamp(elapsedSeconds, 0, VEHICLE_PREDICTION_STEP_SECONDS * MAX_STEPS_PER_FRAME);
    const outboundMoves: VehicleInputMove[] = [];
    let steps = 0;
    while (
      this.accumulatorSeconds + Number.EPSILON >= VEHICLE_PREDICTION_STEP_SECONDS &&
      steps < MAX_STEPS_PER_FRAME
    ) {
      this.accumulatorSeconds -= VEHICLE_PREDICTION_STEP_SECONDS;
      const move = {
        sequence: ++this.nextSequence,
        x: movement.x,
        y: movement.y
      };
      this.physicsPose = this.stepper(
        this.physicsPose,
        move,
        kind,
        VEHICLE_PREDICTION_STEP_SECONDS,
        canOccupy,
        modifiers
      );
      this.history.push({...move, predicted: {...this.physicsPose}});
      outboundMoves.push(move);
      steps += 1;
    }
    if (this.history.length > MAX_HISTORY_MOVES) {
      this.history.splice(0, this.history.length - MAX_HISTORY_MOVES);
    }
    const pose = this.accumulatorSeconds > 0
      ? predictVehiclePoseWithWorldCollision(
        this.physicsPose,
        movement,
        kind,
        this.accumulatorSeconds,
        canOccupy,
        modifiers
      )
      : this.physicsPose;
    return {pose: {...pose}, outboundMoves};
  }

  reconcile(
    authoritative: PredictedVehiclePose,
    acknowledgedSequence: number,
    kind: string,
    canOccupy: OccupancyQuery,
    modifiers: VehicleStepModifiers = {}
  ): VehiclePredictionCorrection {
    const acknowledged = validSequence(acknowledgedSequence);
    if (!this.physicsPose) this.initialize(authoritative, acknowledged);
    if (acknowledged < this.lastAcknowledgedSequence) {
      return correction(authoritative, this.physicsPose ?? authoritative, false, this.history.length);
    }
    if (acknowledged === this.lastAcknowledgedSequence) {
      return correction(authoritative, this.physicsPose ?? authoritative, false, this.history.length);
    }
    const oldestSequence = this.history[0]?.sequence;
    if (
      acknowledged > this.nextSequence ||
      (oldestSequence !== undefined && acknowledged < oldestSequence - 1)
    ) {
      const compared = this.physicsPose ?? authoritative;
      const result = correction(authoritative, compared, false, 0, authoritative);
      this.initialize(authoritative, acknowledged);
      return {...result, hardCorrection: true};
    }
    const historical = this.history.find((move) => move.sequence === acknowledged)?.predicted;
    const compared = historical ?? this.physicsPose ?? authoritative;
    const pending = this.history.filter((move) => move.sequence > acknowledged);
    const measured = correction(authoritative, compared, false, pending.length, this.physicsPose ?? compared);
    const requiresResimulation = !historical ||
      measured.positionError > RESIMULATE_POSITION_ERROR ||
      measured.angularError > RESIMULATE_ANGLE_ERROR ||
      measured.speedError > RESIMULATE_SPEED_ERROR;
    if (!requiresResimulation) {
      this.history = pending;
      this.lastAcknowledgedSequence = acknowledged;
      this.nextSequence = Math.max(this.nextSequence, acknowledged);
      return measured;
    }
    let replayed = {...authoritative};
    for (const move of pending) {
      replayed = this.stepper(
        replayed,
        move,
        kind,
        VEHICLE_PREDICTION_STEP_SECONDS,
        canOccupy,
        modifiers
      );
      move.predicted = {...replayed};
    }
    this.physicsPose = replayed;
    this.history = pending;
    this.lastAcknowledgedSequence = acknowledged;
    this.nextSequence = Math.max(this.nextSequence, acknowledged);
    return correction(authoritative, compared, true, pending.length, replayed);
  }

  pendingMoveCount(): number {
    return this.history.length;
  }

  pendingMovesAfter(acknowledgedSequence: number): readonly VehicleInputMove[] | undefined {
    const acknowledged = validSequence(acknowledgedSequence);
    if (
      acknowledged < this.lastAcknowledgedSequence ||
      acknowledged > this.nextSequence
    ) return undefined;
    const pending = this.history.filter(({sequence}) => sequence > acknowledged);
    if (pending.length !== this.nextSequence - acknowledged) return undefined;
    for (let index = 0; index < pending.length; index++) {
      if (pending[index].sequence !== acknowledged + index + 1) return undefined;
    }
    return Object.freeze(pending.map(({sequence, x, y}) => Object.freeze({sequence, x, y})));
  }

  applyInteractionReplay(
    acknowledgedSequence: number,
    samples: readonly VehiclePredictionReplaySample[]
  ): VehiclePredictionCorrection | undefined {
    if (!this.physicsPose) return undefined;
    const acknowledged = validSequence(acknowledgedSequence);
    const pending = this.history.filter(({sequence}) => sequence > acknowledged);
    if (
      acknowledged < this.lastAcknowledgedSequence ||
      pending.length !== samples.length ||
      pending.length !== this.nextSequence - acknowledged
    ) return undefined;
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const move = pending[index];
      if (
        sample.sequence !== move.sequence ||
        sample.sequence !== acknowledged + index + 1 ||
        !validPose(sample.pose)
      ) return undefined;
    }
    if (samples.length === 0) {
      return correction(this.physicsPose, this.physicsPose, false, pending.length);
    }
    const compared = {...this.physicsPose};
    for (let index = 0; index < samples.length; index++) {
      pending[index].predicted = {...samples[index].pose};
    }
    const pose = {...samples.at(-1)!.pose};
    this.physicsPose = pose;
    this.history = pending;
    this.lastAcknowledgedSequence = acknowledged;
    this.nextSequence = Math.max(this.nextSequence, acknowledged);
    return correction(pose, compared, true, pending.length, pose);
  }
}

function correction(
  authoritative: PredictedVehiclePose,
  compared: PredictedVehiclePose,
  resimulated: boolean,
  pendingMoveCount: number,
  pose: PredictedVehiclePose = compared
): VehiclePredictionCorrection {
  const positionError = Math.hypot(authoritative.x - compared.x, authoritative.y - compared.y);
  return {
    pose: {...pose},
    positionError,
    angularError: Math.abs(normalizeAngle(authoritative.angle - compared.angle)),
    speedError: Math.abs(authoritative.speed - compared.speed),
    resimulated,
    hardCorrection: positionError > HARD_CORRECTION_DISTANCE,
    pendingMoveCount
  };
}

function validSequence(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function validPose(pose: PredictedVehiclePose): boolean {
  return Number.isFinite(pose?.x) && Number.isFinite(pose.y) &&
    Number.isFinite(pose.angle) && Number.isFinite(pose.speed);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}
