import type {NetworkPlayer} from '../types.ts';
import {isMeleeWeapon, weaponDefinition} from '../../../shared/content/weapon-catalog.ts';

const INPUT_SEND_INTERVAL_MS = 50;
const INPUT_HEARTBEAT_MS = 220;
const AIM_SEND_INTERVAL_MS = 45;
const FIRE_INTERVAL_MS = 45;
const WEAPON_CYCLE_INTERVAL_MS = 120;
const MOVEMENT_CHANGE_EPSILON = 0.015;

export interface MovementVector {
  x: number;
  y: number;
}

export class ClientInputCadence {
  private lastMovement: MovementVector = {x: 0, y: 0};
  private lastMovementAt = 0;
  private lastAimAt = 0;
  private lastFireAt = 0;
  private lastWeaponCycleAt = 0;

  shouldSendMovement(movement: MovementVector, nowMs: number): boolean {
    const changed = (
      Math.abs(movement.x - this.lastMovement.x) > MOVEMENT_CHANGE_EPSILON ||
      Math.abs(movement.y - this.lastMovement.y) > MOVEMENT_CHANGE_EPSILON
    );
    if (
      (!changed || nowMs - this.lastMovementAt < INPUT_SEND_INTERVAL_MS) &&
      nowMs - this.lastMovementAt < INPUT_HEARTBEAT_MS
    ) {
      return false;
    }
    this.lastMovement = {...movement};
    this.lastMovementAt = nowMs;
    return true;
  }

  shouldSendAim(nowMs: number): boolean {
    if (nowMs - this.lastAimAt < AIM_SEND_INTERVAL_MS) return false;
    this.lastAimAt = nowMs;
    return true;
  }

  shouldSendFire(nowMs: number): boolean {
    if (nowMs - this.lastFireAt < FIRE_INTERVAL_MS) return false;
    this.lastFireAt = nowMs;
    return true;
  }

  shouldCycleWeapon(nowMs: number): boolean {
    if (nowMs - this.lastWeaponCycleAt < WEAPON_CYCLE_INTERVAL_MS) return false;
    this.lastWeaponCycleAt = nowMs;
    return true;
  }
}

export function normalizeMovement(x: number, y: number): MovementVector {
  const finiteX = Number.isFinite(x) ? x : 0;
  const finiteY = Number.isFinite(y) ? y : 0;
  const magnitude = Math.hypot(finiteX, finiteY);
  if (magnitude <= 1) return {x: finiteX, y: finiteY};
  return {x: finiteX / magnitude, y: finiteY / magnitude};
}

export function directionalVehicleMovement(
  stickX: number,
  stickY: number,
  vehicleAngle: number
): MovementVector {
  const stick = normalizeMovement(stickX, stickY);
  const magnitude = Math.hypot(stick.x, stick.y);
  if (magnitude === 0) return {x: 0, y: 0};

  const desiredAngle = Math.atan2(stick.y, stick.x);
  const currentAngle = Number.isFinite(vehicleAngle) ? vehicleAngle : desiredAngle;
  const angleDelta = Math.atan2(
    Math.sin(desiredAngle - currentAngle),
    Math.cos(desiredAngle - currentAngle)
  );

  return normalizeMovement(
    Math.max(-1, Math.min(1, angleDelta / (Math.PI / 2))),
    -magnitude
  );
}

export function canUseWeaponControls(player?: NetworkPlayer): boolean {
  return Boolean(
    player?.alive &&
    !player.action &&
    (!player.vehicleId || player.vehicleSeat > 0)
  );
}

export function canRequestPrimaryAttack(player?: NetworkPlayer): boolean {
  if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0)) return false;
  if (!player.action) return true;
  return player.action === 'melee' && isMeleeWeapon(weaponDefinition(player.weapon));
}
