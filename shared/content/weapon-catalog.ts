export const WEAPON_ORDER = [
  'fists', 'bat', 'pistol', 'smg', 'shotgun', 'rocket', 'grenade', 'molotov'
] as const;

export type WeaponId = typeof WEAPON_ORDER[number];
export type BulletWeaponId = Extract<WeaponId, 'pistol' | 'smg' | 'shotgun'>;
export type RocketWeaponId = Extract<WeaponId, 'rocket'>;
export type MagazineWeaponId = BulletWeaponId | RocketWeaponId;
export type MeleeWeaponId = Extract<WeaponId, 'fists' | 'bat'>;
export type AmmunitionField =
  | 'ammoPistol'
  | 'ammoSmg'
  | 'ammoShotgun'
  | 'ammoRocket'
  | 'ammoGrenade'
  | 'ammoMolotov';
export type MagazineField =
  | 'magazinePistol'
  | 'magazineSmg'
  | 'magazineShotgun'
  | 'magazineRocket';

export interface WeaponPresentationDefinition {
  assetId: string;
  assetPath?: string;
  heldWidth: number;
  heldHeight: number;
  heldVisible: boolean;
  heldOriginX?: number;
  heldDistance?: number;
  heldOffsetY?: number;
  recoilDistance?: number;
  recoilMs?: number;
  muzzleFlashMs?: number;
  muzzleFlashScale?: number;
}

interface WeaponDefinitionBase {
  id: WeaponId;
  name: string;
  passengerAllowed: boolean;
  cooldownMs: number;
  ammunitionField: AmmunitionField | null;
  presentation: WeaponPresentationDefinition;
}

interface MagazineWeaponDefinitionBase {
  ammunitionCapacity: number;
  magazineField: MagazineField;
  magazineSize: number;
  reloadMs: number;
  reloadStyle: 'magazine' | 'per-shell';
  trigger: 'semi' | 'automatic';
}

export interface BulletWeaponDefinition extends WeaponDefinitionBase, MagazineWeaponDefinitionBase {
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
  id: Extract<WeaponId, 'grenade' | 'molotov'>;
  fireMode: 'thrown';
  ammunitionField: Extract<AmmunitionField, 'ammoGrenade' | 'ammoMolotov'>;
  ammunitionCapacity: number;
  fuseMs: number;
  impactTriggered: boolean;
}

export interface RocketWeaponDefinition extends WeaponDefinitionBase, MagazineWeaponDefinitionBase {
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
    ammunitionCapacity: 120,
    magazineField: 'magazinePistol',
    magazineSize: 12,
    reloadMs: 1100,
    reloadStyle: 'magazine',
    trigger: 'semi',
    damage: 25,
    projectileSpeed: 720,
    lifetimeMs: 1100,
    pellets: 1,
    spread: 0,
    presentation: Object.freeze({
      assetId: 'pistol',
      assetPath: '/assets/custom/weapons/datdev-demo/pistol.png',
      heldWidth: 24,
      heldHeight: 17,
      heldVisible: true,
      heldOriginX: 0.3,
      heldDistance: 10,
      heldOffsetY: 4,
      recoilDistance: 5,
      recoilMs: 110,
      muzzleFlashMs: 42,
      muzzleFlashScale: 1
    })
  } satisfies BulletWeaponDefinition),
  smg: Object.freeze({
    id: 'smg',
    name: 'SMG',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 85,
    ammunitionField: 'ammoSmg',
    ammunitionCapacity: 240,
    magazineField: 'magazineSmg',
    magazineSize: 30,
    reloadMs: 1500,
    reloadStyle: 'magazine',
    trigger: 'automatic',
    damage: 12,
    projectileSpeed: 820,
    lifetimeMs: 900,
    pellets: 1,
    spread: 0.045,
    presentation: Object.freeze({
      assetId: 'smg',
      assetPath: '/assets/custom/weapons/datdev-demo/smg.png',
      heldWidth: 38,
      heldHeight: 21,
      heldVisible: true,
      heldOriginX: 0.33,
      heldDistance: 10,
      heldOffsetY: 5,
      recoilDistance: 3,
      recoilMs: 80,
      muzzleFlashMs: 30,
      muzzleFlashScale: 0.78
    })
  } satisfies BulletWeaponDefinition),
  shotgun: Object.freeze({
    id: 'shotgun',
    name: 'Shotgun',
    fireMode: 'bullet',
    passengerAllowed: true,
    cooldownMs: 650,
    ammunitionField: 'ammoShotgun',
    ammunitionCapacity: 48,
    magazineField: 'magazineShotgun',
    magazineSize: 6,
    reloadMs: 480,
    reloadStyle: 'per-shell',
    trigger: 'semi',
    damage: 18,
    projectileSpeed: 650,
    lifetimeMs: 550,
    pellets: 6,
    spread: 0.3,
    presentation: Object.freeze({
      assetId: 'shotgun',
      assetPath: '/assets/custom/weapons/datdev-demo/shotgun.png',
      heldWidth: 46,
      heldHeight: 11,
      heldVisible: true,
      heldOriginX: 0.3,
      heldDistance: 11,
      heldOffsetY: 5,
      recoilDistance: 9,
      recoilMs: 180,
      muzzleFlashMs: 65,
      muzzleFlashScale: 1.45
    })
  } satisfies BulletWeaponDefinition),
  rocket: Object.freeze({
    id: 'rocket',
    name: 'Rocket Launcher',
    fireMode: 'rocket',
    passengerAllowed: false,
    cooldownMs: 950,
    ammunitionField: 'ammoRocket',
    ammunitionCapacity: 4,
    magazineField: 'magazineRocket',
    magazineSize: 1,
    reloadMs: 1800,
    reloadStyle: 'magazine',
    trigger: 'semi',
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
    ammunitionCapacity: 6,
    fuseMs: 2000,
    impactTriggered: false,
    presentation: Object.freeze({assetId: 'grenade', heldWidth: 15, heldHeight: 15, heldVisible: true})
  } satisfies ThrownWeaponDefinition),
  molotov: Object.freeze({
    id: 'molotov',
    name: 'Molotov',
    fireMode: 'thrown',
    passengerAllowed: false,
    cooldownMs: 720,
    ammunitionField: 'ammoMolotov',
    ammunitionCapacity: 5,
    fuseMs: 2000,
    impactTriggered: true,
    presentation: Object.freeze({assetId: 'molotov', heldWidth: 14, heldHeight: 25, heldVisible: true})
  } satisfies ThrownWeaponDefinition)
}) satisfies Readonly<Record<WeaponId, WeaponDefinition>>;

export function isWeaponId(value: string): value is WeaponId {
  return value in WEAPONS;
}

export function weaponAssetPath(id: WeaponId): string {
  const presentation = WEAPONS[id].presentation;
  return 'assetPath' in presentation
    ? presentation.assetPath
    : `/assets/original/weapons/${presentation.assetId}.svg`;
}

export function isBulletWeaponId(value: string): value is BulletWeaponId {
  return value === 'pistol' || value === 'smg' || value === 'shotgun';
}

export function isMagazineWeaponId(value: string): value is MagazineWeaponId {
  return value === 'pistol' || value === 'smg' || value === 'shotgun' || value === 'rocket';
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
