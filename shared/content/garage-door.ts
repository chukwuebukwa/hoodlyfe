export type GarageDoorPhase = 'closed' | 'opening' | 'open' | 'closing';

export interface GarageDoorTimeline {
  phase: GarageDoorPhase;
  phaseStartedAt: number;
  transitionFrom: number;
  progress: number;
}

export function garageDoorProgress(
  state: GarageDoorTimeline,
  animationMs: number,
  nowMs: number
): number {
  if (state.phase === 'closed') return 0;
  if (state.phase === 'open') return 1;
  const duration = Math.max(1, animationMs);
  const elapsed = Math.max(0, nowMs - state.phaseStartedAt) / duration;
  if (state.phase === 'opening') {
    return clamp01(state.transitionFrom + elapsed * (1 - state.transitionFrom));
  }
  if (state.phase === 'closing') {
    return clamp01(state.transitionFrom - elapsed * state.transitionFrom);
  }
  return clamp01(state.progress);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
