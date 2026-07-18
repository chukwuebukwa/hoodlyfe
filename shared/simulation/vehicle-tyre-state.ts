export const VEHICLE_TYRE = Object.freeze({
  frontLeft: 1 << 0,
  rearLeft: 1 << 1,
  frontRight: 1 << 2,
  rearRight: 1 << 3
});

export const VEHICLE_TYRE_MASK = Object.freeze({
  left: VEHICLE_TYRE.frontLeft | VEHICLE_TYRE.rearLeft,
  right: VEHICLE_TYRE.frontRight | VEHICLE_TYRE.rearRight,
  all: VEHICLE_TYRE.frontLeft | VEHICLE_TYRE.rearLeft |
    VEHICLE_TYRE.frontRight | VEHICLE_TYRE.rearRight
});

export type VehicleTyreBit = typeof VEHICLE_TYRE[keyof typeof VEHICLE_TYRE];

export interface VehicleTyreHandlingModifiers {
  burstCount: number;
  maximumSpeedMultiplier: number;
  accelerationMultiplier: number;
  brakeDecelerationMultiplier: number;
  coastDecelerationMultiplier: number;
  steeringRateMultiplier: number;
  steeringBias: number;
}

const SPEED_MULTIPLIER = [1, 0.88, 0.74, 0.62, 0.52] as const;
const ACCELERATION_MULTIPLIER = [1, 0.9, 0.8, 0.7, 0.6] as const;
const BRAKE_MULTIPLIER = [1, 0.92, 0.82, 0.72, 0.62] as const;
const COAST_MULTIPLIER = [1, 1.18, 1.32, 1.48, 1.64] as const;
const STEERING_RATE_MULTIPLIER = [1, 0.9, 0.78, 0.68, 0.58] as const;
const STEERING_PULL_PER_SIDE_IMBALANCE = 0.055;

export function normalizeVehicleTyreMask(value: number): number {
  if (!Number.isSafeInteger(value)) return 0;
  return value & VEHICLE_TYRE_MASK.all;
}

export function vehicleTyreBurstCount(mask: number): number {
  let remaining = normalizeVehicleTyreMask(mask);
  let count = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count++;
  }
  return count;
}

export function vehicleTyreIsBurst(mask: number, tyre: VehicleTyreBit): boolean {
  return (normalizeVehicleTyreMask(mask) & tyre) !== 0;
}

export function vehicleTyreHandlingModifiers(mask: number): VehicleTyreHandlingModifiers {
  const normalized = normalizeVehicleTyreMask(mask);
  const burstCount = vehicleTyreBurstCount(normalized);
  const leftCount = vehicleTyreBurstCount(normalized & VEHICLE_TYRE_MASK.left);
  const rightCount = vehicleTyreBurstCount(normalized & VEHICLE_TYRE_MASK.right);
  return Object.freeze({
    burstCount,
    maximumSpeedMultiplier: SPEED_MULTIPLIER[burstCount],
    accelerationMultiplier: ACCELERATION_MULTIPLIER[burstCount],
    brakeDecelerationMultiplier: BRAKE_MULTIPLIER[burstCount],
    coastDecelerationMultiplier: COAST_MULTIPLIER[burstCount],
    steeringRateMultiplier: STEERING_RATE_MULTIPLIER[burstCount],
    // Screen-space angles increase clockwise, so right-side damage pulls clockwise.
    steeringBias: (rightCount - leftCount) * STEERING_PULL_PER_SIDE_IMBALANCE
  });
}
