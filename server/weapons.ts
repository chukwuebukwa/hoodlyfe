import type {PlayerState} from './state.ts';
import {
  WEAPON_ORDER,
  WEAPONS,
  isMagazineWeaponId,
  isWeaponId,
  type MagazineWeaponId,
  type WeaponId
} from '../shared/content/weapon-catalog.ts';
import {AMMUNITION_CAPACITY} from '../shared/content/street-services.ts';

export {
  WEAPON_ORDER,
  WEAPONS,
  isBulletWeaponId,
  isMeleeWeaponId,
  isMagazineWeaponId,
  isWeaponId,
  type BulletWeaponId,
  type MeleeWeaponDefinition,
  type MeleeWeaponId,
  type MagazineWeaponId,
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

export function magazineFor(player: PlayerState, weapon: MagazineWeaponId): number {
  return player[WEAPONS[weapon].magazineField];
}

export function setMagazine(player: PlayerState, weapon: MagazineWeaponId, amount: number): void {
  const definition = WEAPONS[weapon];
  player[definition.magazineField] = Math.max(0, Math.min(definition.magazineSize, Math.floor(amount)));
}

export function refillAmmo(player: PlayerState): void {
  for (const weapon of ['pistol', 'smg', 'shotgun', 'rocket'] as const) {
    const definition = WEAPONS[weapon];
    setMagazine(player, weapon, definition.magazineSize);
    setAmmo(player, weapon, AMMUNITION_CAPACITY[definition.ammunitionField] - definition.magazineSize);
  }
  player.ammoGrenade = 6;
  player.ammoMolotov = 5;
  clearReload(player);
}

export function confiscateWeapons(player: PlayerState): void {
  player.weapon = 'fists';
  player.ammoPistol = 0;
  player.ammoSmg = 0;
  player.ammoShotgun = 0;
  player.ammoRocket = 0;
  player.ammoGrenade = 0;
  player.ammoMolotov = 0;
  player.magazinePistol = 0;
  player.magazineSmg = 0;
  player.magazineShotgun = 0;
  player.magazineRocket = 0;
  clearReload(player);
}

export function clearReload(player: PlayerState): void {
  player.reloadWeapon = '';
  player.reloadStartedAt = 0;
  player.reloadEndsAt = 0;
}
