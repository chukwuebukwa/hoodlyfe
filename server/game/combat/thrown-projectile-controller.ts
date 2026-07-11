import {GRENADE_PROJECTILE} from '../../../shared/content/explosives.ts';
import {MOLOTOV_PROJECTILE} from '../../../shared/content/fire-zones.ts';
import {ThrownProjectileState, type DistrictState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

interface ThrownProjectileRuntime {
  velocityX: number;
  velocityY: number;
  velocityZ: number;
}

interface ThrowExplosiveInput {
  kind: 'grenade' | 'molotov';
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  nowMs: number;
}

interface ThrownProjectileControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  resolve: (kind: 'grenade' | 'molotov', x: number, y: number, ownerId: string, nowMs: number) => void;
  remove: (projectileId: string) => void;
}

export class ThrownProjectileController {
  private readonly runtime = new Map<string, ThrownProjectileRuntime>();
  private nextProjectileId = 1;

  constructor(private readonly options: ThrownProjectileControllerOptions) {}

  throw(input: ThrowExplosiveInput): boolean {
    const config = input.kind === 'molotov' ? MOLOTOV_PROJECTILE : GRENADE_PROJECTILE;
    if (
      this.options.state.thrownProjectiles.size >= config.globalCapacity ||
      this.ownerCount(input.ownerId) >= config.ownerCapacity
    ) {
      return false;
    }

    const projectile = new ThrownProjectileState();
    projectile.id = `${input.kind}-${this.nextProjectileId++}`;
    projectile.ownerId = input.ownerId;
    projectile.kind = input.kind;
    projectile.x = input.x + Math.cos(input.angle) * 18;
    projectile.y = input.y + Math.sin(input.angle) * 18;
    projectile.height = config.initialHeight;
    projectile.angle = input.angle;
    projectile.createdAt = input.nowMs;
    projectile.fuseAt = input.nowMs + config.fuseMs;
    this.options.state.thrownProjectiles.set(projectile.id, projectile);
    this.runtime.set(projectile.id, {
      velocityX: Math.cos(input.angle) * config.planarSpeed,
      velocityY: Math.sin(input.angle) * config.planarSpeed,
      velocityZ: config.verticalSpeed
    });
    return true;
  }

  update(
    projectile: ThrownProjectileState,
    projectileId: string,
    deltaSeconds: number,
    nowMs: number
  ): void {
    const motion = this.runtime.get(projectileId);
    if (!motion) {
      this.remove(projectileId);
      return;
    }

    const delta = Math.min(Math.max(0, deltaSeconds), 0.1);
    const config = projectile.kind === 'molotov' ? MOLOTOV_PROJECTILE : GRENADE_PROJECTILE;
    const collided = this.movePlanar(projectile, motion, delta, config.radius);
    projectile.height += motion.velocityZ * delta;
    motion.velocityZ -= config.gravity * delta;
    if (projectile.kind === 'molotov' && (collided || (projectile.height <= 0 && motion.velocityZ <= 0))) {
      this.resolve(projectile, projectileId, nowMs);
      return;
    }
    if (projectile.height <= 0) {
      projectile.height = 0;
      if (Math.abs(motion.velocityZ) < 34) {
        motion.velocityZ = 0;
      } else {
        motion.velocityZ = -motion.velocityZ * GRENADE_PROJECTILE.groundElasticity;
      }
      motion.velocityX *= GRENADE_PROJECTILE.groundDamping;
      motion.velocityY *= GRENADE_PROJECTILE.groundDamping;
    }
    if (Math.abs(motion.velocityX) + Math.abs(motion.velocityY) > 1) {
      projectile.angle = Math.atan2(motion.velocityY, motion.velocityX);
    }

    if (nowMs < projectile.fuseAt) return;
    this.resolve(projectile, projectileId, nowMs);
  }

  private movePlanar(
    projectile: ThrownProjectileState,
    motion: ThrownProjectileRuntime,
    deltaSeconds: number,
    radius: number
  ): boolean {
    let collided = false;
    const nextX = projectile.x + motion.velocityX * deltaSeconds;
    if (this.options.world.canOccupy(nextX, projectile.y, radius)) {
      projectile.x = nextX;
    } else {
      collided = true;
      motion.velocityX *= -GRENADE_PROJECTILE.wallElasticity;
    }

    const nextY = projectile.y + motion.velocityY * deltaSeconds;
    if (this.options.world.canOccupy(projectile.x, nextY, radius)) {
      projectile.y = nextY;
    } else {
      collided = true;
      motion.velocityY *= -GRENADE_PROJECTILE.wallElasticity;
    }
    return collided;
  }

  private ownerCount(ownerId: string): number {
    let count = 0;
    for (const projectile of this.options.state.thrownProjectiles.values()) {
      if (projectile.ownerId === ownerId) count++;
    }
    return count;
  }

  private remove(projectileId: string): void {
    this.runtime.delete(projectileId);
    this.options.remove(projectileId);
  }

  private resolve(projectile: ThrownProjectileState, projectileId: string, nowMs: number): void {
    const kind = projectile.kind === 'molotov' ? 'molotov' : 'grenade';
    this.options.resolve(kind, projectile.x, projectile.y, projectile.ownerId, nowMs);
    this.remove(projectileId);
  }
}
