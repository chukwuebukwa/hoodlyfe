import {
  DISTRICT_POPULATION_FALLBACK,
  DISTRICT_POPULATION_ZONES,
  type AmbientVehicleKind,
  type DistrictPopulationZone,
  type PopulationMix
} from '../../../shared/content/district-population-zones.ts';
import {
  CIVILIAN_TRAFFIC_VEHICLE_KINDS,
  vehicleDefinition
} from '../../../shared/content/vehicle-catalog.ts';

const DAY_MINUTES = 24 * 60;
const VEHICLE_ORDER = CIVILIAN_TRAFFIC_VEHICLE_KINDS.filter(
  (kind): kind is AmbientVehicleKind => kind !== 'police'
);

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
    vehicleWeights: Object.freeze(Object.fromEntries(VEHICLE_ORDER.map((kind) => {
      const fallback = vehicleDefinition(kind).population.weight;
      return [kind, mix(
        zone.night.vehicleWeights[kind] ?? fallback,
        zone.day.vehicleWeights[kind] ?? fallback,
        dayWeight
      )];
    })) as Record<AmbientVehicleKind, number>)
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
    (sum, kind) => sum + Math.max(
      0,
      finite(profile.vehicleWeights[kind] ?? vehicleDefinition(kind).population.weight)
    ),
    0
  );
  if (total <= 0) return 'sedan';
  let cursor = clamp01(sample) * total;
  for (const kind of VEHICLE_ORDER) {
    cursor -= Math.max(
      0,
      finite(profile.vehicleWeights[kind] ?? vehicleDefinition(kind).population.weight)
    );
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
