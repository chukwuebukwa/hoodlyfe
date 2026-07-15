export const MINIMUM_INTERPOLATION_DELAY_MS = 75;
export const MAXIMUM_INTERPOLATION_DELAY_MS = 250;
export const DEFAULT_INTERPOLATION_DELAY_MS = 100;

export function adaptiveInterpolationDelayMs(input: {
  patchGapP95Ms: number;
  jitterP95Ms: number;
  rttMedianMs: number;
  rttP95Ms: number;
}): number {
  const patchGap = nonnegative(input.patchGapP95Ms);
  if (patchGap === 0) return DEFAULT_INTERPOLATION_DELAY_MS;
  const jitter = nonnegative(input.jitterP95Ms);
  const rttMedian = nonnegative(input.rttMedianMs);
  const rttP95 = Math.max(rttMedian, nonnegative(input.rttP95Ms));
  const transitBudget = rttMedian / 2 + Math.max(0, rttP95 - rttMedian) / 2 + jitter * 2;
  const target = Math.max(
    patchGap * 1.5,
    patchGap + jitter * 2,
    transitBudget
  );
  return round(clamp(target, MINIMUM_INTERPOLATION_DELAY_MS, MAXIMUM_INTERPOLATION_DELAY_MS));
}

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
