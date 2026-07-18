import type {LaneRoadblockDefinition} from '../traffic/lane-graph.ts';

export const POLICE_ROADBLOCK = Object.freeze({
  minimumWantedLevel: 3,
  minimumVehicleSpeed: 34,
  minimumDeploymentDistance: 720,
  preferredDeploymentDistance: 1_080,
  maximumDeploymentDistance: 1_700,
  minimumAheadAlignment: 0.3,
  maximumActive: 2
});

export interface PoliceRoadblockSuspect {
  id: string;
  wantedLevel: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  inVehicle: boolean;
}

export function roadblockEligible(suspect: PoliceRoadblockSuspect): boolean {
  return suspect.wantedLevel >= POLICE_ROADBLOCK.minimumWantedLevel &&
    suspect.inVehicle &&
    Math.abs(suspect.speed) >= POLICE_ROADBLOCK.minimumVehicleSpeed;
}

export function selectRoadblockOpportunity(
  suspect: PoliceRoadblockSuspect,
  opportunities: readonly LaneRoadblockDefinition[]
): LaneRoadblockDefinition | undefined {
  if (!roadblockEligible(suspect)) return undefined;
  const motionAngle = suspect.speed >= 0 ? suspect.angle : suspect.angle + Math.PI;
  const forwardX = Math.cos(motionAngle);
  const forwardY = Math.sin(motionAngle);
  return opportunities.map((opportunity) => {
    const deltaX = opportunity.x - suspect.x;
    const deltaY = opportunity.y - suspect.y;
    const distance = Math.hypot(deltaX, deltaY);
    const alignment = distance > 0
      ? (deltaX * forwardX + deltaY * forwardY) / distance
      : -1;
    const distanceError = Math.abs(distance - POLICE_ROADBLOCK.preferredDeploymentDistance);
    return {opportunity, distance, alignment, distanceError};
  }).filter(({distance, alignment}) => (
    distance >= POLICE_ROADBLOCK.minimumDeploymentDistance &&
    distance <= POLICE_ROADBLOCK.maximumDeploymentDistance &&
    alignment >= POLICE_ROADBLOCK.minimumAheadAlignment
  )).sort((left, right) => (
    left.distanceError - right.distanceError ||
    right.alignment - left.alignment ||
    left.opportunity.id.localeCompare(right.opportunity.id)
  ))[0]?.opportunity;
}

export function roadblockCooldownMs(wantedLevel: number): number {
  if (wantedLevel >= 5) return 14_000;
  if (wantedLevel >= 4) return 20_000;
  return 28_000;
}
