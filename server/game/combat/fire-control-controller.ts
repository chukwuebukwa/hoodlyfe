import {BulletState, type DistrictState, type PlayerState} from '../../state.ts';
import {
  WEAPON_ORDER,
  WEAPONS,
  isMagazineWeaponId,
  isWeaponId,
  type BulletWeaponId,
  type MeleeWeaponId,
  type WeaponId
} from '../../../shared/content/weapon-catalog.ts';
import {ammoFor, refillAmmo, setAmmo} from '../../weapons.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {GameEventStream} from '../events/game-events.ts';
import type {
  CombatFireCommand,
  CombatProjectileReceipt
} from '../../../shared/protocol/combat-fire.ts';
import type {WeaponRuntimeController} from './weapon-runtime-controller.ts';

export interface FireControlResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly weapon?: WeaponId;
  readonly magazine?: number;
  readonly reserve?: number;
  readonly shotSequence?: number;
  readonly reloadSequence?: number;
  readonly reloadEndsAt?: number;
  readonly projectiles?: readonly CombatProjectileReceipt[];
}

interface FireControlControllerOptions {
  state: DistrictState;
  random: DeterministicRandom;
  clock: () => {tick: number; nowMs: number};
  events?: GameEventStream;
  weaponRuntime: WeaponRuntimeController;
  cancelSpawnProtection?: (playerId: string) => void;
  throwExplosive?: (input: {
    kind: 'grenade' | 'molotov';
    ownerId: string;
    x: number;
    y: number;
    angle: number;
    nowMs: number;
  }) => boolean;
  launchRocket?: (input: {
    ownerId: string;
    x: number;
    y: number;
    angle: number;
    nowMs: number;
  }) => boolean;
  meleeAttack?: (input: {
    playerId: string;
    weapon: MeleeWeaponId;
    nowMs: number;
  }) => {accepted: boolean; combo: number};
  compensateBullet?: (input: {
    bullet: BulletState;
    requestedServerShotTimeMs: number;
    nowMs: number;
    excludedIds: ReadonlySet<string>;
  }) => {
    effectiveServerShotTimeMs: number;
    rewindMs: number;
    resolved: boolean;
  };
}

export class FireControlController {
  private readonly lastAttackAt = new Map<string, number>();
  private nextBulletId = 1;

  constructor(private readonly options: FireControlControllerOptions) {}

