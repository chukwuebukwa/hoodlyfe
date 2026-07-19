export const PROXIMITY_VOICE = {
  fullVolumeDistance: 120,
  audibleDistance: 700,
  subscribeDistance: 800,
  unsubscribeDistance: 950,
  maximumPeers: 8,
  updateIntervalMs: 250
} as const;

export interface ProximityVoiceActor {
  id: string;
  x: number;
  y: number;
  spaceId: string;
  alive: boolean;
}

export function selectProximityVoicePeers(
  listener: ProximityVoiceActor,
  candidates: Iterable<ProximityVoiceActor>,
  subscribedPeerIds: ReadonlySet<string> = new Set()
): string[] {
  if (!listener.alive) return [];
  return [...candidates]
    .filter((candidate) => candidate.id !== listener.id && candidate.alive)
    .filter((candidate) => candidate.spaceId === listener.spaceId)
    .map((candidate) => ({
      id: candidate.id,
      distance: Math.hypot(candidate.x - listener.x, candidate.y - listener.y)
    }))
    .filter(({id, distance}) => distance <= (
      subscribedPeerIds.has(id)
        ? PROXIMITY_VOICE.unsubscribeDistance
        : PROXIMITY_VOICE.subscribeDistance
    ))
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
    .slice(0, PROXIMITY_VOICE.maximumPeers)
    .map(({id}) => id);
}

export function proximityVoiceGain(distance: number): number {
  const finiteDistance = Number.isFinite(distance) ? Math.max(0, distance) : Number.POSITIVE_INFINITY;
  if (finiteDistance <= PROXIMITY_VOICE.fullVolumeDistance) return 1;
  if (finiteDistance >= PROXIMITY_VOICE.audibleDistance) return 0;
  const progress = (
    finiteDistance - PROXIMITY_VOICE.fullVolumeDistance
  ) / (
    PROXIMITY_VOICE.audibleDistance - PROXIMITY_VOICE.fullVolumeDistance
  );
  const remaining = 1 - progress;
  return remaining * remaining * (3 - 2 * remaining);
}
