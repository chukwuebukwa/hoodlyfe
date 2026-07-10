export interface VehicleConfig {
  maxHealth: number;
  mass: number;
  collisionDamageScale: number;
}

const DEFAULT_CONFIG: VehicleConfig = {
  maxHealth: 100,
  mass: 1,
  collisionDamageScale: 1
};

const VEHICLE_CONFIGS: Readonly<Record<string, VehicleConfig>> = {
  sedan: DEFAULT_CONFIG,
  taxi: {maxHealth: 105, mass: 1.05, collisionDamageScale: 0.95},
  police: {maxHealth: 120, mass: 1.12, collisionDamageScale: 0.9}
};

export function vehicleConfig(kind: string): VehicleConfig {
  return VEHICLE_CONFIGS[kind] ?? DEFAULT_CONFIG;
}
