import {vehicleDefinition} from '../content/vehicle-catalog.ts';
import {
  resolveSweptVehicleWorldCollision,
  type VehicleWorldOccupancy,
  type VehicleWorldPose
} from '../physics/vehicle-world-collision.ts';

export const VEHICLE_SIMULATION_HZ = 30;
export const VEHICLE_SIMULATION_STEP_SECONDS = 1 / VEHICLE_SIMULATION_HZ;
export const MAX_VEHICLE_STEP_SECONDS = 0.05;

export interface VehicleControlCommand {
  steering: number;
  throttle: number;
}

export interface VehicleStepModifiers {
  maximumSpeedMultiplier?: number;
}

export interface VehicleStepResult {
  pose: VehicleWorldPose;
  attemptedPose: VehicleWorldPose;
  impactSpeed: number;
  collidedWithWorld: boolean;
  sweepSteps: number;
}

export function integrateVehiclePose(
  pose: VehicleWorldPose,
  command: VehicleControlCommand,
  kind: string,
  deltaSeconds: number,
  modifiers: VehicleStepModifiers = {}
): VehicleWorldPose {
  const delta = finiteClamp(deltaSeconds, 0, MAX_VEHICLE_STEP_SECONDS);
  const handling = vehicleDefinition(kind).handling;
  const throttle = finiteClamp(command.throttle, -1, 1);
  const steering = finiteClamp(command.steering, -1, 1);
  const speedMultiplier = finiteClamp(modifiers.maximumSpeedMultiplier ?? 1, 0, 1);
  let speed = finite(pose.speed);

  if (throttle !== 0) {
    const changingDirection = speed !== 0 && Math.sign(speed) !== Math.sign(throttle);
    if (changingDirection) {
      speed = approach(speed, 0, handling.brakeDeceleration * delta);
    } else {
      const acceleration = throttle > 0
        ? handling.forwardAcceleration
        : handling.reverseAcceleration;
      speed += throttle * acceleration * delta;
    }
  } else {
    speed = approach(speed, 0, handling.coastDeceleration * delta);
  }

  speed = finiteClamp(
    speed,
    -handling.maximumReverseSpeed * speedMultiplier,
    handling.maximumForwardSpeed * speedMultiplier
  );

  let angle = normalizeAngle(finite(pose.angle));
  if (Math.abs(speed) > 4 && steering !== 0) {
    const grip = finiteClamp(
      Math.abs(speed) / handling.steeringGripSpeed,
      handling.steeringGripFloor,
      1
    );
    const direction = speed >= 0 ? 1 : -1;
    angle = normalizeAngle(
      angle + steering * handling.steeringRate * grip * direction * delta
    );
  }

  const x = finite(pose.x);
  const y = finite(pose.y);
  return {
    x: x + Math.cos(angle) * speed * delta,
    y: y + Math.sin(angle) * speed * delta,
    angle,
    speed
  };
}

export function stepVehicleWithWorldCollision(
  pose: VehicleWorldPose,
  command: VehicleControlCommand,
  kind: string,
  deltaSeconds: number,
  canOccupy: VehicleWorldOccupancy,
  modifiers: VehicleStepModifiers = {}
): VehicleStepResult {
  const attemptedPose = integrateVehiclePose(pose, command, kind, deltaSeconds, modifiers);
  const collision = resolveSweptVehicleWorldCollision(pose, attemptedPose, kind, canOccupy);
  return {
    pose: collision.pose,
    attemptedPose,
    impactSpeed: collision.collided ? attemptedPose.speed : 0,
    collidedWithWorld: collision.collided,
    sweepSteps: collision.sweepSteps
  };
}

export function vehicleMechanicalSpeedMultiplier(engineDamage: number, onFire: boolean): number {
  const engineRatio = finiteClamp(engineDamage / 250, 0, 1);
  const mechanicalLimit = 1 - engineRatio * 0.38;
  return onFire ? Math.min(mechanicalLimit, 0.58) : mechanicalLimit;
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, finite(value)));
}
