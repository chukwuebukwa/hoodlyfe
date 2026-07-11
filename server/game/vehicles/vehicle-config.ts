import {vehicleDefinition, type VehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';

export type VehicleConfig = VehicleDefinition;
export const VEHICLE_RADIUS = vehicleDefinition('sedan').radius;
export const VEHICLE_COLLISION_BOUNDING_RADIUS = Math.ceil(Math.hypot(
  vehicleDefinition('police').collision.length / 2,
  vehicleDefinition('police').collision.width / 2
));
export const vehicleConfig = vehicleDefinition;
