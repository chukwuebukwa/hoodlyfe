import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import type {
  HumanoidInteractionState,
  InteractionEntityState,
  VehicleInteractionState
} from '../../../shared/protocol/interaction-contracts.ts';
import {resolveVehicleHumanoidContact} from '../../../shared/simulation/vehicle-humanoid-contact.ts';
import {
  VEHICLE_HUMANOID_MASS,
  vehicleHumanoidImpactThreshold
} from '../../../shared/simulation/vehicle-humanoid-contact-policy.ts';
import type {
  InteractionReplayBodyStep,
  InteractionReplayPairStep,
  InteractionReplayStepContext
} from './interaction-island-replay.ts';
import {
  createHumanoidInteractionBodyStep,
  humanoidState
} from './on-foot-interaction-replay.ts';
import {
  clampInteractionVehicleSpeed,
  createVehicleInteractionBodyStep,
  createVehicleInteractionPairStep,
  interactionVehicleState,
  type InteractionWorldOccupancy
} from './vehicle-interaction-replay.ts';

export function createMixedInteractionBodyStep(
  canOccupy: InteractionWorldOccupancy
): InteractionReplayBodyStep {
  const stepVehicle = createVehicleInteractionBodyStep(canOccupy);
  const stepHumanoid = createHumanoidInteractionBodyStep(canOccupy);
  return (entity, control, context) => {
    if (entity.kind === 'vehicle') return stepVehicle(entity, control, context);
    if (entity.kind === 'player' || entity.kind === 'pedestrian') {
      return stepHumanoid(entity, control, context);
    }
    return entity;
  };
}

export function createMixedInteractionPairStep(
  canOccupy: InteractionWorldOccupancy
): InteractionReplayPairStep {
  const resolveVehicles = createVehicleInteractionPairStep(canOccupy);
  return (left, right, context) => {
    if (left.kind === 'vehicle' && right.kind === 'vehicle') {
      return resolveVehicles(left, right, context);
    }
    if (left.spaceId !== right.spaceId || left.layerId !== right.layerId) return undefined;
    if (left.kind === 'vehicle' && isHumanoid(right)) {
      return resolveVehicleHumanoid(left, right, context, canOccupy);
    }
    if (isHumanoid(left) && right.kind === 'vehicle') {
      const resolved = resolveVehicleHumanoid(right, left, context, canOccupy);
      return resolved ? [resolved[1], resolved[0]] : undefined;
    }
    return undefined;
  };
}

function resolveVehicleHumanoid(
  vehicle: VehicleInteractionState,
  humanoid: HumanoidInteractionState,
  context: InteractionReplayStepContext,
  canOccupy: InteractionWorldOccupancy
): readonly [InteractionEntityState, InteractionEntityState] | undefined {
  if (!humanoid.alive) return undefined;
  const definition = vehicleDefinition(vehicle.vehicleKind);
  const result = resolveVehicleHumanoidContact({
    id: vehicle.id,
    x: vehicle.x,
    y: vehicle.y,
    angle: vehicle.angle,
    speed: vehicle.destroyed ? 0 : vehicle.speed,
    halfLength: definition.collision.length / 2,
    halfWidth: definition.collision.width / 2,
    mass: definition.mass * (vehicle.destroyed ? 2.5 : 1)
  }, {
    id: humanoid.id,
    x: humanoid.x,
    y: humanoid.y,
    velocityX: humanoid.velocityX,
    velocityY: humanoid.velocityY,
    radius: humanoid.radius,
    mass: VEHICLE_HUMANOID_MASS
  });
  if (!result.valid || !result.collided) return undefined;
  if (result.vehicleImpactSpeed >= vehicleHumanoidImpactThreshold(
    vehicle.interactionPriority === 'player-controlled'
  )) {
    context.sideEffects.dispatch('authoritative-gameplay', () => undefined);
  }
  const positions = safeSeparation(vehicle, humanoid, result, canOccupy);
  return Object.freeze([
    interactionVehicleState(vehicle, {
      x: positions.vehicleX,
      y: positions.vehicleY,
      angle: vehicle.angle,
      speed: vehicle.destroyed
        ? vehicle.speed
        : clampInteractionVehicleSpeed(result.vehicleSpeed)
    }, vehicle.steering, context.deltaSeconds),
    humanoidState(
      humanoid,
      positions.humanoidX,
      positions.humanoidY,
      result.humanoidVelocityX,
      result.humanoidVelocityY
    )
  ]);
}

function safeSeparation(
  vehicle: VehicleInteractionState,
  humanoid: HumanoidInteractionState,
  result: ReturnType<typeof resolveVehicleHumanoidContact>,
  canOccupy: InteractionWorldOccupancy
): {vehicleX: number; vehicleY: number; humanoidX: number; humanoidY: number} {
  const vehicleRadius = vehicleDefinition(vehicle.vehicleKind).radius;
  const vehicleCanMove = canOccupy(
    vehicle.spaceId,
    result.vehicleX,
    result.vehicleY,
    vehicleRadius
  );
  const humanoidCanMove = canOccupy(
    humanoid.spaceId,
    result.humanoidX,
    result.humanoidY,
    humanoid.radius
  );
  if (vehicleCanMove && humanoidCanMove) {
    return {
      vehicleX: result.vehicleX,
      vehicleY: result.vehicleY,
      humanoidX: result.humanoidX,
      humanoidY: result.humanoidY
    };
  }
  let vehicleX = vehicle.x;
  let vehicleY = vehicle.y;
  let humanoidX = humanoid.x;
  let humanoidY = humanoid.y;
  if (vehicleCanMove) {
    const x = vehicle.x - result.normalX * result.penetration;
    const y = vehicle.y - result.normalY * result.penetration;
    if (canOccupy(vehicle.spaceId, x, y, vehicleRadius)) {
      vehicleX = x;
      vehicleY = y;
    } else {
      vehicleX = result.vehicleX;
      vehicleY = result.vehicleY;
    }
  } else if (humanoidCanMove) {
    const x = humanoid.x + result.normalX * result.penetration;
    const y = humanoid.y + result.normalY * result.penetration;
    if (canOccupy(humanoid.spaceId, x, y, humanoid.radius)) {
      humanoidX = x;
      humanoidY = y;
    } else {
      humanoidX = result.humanoidX;
      humanoidY = result.humanoidY;
    }
  }
  return {vehicleX, vehicleY, humanoidX, humanoidY};
}

function isHumanoid(entity: InteractionEntityState): entity is HumanoidInteractionState {
  return entity.kind === 'player' || entity.kind === 'pedestrian';
}
