import {BulletState, type DistrictState, type PlayerState} from '../../state.ts';
import {
  WEAPON_ORDER,
  WEAPONS,
  ammoFor,
  isWeaponId,
  setAmmo,
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
}

export class FireControlController {
  private readonly lastShotAt = new Map<string, number>();
  private nextBulletId = 1;

  constructor(private readonly options: FireControlControllerOptions) {}

  shoot(playerId: string): void {
    const player = this.options.state.players.get(playerId);
    const clock = this.options.clock();
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0) || player.action) return;
    const weaponId = isWeaponId(player.weapon) ? player.weapon : 'pistol';
    const weapon = WEAPONS[weaponId];
    if (
      clock.nowMs - (this.lastShotAt.get(playerId) ?? Number.NEGATIVE_INFINITY) < weapon.cooldownMs ||
      ammoFor(player, weaponId) <= 0
    ) {
      return;
    }

    this.lastShotAt.set(playerId, clock.nowMs);
    setAmmo(player, weaponId, ammoFor(player, weaponId) - 1);
    const origin = this.shotOrigin(player);
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
        weaponId
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
    weapon: WeaponId = 'pistol'
  ): void {
    this.publishWeaponFired(ownerId, 'police', x, y, weapon, {
      tick: this.options.clock().tick,
      nowMs
    });
    this.createBullet(ownerId, 'police', x, y, angle, nowMs, weapon);
  }

  clearPlayer(playerId: string): void {
    this.lastShotAt.delete(playerId);
  }

  restock(playerId: string): void {
    const player = this.options.state.players.get(playerId);
    if (!player) return;
    player.ammoPistol = AMMUNITION_CAPACITY.ammoPistol;
    player.ammoSmg = AMMUNITION_CAPACITY.ammoSmg;
    player.ammoShotgun = AMMUNITION_CAPACITY.ammoShotgun;
  }

  private publishWeaponFired(
    ownerId: string,
    ownerKind: 'player' | 'police',
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
    ownerKind: 'player' | 'police',
    x: number,
    y: number,
    angle: number,
    nowMs: number,
    weapon: WeaponId
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
