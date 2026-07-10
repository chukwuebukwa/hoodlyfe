import type {PlayerState} from './state.ts';

export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'grenade'] as const;

export type WeaponId = typeof WEAPON_ORDER[number];

export interface WeaponConfig {
  id: WeaponId;
  name: string;
  fireMode: 'bullet' | 'thrown';
  passengerAllowed: boolean;
  cooldownMs: number;
  damage: number;
  projectileSpeed: number;
  lifetimeMs: number;
  pellets: number;
  spread: number;
}

export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 170,
    damage: 25,
    projectileSpeed: 720,
    lifetimeMs: 1100,
    pellets: 1,
    spread: 0
  },
  smg: {
    id: 'smg',
    name: 'SMG',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 85,
    damage: 12,
    projectileSpeed: 820,
    lifetimeMs: 900,
    pellets: 1,
    spread: 0.045
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 650,
    damage: 18,
    projectileSpeed: 650,
    lifetimeMs: 550,
    pellets: 6,
    spread: 0.3
  },
  grenade: {
    id: 'grenade',
    name: 'Grenade',
    fireMode: 'thrown',
    passengerAllowed: false,
    cooldownMs: 650,
    damage: 0,
    projectileSpeed: 0,
    lifetimeMs: 2000,
    pellets: 0,
    spread: 0
  }
};

export function isWeaponId(value: string): value is WeaponId {
  return value in WEAPONS;
}

export function ammoFor(player: PlayerState, weapon: WeaponId): number {
  if (weapon === 'grenade') return player.ammoGrenade;
  if (weapon === 'smg') return player.ammoSmg;
  if (weapon === 'shotgun') return player.ammoShotgun;
  return player.ammoPistol;
}

export function setAmmo(player: PlayerState, weapon: WeaponId, amount: number): void {
  const ammo = Math.max(0, Math.floor(amount));
  if (weapon === 'grenade') player.ammoGrenade = ammo;
  else if (weapon === 'smg') player.ammoSmg = ammo;
  else if (weapon === 'shotgun') player.ammoShotgun = ammo;
  else player.ammoPistol = ammo;
}

export function refillAmmo(player: PlayerState): void {
  player.ammoPistol = 120;
  player.ammoSmg = 240;
  player.ammoShotgun = 48;
  player.ammoGrenade = 6;
}
