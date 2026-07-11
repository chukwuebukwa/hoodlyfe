export const WORLD_CLOCK = Object.freeze({
  startMinute: 8 * 60,
  gameMinutesPerRealSecond: 0.5,
  cycleRealMinutes: 48
});

export interface ReplicatedWorldClock {
  worldTimeStartedAt: number;
  worldTimeStartMinute: number;
  worldTimeRate: number;
}

export interface WorldLighting {
  minute: number;
  phase: 'night' | 'dawn' | 'day' | 'dusk';
  skyColor: number;
  hemisphereSkyColor: number;
  hemisphereGroundColor: number;
  hemisphereIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunAngle: number;
  streetlightIntensity: number;
}

const DAY_MINUTES = 24 * 60;

export function worldMinuteAt(clock: ReplicatedWorldClock, nowMs: number): number {
  const elapsedSeconds = Math.max(0, finite(nowMs) - finite(clock.worldTimeStartedAt)) / 1000;
  const minute = finite(clock.worldTimeStartMinute) + elapsedSeconds * Math.max(0, finite(clock.worldTimeRate));
  return modulo(minute, DAY_MINUTES);
}

export function lightingAtMinute(rawMinute: number): WorldLighting {
  const minute = modulo(finite(rawMinute), DAY_MINUTES);
  const dawn = smoothRange(minute, 5 * 60, 7 * 60);
  const dusk = smoothRange(minute, 18 * 60, 20 * 60);
  const daylight = Math.min(dawn, 1 - dusk);
  const warmEdge = Math.max(1 - Math.abs(minute - 6 * 60) / 90, 1 - Math.abs(minute - 19 * 60) / 90, 0);
  const phase = minute < 5 * 60 || minute >= 20 * 60
    ? 'night'
    : minute < 7 * 60
      ? 'dawn'
      : minute < 18 * 60
        ? 'day'
        : 'dusk';
  return {
    minute,
    phase,
    skyColor: mixColor(0x07101b, warmEdge > 0.05 ? 0xbd6c4a : 0x86b8d8, daylight),
    hemisphereSkyColor: mixColor(0x1a2942, warmEdge > 0.05 ? 0xffb071 : 0xd9efff, daylight),
    hemisphereGroundColor: mixColor(0x0a0d12, 0x68705f, daylight),
    hemisphereIntensity: 0.24 + daylight * 1.08,
    sunColor: mixColor(0xff8a50, 0xfff4d6, Math.max(0, daylight - warmEdge * 0.55)),
    sunIntensity: daylight * 2.15,
    sunAngle: minute / DAY_MINUTES * Math.PI * 2 - Math.PI / 2,
    streetlightIntensity: 1 - smoothRange(daylight, 0.18, 0.48)
  };
}

export function formatWorldTime(minute: number): string {
  const normalized = Math.floor(modulo(minute, DAY_MINUTES));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function smoothRange(value: number, start: number, end: number): number {
  const progress = Math.max(0, Math.min(1, (value - start) / Math.max(0.0001, end - start)));
  return progress * progress * (3 - 2 * progress);
}

function mixColor(from: number, to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const channel = (shift: number) => Math.round(
    ((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * t
  );
  return channel(16) << 16 | channel(8) << 8 | channel(0);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
