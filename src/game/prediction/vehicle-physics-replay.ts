// Engine-backed stepping shared by direct prediction and interaction-island replay.

import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {STREET_GROUND_SURFACE_ID} from '../../../shared/world/surface-map.ts';
import type {
  HumanoidInteractionState,
  InteractionEntityState,
  VehicleInteractionState
} from '../../../shared/protocol/interaction-contracts.ts';
import type {PhysicsWorld} from '../../../shared/physics/physics-world.ts';
import type {VehicleWorldPose} from '../../../shared/simulation/vehicle-step.ts';
import {
  captureVehicleBody,
  driveVehicleBody
} from '../../../shared/simulation/vehicle-body-drive.ts';
import {
  captureHumanoidBody,
  driveHumanoidBody,
  physicsBodyKey
} from '../../../shared/simulation/humanoid-body-drive.ts';
import {
  vehicleMechanicalStepModifiers
} from '../../../shared/simulation/vehicle-step.ts';
import {
  integrateOnFootPose,
  stepInteriorOnFootPose
} from '../../../shared/simulation/on-foot-step.ts';
import type {InteractionReplayBatchStep} from './interaction-island-replay.ts';
import type {OnFootPoseStepper} from './saved-on-foot-prediction.ts';
import type {VehiclePoseStepper} from './saved-vehicle-prediction.ts';
import {interactionVehicleState} from './vehicle-interaction-replay.ts';
import {
  allowsHumanoidMovement,
  humanoidState
} from './on-foot-interaction-replay.ts';

export function createVehiclePhysicsBatchStep(world: PhysicsWorld): InteractionReplayBatchStep {
  return (entities, controls, context) => {
    for (const key of [...world.keys()]) world.remove(key);
    world.setStaticsEnabled(
      entities[0]?.surfaceId === STREET_GROUND_SURFACE_ID
    );
    const vehicles = entities.filter((entity): entity is VehicleInteractionState => (
      entity.kind === 'vehicle' && entity.spaceId === STREET_SPACE_ID
    ));
    const humanoids = entities.filter((entity): entity is HumanoidInteractionState => (
      (entity.kind === 'player' || entity.kind === 'pedestrian') &&
      entity.alive && entity.spaceId === STREET_SPACE_ID
    ));
    const memberIds = new Set([
      ...vehicles.map(({id}) => physicsBodyKey('vehicle', id)),
      ...humanoids.map(({kind, id}) => physicsBodyKey(kind, id))
    ]);
    if (memberIds.size === 0) return undefined;
    const drives = new Map<string, {target: VehicleWorldPose; steering: number}>();
    for (const vehicle of vehicles) {
      const control = controls.get(vehicle.id);
      if (!control) continue;
      const steering = vehicle.destroyed
        ? 0
        : control.source === 'neutral' ? vehicle.steering : control.steering;
      const target = driveVehicleBody(
        world,
        physicsBodyKey('vehicle', vehicle.id),
        vehicle.vehicleKind,
        {
          x: vehicle.x,
          y: vehicle.y,
          angle: vehicle.angle,
          speed: vehicle.destroyed ? 0 : vehicle.speed
        },
        {steering, throttle: vehicle.destroyed ? 0 : control.throttle},
        context.deltaSeconds,
        vehicleMechanicalStepModifiers(
          vehicle.engineDamage,
          vehicle.onFire,
          vehicle.tyreDamageMask
        )
      );
      drives.set(vehicle.id, {target, steering});
    }
    for (const humanoid of humanoids) {
      const control = controls.get(humanoid.id);
      if (!control) continue;
      const movementScale = allowsHumanoidMovement(humanoid.actionPhase)
        ? control.movementScale
        : 0;
      const pose = {x: humanoid.x, y: humanoid.y, spaceId: humanoid.spaceId};
      const desired = integrateOnFootPose(
        pose,
        {moveX: control.moveX, moveY: control.moveY},
        context.deltaSeconds,
        {movementScale, radius: humanoid.radius}
      );
      driveHumanoidBody(
        world,
        physicsBodyKey(humanoid.kind, humanoid.id),
        humanoid.radius,
        pose,
        desired,
        context.deltaSeconds
      );
    }
    world.step();
    const stepped = new Map<string, InteractionEntityState>();
    for (const vehicle of vehicles) {
      const drive = drives.get(vehicle.id);
      if (!drive) continue;
      const captured = captureVehicleBody(
        world,
        physicsBodyKey('vehicle', vehicle.id),
        drive.target
      );
      if (!captured) continue;
      stepped.set(vehicle.id, interactionVehicleState(
        vehicle,
        captured.pose,
        drive.steering,
        context.deltaSeconds
      ));
    }
    for (const humanoid of humanoids) {
      const key = physicsBodyKey(humanoid.kind, humanoid.id);
      const pose = captureHumanoidBody(world, key, humanoid.spaceId);
      const state = world.capture(key);
      if (!pose || !state) continue;
      stepped.set(humanoid.id, humanoidState(
        humanoid,
        pose.x,
        pose.y,
        state.linvelX,
        state.linvelY
      ));
    }
    return stepped;
  };
}

export function createVehiclePhysicsPoseStepper(
  world: () => PhysicsWorld | undefined,
  vehicleId: string
): VehiclePoseStepper {
  return (pose, movement, kind, deltaSeconds, canOccupy, modifiers) => {
    const active = world();
    if (!active) throw new Error('Vehicle physics world is not initialized.');
    for (const key of [...active.keys()]) active.remove(key);
    const key = physicsBodyKey('vehicle', vehicleId);
    const target = driveVehicleBody(
      active,
      key,
      kind,
      pose,
      {steering: movement.x, throttle: -movement.y},
      deltaSeconds,
      modifiers
    );
    const occupancy = canOccupy(
      target.x,
      target.y,
      20,
      pose.surfaceId,
      pose.x,
      pose.y
    );
    if (!occupancy) return {...pose, speed: 0};
    const surfaceId = typeof occupancy === 'string' ? occupancy : pose.surfaceId;
    active.setStaticsEnabled(
      (surfaceId ?? STREET_GROUND_SURFACE_ID) === STREET_GROUND_SURFACE_ID
    );
    active.step();
    return {
      ...(captureVehicleBody(active, key, target)?.pose ?? target),
      ...(surfaceId ? {surfaceId} : {})
    };
  };
}

export function createHumanoidPhysicsPoseStepper(
  world: () => PhysicsWorld | undefined,
  playerId: string,
  radius = 11
): OnFootPoseStepper {
  return (pose, command, deltaSeconds, canOccupy, modifiers) => {
    if (pose.spaceId !== STREET_SPACE_ID) {
      return stepInteriorOnFootPose(
        pose,
        command,
        deltaSeconds,
        canOccupy,
        modifiers
      ).pose;
    }
    const active = world();
    if (!active) throw new Error('Humanoid physics world is not initialized.');
    for (const key of [...active.keys()]) active.remove(key);
    const desired = stepInteriorOnFootPose(
      pose,
      command,
      deltaSeconds,
      canOccupy,
      modifiers
    ).pose;
    active.setStaticsEnabled(
      (desired.surfaceId ?? STREET_GROUND_SURFACE_ID) === STREET_GROUND_SURFACE_ID
    );
    const key = physicsBodyKey('player', playerId);
    driveHumanoidBody(active, key, radius, pose, desired, deltaSeconds);
    active.step();
    return {
      ...(captureHumanoidBody(active, key, pose.spaceId) ?? desired),
      ...(desired.surfaceId ? {surfaceId: desired.surfaceId} : {})
    };
  };
}
