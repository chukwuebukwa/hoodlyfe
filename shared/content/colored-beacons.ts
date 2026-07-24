export interface ColoredBeaconDefinition {
  id: string;
  label: string;
  enabled: boolean;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  color: string;
  intensity: number;
  radius: number;
  footprintWidth: number;
  footprintHeight: number;
}

export const DEFAULT_COLORED_BEACON_STYLE = {
  color: '#20dcff',
  intensity: 0.82,
  z: 108,
  targetZ: 35,
  radius: 88,
  footprintWidth: 215.6,
  footprintHeight: 176
} as const;

export function isColoredBeaconDefinition(value: unknown): value is ColoredBeaconDefinition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ColoredBeaconDefinition>;
  return typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.enabled === 'boolean' &&
    finite(candidate.x) &&
    finite(candidate.y) &&
    finite(candidate.z) &&
    finite(candidate.targetX) &&
    finite(candidate.targetY) &&
    finite(candidate.targetZ) &&
    typeof candidate.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(candidate.color) &&
    positive(candidate.intensity) &&
    positive(candidate.radius) &&
    positive(candidate.footprintWidth) &&
    positive(candidate.footprintHeight);
}

export function parseColoredBeaconDefinitions(value: unknown): ColoredBeaconDefinition[] {
  return Array.isArray(value) ? value.filter(isColoredBeaconDefinition) : [];
}

export function coloredBeaconHex(color: string): number {
  return Number.parseInt(color.replace(/^#/, ''), 16);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}
