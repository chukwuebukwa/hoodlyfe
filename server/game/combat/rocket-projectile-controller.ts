import {ROCKET_PROJECTILE} from '../../../shared/content/explosives.ts';
import {WEAPONS} from '../../../shared/content/weapon-catalog.ts';
import {
  RocketProjectileState,
  type DistrictState,
  type NpcState,
  type PlayerState,
  type VehicleState
} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

interface LaunchRocketInput {
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  nowMs: number;
}

interface RocketProjectileControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  queryPlayers: (minX: number, minY: number, maxX: number, maxY: number) => PlayerState[];
  queryNpcs: (minX: number, minY: number, maxX: number, maxY: number) => NpcState[];
  queryVehicles: (minX: number, minY: number, maxX: number, maxY: number) => VehicleState[];
  detonate: (x: number, y: number, ownerId: string, nowMs: number, surfaceId: string) => void;
  remove: (projectileId: string) => void;
}

interface Impact {
  progress: number;
  x: number;
  y: number;
}

export class RocketProjectileController {
  private static readonly settledCapacity = 128;
  private readonly detonated = new Set<string>();
  private nextProjectileId = 1;

  constructor(private readonly options: RocketProjectileControllerOptions) {}

  motionFor(projectileId: string): {velocityX: number; velocityY: number} | undefined {
    const rocket = this.options.state.rockets.get(projectileId);
    if (!rocket || this.detonated.has(projectileId)) return undefined;
    const speed = WEAPONS.rocket.projectileSpeed;
    return {
      velocityX: Math.cos(rocket.angle) * speed,
      velocityY: Math.sin(rocket.angle) * speed
    };
  }

  launch(input: LaunchRocketInput): boolean {
    if (
      this.options.state.rockets.size >= ROCKET_PROJECTILE.globalCapacity ||
      this.ownerCount(input.ownerId) >= ROCKET_PROJECTILE.ownerCapacity
    ) return false;

    const rocket = new RocketProjectileState();
    rocket.id = `rocket-${this.nextProjectileId++}`;
    rocket.ownerId = input.ownerId;
    rocket.surfaceId = (
      this.options.state.players.get(input.ownerId) ?? this.options.state.npcs.get(input.ownerId)
    )?.surfaceId ?? rocket.surfaceId;
    rocket.angle = input.angle;
    rocket.x = input.x + Math.cos(input.angle) * ROCKET_PROJECTILE.spawnOffset;
    rocket.y = input.y + Math.sin(input.angle) * ROCKET_PROJECTILE.spawnOffset;
    rocket.createdAt = input.nowMs;
    if (this.options.world.isBlockedAt(rocket.x, rocket.y)) return false;
    this.options.state.rockets.set(rocket.id, rocket);
    return true;
  }

  update(rocket: RocketProjectileState, rocketId: string, deltaSeconds: number, nowMs: number): void {
    if (this.detonated.has(rocketId)) return;
    const definition = WEAPONS.rocket;
    if (nowMs - rocket.createdAt >= definition.lifetimeMs) {
      this.detonate(rocket, rocketId, rocket.x, rocket.y, nowMs);
      return;
    }

    const distance = definition.projectileSpeed * Math.min(Math.max(0, deltaSeconds), 0.1);
    const endX = rocket.x + Math.cos(rocket.angle) * distance;
    const endY = rocket.y + Math.sin(rocket.angle) * distance;
    const moveSurface = this.options.world.surfaceAfterMove;
    const nextSurface = typeof moveSurface === 'function'
      ? moveSurface.call(
        this.options.world,
        rocket.surfaceId,
        rocket.x,
        rocket.y,
        endX,
        endY,
        ROCKET_PROJECTILE.radius,
        'projectile'
      )
      : rocket.surfaceId;
    if (!nextSurface) {
      this.detonate(rocket, rocketId, endX, endY, nowMs);
      return;
    }
    rocket.surfaceId = nextSurface;
    const worldImpact = this.worldImpact(rocket.x, rocket.y, endX, endY);
    const actorImpact = this.actorImpact(rocket, endX, endY);
    const impact = earliest(worldImpact, actorImpact);
    if (impact) {
      this.detonate(rocket, rocketId, impact.x, impact.y, nowMs);
      return;
    }
    rocket.x = endX;
    rocket.y = endY;
  }

