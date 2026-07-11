import {GRENADE_PROJECTILE} from '../../../shared/content/explosives.ts';
import {ThrownProjectileState, type DistrictState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

interface ThrownProjectileRuntime {
  velocityX: number;
  velocityY: number;
  velocityZ: number;
}

interface ThrowExplosiveInput {
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  nowMs: number;
}

interface ThrownProjectileControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  detonate: (x: number, y: number, ownerId: string, nowMs: number) => void;
  remove: (projectileId: string) => void;
}

export class ThrownProjectileController {
  private readonly runtime = new Map<string, ThrownProjectileRuntime>();
  private nextProjectileId = 1;

  constructor(private readonly options: ThrownProjectileControllerOptions) {}

  throw(input: ThrowExplosiveInput): boolean {
    if (
      this.options.state.thrownProjectiles.size >= GRENADE_PROJECTILE.globalCapacity ||
      this.ownerCount(input.ownerId) >= GRENADE_PROJECTILE.ownerCapacity
    ) {
      return false;
    }

    const projectile = new ThrownProjectileState();
    projectile.id = `grenade-${this.nextProjectileId++}`;
    projectile.ownerId = input.ownerId;
    projectile.x = input.x + Math.cos(input.angle) * 18;
    projectile.y = input.y + Math.sin(input.angle) * 18;
    projectile.height = GRENADE_PROJECTILE.initialHeight;
    projectile.angle = input.angle;
    projectile.createdAt = input.nowMs;
    projectile.fuseAt = input.nowMs + GRENADE_PROJECTILE.fuseMs;
    this.options.state.thrownProjectiles.set(projectile.id, projectile);
    this.runtime.set(projectile.id, {
      velocityX: Math.cos(input.angle) * GRENADE_PROJECTILE.planarSpeed,
      velocityY: Math.sin(input.angle) * GRENADE_PROJECTILE.planarSpeed,
      velocityZ: GRENADE_PROJECTILE.verticalSpeed
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
    this.movePlanar(projectile, motion, delta);
    projectile.height += motion.velocityZ * delta;
    motion.velocityZ -= GRENADE_PROJECTILE.gravity * delta;
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
    this.options.detonate(projectile.x, projectile.y, projectile.ownerId, nowMs);
    this.remove(projectileId);
  }

  private movePlanar(
    projectile: ThrownProjectileState,
    motion: ThrownProjectileRuntime,
    deltaSeconds: number
  ): void {
    const nextX = projectile.x + motion.velocityX * deltaSeconds;
    if (this.options.world.canOccupy(nextX, projectile.y, GRENADE_PROJECTILE.radius)) {
      projectile.x = nextX;
    } else {
      motion.velocityX *= -GRENADE_PROJECTILE.wallElasticity;
    }

    const nextY = projectile.y + motion.velocityY * deltaSeconds;
    if (this.options.world.canOccupy(projectile.x, nextY, GRENADE_PROJECTILE.radius)) {
      projectile.y = nextY;
    } else {
      motion.velocityY *= -GRENADE_PROJECTILE.wallElasticity;
    }
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
}
