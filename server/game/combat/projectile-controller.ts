import type {BulletState, DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {WEAPONS, isBulletWeaponId} from '../../weapons.ts';
import {classifyImpactZone} from '../vehicles/vehicle-collision-system.ts';
import type {VehicleAccessController} from '../vehicles/vehicle-access-controller.ts';
import type {VehicleSimulationController} from '../vehicles/vehicle-simulation-controller.ts';
import type {DamageController} from './damage-controller.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;

interface ProjectileControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  access: VehicleAccessController;
  vehicles: VehicleSimulationController;
  damage: DamageController;
  queryPlayers: (minX: number, minY: number, maxX: number, maxY: number) => PlayerState[];
  queryNpcs: (minX: number, minY: number, maxX: number, maxY: number) => NpcState[];
  queryVehicles: (minX: number, minY: number, maxX: number, maxY: number) => VehicleState[];
  remove: (bulletId: string) => void;
}

export class ProjectileController {
  constructor(private readonly options: ProjectileControllerOptions) {}

  update(bullet: BulletState, bulletId: string, deltaSeconds: number, nowMs: number): void {
    const weapon = WEAPONS[isBulletWeaponId(bullet.weapon) ? bullet.weapon : 'pistol'];
    if (nowMs - bullet.createdAt > weapon.lifetimeMs) {
      this.options.remove(bulletId);
      return;
    }

    const previousX = bullet.x;
    const previousY = bullet.y;
    bullet.x += Math.cos(bullet.angle) * weapon.projectileSpeed * deltaSeconds;
    bullet.y += Math.sin(bullet.angle) * weapon.projectileSpeed * deltaSeconds;
    if (this.options.world.isBlockedAt(bullet.x, bullet.y)) {
      this.options.remove(bulletId);
      return;
    }

    const minX = Math.min(previousX, bullet.x) - 4;
    const minY = Math.min(previousY, bullet.y) - 4;
    const maxX = Math.max(previousX, bullet.x) + 4;
    const maxY = Math.max(previousY, bullet.y) + 4;
    for (const target of this.options.queryPlayers(minX, minY, maxX, maxY)) {
      if (!target.alive || target.vehicleId || target.id === bullet.ownerId) continue;
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
        bullet.ownerKind === 'player' ? 'player' : 'non-player'
      );
      this.options.remove(bulletId);
      return;
    }

    for (const target of this.options.queryVehicles(minX, minY, maxX, maxY)) {
      if (target.destroyed) continue;
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
      if (!target.alive) continue;
      if (pointSegmentDistance(target.x, target.y, previousX, previousY, bullet.x, bullet.y) > NPC_RADIUS + 4) {
        continue;
      }
      this.options.damage.npc(target, weapon.damage, bullet.ownerId, nowMs);
      this.options.remove(bulletId);
      return;
    }
  }
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
