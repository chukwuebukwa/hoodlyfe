import type {BulletState, DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {WEAPONS, isBulletWeaponId} from '../../weapons.ts';
import {SIMULATION_STEP_MS} from '../../../shared/simulation/timing.ts';
import {classifyImpactZone} from '../vehicles/vehicle-damage-system.ts';
import type {VehicleAccessController} from '../vehicles/vehicle-access-controller.ts';
import type {VehicleSimulationController} from '../vehicles/vehicle-simulation-controller.ts';
import type {DamageController} from './damage-controller.ts';
import {
  CombatHitboxHistory,
  type HistoricalCombatHit
} from './combat-hitbox-history.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;

interface ProjectileControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  access: VehicleAccessController;
  vehicles: VehicleSimulationController;
  damage: DamageController;
  history?: CombatHitboxHistory;
  queryPlayers: (minX: number, minY: number, maxX: number, maxY: number) => PlayerState[];
  queryNpcs: (minX: number, minY: number, maxX: number, maxY: number) => NpcState[];
  queryVehicles: (minX: number, minY: number, maxX: number, maxY: number) => VehicleState[];
  remove: (bulletId: string) => void;
}

export class ProjectileController {
  constructor(private readonly options: ProjectileControllerOptions) {}

  catchUp(input: {
    bullet: BulletState;
    requestedServerShotTimeMs: number;
    nowMs: number;
    excludedIds: ReadonlySet<string>;
  }): {effectiveServerShotTimeMs: number; rewindMs: number; resolved: boolean} {
    if (!this.options.state.bullets.has(input.bullet.id)) {
      return {
        effectiveServerShotTimeMs: input.nowMs,
        rewindMs: 0,
        resolved: true
      };
    }
    const window = this.options.history?.resolveTime(input.requestedServerShotTimeMs, input.nowMs);
    if (!window || window.rewindMs <= 0) {
      return {
        effectiveServerShotTimeMs: input.nowMs,
        rewindMs: 0,
        resolved: false
      };
    }
    const bullet = input.bullet;
    const weapon = WEAPONS[isBulletWeaponId(bullet.weapon) ? bullet.weapon : 'pistol'];
    bullet.createdAt = window.effectiveServerTimeMs;
    const stepCount = Math.max(1, Math.ceil(window.rewindMs / SIMULATION_STEP_MS));
    const stepMs = window.rewindMs / stepCount;
    for (let step = 0; step < stepCount; step++) {
      const startX = bullet.x;
      const startY = bullet.y;
      const durationSeconds = stepMs / 1000;
      const endX = startX + Math.cos(bullet.angle) * weapon.projectileSpeed * durationSeconds;
      const endY = startY + Math.sin(bullet.angle) * weapon.projectileSpeed * durationSeconds;
      const nextSurface = this.surfaceAfterMove(bullet, startX, startY, endX, endY);
      if (!nextSurface) {
        this.options.state.bullets.delete(bullet.id);
        return {
          effectiveServerShotTimeMs: window.effectiveServerTimeMs,
          rewindMs: window.rewindMs,
          resolved: true
        };
      }
      const worldProgress = firstBlockedProgress(this.options.world, startX, startY, endX, endY);
      const historical = this.options.history?.querySegment({
        requestedServerTimeMs: window.effectiveServerTimeMs + (step + 1) * stepMs,
        nowMs: input.nowMs,
        startX,
        startY,
        endX,
        endY,
        projectileRadius: 4,
        surfaceId: nextSurface,
        excludedIds: input.excludedIds
      });
      if (historical?.hit && (worldProgress === undefined || historical.hit.progress < worldProgress)) {
        bullet.x = interpolate(startX, endX, historical.hit.progress);
        bullet.y = interpolate(startY, endY, historical.hit.progress);
        this.resolveHistoricalHit(historical.hit, bullet, input.nowMs);
        this.options.state.bullets.delete(bullet.id);
        return {
          effectiveServerShotTimeMs: window.effectiveServerTimeMs,
          rewindMs: window.rewindMs,
          resolved: true
        };
      }
      if (worldProgress !== undefined) {
        bullet.x = interpolate(startX, endX, worldProgress);
        bullet.y = interpolate(startY, endY, worldProgress);
        this.options.state.bullets.delete(bullet.id);
        return {
          effectiveServerShotTimeMs: window.effectiveServerTimeMs,
          rewindMs: window.rewindMs,
          resolved: true
        };
      }
      bullet.x = endX;
      bullet.y = endY;
      bullet.surfaceId = nextSurface;
    }
    return {
      effectiveServerShotTimeMs: window.effectiveServerTimeMs,
      rewindMs: window.rewindMs,
      resolved: false
    };
  }

