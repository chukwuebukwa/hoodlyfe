import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import type {MovementVector} from '../input/client-input-policy.ts';
import {resolveSweptVehicleWorldCollision} from '../../../shared/physics/vehicle-world-collision.ts';

export interface PredictedVehiclePose {
  x: number;
  y: number;
  angle: number;
  speed: number;
}

export function predictVehiclePose(
  pose: PredictedVehiclePose,
  movement: MovementVector,
  kind: string,
  deltaSeconds: number
): PredictedVehiclePose {
  const delta = clamp(deltaSeconds, 0, 0.05);
  const handling = vehicleDefinition(kind).handling;
  const throttle = clamp(-movement.y, -1, 1);
  const steering = clamp(movement.x, -1, 1);
  let speed = pose.speed;
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
  speed = clamp(speed, -handling.maximumReverseSpeed, handling.maximumForwardSpeed);

  let angle = pose.angle;
  if (Math.abs(speed) > 4 && steering !== 0) {
    const grip = clamp(
      Math.abs(speed) / handling.steeringGripSpeed,
      handling.steeringGripFloor,
      1
    );
    angle = normalizeAngle(
      angle + steering * handling.steeringRate * grip * Math.sign(speed) * delta
    );
  }
  return {
    x: pose.x + Math.cos(angle) * speed * delta,
    y: pose.y + Math.sin(angle) * speed * delta,
    angle,
    speed
  };
}

export function predictVehiclePoseWithWorldCollision(
  pose: PredictedVehiclePose,
  movement: MovementVector,
  kind: string,
  deltaSeconds: number,
  canOccupy: (x: number, y: number, radius: number) => boolean
): PredictedVehiclePose {
  const predicted = predictVehiclePose(pose, movement, kind, deltaSeconds);
  return resolveSweptVehicleWorldCollision(pose, predicted, kind, canOccupy).pose;
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
