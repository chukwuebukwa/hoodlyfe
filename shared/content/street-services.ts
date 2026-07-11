export type StreetServiceKind = 'ammunition' | 'repair' | 'hospital' | 'clothing';

export interface AmmunitionState {
  ammoPistol: number;
  ammoSmg: number;
  ammoShotgun: number;
}

export interface CombatResupplyState extends AmmunitionState {
  armor?: number;
}

export const ARMOR_CAPACITY = 100;

export interface VehicleRepairState {
  health: number;
  maxHealth: number;
  engineDamage: number;
  damageFront: number;
  damageRear: number;
  damageLeft: number;
  damageRight: number;
}

export const AMMUNITION_CAPACITY: Readonly<AmmunitionState> = Object.freeze({
  ammoPistol: 120,
  ammoSmg: 240,
  ammoShotgun: 48
});

export const STREET_SERVICE_RADIUS: Readonly<Record<StreetServiceKind, number>> = Object.freeze({
  ammunition: 72,
  repair: 78,
  hospital: 76,
  clothing: 76
});

export function ammunitionRestockQuote(state: AmmunitionState): number {
  const pistol = missingRounds(state.ammoPistol, AMMUNITION_CAPACITY.ammoPistol);
  const smg = missingRounds(state.ammoSmg, AMMUNITION_CAPACITY.ammoSmg);
  const shotgun = missingRounds(state.ammoShotgun, AMMUNITION_CAPACITY.ammoShotgun);
  if (pistol + smg + shotgun === 0) return 0;
  return clamp(Math.ceil(pistol * 0.5 + smg * 0.25 + shotgun * 2), 25, 500);
}

export function combatResupplyQuote(state: CombatResupplyState): number {
  const ammunition = ammunitionRestockQuote(state);
  const missingArmor = Math.max(
    0,
    ARMOR_CAPACITY - clamp(finite(state.armor ?? 0), 0, ARMOR_CAPACITY)
  );
  if (ammunition === 0 && missingArmor === 0) return 0;
  return clamp(Math.ceil(ammunition + missingArmor * 1.5), 25, 650);
}

export function vehicleRepairQuote(state: VehicleRepairState): number {
  const maximumHealth = Math.max(1, finite(state.maxHealth));
  const missingHealth = Math.max(0, maximumHealth - clamp(finite(state.health), 0, maximumHealth));
  const bodyDamage = [state.damageFront, state.damageRear, state.damageLeft, state.damageRight]
    .reduce((total, value) => total + Math.max(0, finite(value)), 0);
  const engineDamage = Math.max(0, finite(state.engineDamage));
  if (missingHealth + bodyDamage + engineDamage === 0) return 0;
  return clamp(Math.ceil(60 + missingHealth * 0.32 + bodyDamage * 0.08 + engineDamage * 0.6), 60, 700);
}

export function medicalTreatmentQuote(health: number): number {
  const missingHealth = Math.max(0, 100 - clamp(finite(health), 0, 100));
  if (missingHealth === 0) return 0;
  return clamp(Math.ceil(25 + missingHealth * 2.25), 25, 250);
}

function missingRounds(current: number, capacity: number): number {
  return Math.max(0, capacity - clamp(Math.floor(finite(current)), 0, capacity));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
