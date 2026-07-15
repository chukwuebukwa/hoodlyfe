import type {MovementVector} from '../input/client-input-policy.ts';
import {
  integrateVehiclePose,
  stepVehicleWithWorldCollision,
  type VehicleStepModifiers
} from '../../../shared/simulation/vehicle-step.ts';

export interface PredictedVehiclePose {
  x: number;
  y: number;
  angle: number;
  speed: number;
}

export function predictVehiclePose(
  pose: PredictedVehiclePose,
  movement: MovementVector,
  kind: string,
  deltaSeconds: number,
  modifiers: VehicleStepModifiers = {}
): PredictedVehiclePose {
  return integrateVehiclePose(
    pose,
    {steering: movement.x, throttle: -movement.y},
    kind,
    deltaSeconds,
    modifiers
  );
}

export function predictVehiclePoseWithWorldCollision(
  pose: PredictedVehiclePose,
  movement: MovementVector,
  kind: string,
  deltaSeconds: number,
  canOccupy: (x: number, y: number, radius: number) => boolean,
  modifiers: VehicleStepModifiers = {}
): PredictedVehiclePose {
  return stepVehicleWithWorldCollision(
    pose,
    {steering: movement.x, throttle: -movement.y},
    kind,
    deltaSeconds,
    canOccupy,
    modifiers
  ).pose;
}
