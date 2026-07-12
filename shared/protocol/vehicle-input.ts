export const VEHICLE_INPUT_MESSAGE = 'vehicle.input';

export interface VehicleInputMoveMessage {
  sequence: number;
  x: number;
  y: number;
}

export interface VehicleInputBatchMessage {
  vehicleId: string;
  moves: VehicleInputMoveMessage[];
}
