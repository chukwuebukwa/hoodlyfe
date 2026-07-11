import type {NetworkVehicle} from '../types.ts';

export interface VehicleLightPresentation {
  active: boolean;
  frontOpacity: number;
  rearColor: number;
  rearOpacity: number;
}

export interface EmergencyLightPresentation {
  active: boolean;
  redOpacity: number;
  blueOpacity: number;
}

export function vehicleLightPresentation(
  vehicle: NetworkVehicle,
  nightIntensity: number,
  nearby: boolean
): VehicleLightPresentation {
  const darkness = Math.max(0, Math.min(1, nightIntensity));
  const operational = !vehicle.destroyed && !vehicle.onFire && vehicle.health > 0;
  const engineActive = vehicle.traffic || Boolean(vehicle.driverId);
  const active = nearby && operational && engineActive && darkness > 0.02;
  if (!active) return {active: false, frontOpacity: 0, rearColor: 0xff1f2f, rearOpacity: 0};

  const frontHealth = 1 - Math.max(0, Math.min(1, vehicle.damageFront));
  const rearHealth = 1 - Math.max(0, Math.min(1, vehicle.damageRear));
  const reversing = vehicle.speed < -4;
  return {
    active: true,
    frontOpacity: darkness * (0.1 + frontHealth * 0.24),
    rearColor: reversing ? 0xf4f0d8 : 0xff1f2f,
    rearOpacity: darkness * rearHealth * (reversing ? 0.34 : 0.24)
  };
}

export function emergencyLightPresentation(
  vehicle: NetworkVehicle,
  nowMs: number
): EmergencyLightPresentation {
  const active = vehicle.kind === 'police' && Boolean(vehicle.siren) &&
    !vehicle.destroyed && !vehicle.onFire && vehicle.health > 0;
  if (!active) return {active: false, redOpacity: 0, blueOpacity: 0};
  const redPhase = Math.floor(Math.max(0, nowMs) / 120) % 2 === 0;
  return {
    active: true,
    redOpacity: redPhase ? 0.92 : 0.16,
    blueOpacity: redPhase ? 0.16 : 0.92
  };
}
