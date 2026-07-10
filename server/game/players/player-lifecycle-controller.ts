import type {GameEventStream} from '../events/game-events.ts';
import type {DistrictState, PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {refillAmmo} from '../../weapons.ts';
import type {CrimeResponseController} from '../police/crime-response-controller.ts';
import type {VehicleAccessController} from '../vehicles/vehicle-access-controller.ts';

const PLAYER_RADIUS = 11;
const RESPAWN_DELAY_MS = 3000;

interface PlayerLifecycleControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  access: VehicleAccessController;
  crime: CrimeResponseController;
  clock: () => {tick: number};
  resetInput: (playerId: string) => void;
}

export class PlayerLifecycleController {
  constructor(private readonly options: PlayerLifecycleControllerOptions) {}

  kill(player: PlayerState, nowMs: number, attackerId: string): void {
    player.alive = false;
    player.health = 0;
    player.respawnAt = nowMs + RESPAWN_DELAY_MS;
    player.wanted = 0;
    this.options.crime.clearSuspect(player.id);
    this.options.events.publish({
      type: 'entity.killed',
      tick: this.options.clock().tick,
      nowMs,
      entityId: player.id,
      entityKind: 'player',
      attackerId
    });
    this.options.resetInput(player.id);
    const vehicle = player.vehicleId ? this.options.state.vehicles.get(player.vehicleId) : undefined;
    this.options.access.removePlayer(player);
    if (vehicle) vehicle.speed *= 0.45;
  }

  tryRespawn(player: PlayerState, nowMs: number): boolean {
    if (nowMs < player.respawnAt) return false;
    const spawn = this.options.world.openPointNear(
      this.options.world.spawn.x,
      this.options.world.spawn.y,
      0,
      180,
      PLAYER_RADIUS,
      nowMs + player.id.length
    );
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = -Math.PI / 2;
    player.health = 100;
    player.alive = true;
    player.respawnAt = 0;
    player.wanted = 0;
    player.vehicleId = '';
    player.vehicleSeat = -1;
    this.options.access.clearAction(player);
    refillAmmo(player);
    this.options.crime.clearSuspect(player.id);
    this.options.events.publish({
      type: 'player.respawned',
      tick: this.options.clock().tick,
      nowMs,
      playerId: player.id,
      x: player.x,
      y: player.y
    });
    return true;
  }
}
