export const VEHICLE_NEON_COLORS = [
  'cyan', 'magenta', 'violet', 'lime', 'amber', 'white'
] as const;

export type VehicleNeonColor = 'off' | typeof VEHICLE_NEON_COLORS[number];

export const VEHICLE_NEON_INSTALL_PRICE = 350;
export const VEHICLE_NEON_RECOLOR_PRICE = 75;

const VEHICLE_NEON_HEX: Readonly<Record<Exclude<VehicleNeonColor, 'off'>, number>> = Object.freeze({
  cyan: 0x39e7ff,
  magenta: 0xff3ec8,
  violet: 0x9b6cff,
  lime: 0x69ff73,
  amber: 0xffa938,
  white: 0xe8fbff
});

export function isVehicleNeonColor(value: string): value is VehicleNeonColor {
  return value === 'off' || VEHICLE_NEON_COLORS.includes(value as typeof VEHICLE_NEON_COLORS[number]);
}

export function normalizeVehicleNeonColor(value: string | undefined): VehicleNeonColor {
  return value && isVehicleNeonColor(value) ? value : 'off';
}

export function nextVehicleNeonColor(current: string | undefined): typeof VEHICLE_NEON_COLORS[number] {
  const normalized = normalizeVehicleNeonColor(current);
  if (normalized === 'off') return VEHICLE_NEON_COLORS[0];
  const index = VEHICLE_NEON_COLORS.indexOf(normalized);
  return VEHICLE_NEON_COLORS[(index + 1) % VEHICLE_NEON_COLORS.length];
}

export function vehicleNeonUpgradeQuote(current: string | undefined): number {
  return normalizeVehicleNeonColor(current) === 'off'
    ? VEHICLE_NEON_INSTALL_PRICE
    : VEHICLE_NEON_RECOLOR_PRICE;
}

export function vehicleNeonColorHex(color: string | undefined): number {
  const normalized = normalizeVehicleNeonColor(color);
  return normalized === 'off' ? 0x000000 : VEHICLE_NEON_HEX[normalized];
}

export function vehicleNeonColorLabel(color: string | undefined): string {
  return normalizeVehicleNeonColor(color).toUpperCase();
}