  update(bullet: BulletState, bulletId: string, deltaSeconds: number, nowMs: number): void {
    const weapon = WEAPONS[isBulletWeaponId(bullet.weapon) ? bullet.weapon : 'pistol'];
    if (nowMs - bullet.createdAt > weapon.lifetimeMs) {
      this.options.remove(bulletId);
      return;
    }

    const previousX = bullet.x;
    const previousY = bullet.y;
    const nextX = bullet.x + Math.cos(bullet.angle) * weapon.projectileSpeed * deltaSeconds;
    const nextY = bullet.y + Math.sin(bullet.angle) * weapon.projectileSpeed * deltaSeconds;
    const nextSurface = this.surfaceAfterMove(bullet, previousX, previousY, nextX, nextY);
    if (!nextSurface || this.options.world.isBlockedAt(nextX, nextY)) {
      this.options.remove(bulletId);
      return;
    }
    bullet.x = nextX;
    bullet.y = nextY;
    bullet.surfaceId = nextSurface;

    const minX = Math.min(previousX, bullet.x) - 4;
    const minY = Math.min(previousY, bullet.y) - 4;
    const maxX = Math.max(previousX, bullet.x) + 4;
    const maxY = Math.max(previousY, bullet.y) + 4;
    for (const target of this.options.queryPlayers(minX, minY, maxX, maxY)) {
      if (
        !target.alive || target.vehicleId || target.id === bullet.ownerId ||
        target.surfaceId !== bullet.surfaceId
      ) continue;
      if (bullet.ownerKind === 'police' && target.wanted <= 0) continue;
      if (pointSegmentDistance(target.x, target.y, previousX, previousY, bullet.x, bullet.y) > PLAYER_RADIUS + 4) {
        continue;
      }
      this.options.damage.player(
        target,
        weapon.damage,
        bullet.ownerId,
        nowMs,
        'assault',
        bullet.ownerKind === 'player' ? 'player' : 'non-player',
        {
          family: 'bullet',
          force: weapon.id === 'shotgun' ? 'heavy' : 'light',
          sourceX: target.x - Math.cos(bullet.angle),
          sourceY: target.y - Math.sin(bullet.angle)
        }
      );
      this.options.remove(bulletId);
      return;
    }

    for (const target of this.options.queryVehicles(minX, minY, maxX, maxY)) {
      if (target.destroyed || target.surfaceId !== bullet.surfaceId) continue;
      if (this.options.access.occupants(target.id).some((occupant) => occupant.id === bullet.ownerId)) {
        continue;
      }
      if (pointSegmentDistance(target.x, target.y, previousX, previousY, bullet.x, bullet.y) > VEHICLE_RADIUS + 4) {
        continue;
      }
      this.options.vehicles.damage(
        target,
        this.options.vehicles.weaponDamage(weapon.damage),
        bullet.ownerId,
        'weapon',
        nowMs,
        classifyImpactZone(target.angle, -Math.cos(bullet.angle), -Math.sin(bullet.angle))
      );
      this.options.remove(bulletId);
      return;
    }

    if (bullet.ownerKind !== 'player') return;
    for (const target of this.options.queryNpcs(minX, minY, maxX, maxY)) {
      if (!target.alive || target.surfaceId !== bullet.surfaceId) continue;
      if (pointSegmentDistance(target.x, target.y, previousX, previousY, bullet.x, bullet.y) > NPC_RADIUS + 4) {
        continue;
      }
      this.options.damage.npc(
        target,
        weapon.damage,
        bullet.ownerId,
        nowMs,
        undefined,
        {
          family: 'bullet',
          force: weapon.id === 'shotgun' ? 'heavy' : 'light',
          sourceX: target.x - Math.cos(bullet.angle),
          sourceY: target.y - Math.sin(bullet.angle)
        }
      );
      this.options.remove(bulletId);
      return;
    }
  }

