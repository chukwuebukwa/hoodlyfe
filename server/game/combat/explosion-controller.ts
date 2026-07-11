import {
  EXPLOSION_POLICIES,
  EXPLOSION_VISUAL_CAPACITY,
  blastFalloff,
  type ExplosionKind
} from '../../../shared/content/explosives.ts';
import {
  ExplosionState,
  type DistrictState,
  type NpcState,
  type PlayerState,
  type VehicleState
} from '../../state.ts';
import type {GameEvent, GameEventStream} from '../events/game-events.ts';
import {classifyImpactZone} from '../vehicles/vehicle-collision-system.ts';
import type {VehicleSimulationController} from '../vehicles/vehicle-simulation-controller.ts';
import type {DamageController} from './damage-controller.ts';

type ExplosionSourceKind = 'player' | 'vehicle' | 'world';

interface PendingVehicleExplosion {
  vehicleId: string;
  sourceId: string;
  x: number;
  y: number;
  excludedPlayerIds: string[];
}

interface ExplosionControllerOptions {
  state: DistrictState;
  events: GameEventStream;
  clock: () => {tick: number};
  damage: DamageController;
  vehicles: VehicleSimulationController;
  queryPlayers: (x: number, y: number, radius: number) => PlayerState[];
  queryNpcs: (x: number, y: number, radius: number) => NpcState[];
  queryVehicles: (x: number, y: number, radius: number) => VehicleState[];
}

export class ExplosionController {
  private readonly pendingVehicleExplosions: PendingVehicleExplosion[] = [];
  private readonly queuedVehicles = new Set<string>();
  private nextExplosionId = 1;

  constructor(private readonly options: ExplosionControllerOptions) {}

  detonate(
    kind: ExplosionKind,
    x: number,
    y: number,
    sourceId: string,
    sourceKind: ExplosionSourceKind,
    nowMs: number
  ): string {
    const activeSourceId = sourceId && this.options.state.players.has(sourceId) ? sourceId : '';
    const effectiveSourceKind: ExplosionSourceKind = activeSourceId
      ? 'player'
      : (sourceKind === 'vehicle' ? 'vehicle' : 'world');
    return this.createAndApply(
      kind, x, y, activeSourceId, effectiveSourceKind, nowMs, []
    );
  }

  observeEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type !== 'vehicle.destroyed' || this.queuedVehicles.has(event.vehicleId)) continue;
      const vehicle = this.options.state.vehicles.get(event.vehicleId);
      if (!vehicle) continue;
      this.queuedVehicles.add(event.vehicleId);
      this.pendingVehicleExplosions.push({
        vehicleId: event.vehicleId,
        sourceId: event.sourceId,
        x: vehicle.x,
        y: vehicle.y,
        excludedPlayerIds: [...event.occupantIds]
      });
    }
  }

  update(nowMs: number): void {
    const expired = [...this.options.state.explosions.entries()]
      .filter(([, explosion]) => nowMs >= explosion.expiresAt)
      .map(([explosionId]) => explosionId);
    for (const explosionId of expired) this.options.state.explosions.delete(explosionId);
    const pending = this.pendingVehicleExplosions.splice(0);
    for (const explosion of pending) {
      this.queuedVehicles.delete(explosion.vehicleId);
      this.detonateVehicle(explosion, nowMs);
    }
  }

  private detonateVehicle(explosion: PendingVehicleExplosion, nowMs: number): void {
    const activeSourceId = explosion.sourceId && this.options.state.players.has(explosion.sourceId)
      ? explosion.sourceId
      : '';
    this.createAndApply(
      'vehicle',
      explosion.x,
      explosion.y,
      activeSourceId,
      activeSourceId ? 'player' : 'vehicle',
      nowMs,
      explosion.excludedPlayerIds
    );
  }

  private createAndApply(
    kind: ExplosionKind,
    x: number,
    y: number,
    sourceId: string,
    sourceKind: ExplosionSourceKind,
    nowMs: number,
    excludedPlayerIds: readonly string[]
  ): string {
    const policy = EXPLOSION_POLICIES[kind];
    this.ensureVisualCapacity();
    const explosion = new ExplosionState();
    explosion.id = `explosion-${this.nextExplosionId++}`;
    explosion.kind = kind;
    explosion.sourceId = sourceId;
    explosion.sourceKind = sourceKind;
    explosion.x = x;
    explosion.y = y;
    explosion.radius = policy.radius;
    explosion.createdAt = nowMs;
    explosion.expiresAt = nowMs + policy.visualLifetimeMs;
    this.options.state.explosions.set(explosion.id, explosion);
    this.applyDamage(kind, x, y, sourceId, nowMs, excludedPlayerIds);
    this.options.events.publish({
      type: 'explosion.created',
      tick: this.options.clock().tick,
      nowMs,
      explosionId: explosion.id,
      kind,
      sourceId,
      sourceKind,
      x,
      y,
      radius: policy.radius
    });
    return explosion.id;
  }

  private applyDamage(
    kind: ExplosionKind,
    x: number,
    y: number,
    sourceId: string,
    nowMs: number,
    excludedPlayerIds: readonly string[]
  ): void {
    const policy = EXPLOSION_POLICIES[kind];
    for (const player of this.options.queryPlayers(x, y, policy.radius)) {
      if (!player.alive || player.vehicleId || excludedPlayerIds.includes(player.id)) continue;
      const amount = scaledDamage(player.x, player.y, x, y, policy.radius, policy.maximumPedestrianDamage);
      this.options.damage.player(
        player,
        amount,
        sourceId,
        nowMs,
        undefined,
        undefined,
        {family: 'explosion', force: 'heavy', sourceX: x, sourceY: y}
      );
    }
    for (const npc of this.options.queryNpcs(x, y, policy.radius)) {
      if (!npc.alive) continue;
      const amount = scaledDamage(npc.x, npc.y, x, y, policy.radius, policy.maximumPedestrianDamage);
      this.options.damage.npc(
        npc,
        amount,
        sourceId,
        nowMs,
        undefined,
        {family: 'explosion', force: 'heavy', sourceX: x, sourceY: y}
      );
    }
    for (const vehicle of this.options.queryVehicles(x, y, policy.radius)) {
      if (vehicle.destroyed) continue;
      const amount = scaledDamage(vehicle.x, vehicle.y, x, y, policy.radius, policy.maximumVehicleDamage);
      const directionX = vehicle.x - x;
      const directionY = vehicle.y - y;
      this.options.vehicles.damage(
        vehicle,
        amount,
        sourceId,
        'explosion',
        nowMs,
        classifyImpactZone(vehicle.angle, -directionX, -directionY)
      );
    }
  }

  private ensureVisualCapacity(): void {
    while (this.options.state.explosions.size >= EXPLOSION_VISUAL_CAPACITY) {
      let oldestId = '';
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const explosion of this.options.state.explosions.values()) {
        if (explosion.createdAt >= oldestAt) continue;
        oldestId = explosion.id;
        oldestAt = explosion.createdAt;
      }
      if (!oldestId) return;
      this.options.state.explosions.delete(oldestId);
    }
  }
}

function scaledDamage(
  targetX: number,
  targetY: number,
  centerX: number,
  centerY: number,
  radius: number,
  maximumDamage: number
): number {
  const falloff = blastFalloff(Math.hypot(targetX - centerX, targetY - centerY), radius);
  return Math.max(0, Math.round(maximumDamage * falloff));
}
