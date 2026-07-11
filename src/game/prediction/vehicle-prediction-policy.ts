import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import type {MovementVector} from '../input/client-input-policy.ts';

export interface PredictedVehiclePose {
  x: number;
  y: number;
  angle: number;
  speed: number;
}

export interface VehicleReconciliation {
  pose: PredictedVehiclePose;
  error: number;
  snapped: boolean;
}

const SNAP_DISTANCE = 180;

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

export function reconcileVehiclePose(
  predicted: PredictedVehiclePose,
  authoritative: PredictedVehiclePose,
  deltaSeconds: number
): VehicleReconciliation {
  const error = Math.hypot(authoritative.x - predicted.x, authoritative.y - predicted.y);
  if (error > SNAP_DISTANCE) return {pose: {...authoritative}, error, snapped: true};
  const delta = clamp(deltaSeconds, 0, 0.05);
  const positionRate = error < 24 ? 3.5 : (error < 80 ? 7 : 12);
  const positionFactor = 1 - Math.exp(-positionRate * delta);
  const speedFactor = 1 - Math.exp(-5 * delta);
  return {
    pose: {
      x: lerp(predicted.x, authoritative.x, positionFactor),
      y: lerp(predicted.y, authoritative.y, positionFactor),
      angle: rotateTowards(predicted.angle, authoritative.angle, 2.8 * delta),
      speed: lerp(predicted.speed, authoritative.speed, speedFactor)
    },
    error,
    snapped: false
  };
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function rotateTowards(current: number, target: number, maximumStep: number): number {
  const difference = normalizeAngle(target - current);
  if (Math.abs(difference) <= maximumStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(difference) * maximumStep);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function lerp(left: number, right: number, factor: number): number {
  return left + (right - left) * clamp(factor, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
