import {STREET_STREAMING} from '../replication/street-streaming-policy.ts';

export const POPULATION_INTEREST = Object.freeze({
  protectedViewRadius: 720,
  prewarmRadius: STREET_STREAMING.enterRadius,
  retentionRadius: STREET_STREAMING.exitRadius
});

export type PopulationInterestTier = 'hot' | 'prewarm' | 'retained' | 'cold';

export interface PopulationInterestAnchor {
  x: number;
  y: number;
  kind?: 'player' | 'lookahead' | 'gameplay';
  protectsVisibility?: boolean;
}

export interface PopulationInterestDecision {
  distance: number;
  tier: PopulationInterestTier;
  materialize: boolean;
  retain: boolean;
}

export function populationInterestAt(
  x: number,
  y: number,
  anchors: readonly PopulationInterestAnchor[]
): PopulationInterestDecision {
  const distance = nearestPopulationAnchorDistance(x, y, anchors);
  const visibilityDistance = nearestPopulationVisibilityDistance(x, y, anchors);
  if (visibilityDistance <= POPULATION_INTEREST.protectedViewRadius) {
    return {distance, tier: 'hot', materialize: false, retain: true};
  }
  if (distance <= POPULATION_INTEREST.prewarmRadius) {
    return {distance, tier: 'prewarm', materialize: true, retain: true};
  }
  if (distance <= POPULATION_INTEREST.retentionRadius) {
    return {distance, tier: 'retained', materialize: false, retain: true};
  }
  return {distance, tier: 'cold', materialize: false, retain: false};
}

export function nearestPopulationAnchorDistance(
  x: number,
  y: number,
  anchors: readonly PopulationInterestAnchor[]
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    nearest = Math.min(nearest, Math.hypot(anchor.x - x, anchor.y - y));
  }
  return nearest;
}

function nearestPopulationVisibilityDistance(
  x: number,
  y: number,
  anchors: readonly PopulationInterestAnchor[]
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    if (anchor.protectsVisibility === false) continue;
    nearest = Math.min(nearest, Math.hypot(anchor.x - x, anchor.y - y));
  }
  return nearest;
}
