import type {InteractionEntityState} from '../../../shared/protocol/interaction-contracts.ts';
export {
  INTERACTION_CONTACT_SLOP,
  INTERACTION_TTC_MARGIN,
  interactionContactShape,
  interactionEntityActive,
  interactionEntityReach,
  interactionMotionCircle,
  interactionStableKey
} from '../../../shared/simulation/interaction-entity-geometry.ts';

export const DESKTOP_INTERACTION_ISLAND_BUDGET = 32;
export const MOBILE_INTERACTION_ISLAND_BUDGET = 20;
export const INTERACTION_CONTACT_RETENTION_TICKS = 6;
export const INTERACTION_MEMBERSHIP_TTC_BONUS_SECONDS = 0.05;
export const MINIMUM_INTERACTION_HORIZON_MS = 100;
export const MAXIMUM_INTERACTION_HORIZON_MS = 500;
export const MAXIMUM_INTERACTION_EXIT_HORIZON_MS = 650;

export interface InteractionNetworkConditions {
  readonly rttMs: number;
  readonly interpolationDelayMs: number;
  readonly jitterMs: number;
}

export function interactionHorizonSeconds(conditions: InteractionNetworkConditions): number {
  const halfRtt = nonnegative(conditions.rttMs) / 2;
  const interpolation = nonnegative(conditions.interpolationDelayMs);
  const jitterMargin = Math.max(1000 / 60, nonnegative(conditions.jitterMs) * 2);
  return clamp(
    halfRtt + interpolation + jitterMargin,
    MINIMUM_INTERACTION_HORIZON_MS,
    MAXIMUM_INTERACTION_HORIZON_MS
  ) / 1000;
}

export function interactionExitHorizonSeconds(horizonSeconds: number): number {
  return Math.min(
    MAXIMUM_INTERACTION_EXIT_HORIZON_MS / 1000,
    Math.max(MINIMUM_INTERACTION_HORIZON_MS / 1000, horizonSeconds * 1.25)
  );
}

export function interactionEntityWeight(entity: InteractionEntityState): number {
  if (entity.kind === 'vehicle') return 4;
  if (entity.kind === 'prop') return 2;
  return 1;
}

export function interactionGameplayPriority(
  entity: InteractionEntityState,
  root: InteractionEntityState
): number {
  if (entity.interactionPriority === 'player-controlled') return 0;
  if (entity.interactionPriority === 'mission-critical') return 1;
  if (entity.kind === 'projectile' && entity.ownerId === root.id) return 2;
  if (entity.kind === 'vehicle') return 3;
  if (entity.kind === 'projectile') return 4;
  if (entity.kind === 'prop') return 5;
  return 6;
}

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
