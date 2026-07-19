import {VehicleSimulationController} from '../../server/game/vehicles/vehicle-simulation-controller.ts';
import {
  initializePhysicsEngine,
  PhysicsWorld
} from '../../shared/physics/physics-world.ts';
import {attachTestPlayerControl} from './player-control.ts';
import {attachTestTrafficController} from './traffic-controller.ts';
import {attachTestVehicleAccess} from './vehicle-access.ts';
import {VEHICLE_COLLISION_BOUNDING_RADIUS} from '../../server/game/vehicles/vehicle-config.ts';

await initializePhysicsEngine();

export function attachTestVehicleSimulation(
  room: any,
  extras: {
    physics?: PhysicsWorld;
    acknowledgeInput?: (playerId: string, vehicleId: string, sequence: number) => void;
  } = {}
): VehicleSimulationController {
  if (!room.trafficController) attachTestTrafficController(room);
  if (!room.vehicleAccess) attachTestVehicleAccess(room);
  if (!room.playerControl) attachTestPlayerControl(room);
  room.physicsWorld ??= extras.physics ?? PhysicsWorld.create({
    width: 128,
    height: 128,
    tileWidth: 64,
    tileHeight: 64,
    collisions: new Array(128 * 128).fill(0)
  });
  const controller = new VehicleSimulationController({
    state: room.state,
    world: room.world,
    physics: room.physicsWorld,
    acknowledgeInput: extras.acknowledgeInput,
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
      Math.hypot(vehicle.x - x, vehicle.y - y) <= radius + VEHICLE_COLLISION_BOUNDING_RADIUS
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
        armorDamage: 0,
        healthDamage: previousHealth - player.health,
        remainingArmor: player.armor,
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
        armorDamage: 0,
        healthDamage: previousHealth - npc.health,
        remainingArmor: npc.armor,
        remainingHealth: npc.health
      });
    }
  });
  room.vehicleSimulation = controller;
  return controller;
}
