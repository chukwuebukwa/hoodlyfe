import type {MovementVector} from '../input/client-input-policy.ts';
import type {OnFootInputMoveMessage} from '../../../shared/protocol/on-foot-input.ts';
import {
  ON_FOOT_SIMULATION_STEP_SECONDS,
  stepOnFootWithWorldCollision,
  type OnFootPose,
  type OnFootWorldOccupancy
} from '../../../shared/simulation/on-foot-step.ts';

interface SavedOnFootMove extends OnFootInputMoveMessage {
  movementScale: number;
  predicted: OnFootPose;
}

export interface OnFootPredictionAdvance {
  pose: OnFootPose;
  outboundMoves: OnFootInputMoveMessage[];
}

export interface OnFootPredictionCorrection {
  pose: OnFootPose;
  positionError: number;
  spaceChanged: boolean;
  resimulated: boolean;
  hardCorrection: boolean;
  pendingMoveCount: number;
}

const MAX_HISTORY_MOVES = 96;
const MAX_STEPS_PER_FRAME = 4;
const HARD_CORRECTION_DISTANCE = 120;
const RESIMULATE_POSITION_ERROR = 1;

export class SavedOnFootPrediction {
  private history: SavedOnFootMove[] = [];
  private physicsPose?: OnFootPose;
  private accumulatorSeconds = 0;
  private nextSequence = 0;
  private lastAcknowledgedSequence = 0;

  initialize(pose: OnFootPose, acknowledgedSequence = 0): void {
    this.physicsPose = sanitizePose(pose);
    this.history = [];
    this.accumulatorSeconds = 0;
    this.lastAcknowledgedSequence = validSequence(acknowledgedSequence);
    this.nextSequence = this.lastAcknowledgedSequence;
  }

  advance(
    movement: MovementVector,
    elapsedSeconds: number,
    canOccupy: OnFootWorldOccupancy,
    movementScale = 1
  ): OnFootPredictionAdvance {
    if (!this.physicsPose) throw new Error('On-foot prediction must be initialized first.');
    this.accumulatorSeconds += clamp(
      elapsedSeconds,
      0,
      ON_FOOT_SIMULATION_STEP_SECONDS * MAX_STEPS_PER_FRAME
    );
    const outboundMoves: OnFootInputMoveMessage[] = [];
    let steps = 0;
    while (
      this.accumulatorSeconds + Number.EPSILON >= ON_FOOT_SIMULATION_STEP_SECONDS &&
      steps < MAX_STEPS_PER_FRAME
    ) {
      this.accumulatorSeconds -= ON_FOOT_SIMULATION_STEP_SECONDS;
      const move = {
        sequence: ++this.nextSequence,
        x: finiteClamp(movement.x, -1, 1),
        y: finiteClamp(movement.y, -1, 1)
      };
      this.physicsPose = stepOnFootWithWorldCollision(
        this.physicsPose,
        {moveX: move.x, moveY: move.y},
        ON_FOOT_SIMULATION_STEP_SECONDS,
        canOccupy,
        {movementScale}
      ).pose;
      this.history.push({
        ...move,
        movementScale: safeMovementScale(movementScale),
        predicted: {...this.physicsPose}
      });
      outboundMoves.push(move);
      steps++;
    }
    if (this.history.length > MAX_HISTORY_MOVES) {
      this.history.splice(0, this.history.length - MAX_HISTORY_MOVES);
    }
    const pose = this.accumulatorSeconds > 0
      ? stepOnFootWithWorldCollision(
        this.physicsPose,
        {moveX: movement.x, moveY: movement.y},
        this.accumulatorSeconds,
        canOccupy,
        {movementScale}
      ).pose
      : this.physicsPose;
    return {pose: {...pose}, outboundMoves};
  }

  reconcile(
    authoritative: OnFootPose,
    acknowledgedSequence: number,
    canOccupy: OnFootWorldOccupancy
  ): OnFootPredictionCorrection {
    const baseline = sanitizePose(authoritative);
    const acknowledged = validSequence(acknowledgedSequence);
    if (!this.physicsPose) this.initialize(baseline, acknowledged);
    if (acknowledged < this.lastAcknowledgedSequence) {
      return correction(baseline, this.physicsPose ?? baseline, false, this.history.length);
    }
    const oldestSequence = this.history[0]?.sequence;
    if (
      acknowledged > this.nextSequence ||
      (oldestSequence !== undefined && acknowledged < oldestSequence - 1)
    ) {
      const compared = this.physicsPose ?? baseline;
      const result = correction(baseline, compared, false, 0, baseline);
      this.initialize(baseline, acknowledged);
      return {...result, hardCorrection: true};
    }
    if (acknowledged === this.lastAcknowledgedSequence) {
      return correction(baseline, this.physicsPose ?? baseline, false, this.history.length);
    }
    const historical = this.history.find((move) => move.sequence === acknowledged)?.predicted;
    const compared = historical ?? this.physicsPose ?? baseline;
    const pending = this.history.filter((move) => move.sequence > acknowledged);
    const measured = correction(baseline, compared, false, pending.length, this.physicsPose ?? compared);
    const requiresResimulation = !historical || measured.spaceChanged ||
      measured.positionError > RESIMULATE_POSITION_ERROR;
    if (!requiresResimulation) {
      this.history = pending;
      this.lastAcknowledgedSequence = acknowledged;
      this.nextSequence = Math.max(this.nextSequence, acknowledged);
      return measured;
    }
    let replayed = {...baseline};
    for (const move of pending) {
      replayed = stepOnFootWithWorldCollision(
        replayed,
        {moveX: move.x, moveY: move.y},
        ON_FOOT_SIMULATION_STEP_SECONDS,
        canOccupy,
        {movementScale: move.movementScale}
      ).pose;
      move.predicted = {...replayed};
    }
    this.physicsPose = replayed;
    this.history = pending;
    this.lastAcknowledgedSequence = acknowledged;
    this.nextSequence = Math.max(this.nextSequence, acknowledged);
    return correction(baseline, compared, true, pending.length, replayed);
  }

  pendingMoveCount(): number {
    return this.history.length;
  }
}

function correction(
  authoritative: OnFootPose,
  compared: OnFootPose,
  resimulated: boolean,
  pendingMoveCount: number,
  pose: OnFootPose = compared
): OnFootPredictionCorrection {
  const positionError = Math.hypot(authoritative.x - compared.x, authoritative.y - compared.y);
  const spaceChanged = authoritative.spaceId !== compared.spaceId;
  return {
    pose: {...pose},
    positionError,
    spaceChanged,
    resimulated,
    hardCorrection: spaceChanged || positionError > HARD_CORRECTION_DISTANCE,
    pendingMoveCount
  };
}

function sanitizePose(pose: OnFootPose): OnFootPose {
  return {
    x: Number.isFinite(pose.x) ? pose.x : 0,
    y: Number.isFinite(pose.y) ? pose.y : 0,
    spaceId: typeof pose.spaceId === 'string' && pose.spaceId ? pose.spaceId : 'street'
  };
}

function validSequence(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeMovementScale(value: number): number {
  return finiteClamp(value, 0, 2);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}
