import type {
  InteractionEntityState,
  VehicleInteractionState
} from '../../../shared/protocol/interaction-contracts.ts';
import type {
  InteractionIslandReplayResult,
  InteractionReplayCommand
} from './interaction-island-replay.ts';
import type {InteractionIslandBaseline} from './island-state-history.ts';
import {
  SavedVehiclePrediction,
  type VehiclePredictionCorrection,
  type VehiclePredictionReplaySample
} from './saved-vehicle-prediction.ts';

export type InteractionWorldOccupancy = (
  spaceId: string,
  x: number,
  y: number,
  radius: number
) => boolean;

export interface VehicleInteractionReplayPreparation {
  readonly targetServerTick: number;
  readonly localCommands: readonly InteractionReplayCommand[];
}

export function prepareVehicleInteractionReplay(
  prediction: SavedVehiclePrediction,
  baseline: InteractionIslandBaseline
): VehicleInteractionReplayPreparation | undefined {
  const root = baseline.entities[0];
  if (
    root?.id !== baseline.rootId ||
    root.kind !== 'vehicle' ||
    !baseline.entities.some((entity) => entity.kind === 'vehicle' && entity.id !== root.id)
  ) return undefined;
  const pending = prediction.pendingMovesAfter(baseline.acknowledgedLocalInputSequence);
  if (!pending?.length) return undefined;
  const localCommands = pending.map((move, index): InteractionReplayCommand => Object.freeze({
    serverTick: baseline.serverTick + index + 1,
    entityId: root.id,
    moveX: 0,
    moveY: 0,
    steering: move.x,
    throttle: -move.y,
    movementScale: 1
  }));
  return Object.freeze({
    targetServerTick: baseline.serverTick + localCommands.length,
    localCommands: Object.freeze(localCommands)
  });
}

export function applyVehicleInteractionReplay(
  prediction: SavedVehiclePrediction,
  baseline: InteractionIslandBaseline,
  result: InteractionIslandReplayResult
): VehiclePredictionCorrection | undefined {
  if (!result.replayed || result.entities[0]?.id !== baseline.rootId) return undefined;
  const samples: VehiclePredictionReplaySample[] = [];
  for (let index = 0; index < result.rootStates.length; index++) {
    const state = result.rootStates[index];
    if (
      state.serverTick !== baseline.serverTick + index + 1 ||
      state.entity.id !== baseline.rootId ||
      state.entity.kind !== 'vehicle'
    ) return undefined;
    samples.push(Object.freeze({
      sequence: baseline.acknowledgedLocalInputSequence + index + 1,
      pose: Object.freeze({
        x: state.entity.x,
        y: state.entity.y,
        angle: state.entity.angle,
        speed: state.entity.speed
      })
    }));
  }
  return prediction.applyInteractionReplay(
    baseline.acknowledgedLocalInputSequence,
    samples
  );
}

export function interactionVehicleState(
  entity: VehicleInteractionState,
  pose: {x: number; y: number; angle: number; speed: number},
  steering: number,
  deltaSeconds: number
): InteractionEntityState {
  const angularVelocity = normalizeAngle(pose.angle - entity.angle) /
    Math.max(0.001, deltaSeconds);
  return Object.freeze({
    ...entity,
    x: pose.x,
    y: pose.y,
    angle: pose.angle,
    speed: pose.speed,
    steering,
    velocityX: Math.cos(pose.angle) * pose.speed,
    velocityY: Math.sin(pose.angle) * pose.speed,
    angularVelocity
  });
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
