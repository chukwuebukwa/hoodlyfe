import type {
  HumanoidInteractionState,
  InteractionEntityState
} from '../../../shared/protocol/interaction-contracts.ts';
import {
  ON_FOOT_PLAYER_SPEED,
  integrateOnFootPose,
  stepInteriorOnFootPose
} from '../../../shared/simulation/on-foot-step.ts';
import type {
  InteractionIslandReplayResult,
  InteractionReplayBodyStep,
  InteractionReplayCommand
} from './interaction-island-replay.ts';
import type {InteractionIslandBaseline} from './island-state-history.ts';
import {
  SavedOnFootPrediction,
  type OnFootPredictionCorrection,
  type OnFootPredictionReplaySample
} from './saved-on-foot-prediction.ts';
import type {InteractionWorldOccupancy} from './vehicle-interaction-replay.ts';

export interface OnFootInteractionReplayPreparation {
  readonly targetServerTick: number;
  readonly localCommands: readonly InteractionReplayCommand[];
}

export function prepareOnFootInteractionReplay(
  prediction: SavedOnFootPrediction,
  baseline: InteractionIslandBaseline
): OnFootInteractionReplayPreparation | undefined {
  const root = baseline.entities[0];
  if (
    baseline.controlMode !== 'on-foot' ||
    root?.id !== baseline.rootId ||
    root.kind !== 'player' ||
    baseline.entities.length < 2
  ) return undefined;
  const pending = prediction.pendingMovesAfter(baseline.acknowledgedLocalInputSequence);
  if (!pending?.length) return undefined;
  const localCommands = pending.map((move, index): InteractionReplayCommand => Object.freeze({
    serverTick: baseline.serverTick + index + 1,
    entityId: root.id,
    moveX: move.x,
    moveY: move.y,
    steering: 0,
    throttle: 0,
    movementScale: move.movementScale
  }));
  return Object.freeze({
    targetServerTick: baseline.serverTick + localCommands.length,
    localCommands: Object.freeze(localCommands)
  });
}

export function applyOnFootInteractionReplay(
  prediction: SavedOnFootPrediction,
  baseline: InteractionIslandBaseline,
  result: InteractionIslandReplayResult
): OnFootPredictionCorrection | undefined {
  if (
    baseline.controlMode !== 'on-foot' ||
    !result.replayed ||
    result.entities[0]?.id !== baseline.rootId
  ) return undefined;
  const samples: OnFootPredictionReplaySample[] = [];
  for (let index = 0; index < result.rootStates.length; index++) {
    const state = result.rootStates[index];
    if (
      state.serverTick !== baseline.serverTick + index + 1 ||
      state.entity.id !== baseline.rootId ||
      state.entity.kind !== 'player'
    ) return undefined;
    samples.push(Object.freeze({
      sequence: baseline.acknowledgedLocalInputSequence + index + 1,
      pose: Object.freeze({
        x: state.entity.x,
        y: state.entity.y,
        spaceId: state.entity.spaceId
      })
    }));
  }
  return prediction.applyInteractionReplay(
    baseline.acknowledgedLocalInputSequence,
    samples
  );
}

export function createHumanoidInteractionBodyStep(
  canOccupy: InteractionWorldOccupancy
): InteractionReplayBodyStep {
  return (entity, control, context) => {
    if (entity.kind !== 'player' && entity.kind !== 'pedestrian') return entity;
    if (!entity.alive) return stationaryHumanoid(entity);
    const movementScale = allowsHumanoidMovement(entity.actionPhase)
      ? control.movementScale
      : 0;
    const pose = {x: entity.x, y: entity.y, spaceId: entity.spaceId};
    const command = {moveX: control.moveX, moveY: control.moveY};
    const modifiers = {movementScale, radius: entity.radius, speed: ON_FOOT_PLAYER_SPEED};
    const movement = entity.spaceId === 'street'
      ? integrateOnFootPose(pose, command, context.deltaSeconds, modifiers)
      : stepInteriorOnFootPose(
        pose,
        command,
        context.deltaSeconds,
        (spaceId, x, y, radius) => canOccupy(spaceId, x, y, radius),
        modifiers
      ).pose;
    const delta = Math.max(0.001, context.deltaSeconds);
    return humanoidState(
      entity,
      movement.x,
      movement.y,
      (movement.x - entity.x) / delta,
      (movement.y - entity.y) / delta
    );
  };
}

export function humanoidState(
  entity: HumanoidInteractionState,
  x: number,
  y: number,
  velocityX: number,
  velocityY: number
): InteractionEntityState {
  return Object.freeze({
    ...entity,
    x,
    y,
    velocityX,
    velocityY,
    angularVelocity: 0
  });
}

function stationaryHumanoid(entity: HumanoidInteractionState): InteractionEntityState {
  return humanoidState(entity, entity.x, entity.y, 0, 0);
}

export function allowsHumanoidMovement(phase: HumanoidInteractionState['actionPhase']): boolean {
  return phase === 'free' || phase === 'melee';
}
