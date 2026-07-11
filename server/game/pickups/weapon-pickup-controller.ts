import {GRENADE_PICKUP} from '../../../shared/content/explosives.ts';
import {WeaponPickupState, type DistrictState, type PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {GameEventStream} from '../events/game-events.ts';

interface WeaponPickupControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  clock: () => {tick: number};
  nearbyPlayers: (x: number, y: number, radius: number) => PlayerState[];
  notice: (playerId: string, message: string, tone: 'info' | 'success' | 'warning') => void;
}

export class WeaponPickupController {
  constructor(private readonly options: WeaponPickupControllerOptions) {}

  initialize(): void {
    if (this.options.state.weaponPickups.has(GRENADE_PICKUP.id)) return;
    const position = this.options.world.openPointNear(
      this.options.world.spawn.x,
      this.options.world.spawn.y,
      GRENADE_PICKUP.minimumSpawnDistance,
      GRENADE_PICKUP.maximumSpawnDistance,
      8,
      5_271
    );
    const pickup = new WeaponPickupState();
    pickup.id = GRENADE_PICKUP.id;
    pickup.weapon = GRENADE_PICKUP.weapon;
    pickup.x = position.x;
    pickup.y = position.y;
    pickup.quantity = GRENADE_PICKUP.quantity;
    this.options.state.weaponPickups.set(pickup.id, pickup);
  }

  update(nowMs: number): void {
    for (const pickup of this.options.state.weaponPickups.values()) {
      if (!pickup.available) {
        if (pickup.respawnAt > 0 && nowMs >= pickup.respawnAt) {
          pickup.available = true;
          pickup.respawnAt = 0;
        }
        continue;
      }
      const players = this.options.nearbyPlayers(pickup.x, pickup.y, GRENADE_PICKUP.radius)
        .sort((left, right) => (
          Math.hypot(left.x - pickup.x, left.y - pickup.y) -
            Math.hypot(right.x - pickup.x, right.y - pickup.y) ||
          left.id.localeCompare(right.id)
        ));
      for (const player of players) {
        if (!player.alive || player.vehicleId || player.action || player.ammoGrenade >= GRENADE_PICKUP.capacity) {
          continue;
        }
        if (Math.hypot(player.x - pickup.x, player.y - pickup.y) > GRENADE_PICKUP.radius) continue;
        const previousAmmo = player.ammoGrenade;
        player.ammoGrenade = Math.min(
          GRENADE_PICKUP.capacity,
          player.ammoGrenade + pickup.quantity
        );
        const granted = player.ammoGrenade - previousAmmo;
        pickup.available = false;
        pickup.respawnAt = nowMs + GRENADE_PICKUP.respawnMs;
        this.options.events.publish({
          type: 'pickup.collected',
          tick: this.options.clock().tick,
          nowMs,
          pickupId: pickup.id,
          playerId: player.id,
          weapon: pickup.weapon,
          quantity: granted
        });
        this.options.notice(player.id, `GRENADES +${granted}`, 'success');
        break;
      }
    }
  }
}
