import generatedCatalog from './vehicle-catalog.generated.json';

export type VehicleKind = keyof typeof generatedCatalog.vehicles;
export type VehicleClass = 'civilian' | 'service' | 'emergency';

export interface VehicleHandlingDefinition {
  readonly forwardAcceleration: number;
  readonly reverseAcceleration: number;
  readonly coastDeceleration: number;
  readonly brakeDeceleration: number;
  readonly maximumForwardSpeed: number;
  readonly maximumReverseSpeed: number;
  readonly steeringRate: number;
  readonly steeringGripFloor: number;
  readonly steeringGripSpeed: number;
  readonly lateralGrip: number;
  readonly handbrakeLateralGrip: number;
  readonly yawResponse: number;
  readonly handbrakeTurnMultiplier: number;
  readonly powerOversteer: number;
}

export interface VehicleTrafficDefinition {
  readonly cruiseSpeed: number;
  readonly acceleration: number;
  readonly brakeDeceleration: number;
  readonly minimumGap: number;
  readonly followingTime: number;
  readonly pedestrianGap: number;
  readonly lookAhead: number;
}

export interface VehiclePopulationDefinition {
  readonly parked: boolean;
  readonly ambientTraffic: boolean;
  readonly weight: number;
}

export interface VehicleSpriteOffsetDefinition {
  readonly x: number;
  readonly y: number;
}

export interface VehiclePresentationDefinition {
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly emergencyLights: boolean;
  readonly offsets: readonly VehicleSpriteOffsetDefinition[];
}

export interface VehicleCollisionDefinition {
  readonly length: number;
  readonly width: number;
}

export interface VehicleDefinition {
  readonly id: VehicleKind;
  readonly label: string;
  readonly class: VehicleClass;
  readonly seats: number;
  readonly radius: number;
  readonly maxHealth: number;
  readonly mass: number;
  readonly collisionDamageScale: number;
  readonly collision: VehicleCollisionDefinition;
  readonly handling: VehicleHandlingDefinition;
  readonly traffic: VehicleTrafficDefinition;
  readonly population: VehiclePopulationDefinition;
  readonly presentation: VehiclePresentationDefinition;
}

const VEHICLE_CATALOG = generatedCatalog.vehicles as unknown as Readonly<
  Record<VehicleKind, VehicleDefinition>
>;

export const VEHICLE_KINDS = Object.freeze(
  [...generatedCatalog.order] as VehicleKind[]
);
export const CIVILIAN_TRAFFIC_VEHICLE_KINDS = Object.freeze(
  VEHICLE_KINDS.filter((kind) => VEHICLE_CATALOG[kind].population.ambientTraffic)
);
export const PARKED_VEHICLE_KINDS = Object.freeze(
  VEHICLE_KINDS.filter((kind) => VEHICLE_CATALOG[kind].population.parked)
);

export function vehicleDefinition(kind: string): VehicleDefinition {
  return isVehicleKind(kind) ? VEHICLE_CATALOG[kind] : VEHICLE_CATALOG.sedan;
}

export function isVehicleKind(kind: string): kind is VehicleKind {
  return Object.hasOwn(VEHICLE_CATALOG, kind);
}
