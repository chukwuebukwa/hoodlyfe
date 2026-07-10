import {VehicleSimulationController} from '../../server/game/vehicles/vehicle-simulation-controller.ts';
import {attachTestPlayerControl} from './player-control.ts';
import {attachTestTrafficController} from './traffic-controller.ts';
import {attachTestVehicleAccess} from './vehicle-access.ts';

export function attachTestVehicleSimulation(room: any): VehicleSimulationController {
  if (!room.trafficController) attachTestTrafficController(room);
  if (!room.vehicleAccess) attachTestVehicleAccess(room);
  if (!room.playerControl) attachTestPlayerControl(room);
  const controller = new VehicleSimulationController({
    state: room.state,
    world: room.world,
    events: room.events,
    access: room.vehicleAccess,
    traffic: room.trafficController,
    clock: () => ({tick: room.simulationClock?.tick ?? 0}),
    inputFor: (playerId) => room.playerControl.inputFor(playerId),
    nearbyPlayers: (x, y, radius) => [...room.state.players.values()].filter((player: any) => (
      Math.hypot(player.x - x, player.y - y) <= radius + 11
    )),
    nearbyNpcs: (x, y, radius) => [...room.state.npcs.values()].filter((npc: any) => (
      Math.hypot(npc.x - x, npc.y - y) <= radius + 10
    )),
    nearbyVehicles: (x, y, radius) => [...room.state.vehicles.values()].filter((vehicle: any) => (
      Math.hypot(vehicle.x - x, vehicle.y - y) <= radius + 20
    )),
    damagePlayer: (player, damage, attackerId, nowMs) => {
      const previousHealth = player.health;
      player.health = Math.max(0, player.health - damage);
      room.events.publish({
        type: 'damage.applied',
        tick: room.simulationClock?.tick ?? 0,
        nowMs,
        targetId: player.id,
        targetKind: 'player',
        attackerId,
        amount: previousHealth - player.health,
        remainingHealth: player.health
      });
    },
    damageNpc: (npc, damage, attackerId, nowMs) => {
      const previousHealth = npc.health;
      npc.health = Math.max(0, npc.health - damage);
      room.events.publish({
        type: 'damage.applied',
        tick: room.simulationClock?.tick ?? 0,
        nowMs,
        targetId: npc.id,
        targetKind: 'npc',
        attackerId,
        amount: previousHealth - npc.health,
        remainingHealth: npc.health
      });
    }
  });
  room.vehicleSimulation = controller;
  return controller;
}
