import type {NetworkVehicle} from '../types.ts';

export interface VehicleVisualState {
  frame: number;
  stage: 'healthy' | 'damaged' | 'smoking' | 'burning' | 'wrecked';
  smoke: boolean;
  fire: boolean;
  alpha: number;
  tint?: number;
}

export function vehicleVisualState(vehicle: NetworkVehicle): VehicleVisualState {
  const frame = vehicleFrame(vehicle.kind);
  if (vehicle.destroyed) {
    return {frame, stage: 'wrecked', smoke: true, fire: true, alpha: 0.68, tint: 0x4f4f4f};
  }
  if (vehicle.onFire) {
    return {frame, stage: 'burning', smoke: true, fire: true, alpha: 1, tint: 0xc77b68};
  }
  if (vehicle.engineDamage >= 100) {
    return {frame, stage: 'smoking', smoke: true, fire: false, alpha: 1, tint: 0xc77b68};
  }
  const healthRatio = vehicle.health / Math.max(1, vehicle.maxHealth);
  if (healthRatio < 0.35) {
    return {frame, stage: 'damaged', smoke: false, fire: false, alpha: 1, tint: 0xc77b68};
  }
  return {frame, stage: 'healthy', smoke: false, fire: false, alpha: 1};
}

export function vehicleFrame(kind: NetworkVehicle['kind']): number {
  if (kind === 'police') return 1;
  if (kind === 'taxi') return 2;
  return 0;
}
