export const VEHICLE_INPUT_MESSAGE = 'vehicle.input';

export interface VehicleInputMoveMessage {
  sequence: number;
  x: number;
  y: number;
  handbrake?: boolean;
}

export interface VehicleInputBatchMessage {
  vehicleId: string;
  moves: VehicleInputMoveMessage[];
}
