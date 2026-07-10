import {VehicleAccessController} from '../../server/game/vehicles/vehicle-access-controller.ts';
import {attachTestPedestrianController} from './pedestrian-controller.ts';

export function attachTestVehicleAccess(room: any): VehicleAccessController {
  if (!room.pedestrians) attachTestPedestrianController(room);
  const controller = new VehicleAccessController({
    state: room.state,
    world: room.world,
    nearbyVehicles: (x, y, radius) => [...room.state.vehicles.values()].filter((vehicle: any) => (
      Math.hypot(vehicle.x - x, vehicle.y - y) <= radius
    )),
    createEjectedDriver: (vehicle, hijacker, nowMs) => room.pedestrians.spawnEjectedDriver(
      vehicle,
      hijacker,
      nowMs
    ),
    recordTheft: () => undefined,
    releaseTrafficControl: (vehicleId) => room.trafficController?.release(vehicleId)
  });
  room.vehicleAccess = controller;
  return controller;
}
