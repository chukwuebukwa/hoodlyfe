import type {PlayerState} from './state.ts';
import {
  WEAPON_ORDER,
  WEAPONS,
  isWeaponId,
  type WeaponId
} from '../shared/content/weapon-catalog.ts';

export {
  WEAPON_ORDER,
  WEAPONS,
  isBulletWeaponId,
  isMeleeWeaponId,
  isWeaponId,
  type BulletWeaponId,
  type MeleeWeaponDefinition,
  type MeleeWeaponId,
  type WeaponDefinition,
  type WeaponId
} from '../shared/content/weapon-catalog.ts';

export function ammoFor(player: PlayerState, weapon: WeaponId): number {
  const field = WEAPONS[weapon].ammunitionField;
  return field ? player[field] : Number.POSITIVE_INFINITY;
}

export function setAmmo(player: PlayerState, weapon: WeaponId, amount: number): void {
  const field = WEAPONS[weapon].ammunitionField;
  if (!field) return;
  const ammo = Math.max(0, Math.floor(amount));
  player[field] = ammo;
}

export function refillAmmo(player: PlayerState): void {
  player.ammoPistol = 120;
  player.ammoSmg = 240;
  player.ammoShotgun = 48;
  player.ammoRocket = 4;
  player.ammoGrenade = 6;
}