  private actorImpact(rocket: RocketProjectileState, endX: number, endY: number): Impact | undefined {
    const radius = ROCKET_PROJECTILE.radius;
    const minX = Math.min(rocket.x, endX) - 28;
    const minY = Math.min(rocket.y, endY) - 28;
    const maxX = Math.max(rocket.x, endX) + 28;
    const maxY = Math.max(rocket.y, endY) + 28;
    const impacts: Impact[] = [];
    for (const player of this.options.queryPlayers(minX, minY, maxX, maxY)) {
      if (
        !player.alive || player.id === rocket.ownerId || player.vehicleId ||
        player.surfaceId !== rocket.surfaceId
      ) continue;
      const impact = circleImpact(rocket.x, rocket.y, endX, endY, player.x, player.y, 11 + radius);
      if (impact) impacts.push(impact);
    }
    for (const npc of this.options.queryNpcs(minX, minY, maxX, maxY)) {
      if (!npc.alive || npc.surfaceId !== rocket.surfaceId) continue;
      const impact = circleImpact(rocket.x, rocket.y, endX, endY, npc.x, npc.y, 10 + radius);
      if (impact) impacts.push(impact);
    }
    for (const vehicle of this.options.queryVehicles(minX, minY, maxX, maxY)) {
      if (vehicle.destroyed || vehicle.surfaceId !== rocket.surfaceId) continue;
      const impact = circleImpact(rocket.x, rocket.y, endX, endY, vehicle.x, vehicle.y, 22 + radius);
      if (impact) impacts.push(impact);
    }
    return impacts.sort((left, right) => left.progress - right.progress)[0];
  }

  private worldImpact(startX: number, startY: number, endX: number, endY: number): Impact | undefined {
    const hit = this.options.world.traceSegment(startX, startY, endX, endY);
    return hit ? {progress: hit.t, x: hit.x, y: hit.y} : undefined;
  }

  private detonate(
    rocket: RocketProjectileState,
    rocketId: string,
    x: number,
    y: number,
    nowMs: number
  ): void {
    this.detonated.add(rocketId);
    while (this.detonated.size > RocketProjectileController.settledCapacity) {
      const oldest = this.detonated.values().next().value;
      if (!oldest) break;
      this.detonated.delete(oldest);
    }
    this.options.detonate(x, y, rocket.ownerId, nowMs, rocket.surfaceId);
    this.options.remove(rocketId);
  }

  private ownerCount(ownerId: string): number {
    let count = 0;
    for (const rocket of this.options.state.rockets.values()) {
      if (rocket.ownerId === ownerId && !this.detonated.has(rocket.id)) count++;
    }
    return count;
  }

}

function circleImpact(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  radius: number
): Impact | undefined {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  if (Math.hypot(startX - centerX, startY - centerY) <= radius) {
    return {progress: 0, x: startX, y: startY};
  }
  if (lengthSquared <= 0) return undefined;
  const offsetX = startX - centerX;
  const offsetY = startY - centerY;
  const b = 2 * (offsetX * dx + offsetY * dy);
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  const discriminant = b * b - 4 * lengthSquared * c;
  if (discriminant < 0) return undefined;
  const root = Math.sqrt(discriminant);
  const entry = (-b - root) / (2 * lengthSquared);
  const exit = (-b + root) / (2 * lengthSquared);
  const progress = entry >= 0 && entry <= 1 ? entry : (exit >= 0 && exit <= 1 ? exit : -1);
  if (progress < 0) return undefined;
  const x = startX + dx * progress;
  const y = startY + dy * progress;
  return {progress, x, y};
}

function earliest(left?: Impact, right?: Impact): Impact | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.progress <= right.progress ? left : right;
}
