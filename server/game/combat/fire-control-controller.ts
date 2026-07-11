import {BulletState, type DistrictState, type PlayerState} from '../../state.ts';
import {
  WEAPON_ORDER,
  WEAPONS,
  ammoFor,
  isWeaponId,
  setAmmo,
  type BulletWeaponId,
  type MeleeWeaponId,
  type WeaponId
} from '../../weapons.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {GameEventStream} from '../events/game-events.ts';
import {AMMUNITION_CAPACITY} from '../../../shared/content/street-services.ts';

interface FireControlControllerOptions {
  state: DistrictState;
  random: DeterministicRandom;
  clock: () => {tick: number; nowMs: number};
  events?: GameEventStream;
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
}

export class FireControlController {
  private readonly lastAttackAt = new Map<string, number>();
  private nextBulletId = 1;

  constructor(private readonly options: FireControlControllerOptions) {}

  shoot(playerId: string): void {
    const player = this.options.state.players.get(playerId);
    const clock = this.options.clock();
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0)) return;
    const weaponId: WeaponId = isWeaponId(player.weapon) ? player.weapon : 'pistol';
    const weapon = WEAPONS[weaponId];
    if (player.action) {
      if (player.action === 'melee' && weapon.fireMode === 'melee') {
        this.options.meleeAttack?.({playerId, weapon: weapon.id, nowMs: clock.nowMs});
      }
      return;
    }
    if (player.vehicleId && !weapon.passengerAllowed) return;
    if (
      clock.nowMs - (this.lastAttackAt.get(playerId) ?? Number.NEGATIVE_INFINITY) < weapon.cooldownMs ||
      ammoFor(player, weaponId) <= 0
    ) {
      return;
    }

    const origin = this.shotOrigin(player);
    if (weapon.fireMode === 'melee') {
      const result = this.options.meleeAttack?.({
        playerId,
        weapon: weapon.id,
        nowMs: clock.nowMs
      });
      if (!result?.accepted) return;
      this.lastAttackAt.set(playerId, clock.nowMs);
      return;
    }
    if (weapon.fireMode === 'thrown') {
      const created = this.options.throwExplosive?.({
        kind: weapon.id,
        ownerId: playerId,
        x: origin.x,
        y: origin.y,
        angle: player.angle,
        nowMs: clock.nowMs
      }) ?? false;
      if (!created) return;
      this.lastAttackAt.set(playerId, clock.nowMs);
      this.options.cancelSpawnProtection?.(playerId);
      setAmmo(player, weaponId, ammoFor(player, weaponId) - 1);
      this.publishWeaponFired(playerId, 'player', origin.x, origin.y, weaponId, clock);
      return;
    }
    if (weapon.fireMode === 'rocket') {
      const created = this.options.launchRocket?.({
        ownerId: playerId,
        x: origin.x,
        y: origin.y,
        angle: player.angle,
        nowMs: clock.nowMs
      }) ?? false;
      if (!created) return;
      this.lastAttackAt.set(playerId, clock.nowMs);
      this.options.cancelSpawnProtection?.(playerId);
      setAmmo(player, weaponId, ammoFor(player, weaponId) - 1);
      this.publishWeaponFired(playerId, 'player', origin.x, origin.y, weaponId, clock);
      return;
    }

    this.lastAttackAt.set(playerId, clock.nowMs);
    this.options.cancelSpawnProtection?.(playerId);
    setAmmo(player, weaponId, ammoFor(player, weaponId) - 1);
    this.publishWeaponFired(playerId, 'player', origin.x, origin.y, weaponId, clock);
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const spread = weapon.pellets === 1
        ? (this.options.random.unit('weapon-spread', `${playerId}:${clock.tick}`) - 0.5) * weapon.spread
        : ((pellet / (weapon.pellets - 1)) - 0.5) * weapon.spread;
      this.createBullet(
        playerId,
        'player',
        origin.x,
        origin.y,
        player.angle + spread,
        clock.nowMs,
        weapon.id
      );
    }
  }

  cycle(playerId: string, rawDirection: unknown): void {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0) || player.action) return;
    const current = isWeaponId(player.weapon) ? WEAPON_ORDER.indexOf(player.weapon) : 0;
    const direction = Number(rawDirection) < 0 ? -1 : 1;
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
    player.ammoPistol = AMMUNITION_CAPACITY.ammoPistol;
    player.ammoSmg = AMMUNITION_CAPACITY.ammoSmg;
    player.ammoShotgun = AMMUNITION_CAPACITY.ammoShotgun;
    player.ammoRocket = AMMUNITION_CAPACITY.ammoRocket;
    player.ammoGrenade = AMMUNITION_CAPACITY.ammoGrenade;
    player.ammoMolotov = AMMUNITION_CAPACITY.ammoMolotov;
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
  ): void {
    const bullet = new BulletState();
    bullet.id = String(this.nextBulletId++);
    bullet.ownerId = ownerId;
    bullet.ownerKind = ownerKind;
    bullet.angle = angle;
    bullet.weapon = weapon;
    bullet.x = x + Math.cos(angle) * 18;
    bullet.y = y + Math.sin(angle) * 18;
    bullet.createdAt = nowMs;
    this.options.state.bullets.set(bullet.id, bullet);
  }
}
