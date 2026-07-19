import type {PoliceVehicleTargetSnapshot} from './crime-response-controller.ts';
import {tacticalGoal} from './pursuit-coordinator.ts';

export type PoliceVehicleStrategy =
  | 'idle'
  | 'hijack'
  | 'search'
  | 'pursuit'
  | 'intercept'
  | 'contain'
  | 'ram'
  | 'route-failed';

export const DIRECT_PURSUIT_DISTANCE = 210;

export function policeVehicleStrategy(
  target: PoliceVehicleTargetSnapshot,
  mode: 'pursuit' | 'search',
  distance: number
): PoliceVehicleStrategy {
  if (mode === 'search') return 'search';
  if (target.tacticalRole !== 'primary') {
    return target.targetVehicleId ? 'intercept' : 'contain';
  }
  if (target.wantedLevel >= 2 && target.targetVehicleId) return 'ram';
  if (distance <= DIRECT_PURSUIT_DISTANCE) return 'intercept';
  return 'pursuit';
}

export function policeVehicleSpeed(
  wantedLevel: number,
  distance: number,
  targetInVehicle: boolean
): number {
  const index = Math.max(0, Math.min(5, Math.floor(wantedLevel)));
  const tierSpeed = [0, 175, 215, 255, 285, 310][index];
  if (wantedLevel <= 2 && distance < 90) return targetInVehicle ? Math.min(tierSpeed, 170) : 100;
  return tierSpeed;
}

export function predictPoliceDestination(
  target: PoliceVehicleTargetSnapshot,
  lastKnownX: number,
  lastKnownY: number,
  canSeeTarget: boolean
): {x: number; y: number} {
  if (!canSeeTarget) return {x: lastKnownX, y: lastKnownY};
  const leadSeconds = target.targetVehicleId
    ? (target.wantedLevel >= 3 ? 0.5 : 0.28)
    : 0;
  const predicted = {
    x: target.currentX + Math.cos(target.currentAngle) * target.currentSpeed * leadSeconds,
    y: target.currentY + Math.sin(target.currentAngle) * target.currentSpeed * leadSeconds
  };
  return tacticalGoal(target.tacticalRole, {
    ...predicted,
    angle: target.currentAngle,
    inVehicle: Boolean(target.targetVehicleId)
  });
}