  private surfaceAfterMove(
    bullet: BulletState,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): string | undefined {
    const moveSurface = this.options.world.surfaceAfterMove;
    return typeof moveSurface === 'function'
      ? moveSurface.call(
        this.options.world,
        bullet.surfaceId,
        fromX,
        fromY,
        toX,
        toY,
        4,
        'projectile'
      )
      : bullet.surfaceId;
  }

  private resolveHistoricalHit(hit: HistoricalCombatHit, bullet: BulletState, nowMs: number): void {
    if (this.options.history?.currentLifecycleRevision(hit.kind, hit.id) !== hit.lifecycleRevision) {
      return;
    }
    const weapon = WEAPONS[isBulletWeaponId(bullet.weapon) ? bullet.weapon : 'pistol'];
    if (hit.kind === 'player') {
      const target = this.options.state.players.get(hit.id);
      if (!target?.alive || target.vehicleId || target.id === bullet.ownerId) return;
      if (bullet.ownerKind === 'police' && target.wanted <= 0) return;
      this.options.damage.player(
        target,
        weapon.damage,
        bullet.ownerId,
        nowMs,
        'assault',
        bullet.ownerKind === 'player' ? 'player' : 'non-player',
        bulletImpact(target.x, target.y, bullet, weapon.id === 'shotgun')
      );
      return;
    }
    if (hit.kind === 'vehicle') {
      const target = this.options.state.vehicles.get(hit.id);
      if (!target || target.destroyed) return;
      if (this.options.access.occupants(target.id).some((occupant) => occupant.id === bullet.ownerId)) {
        return;
      }
      this.options.vehicles.damage(
        target,
        this.options.vehicles.weaponDamage(weapon.damage),
        bullet.ownerId,
        'weapon',
        nowMs,
        classifyImpactZone(target.angle, -Math.cos(bullet.angle), -Math.sin(bullet.angle))
      );
      return;
    }
    if (bullet.ownerKind !== 'player') return;
    const target = this.options.state.npcs.get(hit.id);
    if (!target?.alive) return;
    this.options.damage.npc(
      target,
      weapon.damage,
      bullet.ownerId,
      nowMs,
      undefined,
      bulletImpact(target.x, target.y, bullet, weapon.id === 'shotgun')
    );
  }
}

function bulletImpact(
  targetX: number,
  targetY: number,
  bullet: BulletState,
  heavy: boolean
): {
  family: 'bullet';
  force: 'light' | 'heavy';
  sourceX: number;
  sourceY: number;
} {
  return {
    family: 'bullet',
    force: heavy ? 'heavy' : 'light',
    sourceX: targetX - Math.cos(bullet.angle),
    sourceY: targetY - Math.sin(bullet.angle)
  };
}

function firstBlockedProgress(
  world: CollisionMap,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number | undefined {
  const distance = Math.hypot(endX - startX, endY - startY);
  const steps = Math.max(1, Math.ceil(distance / 4));
  for (let step = 1; step <= steps; step++) {
    const progress = step / steps;
    if (world.isBlockedAt(
      startX + (endX - startX) * progress,
      startY + (endY - startY) * progress
    )) return progress;
  }
  return undefined;
}

function pointSegmentDistance(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return Math.hypot(pointX - startX, pointY - startY);
  const progress = clamp(
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSquared,
    0,
    1
  );
  return Math.hypot(
    pointX - (startX + segmentX * progress),
    pointY - (startY + segmentY * progress)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
