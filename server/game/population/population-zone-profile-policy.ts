import {
  DISTRICT_POPULATION_FALLBACK,
  DISTRICT_POPULATION_ZONES,
  type AmbientVehicleKind,
  type DistrictPopulationZone,
  type PopulationMix
} from '../../../shared/content/district-population-zones.ts';

const DAY_MINUTES = 24 * 60;
const VEHICLE_ORDER: readonly AmbientVehicleKind[] = ['sedan', 'taxi', 'r33', 's15'];

export interface ResolvedPopulationProfile extends PopulationMix {
  zone: DistrictPopulationZone;
  minute: number;
  dayWeight: number;
}

export function districtPopulationZoneAt(x: number, y: number): DistrictPopulationZone {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return DISTRICT_POPULATION_FALLBACK;
  return DISTRICT_POPULATION_ZONES.find((zone) => (
    x >= zone.bounds.minX && x <= zone.bounds.maxX &&
    y >= zone.bounds.minY && y <= zone.bounds.maxY
  )) ?? DISTRICT_POPULATION_FALLBACK;
}

export function populationDayWeightAtMinute(rawMinute: number): number {
  const minute = modulo(finite(rawMinute), DAY_MINUTES);
  if (minute >= 7 * 60 && minute < 18 * 60) return 1;
  if (minute >= 20 * 60 || minute < 5 * 60) return 0;
  if (minute < 7 * 60) return smooth((minute - 5 * 60) / (2 * 60));
  return 1 - smooth((minute - 18 * 60) / (2 * 60));
}

export function populationProfileAt(
  x: number,
  y: number,
  rawMinute: number
): ResolvedPopulationProfile {
  const zone = districtPopulationZoneAt(x, y);
  const minute = modulo(finite(rawMinute), DAY_MINUTES);
  const dayWeight = populationDayWeightAtMinute(minute);
  return {
    zone,
    minute,
    dayWeight,
    pedestrianDensity: mix(zone.night.pedestrianDensity, zone.day.pedestrianDensity, dayWeight),
    trafficDensity: mix(zone.night.trafficDensity, zone.day.trafficDensity, dayWeight),
    policeShare: mix(zone.night.policeShare, zone.day.policeShare, dayWeight),
    vehicleWeights: Object.freeze({
      sedan: mix(zone.night.vehicleWeights.sedan, zone.day.vehicleWeights.sedan, dayWeight),
      taxi: mix(zone.night.vehicleWeights.taxi, zone.day.vehicleWeights.taxi, dayWeight),
      r33: mix(zone.night.vehicleWeights.r33, zone.day.vehicleWeights.r33, dayWeight),
      s15: mix(zone.night.vehicleWeights.s15, zone.day.vehicleWeights.s15, dayWeight)
    })
  };
}

export function populationDensityAdmits(density: number, sample: number): boolean {
  return clamp01(sample) < clamp01(density);
}

export function pedestrianKindForProfile(
  profile: Pick<ResolvedPopulationProfile, 'policeShare'>,
  sample: number
): 'civilian' | 'police' {
  return clamp01(sample) < clamp01(profile.policeShare) ? 'police' : 'civilian';
}

export function vehicleKindForProfile(
  profile: Pick<ResolvedPopulationProfile, 'vehicleWeights'>,
  sample: number
): AmbientVehicleKind {
  const total = VEHICLE_ORDER.reduce(
    (sum, kind) => sum + Math.max(0, finite(profile.vehicleWeights[kind])),
    0
  );
  if (total <= 0) return 'sedan';
  let cursor = clamp01(sample) * total;
  for (const kind of VEHICLE_ORDER) {
    cursor -= Math.max(0, finite(profile.vehicleWeights[kind]));
    if (cursor < 0) return kind;
  }
  return VEHICLE_ORDER[VEHICLE_ORDER.length - 1];
}

function smooth(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * clamp01(amount);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value)));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
