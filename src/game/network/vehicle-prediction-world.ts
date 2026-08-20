import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  VEHICLE_SIMULATION_STEP_SECONDS,
  integrateVehicleMotion,
  type VehicleStepModifiers
} from '../../../shared/simulation/vehicle-step.ts';
import type {SurfaceMap} from '../../../shared/world/surface-map.ts';
import type {
  VehiclePredictionMovement,
  VehiclePredictionPose,
  VehiclePredictionWorld
} from './vehicle-prediction-controller.ts';

export class SurfaceVehiclePredictionWorld implements VehiclePredictionWorld {
  constructor(private readonly surfaces: SurfaceMap) {}

  step(
    pose: VehiclePredictionPose,
    movement: VehiclePredictionMovement,
    modifiers: VehicleStepModifiers
  ): VehiclePredictionPose {
    const moved = integrateVehicleMotion(pose, {
      steering: movement.x,
      throttle: -movement.y,
      handbrake: movement.handbrake
    }, pose.kind, VEHICLE_SIMULATION_STEP_SECONDS, modifiers);
    const surfaceId = this.surfaces.transitionFor(
      pose.surfaceId,
      pose.x,
      pose.y,
      moved.x,
      moved.y,
      'vehicle'
    )?.surfaceId ?? pose.surfaceId;
    const radius = vehicleDefinition(pose.kind).radius;
    if (this.surfaces.canOccupyConnected(surfaceId, moved.x, moved.y, radius, 'vehicle')) {
      return {...pose, ...moved, surfaceId};
    }
    return {...pose, speed: 0, linvelX: 0, linvelY: 0, angvel: 0};
  }
}
