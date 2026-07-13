import {isMeleeWeaponId, WEAPONS} from '../content/weapon-catalog.ts';

export const ON_FOOT_SIMULATION_HZ = 30;
export const ON_FOOT_SIMULATION_STEP_SECONDS = 1 / ON_FOOT_SIMULATION_HZ;
export const ON_FOOT_MAX_STEP_SECONDS = 0.05;
export const ON_FOOT_PLAYER_RADIUS = 11;
export const ON_FOOT_PLAYER_SPEED = 190;

export interface OnFootPose {
  x: number;
  y: number;
  spaceId: string;
}

export interface OnFootControlCommand {
  moveX: number;
  moveY: number;
}

export interface OnFootStepModifiers {
  movementScale?: number;
}

export interface OnFootStepResult {
  pose: OnFootPose;
  attemptedX: number;
  attemptedY: number;
  collidedX: boolean;
  collidedY: boolean;
  distance: number;
}

export type OnFootWorldOccupancy = (
  spaceId: string,
  x: number,
  y: number,
  radius: number
) => boolean;

export function stepOnFootWithWorldCollision(
  pose: OnFootPose,
  command: OnFootControlCommand,
  deltaSeconds: number,
  canOccupy: OnFootWorldOccupancy,
  modifiers: OnFootStepModifiers = {}
): OnFootStepResult {
  const delta = finiteClamp(deltaSeconds, 0, ON_FOOT_MAX_STEP_SECONDS);
  const movementScale = finiteClamp(modifiers.movementScale ?? 1, 0, 2);
  const inputX = finiteClamp(command.moveX, -1, 1);
  const inputY = finiteClamp(command.moveY, -1, 1);
  const magnitude = Math.hypot(inputX, inputY);
  const normalization = magnitude > 1 ? 1 / magnitude : 1;
  const distance = ON_FOOT_PLAYER_SPEED * movementScale * delta;
  const moveX = inputX * normalization * distance;
  const moveY = inputY * normalization * distance;
  const startX = finite(pose.x);
  const startY = finite(pose.y);
  const spaceId = typeof pose.spaceId === 'string' && pose.spaceId ? pose.spaceId : 'street';
  const attemptedX = startX + moveX;
  const attemptedY = startY + moveY;
  let x = startX;
  let y = startY;
  const collidedX = moveX !== 0 && !canOccupy(spaceId, attemptedX, y, ON_FOOT_PLAYER_RADIUS);
  if (!collidedX) x = attemptedX;
  const collidedY = moveY !== 0 && !canOccupy(spaceId, x, attemptedY, ON_FOOT_PLAYER_RADIUS);
  if (!collidedY) y = attemptedY;
  return {
    pose: {x, y, spaceId},
    attemptedX,
    attemptedY,
    collidedX,
    collidedY,
    distance: Math.hypot(x - startX, y - startY)
  };
}

export function onFootMovementScale(action: string, weapon: string, attackCombo: number): number {
  if (!action) return 1;
  if (action !== 'melee' || !isMeleeWeaponId(weapon)) return 0;
  return WEAPONS[weapon].strikes[safeIndex(attackCombo)]?.movementScale ?? 0;
}

function safeIndex(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, finite(value)));
}
