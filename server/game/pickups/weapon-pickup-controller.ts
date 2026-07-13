import {
  WEAPON_PICKUPS,
  weaponPickupDefinition
} from '../../../shared/content/weapon-pickups.ts';
import {ammoFor, isWeaponId, setAmmo} from '../../weapons.ts';
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
    for (const definition of WEAPON_PICKUPS) {
      if (this.options.state.weaponPickups.has(definition.id)) continue;
      const position = this.options.world.openPointNear(
        this.options.world.spawn.x,
        this.options.world.spawn.y,
        definition.minimumSpawnDistance,
        definition.maximumSpawnDistance,
        8,
        definition.placementSeed
      );
      const pickup = new WeaponPickupState();
      pickup.id = definition.id;
      pickup.weapon = definition.weapon;
      pickup.x = position.x;
      pickup.y = position.y;
      pickup.quantity = definition.quantity;
      this.options.state.weaponPickups.set(pickup.id, pickup);
    }
  }

  update(nowMs: number): void {
    for (const pickup of this.options.state.weaponPickups.values()) {
      const definition = weaponPickupDefinition(pickup.weapon);
      if (!definition || !isWeaponId(pickup.weapon)) continue;
      if (!pickup.available) {
        if (pickup.respawnAt > 0 && nowMs >= pickup.respawnAt) {
          pickup.available = true;
          pickup.respawnAt = 0;
        }
        continue;
      }
      const players = this.options.nearbyPlayers(pickup.x, pickup.y, definition.radius)
        .sort((left, right) => (
          Math.hypot(left.x - pickup.x, left.y - pickup.y) -
            Math.hypot(right.x - pickup.x, right.y - pickup.y) ||
          left.id.localeCompare(right.id)
        ));
      for (const player of players) {
        if (!player.alive || player.vehicleId || player.action || ammoFor(player, pickup.weapon) >= definition.capacity) {
          continue;
        }
        if (Math.hypot(player.x - pickup.x, player.y - pickup.y) > definition.radius) continue;
        const previousAmmo = ammoFor(player, pickup.weapon);
        setAmmo(player, pickup.weapon, Math.min(definition.capacity, previousAmmo + pickup.quantity));
        const granted = ammoFor(player, pickup.weapon) - previousAmmo;
        pickup.available = false;
        pickup.respawnAt = nowMs + definition.respawnMs;
        this.options.events.publish({
          type: 'pickup.collected',
          tick: this.options.clock().tick,
          nowMs,
          pickupId: pickup.id,
          playerId: player.id,
          weapon: pickup.weapon,
          quantity: granted
        });
        this.options.notice(player.id, `${definition.label} +${granted}`, 'success');
        break;
      }
    }
  }
}
