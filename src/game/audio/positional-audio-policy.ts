export interface AudioListenerPosition {
  x: number;
  y: number;
  angle?: number;
}

export interface AudioSourcePosition {
  x: number;
  y: number;
  maxDistance?: number;
}

export interface PositionalAudioProjection {
  distance: number;
  gain: number;
  pan: number;
}

const DEFAULT_MAX_DISTANCE = 1_100;

export function projectPositionalAudio(
  listener: AudioListenerPosition,
  source: AudioSourcePosition,
  baseGain = 1
): PositionalAudioProjection {
  const maxDistance = positive(source.maxDistance ?? DEFAULT_MAX_DISTANCE);
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= maxDistance) return {distance, gain: 0, pan: 0};
  const normalized = distance / maxDistance;
  const rolloff = (1 - normalized) * (1 - normalized * 0.35);
  const pan = clamp(dx / Math.max(180, maxDistance * 0.48), -1, 1);
  return {
    distance,
    gain: clamp(baseGain * rolloff, 0, 1),
    pan
  };
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_DISTANCE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
