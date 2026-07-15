import type {
  InteractionProtocolRejection,
  InteractionValidationResult
} from './interaction-contracts.ts';

export const MAX_ID_LENGTH = 96;
export const MAX_SPACE_ID_LENGTH = 64;
export const MAX_ABSOLUTE_POSITION = 1_000_000;
export const MAX_ABSOLUTE_VELOCITY = 10_000;
export const MAX_COLLIDER_SIZE = 2_048;

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

export function positiveFinite(value: unknown, maximum: number): number | undefined {
  return finiteInRange(value, Number.EPSILON, maximum);
}

export function boundedId(value: unknown): string | undefined {
  return boundedString(value, MAX_ID_LENGTH);
}

export function boundedString(value: unknown, maximumLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
    ? value
    : undefined;
}

export function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] | undefined {
  return typeof value === 'string' && allowed.includes(value) ? value as T[number] : undefined;
}

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function accepted<T>(value: T): InteractionValidationResult<T> {
  return {accepted: true, value};
}

export function rejected<T>(reason: InteractionProtocolRejection): InteractionValidationResult<T> {
  return {accepted: false, reason};
}
