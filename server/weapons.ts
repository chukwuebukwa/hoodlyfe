import type {PlayerState} from './state.ts';
import {
  WEAPON_ORDER,
  WEAPONS,
  isMagazineWeaponId,
  type MagazineWeaponId,
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
  for (const weapon of WEAPON_ORDER) {
    const definition = WEAPONS[weapon];
    if (!definition.ammunitionField) continue;
    if (isMagazineWeaponId(weapon)) {
      const magazineDefinition = WEAPONS[weapon];
      setMagazine(player, weapon, magazineDefinition.magazineSize);
      setAmmo(
        player,
        weapon,
        magazineDefinition.ammunitionCapacity - magazineDefinition.magazineSize
      );
    } else {
      setAmmo(player, weapon, definition.ammunitionCapacity);
    }
  }
  clearReload(player);
}

export function confiscateWeapons(player: PlayerState): void {
  player.weapon = 'fists';
  for (const weapon of WEAPON_ORDER) {
    if (WEAPONS[weapon].ammunitionField) setAmmo(player, weapon, 0);
    if (isMagazineWeaponId(weapon)) setMagazine(player, weapon, 0);
  }
  clearReload(player);
}

export function clearReload(player: PlayerState): void {
  player.reloadWeapon = '';
  player.reloadStartedAt = 0;
  player.reloadEndsAt = 0;
}
