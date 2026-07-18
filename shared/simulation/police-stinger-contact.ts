import {vehicleDefinition, type VehicleKind} from '../content/vehicle-catalog.ts';
import {
  VEHICLE_TYRE,
  normalizeVehicleTyreMask,
  type VehicleTyreBit
} from './vehicle-tyre-state.ts';

export const POLICE_STINGER_SEGMENT_COUNT = 12;
export const POLICE_STINGER_SEGMENT_SPACING = 8;
export const POLICE_STINGER_CONTACT_RADIUS = 6;

export interface StingerPose {
  x: number;
  y: number;
  angle: number;
  activeSegmentCount: number;
}

export interface StingerVehiclePose {
  x: number;
  y: number;
  angle: number;
}

export interface StingerSegmentPosition {
  index: number;
  x: number;
  y: number;
}

export interface VehicleWheelPosition extends StingerVehiclePose {
  tyre: VehicleTyreBit;
}

export function policeStingerSegmentPositions(stinger: StingerPose): StingerSegmentPosition[] {
  const count = Math.max(
    0,
    Math.min(POLICE_STINGER_SEGMENT_COUNT, Math.floor(finite(stinger.activeSegmentCount)))
  );
  const halfLength = (POLICE_STINGER_SEGMENT_COUNT - 1) * POLICE_STINGER_SEGMENT_SPACING / 2;
  const axisX = Math.cos(finite(stinger.angle));
  const axisY = Math.sin(finite(stinger.angle));
  return Array.from({length: count}, (_, index) => {
    const offset = index * POLICE_STINGER_SEGMENT_SPACING - halfLength;
    return Object.freeze({
      index,
      x: finite(stinger.x) + axisX * offset,
      y: finite(stinger.y) + axisY * offset
    });
  });
}

export function vehicleWheelPositions(
  pose: StingerVehiclePose,
  kind: VehicleKind
): VehicleWheelPosition[] {
  const collision = vehicleDefinition(kind).collision;
  const forwardOffset = collision.length * 0.32;
  const lateralOffset = collision.width * 0.36;
  const angle = finite(pose.angle);
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const leftX = Math.sin(angle);
  const leftY = -Math.cos(angle);
  return [
    wheel(VEHICLE_TYRE.frontLeft, forwardOffset, lateralOffset),
    wheel(VEHICLE_TYRE.rearLeft, -forwardOffset, lateralOffset),
    wheel(VEHICLE_TYRE.frontRight, forwardOffset, -lateralOffset),
    wheel(VEHICLE_TYRE.rearRight, -forwardOffset, -lateralOffset)
  ];

  function wheel(
    tyre: VehicleTyreBit,
    longitudinal: number,
    lateral: number
  ): VehicleWheelPosition {
    return Object.freeze({
      tyre,
      x: finite(pose.x) + forwardX * longitudinal + leftX * lateral,
      y: finite(pose.y) + forwardY * longitudinal + leftY * lateral,
      angle
    });
  }
}

export function policeStingerBurstMask(
  stinger: StingerPose,
  previousPose: StingerVehiclePose,
  currentPose: StingerVehiclePose,
  kind: VehicleKind,
  existingMask = 0
): number {
  const segments = policeStingerSegmentPositions(stinger);
  if (segments.length === 0) return 0;
  const previousWheels = vehicleWheelPositions(previousPose, kind);
  const currentWheels = vehicleWheelPositions(currentPose, kind);
  const normalizedExisting = normalizeVehicleTyreMask(existingMask);
  let burstMask = 0;
  for (let index = 0; index < currentWheels.length; index++) {
    const current = currentWheels[index];
    if ((normalizedExisting & current.tyre) !== 0) continue;
    const previous = previousWheels[index];
    if (segments.some((segment) => (
      distancePointToSegment(segment.x, segment.y, previous.x, previous.y, current.x, current.y) <=
        POLICE_STINGER_CONTACT_RADIUS
    ))) burstMask |= current.tyre;
  }
  return normalizeVehicleTyreMask(burstMask);
}

function distancePointToSegment(
  pointX: number,
  pointY: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): number {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(pointX - fromX, pointY - fromY);
  const progress = Math.max(0, Math.min(1, (
    (pointX - fromX) * deltaX + (pointY - fromY) * deltaY
  ) / lengthSquared));
  return Math.hypot(pointX - (fromX + deltaX * progress), pointY - (fromY + deltaY * progress));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
