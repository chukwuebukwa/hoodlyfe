import {ProjectileController} from '../../server/game/combat/projectile-controller.ts';
import {attachTestVehicleSimulation} from './vehicle-simulation.ts';

export function attachTestProjectileController(room: any): ProjectileController {
  if (!room.vehicleSimulation) attachTestVehicleSimulation(room);
  const controller = new ProjectileController({
    state: room.state,
    world: room.world,
    access: room.vehicleAccess,
    vehicles: room.vehicleSimulation,
    damage: {
      player: () => undefined,
      npc: () => undefined
    } as any,
    events: room.events,
    clock: () => ({tick: room.simulationClock?.tick ?? 0}),
    queryPlayers: (minX, minY, maxX, maxY) => [...room.state.players.values()].filter((player: any) => (
      player.x >= minX && player.x <= maxX && player.y >= minY && player.y <= maxY
    )),
    queryNpcs: (minX, minY, maxX, maxY) => [...room.state.npcs.values()].filter((npc: any) => (
      npc.x >= minX && npc.x <= maxX && npc.y >= minY && npc.y <= maxY
    )),
    queryVehicles: (minX, minY, maxX, maxY) => [...room.state.vehicles.values()].filter((vehicle: any) => (
      vehicle.x >= minX && vehicle.x <= maxX && vehicle.y >= minY && vehicle.y <= maxY
    )),
    remove: (bulletId) => room.lifecycle.defer(`bullet.remove:${bulletId}`, () => {
      room.state.bullets.delete(bulletId);
    })
  });
  room.projectileController = controller;
  return controller;
}
