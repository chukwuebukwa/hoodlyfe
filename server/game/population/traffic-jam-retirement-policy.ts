import {STREET_STREAMING} from '../replication/street-streaming-policy.ts';

export const TRAFFIC_JAM_RETIREMENT = Object.freeze({
  invisibleDistance: STREET_STREAMING.exitRadius,
  minimumStationaryMs: 18_000,
  cooldownMs: 1_000,
  maxRetirementsPerPass: 2,
  virtualAdvanceSteps: 3
});

export interface TrafficJamRetirementCandidate {
  id: string;
  distance: number;
  stationarySince: number;
  blockedFollowerCount: number;
  speedReason: string;
  streamable: boolean;
}

export function selectInvisibleTrafficJamRetirements(
  candidates: readonly TrafficJamRetirementCandidate[],
  nowMs: number,
  limit = TRAFFIC_JAM_RETIREMENT.maxRetirementsPerPass
): TrafficJamRetirementCandidate[] {
  if (limit <= 0) return [];
  return candidates.filter((candidate) => (
    candidate.streamable &&
    candidate.distance > TRAFFIC_JAM_RETIREMENT.invisibleDistance &&
    candidate.stationarySince > 0 &&
    nowMs - candidate.stationarySince >= TRAFFIC_JAM_RETIREMENT.minimumStationaryMs &&
    isDeadlockCandidate(candidate)
  )).sort(compareRetirementCandidate).slice(0, limit);
}

function isDeadlockCandidate(candidate: TrafficJamRetirementCandidate): boolean {
  return candidate.blockedFollowerCount > 0 ||
    candidate.speedReason === 'vehicle' ||
    candidate.speedReason === 'pedestrian' ||
    candidate.speedReason === 'blocked';
}

function compareRetirementCandidate(
  left: TrafficJamRetirementCandidate,
  right: TrafficJamRetirementCandidate
): number {
  return right.blockedFollowerCount - left.blockedFollowerCount ||
    left.stationarySince - right.stationarySince ||
    right.distance - left.distance ||
    left.id.localeCompare(right.id);
}
