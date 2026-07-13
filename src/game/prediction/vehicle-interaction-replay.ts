import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import type {
  InteractionEntityState,
  VehicleInteractionState
} from '../../../shared/protocol/interaction-contracts.ts';
import {
  resolveVehicleDynamicContact,
  type VehicleCollisionBody
} from '../../../shared/simulation/vehicle-dynamic-contact.ts';
import {
  stepVehicleWithWorldCollision,
  vehicleMechanicalSpeedMultiplier
} from '../../../shared/simulation/vehicle-step.ts';
import {
  type InteractionIslandReplayResult,
  type InteractionReplayBodyStep,
  type InteractionReplayCommand,
  type InteractionReplayPairStep
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

const MINIMUM_COLLISION_SPEED = -150;
const MAXIMUM_COLLISION_SPEED = 430;
const SEPARATION_OCCUPANCY_RADIUS = vehicleDefinition('sedan').radius;

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
    throttle: -move.y
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

export function createVehicleInteractionBodyStep(
  canOccupy: InteractionWorldOccupancy
): InteractionReplayBodyStep {
  return (entity, control, context) => {
    if (entity.kind !== 'vehicle') return entity;
    if (entity.destroyed) return vehicleState(entity, {
      x: entity.x,
      y: entity.y,
      angle: entity.angle,
      speed: 0
    }, entity.steering, context.deltaSeconds);
    const steering = control.source === 'neutral' ? entity.steering : control.steering;
    const movement = stepVehicleWithWorldCollision(
      entity,
      {steering, throttle: control.throttle},
      entity.vehicleKind,
      context.deltaSeconds,
      (x, y, radius) => canOccupy(entity.spaceId, x, y, radius),
      {
        maximumSpeedMultiplier: vehicleMechanicalSpeedMultiplier(
          entity.engineDamage,
          entity.onFire
        )
      }
    );
    return vehicleState(entity, movement.pose, steering, context.deltaSeconds);
  };
}

export function createVehicleInteractionPairStep(
  canOccupy: InteractionWorldOccupancy
): InteractionReplayPairStep {
  return (left, right, context) => {
    if (
      left.kind !== 'vehicle' || right.kind !== 'vehicle' ||
      left.spaceId !== right.spaceId || left.layerId !== right.layerId
    ) return undefined;
    const result = resolveVehicleDynamicContact(collisionBody(left), collisionBody(right));
    if (!result.collided) return undefined;
    if (result.primaryDamage > 0) {
      context.sideEffects.dispatch('authoritative-gameplay', () => undefined);
    }
    if (result.otherDamage > 0) {
      context.sideEffects.dispatch('authoritative-gameplay', () => undefined);
    }
    const canSeparateLeft = canOccupy(
      left.spaceId,
      result.primaryX,
      result.primaryY,
      SEPARATION_OCCUPANCY_RADIUS
    );
    const nextLeftX = canSeparateLeft ? result.primaryX : left.x;
    const nextLeftY = canSeparateLeft ? result.primaryY : left.y;
    const canSeparateRight = canOccupy(
      right.spaceId,
      result.otherX,
      result.otherY,
      SEPARATION_OCCUPANCY_RADIUS
    );
    const nextRightX = canSeparateRight ? result.otherX : right.x;
    const nextRightY = canSeparateRight ? result.otherY : right.y;
    return [
      vehicleState(left, {
        x: nextLeftX,
        y: nextLeftY,
        angle: left.angle,
        speed: left.destroyed
          ? left.speed
          : clamp(result.primarySpeed, MINIMUM_COLLISION_SPEED, MAXIMUM_COLLISION_SPEED)
      }, left.steering, context.deltaSeconds),
      vehicleState(right, {
        x: nextRightX,
        y: nextRightY,
        angle: right.angle,
        speed: right.destroyed
          ? right.speed
          : clamp(result.otherSpeed, MINIMUM_COLLISION_SPEED, MAXIMUM_COLLISION_SPEED)
      }, right.steering, context.deltaSeconds)
    ];
  };
}

function collisionBody(entity: VehicleInteractionState): VehicleCollisionBody {
  const definition = vehicleDefinition(entity.vehicleKind);
  return {
    id: entity.id,
    x: entity.x,
    y: entity.y,
    angle: entity.angle,
    speed: entity.destroyed ? 0 : entity.speed,
    halfLength: definition.collision.length / 2,
    halfWidth: definition.collision.width / 2,
    mass: definition.mass * (entity.destroyed ? 2.5 : 1),
    damageScale: definition.collisionDamageScale
  };
}

function vehicleState(
  entity: VehicleInteractionState,
  pose: {x: number; y: number; angle: number; speed: number},
  steering: number,
  deltaSeconds: number
): InteractionEntityState {
  const angularVelocity = normalizeAngle(pose.angle - entity.angle) / Math.max(0.001, deltaSeconds);
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}
