export type VehicleKind = 'sedan' | 'police' | 'taxi' | 'r33' | 's15';
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

export interface VehiclePresentationDefinition {
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly emergencyLights: boolean;
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
    collision: {length: 58, width: 32},
    handling: {
      forwardAcceleration: 390,
      reverseAcceleration: 270,
      coastDeceleration: 150,
      brakeDeceleration: 280,
      maximumForwardSpeed: 410,
      maximumReverseSpeed: 115,
      steeringRate: 2.35,
      steeringGripFloor: 0.22,
      steeringGripSpeed: 120,
      lateralGrip: 18,
      handbrakeLateralGrip: 1.4,
      yawResponse: 12,
      handbrakeTurnMultiplier: 1.35,
      powerOversteer: 0.05
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
    collision: {length: 60, width: 33},
    handling: {
      forwardAcceleration: 440,
      reverseAcceleration: 300,
      coastDeceleration: 155,
      brakeDeceleration: 330,
      maximumForwardSpeed: 450,
      maximumReverseSpeed: 125,
      steeringRate: 2.55,
      steeringGripFloor: 0.24,
      steeringGripSpeed: 115,
      lateralGrip: 20,
      handbrakeLateralGrip: 1.8,
      yawResponse: 13,
      handbrakeTurnMultiplier: 1.25,
      powerOversteer: 0.03
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
    collision: {length: 57, width: 32},
    handling: {
      forwardAcceleration: 360,
      reverseAcceleration: 250,
      coastDeceleration: 165,
      brakeDeceleration: 300,
      maximumForwardSpeed: 385,
      maximumReverseSpeed: 105,
      steeringRate: 2.5,
      steeringGripFloor: 0.25,
      steeringGripSpeed: 110,
      lateralGrip: 17,
      handbrakeLateralGrip: 1.3,
      yawResponse: 11,
      handbrakeTurnMultiplier: 1.38,
      powerOversteer: 0.06
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
  },
  r33: {
    id: 'r33',
    label: 'R33 Coupe',
    class: 'civilian',
    seats: 2,
    radius: 19,
    maxHealth: 850,
    mass: 0.92,
    collisionDamageScale: 1.12,
    collision: {length: 62, width: 30},
    handling: {
      forwardAcceleration: 535,
      reverseAcceleration: 285,
      coastDeceleration: 135,
      brakeDeceleration: 370,
      maximumForwardSpeed: 530,
      maximumReverseSpeed: 120,
      steeringRate: 2.86,
      steeringGripFloor: 0.3,
      steeringGripSpeed: 152,
      lateralGrip: 17,
      handbrakeLateralGrip: 0.95,
      yawResponse: 10,
      handbrakeTurnMultiplier: 1.5,
      powerOversteer: 0.05
    },
    traffic: {
      cruiseSpeed: 150,
      acceleration: 118,
      brakeDeceleration: 360,
      minimumGap: 32,
      followingTime: 0.52,
      pedestrianGap: 40,
      lookAhead: 300
    },
    presentation: {frame: 3, width: 96, height: 96, emergencyLights: false}
  },
  s15: {
    id: 's15',
    label: 'S15 Silvia',
    class: 'civilian',
    seats: 2,
    radius: 18,
    maxHealth: 780,
    mass: 0.84,
    collisionDamageScale: 1.2,
    collision: {length: 60, width: 29},
    handling: {
      forwardAcceleration: 565,
      reverseAcceleration: 292,
      coastDeceleration: 128,
      brakeDeceleration: 392,
      maximumForwardSpeed: 545,
      maximumReverseSpeed: 122,
      steeringRate: 3.05,
      steeringGripFloor: 0.33,
      steeringGripSpeed: 158,
      lateralGrip: 16.5,
      handbrakeLateralGrip: 0.85,
      yawResponse: 9.5,
      handbrakeTurnMultiplier: 1.55,
      powerOversteer: 0.07
    },
    traffic: {
      cruiseSpeed: 156,
      acceleration: 124,
      brakeDeceleration: 372,
      minimumGap: 31,
      followingTime: 0.5,
      pedestrianGap: 39,
      lookAhead: 305
    },
    presentation: {frame: 4, width: 96, height: 96, emergencyLights: false}
  }
};

export const VEHICLE_KINDS = Object.freeze(Object.keys(VEHICLE_CATALOG) as VehicleKind[]);

export function vehicleDefinition(kind: string): VehicleDefinition {
  return isVehicleKind(kind) ? VEHICLE_CATALOG[kind] : VEHICLE_CATALOG.sedan;
}

export function isVehicleKind(kind: string): kind is VehicleKind {
  return Object.hasOwn(VEHICLE_CATALOG, kind);
}
