export const VEHICLE_SOURCE_FRAMES = [
  'closed',
  'front-left',
  'front-right',
  'rear-left',
  'rear-right'
] as const;

export type VehicleSourceFrame = typeof VEHICLE_SOURCE_FRAMES[number];
export type VehicleBuildStatus = 'draft' | 'ready';
export type VehicleWorkshopClass = 'civilian' | 'service' | 'emergency';

export interface VehicleFrameOffset {
  x: number;
  y: number;
}

export interface VehicleWorkshopManifest {
  version: 1;
  id: string;
  label: string;
  status: VehicleBuildStatus;
  class: VehicleWorkshopClass;
  seats: number;
  radius: number;
  maxHealth: number;
  mass: number;
  collisionDamageScale: number;
  collision: {
    length: number;
    width: number;
  };
  handling: {
    forwardAcceleration: number;
    reverseAcceleration: number;
    coastDeceleration: number;
    brakeDeceleration: number;
    maximumForwardSpeed: number;
    maximumReverseSpeed: number;
    steeringRate: number;
    steeringGripFloor: number;
    steeringGripSpeed: number;
    lateralGrip: number;
    handbrakeLateralGrip: number;
    yawResponse: number;
    handbrakeTurnMultiplier: number;
    powerOversteer: number;
  };
  traffic: {
    cruiseSpeed: number;
    acceleration: number;
    brakeDeceleration: number;
    minimumGap: number;
    followingTime: number;
    pedestrianGap: number;
    lookAhead: number;
  };
  population: {
    parked: boolean;
    ambientTraffic: boolean;
    weight: number;
  };
  presentation: {
    atlasRow: number;
    width: number;
    height: number;
    emergencyLights: boolean;
    lights: {
      front: number;
      rear: number;
      halfWidth: number;
    };
    offsets: Record<VehicleSourceFrame, VehicleFrameOffset>;
  };
  generation: {
    prompt: string;
    model: string;
    updatedAt?: string;
  };
}

export interface VehicleFrameState {
  name: VehicleSourceFrame;
  exists: boolean;
  url?: string;
}

export interface VehicleCandidate {
  id: string;
  frame: VehicleSourceFrame;
  url: string;
  createdAt: string;
}

export interface VehicleWorkshopRecord {
  manifest: VehicleWorkshopManifest;
  frames: VehicleFrameState[];
  candidates: VehicleCandidate[];
  issues: string[];
}

export interface VehicleWorkshopCatalogResponse {
  generatorConfigured: boolean;
  writable: boolean;
  vehicles: VehicleWorkshopRecord[];
}

export interface VehicleBuildReport {
  ok: boolean;
  builtAt: string;
  atlas: string;
  generatedCatalog: string;
  vehicles: string[];
  warnings: string[];
  errors: string[];
}
