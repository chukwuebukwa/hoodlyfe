import type {VehicleDamageSource} from '../events/game-events.ts';
import {
  vehicleMechanicalSpeedMultiplier,
  vehicleMechanicalStepModifiers
} from '../../../shared/simulation/vehicle-step.ts';

const ENGINE_STEAM_1 = 100;
const ENGINE_STEAM_2 = 150;
const ENGINE_SMOKE = 200;
const ENGINE_ON_FIRE = 225;
const MAX_COMPONENT_DAMAGE = 300;
const FIRE_FUSE_MS = 5000;

export type VehicleDamageZone = 'front' | 'rear' | 'left' | 'right';

export function classifyImpactZone(
  vehicleAngle: number,
  impactDirectionX: number,
  impactDirectionY: number
): VehicleDamageZone {
  const forward = impactDirectionX * Math.cos(vehicleAngle) +
    impactDirectionY * Math.sin(vehicleAngle);
  const side = impactDirectionX * -Math.sin(vehicleAngle) +
    impactDirectionY * Math.cos(vehicleAngle);
  if (Math.abs(forward) >= Math.abs(side)) return forward >= 0 ? 'front' : 'rear';
  return side >= 0 ? 'right' : 'left';
}

export interface VehicleMechanicalState {
  health: number;
  maxHealth: number;
  engineDamage: number;
  tyreDamageMask: number;
  damageFront: number;
  damageRear: number;
  damageLeft: number;
  damageRight: number;
  onFire: boolean;
  fireStartedAt: number;
}

export interface VehicleDamageResult extends VehicleMechanicalState {
  appliedDamage: number;
  destroyed: boolean;
  ignited: boolean;
}

export class VehicleDamageSystem {
  apply(
    state: VehicleMechanicalState,
    damage: number,
    sourceKind: VehicleDamageSource,
    zone: VehicleDamageZone,
    nowMs: number
  ): VehicleDamageResult {
    const safeHealth = Math.max(0, state.health);
    const requestedDamage = Math.max(0, Math.round(damage));
    let nextHealth = Math.max(0, safeHealth - requestedDamage);
    const collisionLike = sourceKind === 'world' || sourceKind === 'vehicle';
    if (collisionLike && safeHealth > 0 && nextHealth === 0) nextHealth = 1;

    const appliedDamage = safeHealth - nextHealth;
    const componentDamage = Math.min(MAX_COMPONENT_DAMAGE, componentForZone(state, zone) + appliedDamage);
    const healthRatio = state.maxHealth <= 0 ? 0 : nextHealth / state.maxHealth;
    let engineDamage = state.engineDamage + appliedDamage * (zone === 'front' ? 0.72 : 0.12);
    if (healthRatio < 0.6) engineDamage = Math.max(engineDamage, ENGINE_STEAM_1);
    if (healthRatio < 0.45) engineDamage = Math.max(engineDamage, ENGINE_STEAM_2);
    if (healthRatio < 0.3) engineDamage = Math.max(engineDamage, ENGINE_SMOKE);

    const shouldIgnite = nextHealth > 0 && healthRatio <= 0.25;
    const ignited = shouldIgnite && !state.onFire;
    const onFire = state.onFire || shouldIgnite;
    if (onFire) engineDamage = Math.max(engineDamage, ENGINE_ON_FIRE);

    return {
      health: nextHealth,
      maxHealth: state.maxHealth,
      engineDamage: Math.min(250, Math.round(engineDamage)),
      tyreDamageMask: state.tyreDamageMask,
      damageFront: zone === 'front' ? componentDamage : state.damageFront,
      damageRear: zone === 'rear' ? componentDamage : state.damageRear,
      damageLeft: zone === 'left' ? componentDamage : state.damageLeft,
      damageRight: zone === 'right' ? componentDamage : state.damageRight,
      onFire,
      fireStartedAt: ignited ? nowMs : state.fireStartedAt,
      appliedDamage,
      destroyed: safeHealth > 0 && nextHealth === 0,
      ignited
    };
  }

  shouldExplode(state: VehicleMechanicalState, nowMs: number): boolean {
    return state.onFire && state.fireStartedAt > 0 && nowMs - state.fireStartedAt >= FIRE_FUSE_MS;
  }

  wallImpactDamage(speed: number): number {
    return Math.max(0, Math.round((Math.abs(speed) - 70) * 0.32));
  }

  weaponDamage(baseDamage: number): number {
    return Math.max(1, Math.round(baseDamage));
  }

  speedMultiplier(engineDamage: number, onFire: boolean): number {
    return vehicleMechanicalSpeedMultiplier(engineDamage, onFire);
  }

  stepModifiers(engineDamage: number, onFire: boolean, tyreDamageMask: number) {
    return vehicleMechanicalStepModifiers(engineDamage, onFire, tyreDamageMask);
  }

  reset(maxHealth: number): VehicleMechanicalState {
    return {
      health: maxHealth,
      maxHealth,
      engineDamage: 0,
      tyreDamageMask: 0,
      damageFront: 0,
      damageRear: 0,
      damageLeft: 0,
      damageRight: 0,
      onFire: false,
      fireStartedAt: 0
    };
  }
}

function componentForZone(state: VehicleMechanicalState, zone: VehicleDamageZone): number {
  if (zone === 'rear') return state.damageRear;
  if (zone === 'left') return state.damageLeft;
  if (zone === 'right') return state.damageRight;
  return state.damageFront;
}
