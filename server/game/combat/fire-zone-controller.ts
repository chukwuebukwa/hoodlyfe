import {FIRE_ZONE} from '../../../shared/content/fire-zones.ts';
import {FireZoneState, type DistrictState, type NpcState, type PlayerState, type VehicleState} from '../../state.ts';
import type {GameEventStream} from '../events/game-events.ts';
import type {DamageController} from './damage-controller.ts';
import type {VehicleSimulationController} from '../vehicles/vehicle-simulation-controller.ts';

interface FireZoneControllerOptions {
  state: DistrictState;
  events: GameEventStream;
  clock: () => {tick: number};
  damage: Pick<DamageController, 'player' | 'npc'>;
  vehicles: Pick<VehicleSimulationController, 'damage'>;
  queryPlayers: (x: number, y: number, radius: number) => PlayerState[];
  queryNpcs: (x: number, y: number, radius: number) => NpcState[];
  queryVehicles: (x: number, y: number, radius: number) => VehicleState[];
}

export class FireZoneController {
  private readonly nextDamageAt = new Map<string, number>();
  private nextId = 1;

  constructor(private readonly options: FireZoneControllerOptions) {}

  ignite(x: number, y: number, ownerId: string, nowMs: number): string {
    this.enforceCapacity(ownerId);
    const fire = new FireZoneState();
    fire.id = `fire-${this.nextId++}`;
    fire.ownerId = ownerId;
    fire.x = x;
    fire.y = y;
    fire.radius = FIRE_ZONE.radius;
    fire.createdAt = nowMs;
    fire.expiresAt = nowMs + FIRE_ZONE.durationMs;
    this.options.state.fires.set(fire.id, fire);
    this.nextDamageAt.set(fire.id, nowMs);
    this.options.events.publish({
      type: 'fire.created',
      tick: this.options.clock().tick,
      nowMs,
      fireId: fire.id,
      sourceId: ownerId,
      x,
      y,
      radius: fire.radius,
      expiresAt: fire.expiresAt
    });
    return fire.id;
  }

  update(nowMs: number): void {
    for (const [fireId, fire] of this.options.state.fires) {
      if (nowMs >= fire.expiresAt) {
        this.remove(fireId);
        continue;
      }
      if (nowMs < (this.nextDamageAt.get(fireId) ?? 0)) continue;
      this.applyDamage(fire, nowMs);
      this.nextDamageAt.set(fireId, nowMs + FIRE_ZONE.damageIntervalMs);
    }
  }

  private applyDamage(fire: FireZoneState, nowMs: number): void {
    const impact = {family: 'environment' as const, force: 'light' as const, sourceX: fire.x, sourceY: fire.y};
    for (const player of this.options.queryPlayers(fire.x, fire.y, fire.radius)) {
      if (!player.alive || player.vehicleId || distance(player, fire) > fire.radius) continue;
      this.options.damage.player(player, FIRE_ZONE.playerDamage, fire.ownerId, nowMs, 'assault', 'player', impact);
    }
    for (const npc of this.options.queryNpcs(fire.x, fire.y, fire.radius)) {
      if (!npc.alive || distance(npc, fire) > fire.radius) continue;
      this.options.damage.npc(npc, FIRE_ZONE.npcDamage, fire.ownerId, nowMs, undefined, impact);
    }
    for (const vehicle of this.options.queryVehicles(fire.x, fire.y, fire.radius)) {
      if (vehicle.destroyed || distance(vehicle, fire) > fire.radius) continue;
      this.options.vehicles.damage(vehicle, FIRE_ZONE.vehicleDamage, fire.ownerId, 'weapon', nowMs);
    }
  }

  private enforceCapacity(ownerId: string): void {
    const owned = [...this.options.state.fires.values()]
      .filter((fire) => fire.ownerId === ownerId)
      .sort(oldestFirst);
    while (owned.length >= FIRE_ZONE.ownerCapacity) this.remove(owned.shift()!.id);
    while (this.options.state.fires.size >= FIRE_ZONE.globalCapacity) {
      const oldest = [...this.options.state.fires.values()].sort(oldestFirst)[0];
      if (!oldest) break;
      this.remove(oldest.id);
    }
  }

  private remove(fireId: string): void {
    this.options.state.fires.delete(fireId);
    this.nextDamageAt.delete(fireId);
  }
}

function oldestFirst(left: FireZoneState, right: FireZoneState): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function distance(
  actor: {x: number; y: number},
  fire: {x: number; y: number}
): number {
  return Math.hypot(actor.x - fire.x, actor.y - fire.y);
}
