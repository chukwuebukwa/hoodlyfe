// Engine-backed vehicle stepping for prediction, mirroring the server's flagged
// simulation path exactly (shared recipe in vehicle-body-drive.ts). Humanoids,
// destroyed vehicles, and non-street spaces fall through to the kernel steps.

import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import type {
  InteractionEntityState,
  VehicleInteractionState
} from '../../../shared/protocol/interaction-contracts.ts';
import type {PhysicsWorld} from '../../../shared/physics/physics-world.ts';
import type {VehicleWorldPose} from '../../../shared/physics/vehicle-world-collision.ts';
import {
  captureVehicleBody,
  driveVehicleBody
} from '../../../shared/simulation/vehicle-body-drive.ts';
import {vehicleMechanicalStepModifiers} from '../../../shared/simulation/vehicle-step.ts';
import type {InteractionReplayBatchStep} from './interaction-island-replay.ts';
import type {VehiclePoseStepper} from './saved-vehicle-prediction.ts';
import {interactionVehicleState} from './vehicle-interaction-replay.ts';
import {predictVehiclePoseWithWorldCollision} from './vehicle-prediction-policy.ts';

export function createVehiclePhysicsBatchStep(world: PhysicsWorld): InteractionReplayBatchStep {
  return (entities, controls, context) => {
    const vehicles = entities.filter((entity): entity is VehicleInteractionState => (
      entity.kind === 'vehicle' && !entity.destroyed && entity.spaceId === STREET_SPACE_ID
    ));
    const memberIds = new Set(vehicles.map(({id}) => id));
    for (const key of [...world.keys()]) {
      if (!memberIds.has(key)) world.remove(key);
    }
    if (vehicles.length === 0) return undefined;
    const drives = new Map<string, {target: VehicleWorldPose; steering: number}>();
    for (const vehicle of vehicles) {
      const control = controls.get(vehicle.id);
      if (!control) continue;
      const steering = control.source === 'neutral' ? vehicle.steering : control.steering;
      const target = driveVehicleBody(
        world,
        vehicle.id,
        vehicle.vehicleKind,
        {x: vehicle.x, y: vehicle.y, angle: vehicle.angle, speed: vehicle.speed},
        {steering, throttle: control.throttle},
        context.deltaSeconds,
        vehicleMechanicalStepModifiers(
          vehicle.engineDamage,
          vehicle.onFire,
          vehicle.tyreDamageMask
        )
      );
      drives.set(vehicle.id, {target, steering});
    }
    if (drives.size === 0) return undefined;
    world.step();
    const stepped = new Map<string, InteractionEntityState>();
    for (const vehicle of vehicles) {
      const drive = drives.get(vehicle.id);
      if (!drive) continue;
      const captured = captureVehicleBody(world, vehicle.id, drive.target);
      if (!captured) continue;
      stepped.set(vehicle.id, interactionVehicleState(
        vehicle,
        captured.pose,
        drive.steering,
        context.deltaSeconds
      ));
    }
    return stepped;
  };
}

// The world is resolved per call: the rollout manifest arrives after entities may
// already exist, and the stage can revert mid-session. Without a world this is the
// plain kernel stepper.
export function createVehiclePhysicsPoseStepper(
  world: () => PhysicsWorld | undefined,
  vehicleId: string
): VehiclePoseStepper {
  return (pose, movement, kind, deltaSeconds, canOccupy, modifiers) => {
    const active = world();
    if (!active) {
      return predictVehiclePoseWithWorldCollision(
        pose,
        movement,
        kind,
        deltaSeconds,
        canOccupy,
        modifiers
      );
    }
    for (const key of [...active.keys()]) {
      if (key !== vehicleId) active.remove(key);
    }
    const target = driveVehicleBody(
      active,
      vehicleId,
      kind,
      pose,
      {steering: movement.x, throttle: -movement.y},
      deltaSeconds,
      modifiers
    );
    active.step();
    return captureVehicleBody(active, vehicleId, target)?.pose ?? target;
  };
}
