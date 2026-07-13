import type {WeaponId} from './weapon-catalog.ts';

export interface WeaponPickupDefinition {
  id: string;
  weapon: Extract<WeaponId, 'grenade' | 'molotov'>;
  label: string;
  quantity: number;
  capacity: number;
  radius: number;
  respawnMs: number;
  minimumSpawnDistance: number;
  maximumSpawnDistance: number;
  placementSeed: number;
}

export const WEAPON_PICKUPS: readonly WeaponPickupDefinition[] = Object.freeze([
  Object.freeze({
    id: 'grenade-cache',
    weapon: 'grenade',
    label: 'GRENADES',
    quantity: 3,
    capacity: 6,
    radius: 26,
    respawnMs: 20_000,
    minimumSpawnDistance: 130,
    maximumSpawnDistance: 220,
    placementSeed: 5_271
  }),
  Object.freeze({
    id: 'molotov-cache',
    weapon: 'molotov',
    label: 'MOLOTOVS',
    quantity: 2,
    capacity: 5,
    radius: 26,
    respawnMs: 24_000,
    minimumSpawnDistance: 240,
    maximumSpawnDistance: 390,
    placementSeed: 8_419
  })
]);

export function weaponPickupDefinition(
  weapon: string
): WeaponPickupDefinition | undefined {
  return WEAPON_PICKUPS.find((definition) => definition.weapon === weapon);
}
