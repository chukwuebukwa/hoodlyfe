export const STREET_STREAMING = Object.freeze({
  enterRadius: 1_280,
  exitRadius: 1_536,
  maxAddsPerPatch: 64,
  maxRemovesPerPatch: 96
});

export interface StreetStreamingDecisionInput {
  distance: number;
  visible: boolean;
  alwaysRelevant?: boolean;
}

export function shouldReplicateStreetEntity(input: StreetStreamingDecisionInput): boolean {
  if (input.alwaysRelevant) return true;
  if (!Number.isFinite(input.distance) || input.distance < 0) return false;
  return input.distance <= (input.visible
    ? STREET_STREAMING.exitRadius
    : STREET_STREAMING.enterRadius);
}

export function compareReplicationCandidate(
  left: ReplicationCandidatePriority,
  right: ReplicationCandidatePriority
): number {
  return left.priority - right.priority || left.distance - right.distance ||
    left.key.localeCompare(right.key);
}

export interface ReplicationCandidatePriority {
  priority: number;
  distance: number;
  key: string;
}
