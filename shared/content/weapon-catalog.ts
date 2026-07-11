export const WEAPON_ORDER = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'rocket', 'grenade'] as const;

export type WeaponId = typeof WEAPON_ORDER[number];
export type BulletWeaponId = Extract<WeaponId, 'pistol' | 'smg' | 'shotgun'>;
export type RocketWeaponId = Extract<WeaponId, 'rocket'>;
export type MeleeWeaponId = Extract<WeaponId, 'fists' | 'bat'>;
export type AmmunitionField = 'ammoPistol' | 'ammoSmg' | 'ammoShotgun' | 'ammoRocket' | 'ammoGrenade';

export interface WeaponPresentationDefinition {
  assetId: string;
  heldWidth: number;
  heldHeight: number;
  heldVisible: boolean;
}

interface WeaponDefinitionBase {
  id: WeaponId;
  name: string;
  passengerAllowed: boolean;
  cooldownMs: number;
  ammunitionField: AmmunitionField | null;
  presentation: WeaponPresentationDefinition;
}

export interface BulletWeaponDefinition extends WeaponDefinitionBase {
  id: BulletWeaponId;
  fireMode: 'bullet';
  ammunitionField: Extract<AmmunitionField, 'ammoPistol' | 'ammoSmg' | 'ammoShotgun'>;
  damage: number;
  projectileSpeed: number;
  lifetimeMs: number;
  pellets: number;
  spread: number;
}

export interface ThrownWeaponDefinition extends WeaponDefinitionBase {
  id: 'grenade';
  fireMode: 'thrown';
  ammunitionField: 'ammoGrenade';
  fuseMs: number;
}

export interface RocketWeaponDefinition extends WeaponDefinitionBase {
  id: RocketWeaponId;
  fireMode: 'rocket';
  ammunitionField: 'ammoRocket';
  projectileSpeed: number;
  lifetimeMs: number;
}

export interface MeleeStrikeDefinition {
  durationMs: number;
  impactMs: number;
  movementScale: number;
  damage: number;
  range: number;
  halfArcRadians: number;
  maxPedTargets: number;
  vehicleDamage: number;
  maxVehicleTargets: number;
}

export interface MeleeWeaponDefinition extends WeaponDefinitionBase {
  id: MeleeWeaponId;
  fireMode: 'melee';
  ammunitionField: null;
  comboResetMs: number;
  strikes: readonly MeleeStrikeDefinition[];
}

export type WeaponDefinition =
  | BulletWeaponDefinition
  | RocketWeaponDefinition
  | ThrownWeaponDefinition
  | MeleeWeaponDefinition;

export const WEAPONS = Object.freeze({
  fists: Object.freeze({
    id: 'fists',
    name: 'Fists',
    fireMode: 'melee',
    passengerAllowed: false,
    cooldownMs: 180,
    ammunitionField: null,
    comboResetMs: 720,
    presentation: Object.freeze({assetId: 'fists', heldWidth: 1, heldHeight: 1, heldVisible: false}),
    strikes: Object.freeze([
      Object.freeze({
        durationMs: 340,
        impactMs: 135,
        movementScale: 1,
        damage: 9,
        range: 31,
        halfArcRadians: 0.62,
        maxPedTargets: 1,
        vehicleDamage: 0,
        maxVehicleTargets: 0
      }),
      Object.freeze({
        durationMs: 360,
        impactMs: 145,
        movementScale: 1,
        damage: 11,
        range: 33,
        halfArcRadians: 0.58,
        maxPedTargets: 1,
        vehicleDamage: 0,
        maxVehicleTargets: 0
      }),
      Object.freeze({
        durationMs: 430,
        impactMs: 205,
        movementScale: 1,
        damage: 18,
        range: 37,
        halfArcRadians: 0.54,
        maxPedTargets: 1,
        vehicleDamage: 0,
        maxVehicleTargets: 0
      })
    ])
  } satisfies MeleeWeaponDefinition),
  bat: Object.freeze({
    id: 'bat',
    name: 'Baseball Bat',
    fireMode: 'melee',
    passengerAllowed: false,
    cooldownMs: 360,
    ammunitionField: null,
    comboResetMs: 900,
    presentation: Object.freeze({assetId: 'bat', heldWidth: 46, heldHeight: 12, heldVisible: true}),
    strikes: Object.freeze([
      Object.freeze({
        durationMs: 610,
        impactMs: 285,
        movementScale: 1,
        damage: 34,
        range: 48,
        halfArcRadians: 0.82,
        maxPedTargets: 3,
        vehicleDamage: 16,
        maxVehicleTargets: 1
      })
    ])
  } satisfies MeleeWeaponDefinition),
  pistol: Object.freeze({
    id: 'pistol',
    name: 'Pistol',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 170,
    ammunitionField: 'ammoPistol',
    damage: 25,
    projectileSpeed: 720,
    lifetimeMs: 1100,
    pellets: 1,
    spread: 0,
    presentation: Object.freeze({assetId: 'pistol', heldWidth: 25, heldHeight: 9, heldVisible: true})
  } satisfies BulletWeaponDefinition),
  smg: Object.freeze({
    id: 'smg',
    name: 'SMG',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 85,
    ammunitionField: 'ammoSmg',
    damage: 12,
    projectileSpeed: 820,
    lifetimeMs: 900,
    pellets: 1,
    spread: 0.045,
    presentation: Object.freeze({assetId: 'smg', heldWidth: 33, heldHeight: 11, heldVisible: true})
  } satisfies BulletWeaponDefinition),
  shotgun: Object.freeze({
    id: 'shotgun',
    name: 'Shotgun',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 650,
    ammunitionField: 'ammoShotgun',
    damage: 18,
    projectileSpeed: 650,
    lifetimeMs: 550,
    pellets: 6,
    spread: 0.3,
    presentation: Object.freeze({assetId: 'shotgun', heldWidth: 42, heldHeight: 10, heldVisible: true})
  } satisfies BulletWeaponDefinition),
  rocket: Object.freeze({
    id: 'rocket',
    name: 'Rocket Launcher',
    fireMode: 'rocket',
    passengerAllowed: false,
    cooldownMs: 950,
    ammunitionField: 'ammoRocket',
    projectileSpeed: 430,
    lifetimeMs: 1400,
    presentation: Object.freeze({assetId: 'rocket', heldWidth: 48, heldHeight: 14, heldVisible: true})
  } satisfies RocketWeaponDefinition),
  grenade: Object.freeze({
    id: 'grenade',
    name: 'Grenade',
    fireMode: 'thrown',
    passengerAllowed: false,
    cooldownMs: 650,
    ammunitionField: 'ammoGrenade',
    fuseMs: 2000,
    presentation: Object.freeze({assetId: 'grenade', heldWidth: 15, heldHeight: 15, heldVisible: true})
  } satisfies ThrownWeaponDefinition)
}) satisfies Readonly<Record<WeaponId, WeaponDefinition>>;

export function isWeaponId(value: string): value is WeaponId {
  return value in WEAPONS;
}

export function isBulletWeaponId(value: string): value is BulletWeaponId {
  return value === 'pistol' || value === 'smg' || value === 'shotgun';
}

export function isMeleeWeaponId(value: string): value is MeleeWeaponId {
  return value === 'fists' || value === 'bat';
}

export function weaponDefinition(id: WeaponId): WeaponDefinition {
  return WEAPONS[id];
}

export function isMeleeWeapon(
  definition: WeaponDefinition
): definition is MeleeWeaponDefinition {
  return definition.fireMode === 'melee';
}
