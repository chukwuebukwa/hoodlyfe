import type {VehicleKind} from './vehicle-catalog.ts';
import {districtBounds} from './district-map-frame.ts';

export type AmbientVehicleKind = Exclude<VehicleKind, 'police'>;

export interface PopulationMix {
  pedestrianDensity: number;
  trafficDensity: number;
  policeShare: number;
  vehicleWeights: Readonly<Partial<Record<AmbientVehicleKind, number>>>;
}

export interface DistrictPopulationZone {
  id: string;
  label: string;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  day: PopulationMix;
  night: PopulationMix;
}

const WORLD_MAX = 4_096;

export const DISTRICT_POPULATION_ZONES: readonly DistrictPopulationZone[] = Object.freeze([
  zone('north-works', 'North Works', 0, 0, WORLD_MAX, 1_151, {
    pedestrianDensity: 1,
    trafficDensity: 0.9,
    policeShare: 0.08,
    vehicleWeights: weights(7, 2, 1, 1, 1)
  }, {
    pedestrianDensity: 0.48,
    trafficDensity: 0.5,
    policeShare: 0.13,
    vehicleWeights: weights(5, 1, 2, 2, 2)
  }),
  zone('west-market', 'West Market', 0, 1_152, 2_303, 2_303, {
    pedestrianDensity: 1,
    trafficDensity: 0.86,
    policeShare: 0.09,
    vehicleWeights: weights(5, 4, 1, 1, 2)
  }, {
    pedestrianDensity: 0.72,
    trafficDensity: 0.68,
    policeShare: 0.11,
    vehicleWeights: weights(5, 2, 2, 2, 2)
  }),
  zone('civic-east', 'Civic East', 2_304, 1_152, WORLD_MAX, 2_303, {
    pedestrianDensity: 0.94,
    trafficDensity: 0.82,
    policeShare: 0.17,
    vehicleWeights: weights(5, 4, 1, 1, 2)
  }, {
    pedestrianDensity: 0.58,
    trafficDensity: 0.54,
    policeShare: 0.2,
    vehicleWeights: weights(5, 2, 1, 1, 2)
  }),
  zone('south-freight', 'South Freight', 0, 2_304, WORLD_MAX, WORLD_MAX, {
    pedestrianDensity: 0.68,
    trafficDensity: 0.92,
    policeShare: 0.07,
    vehicleWeights: weights(7, 1, 2, 2, 3)
  }, {
    pedestrianDensity: 0.4,
    trafficDensity: 0.66,
    policeShare: 0.1,
    vehicleWeights: weights(5, 1, 3, 3, 3)
  })
]);

export const DISTRICT_POPULATION_FALLBACK: DistrictPopulationZone = zone(
  'district-default',
  'District Default',
  Number.NEGATIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  {
    pedestrianDensity: 0.78,
    trafficDensity: 0.76,
    policeShare: 0.09,
    vehicleWeights: weights(6, 2, 1, 1, 2)
  },
  {
    pedestrianDensity: 0.46,
    trafficDensity: 0.56,
    policeShare: 0.12,
    vehicleWeights: weights(5, 1, 2, 2, 2)
  }
);

function zone(
  id: string,
  label: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  day: PopulationMix,
  night: PopulationMix
): DistrictPopulationZone {
  return Object.freeze({
    id,
    label,
    bounds: Object.freeze(districtBounds({minX, minY, maxX, maxY})),
    day: freezeMix(day),
    night: freezeMix(night)
  });
}

function weights(
  sedan: number,
  taxi: number,
  r33: number,
  s15: number,
  suv: number
): Readonly<Partial<Record<AmbientVehicleKind, number>>> {
  return Object.freeze({sedan, taxi, r33, s15, suv});
}

function freezeMix(mix: PopulationMix): PopulationMix {
  return Object.freeze({...mix, vehicleWeights: Object.freeze({...mix.vehicleWeights})});
}