  shoot(playerId: string, command?: CombatFireCommand): FireControlResult {
    const player = this.options.state.players.get(playerId);
    const clock = this.options.clock();
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0)) {
      return rejected('not-allowed');
    }
    const weaponId: WeaponId = isWeaponId(player.weapon) ? player.weapon : 'pistol';
    const weapon = WEAPONS[weaponId];
    if (command) {
      const expectedPredictedSpawns = weapon.fireMode === 'bullet' ? weapon.pellets : 0;
      if (command.predictedSpawnIds.length !== expectedPredictedSpawns) {
        return rejected('invalid-predicted-spawn-count', weaponId);
      }
    }
    if (player.action) {
      if (player.action === 'melee' && weapon.fireMode === 'melee') {
        const result = this.options.meleeAttack?.({playerId, weapon: weapon.id, nowMs: clock.nowMs});
        return result?.accepted
          ? accepted()
          : rejected('action-blocked');
      }
      return rejected('action-blocked');
    }
    if (player.vehicleId && !weapon.passengerAllowed) return rejected('not-allowed');
    if (clock.nowMs - (this.lastAttackAt.get(playerId) ?? Number.NEGATIVE_INFINITY) < weapon.cooldownMs) {
      return rejected('cooldown', weaponId);
    }
    if (!isMagazineWeaponId(weaponId) && ammoFor(player, weaponId) <= 0) {
      return rejected('empty-ammo', weaponId);
    }

    const origin = this.shotOrigin(player);
    const aimAngle = command?.aimAngle ?? player.angle;
    if (weapon.fireMode === 'melee') {
      const result = this.options.meleeAttack?.({
        playerId,
        weapon: weapon.id,
        nowMs: clock.nowMs
      });
      if (!result?.accepted) return rejected('action-blocked');
      this.lastAttackAt.set(playerId, clock.nowMs);
      return accepted();
    }
    if (weapon.fireMode === 'thrown') {
      const created = this.options.throwExplosive?.({
        kind: weapon.id,
        ownerId: playerId,
        x: origin.x,
        y: origin.y,
        angle: aimAngle,
        nowMs: clock.nowMs
      }) ?? false;
      if (!created) return rejected('capacity-exceeded');
      this.lastAttackAt.set(playerId, clock.nowMs);
      this.options.cancelSpawnProtection?.(playerId);
      setAmmo(player, weaponId, ammoFor(player, weaponId) - 1);
      this.publishWeaponFired(playerId, 'player', origin.x, origin.y, weaponId, clock);
      return accepted();
    }
    if (weapon.fireMode === 'rocket') {
      const ready = this.options.weaponRuntime.canFire(player, weapon.id);
      if (!ready.accepted) return {...ready, shotSequence: player.shotSequence};
      const created = this.options.launchRocket?.({
        ownerId: playerId,
        x: origin.x,
        y: origin.y,
        angle: aimAngle,
        nowMs: clock.nowMs
      }) ?? false;
      if (!created) return rejected('capacity-exceeded');
      const consumed = this.options.weaponRuntime.consumeShot(player, weapon.id);
      if (!consumed.accepted) return {...consumed, shotSequence: player.shotSequence};
      this.lastAttackAt.set(playerId, clock.nowMs);
      this.options.cancelSpawnProtection?.(playerId);
      this.publishWeaponFired(playerId, 'player', origin.x, origin.y, weaponId, clock);
      return accepted(player, weaponId, consumed);
    }

    const consumed = this.options.weaponRuntime.consumeShot(player, weapon.id);
    if (!consumed.accepted) return {...consumed, shotSequence: player.shotSequence};
    this.lastAttackAt.set(playerId, clock.nowMs);
    this.options.cancelSpawnProtection?.(playerId);
    this.publishWeaponFired(playerId, 'player', origin.x, origin.y, weaponId, clock);
    const excludedIds = new Set([playerId]);
    if (player.vehicleId) excludedIds.add(player.vehicleId);
    const projectiles: CombatProjectileReceipt[] = [];
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const spread = weapon.pellets === 1
        ? (this.options.random.unit('weapon-spread', `${playerId}:${clock.tick}`) - 0.5) * weapon.spread
        : ((pellet / (weapon.pellets - 1)) - 0.5) * weapon.spread;
      const bullet = this.createBullet(
        playerId,
        'player',
        origin.x,
        origin.y,
        aimAngle + spread,
        clock.nowMs,
        weapon.id
      );
      const compensation = command && this.options.compensateBullet
        ? this.options.compensateBullet({
          bullet,
          requestedServerShotTimeMs: command.clientSampleTimeMs,
          nowMs: clock.nowMs,
          excludedIds
        })
        : undefined;
      if (command) {
        projectiles.push(Object.freeze({
          clientSpawnId: command.predictedSpawnIds[pellet],
          authoritativeSpawnId: bullet.id,
          status: compensation?.resolved ? 'resolved' : 'active',
          weapon: weapon.id,
          x: bullet.x,
          y: bullet.y,
          angle: bullet.angle
        }));
      }
    }
    return Object.freeze({
      ...accepted(player, weaponId, consumed),
      projectiles: Object.freeze(projectiles)
    });
  }

  cycle(playerId: string, rawDirection: unknown): void {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0) || player.action) return;
    const current = isWeaponId(player.weapon) ? WEAPON_ORDER.indexOf(player.weapon) : 0;
    const direction = Number(rawDirection) < 0 ? -1 : 1;
    this.options.weaponRuntime.cancelReload(player);
    player.weapon = WEAPON_ORDER[(current + direction + WEAPON_ORDER.length) % WEAPON_ORDER.length];
  }

  createPoliceBullet(x: number, y: number, angle: number, nowMs: number): void {
    this.publishWeaponFired('police', 'police', x, y, 'pistol', {
      tick: this.options.clock().tick,
      nowMs
    });
    this.createBullet('police', 'police', x, y, angle, nowMs, 'pistol');
  }

  createNpcBullet(
    ownerId: string,
    x: number,
    y: number,
    angle: number,
    nowMs: number,
    weapon: WeaponId = 'pistol',
    ownerKind: 'police' | 'hostile' = 'police'
  ): void {
    const definition = WEAPONS[weapon];
    if (definition.fireMode !== 'bullet') return;
    this.publishWeaponFired(ownerId, ownerKind, x, y, definition.id, {
      tick: this.options.clock().tick,
      nowMs
    });
    this.createBullet(ownerId, ownerKind, x, y, angle, nowMs, definition.id);
  }

  clearPlayer(playerId: string): void {
    this.lastAttackAt.delete(playerId);
  }

  restock(playerId: string): void {
    const player = this.options.state.players.get(playerId);
    if (!player) return;
    refillAmmo(player);
  }

  private publishWeaponFired(
    ownerId: string,
    ownerKind: 'player' | 'police' | 'hostile',
    x: number,
    y: number,
    weapon: WeaponId,
    clock: {tick: number; nowMs: number}
  ): void {
    this.options.events?.publish({
      type: 'weapon.fired',
      tick: clock.tick,
      nowMs: clock.nowMs,
      ownerId,
      ownerKind,
      weapon,
      x,
      y
    });
  }

  private shotOrigin(player: PlayerState): {x: number; y: number} {
    if (!player.vehicleId || player.vehicleSeat <= 0) return {x: player.x, y: player.y};
    const vehicle = this.options.state.vehicles.get(player.vehicleId);
    if (!vehicle) return {x: player.x, y: player.y};
    const forwardOffset = player.vehicleSeat === 3 ? -11 : 5;
    const sideOffset = player.vehicleSeat === 1 ? 15 : (player.vehicleSeat === 2 ? -15 : 0);
    const sideAngle = vehicle.angle + Math.PI / 2;
    return {
      x: vehicle.x + Math.cos(vehicle.angle) * forwardOffset + Math.cos(sideAngle) * sideOffset,
      y: vehicle.y + Math.sin(vehicle.angle) * forwardOffset + Math.sin(sideAngle) * sideOffset
    };
  }

  private createBullet(
    ownerId: string,
    ownerKind: 'player' | 'police' | 'hostile',
    x: number,
    y: number,
    angle: number,
    nowMs: number,
    weapon: BulletWeaponId
  ): BulletState {
    const bullet = new BulletState();
    bullet.id = String(this.nextBulletId++);
    bullet.ownerId = ownerId;
    bullet.ownerKind = ownerKind;
    bullet.surfaceId = (
      this.options.state.players.get(ownerId) ?? this.options.state.npcs.get(ownerId)
    )?.surfaceId ?? bullet.surfaceId;
    bullet.angle = angle;
    bullet.weapon = weapon;
    bullet.x = x + Math.cos(angle) * 18;
    bullet.y = y + Math.sin(angle) * 18;
    bullet.createdAt = nowMs;
    this.options.state.bullets.set(bullet.id, bullet);
    return bullet;
  }
}

function accepted(
  player?: PlayerState,
  weapon?: WeaponId,
  runtime?: {magazine?: number; reserve?: number; reloadSequence?: number; reloadEndsAt?: number}
): FireControlResult {
  return Object.freeze({
    accepted: true,
    ...(weapon ? {weapon} : {}),
    ...(runtime ?? {}),
    ...(player ? {shotSequence: player.shotSequence} : {})
  });
}

function rejected(reason: string, weapon?: WeaponId): FireControlResult {
  return Object.freeze({accepted: false, reason, ...(weapon ? {weapon} : {})});
}
