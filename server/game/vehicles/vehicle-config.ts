import {vehicleDefinition, type VehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';

export type VehicleConfig = VehicleDefinition;
export const VEHICLE_RADIUS = vehicleDefinition('sedan').radius;
export const vehicleConfig = vehicleDefinition;
