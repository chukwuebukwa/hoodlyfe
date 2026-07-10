import {VehicleSimulationController} from '../../server/game/vehicles/vehicle-simulation-controller.ts';
import {attachTestTrafficController} from './traffic-controller.ts';
import {attachTestVehicleAccess} from './vehicle-access.ts';

export function attachTestVehicleSimulation(room: any): VehicleSimulationController {
  if (!room.trafficController) attachTestTrafficController(room);
  if (!room.vehicleAccess) attachTestVehicleAccess(room);
  const controller = new VehicleSimulationController({
    state: room.state,
    world: room.world,
    events: room.events,
    access: room.vehicleAccess,
    traffic: room.trafficController,
    clock: () => ({tick: room.simulationClock?.tick ?? 0}),
    inputFor: (playerId) => room.runtimePlayers?.get(playerId),
    nearbyPlayers: (x, y, radius) => [...room.state.players.values()].filter((player: any) => (
      Math.hypot(player.x - x, player.y - y) <= radius + 11
    )),
    nearbyNpcs: (x, y, radius) => [...room.state.npcs.values()].filter((npc: any) => (
      Math.hypot(npc.x - x, npc.y - y) <= radius + 10
    )),
    nearbyVehicles: (x, y, radius) => [...room.state.vehicles.values()].filter((vehicle: any) => (
      Math.hypot(vehicle.x - x, vehicle.y - y) <= radius + 20
    )),
    damagePlayer: (player, damage, attackerId, nowMs, crimeKind) => room.damagePlayer(
      player,
      damage,
      attackerId,
      nowMs,
      crimeKind
    ),
    damageNpc: (npc, damage, attackerId, nowMs, crimeKind) => room.damageNpc(
      npc,
      damage,
      attackerId,
      nowMs,
      crimeKind
    )
  });
  room.vehicleSimulation = controller;
  return controller;
}
