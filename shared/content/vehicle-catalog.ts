export type VehicleKind = 'sedan' | 'police' | 'taxi';
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

export interface VehiclePresentationDefinition {
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly emergencyLights: boolean;
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
  readonly handling: VehicleHandlingDefinition;
  readonly traffic: VehicleTrafficDefinition;
  readonly presentation: VehiclePresentationDefinition;
}

const VEHICLE_CATALOG: Readonly<Record<VehicleKind, VehicleDefinition>> = {
  sedan: {
    id: 'sedan',
    label: 'Sedan',
    class: 'civilian',
    seats: 4,
    radius: 20,
    maxHealth: 1000,
    mass: 1,
    collisionDamageScale: 1,
    handling: {
      forwardAcceleration: 390,
      reverseAcceleration: 270,
      coastDeceleration: 150,
      brakeDeceleration: 280,
      maximumForwardSpeed: 410,
      maximumReverseSpeed: 115,
      steeringRate: 2.35,
      steeringGripFloor: 0.22,
      steeringGripSpeed: 120
    },
    traffic: {
      cruiseSpeed: 118,
      acceleration: 85,
      brakeDeceleration: 290,
      minimumGap: 28,
      followingTime: 0.58,
      pedestrianGap: 38,
      lookAhead: 260
    },
    presentation: {frame: 0, width: 96, height: 96, emergencyLights: false}
  },
  police: {
    id: 'police',
    label: 'Police Cruiser',
    class: 'emergency',
    seats: 4,
    radius: 20,
    maxHealth: 1200,
    mass: 1.12,
    collisionDamageScale: 0.82,
    handling: {
      forwardAcceleration: 440,
      reverseAcceleration: 300,
      coastDeceleration: 155,
      brakeDeceleration: 330,
      maximumForwardSpeed: 450,
      maximumReverseSpeed: 125,
      steeringRate: 2.55,
      steeringGripFloor: 0.24,
      steeringGripSpeed: 115
    },
    traffic: {
      cruiseSpeed: 142,
      acceleration: 110,
      brakeDeceleration: 350,
      minimumGap: 26,
      followingTime: 0.5,
      pedestrianGap: 38,
      lookAhead: 290
    },
    presentation: {frame: 1, width: 96, height: 96, emergencyLights: true}
  },
  taxi: {
    id: 'taxi',
    label: 'Taxi',
    class: 'service',
    seats: 4,
    radius: 20,
    maxHealth: 950,
    mass: 1.05,
    collisionDamageScale: 0.95,
    handling: {
      forwardAcceleration: 360,
      reverseAcceleration: 250,
      coastDeceleration: 165,
      brakeDeceleration: 300,
      maximumForwardSpeed: 385,
      maximumReverseSpeed: 105,
      steeringRate: 2.5,
      steeringGripFloor: 0.25,
      steeringGripSpeed: 110
    },
    traffic: {
      cruiseSpeed: 108,
      acceleration: 78,
      brakeDeceleration: 310,
      minimumGap: 30,
      followingTime: 0.64,
      pedestrianGap: 40,
      lookAhead: 250
    },
    presentation: {frame: 2, width: 96, height: 96, emergencyLights: false}
  }
};

export const VEHICLE_KINDS = Object.freeze(Object.keys(VEHICLE_CATALOG) as VehicleKind[]);

export function vehicleDefinition(kind: string): VehicleDefinition {
  return isVehicleKind(kind) ? VEHICLE_CATALOG[kind] : VEHICLE_CATALOG.sedan;
}

export function isVehicleKind(kind: string): kind is VehicleKind {
  return Object.hasOwn(VEHICLE_CATALOG, kind);
}
