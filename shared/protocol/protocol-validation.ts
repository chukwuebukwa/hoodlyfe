export const MAX_ID_LENGTH = 96;

export function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function safeNonnegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

export function safePositiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number
): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= minimum && number <= maximum ? number : undefined;
}

export function boundedId(value: unknown): string | undefined {
  return boundedString(value, MAX_ID_LENGTH);
}

export function boundedString(value: unknown, maximumLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
    ? value
    : undefined;
}

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
