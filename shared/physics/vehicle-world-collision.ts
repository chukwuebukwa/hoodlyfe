import {vehicleDefinition} from '../content/vehicle-catalog.ts';

export interface VehicleWorldPose {
  x: number;
  y: number;
  angle: number;
  speed: number;
}

export interface SweptVehicleWorldResult {
  pose: VehicleWorldPose;
  collided: boolean;
  sweepSteps: number;
}

export type VehicleWorldOccupancy = (x: number, y: number, radius: number) => boolean;

const MAX_SWEEP_STEP_DISTANCE = 6;
const SAMPLE_CLEARANCE = 1.5;
const MAX_SWEEP_STEPS = 48;

export function resolveSweptVehicleWorldCollision(
  start: VehicleWorldPose,
  attempted: VehicleWorldPose,
  kind: string,
  canOccupy: VehicleWorldOccupancy
): SweptVehicleWorldResult {
  const definition = vehicleDefinition(kind).collision;
  const halfDiagonal = Math.hypot(definition.length / 2, definition.width / 2);
  const distance = Math.hypot(attempted.x - start.x, attempted.y - start.y);
  const angleDelta = normalizeAngle(attempted.angle - start.angle);
  const sweptDistance = Math.max(distance, Math.abs(angleDelta) * halfDiagonal);
  const sweepSteps = Math.max(1, Math.min(
    MAX_SWEEP_STEPS,
    Math.ceil(sweptDistance / MAX_SWEEP_STEP_DISTANCE)
  ));
  let safe = {...start};
  for (let step = 1; step <= sweepSteps; step++) {
    const progress = step / sweepSteps;
    const candidate = {
      x: lerp(start.x, attempted.x, progress),
      y: lerp(start.y, attempted.y, progress),
      angle: normalizeAngle(start.angle + angleDelta * progress),
      speed: attempted.speed
    };
    if (!orientedVehicleCanOccupy(candidate, kind, canOccupy)) {
      return {
        pose: {
          ...safe,
          speed: attempted.speed * -0.2
        },
        collided: true,
        sweepSteps
      };
    }
    safe = candidate;
  }
  return {pose: attempted, collided: false, sweepSteps};
}

export function orientedVehicleCanOccupy(
  pose: Pick<VehicleWorldPose, 'x' | 'y' | 'angle'>,
  kind: string,
  canOccupy: VehicleWorldOccupancy
): boolean {
  const collision = vehicleDefinition(kind).collision;
  const halfLength = collision.length / 2;
  const halfWidth = collision.width / 2;
  const forwardX = Math.cos(pose.angle);
  const forwardY = Math.sin(pose.angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  for (const longitudinal of [-1, -0.5, 0, 0.5, 1]) {
    for (const lateral of [-1, 0, 1]) {
      const x = pose.x + forwardX * halfLength * longitudinal + sideX * halfWidth * lateral;
      const y = pose.y + forwardY * halfLength * longitudinal + sideY * halfWidth * lateral;
      if (!canOccupy(x, y, SAMPLE_CLEARANCE)) return false;
    }
  }
  return true;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function lerp(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}
