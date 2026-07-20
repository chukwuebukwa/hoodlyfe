import {
  boundedId,
  finiteInRange,
  finiteNumber,
  normalizeAngle,
  objectRecord,
  safeNonnegativeInteger
} from './protocol-validation.ts';

export const COMBAT_FIRE_MESSAGE = 'combat.fire';
export const COMBAT_FIRE_RECEIPT_MESSAGE = 'combat.fire.receipt';
export const COMBAT_PROTOCOL_VERSION = 8;
const MAX_INPUT_SEQUENCE_ADVANCE = 4_096;

export interface CombatFireCommand {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly clientSampleTimeMs: number;
  readonly controlledEntityId: string;
  readonly aimAngle: number;
}

export interface CombatFireReceipt {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly accepted: boolean;
  readonly reason?: string;
  readonly weapon?: string;
  readonly magazine?: number;
  readonly reserve?: number;
  readonly shotSequence?: number;
  readonly reloadSequence?: number;
  readonly reloadEndsAt?: number;
}

export interface CombatFireValidationContext {
  readonly previousSequence: number;
  readonly expectedControlledEntityId: string;
  readonly minimumClientSampleTimeMs?: number;
  readonly maximumSequenceAdvance?: number;
}

export type CombatFireRejection =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'invalid-sequence'
  | 'stale-sequence'
  | 'sequence-window-exceeded'
  | 'invalid-number'
  | 'stale-sample-time'
  | 'invalid-controlled-entity';

export type CombatFireValidationResult =
  | {readonly accepted: true; readonly value: CombatFireCommand}
  | {readonly accepted: false; readonly reason: CombatFireRejection};

export function validateCombatFireCommand(
  message: unknown,
  context: CombatFireValidationContext
): CombatFireValidationResult {
  const record = objectRecord(message);
  if (!record) return rejected('invalid-shape');
  if (record.protocolVersion !== COMBAT_PROTOCOL_VERSION) {
    return rejected('unsupported-version');
  }
  const sequence = safeNonnegativeInteger(record.sequence);
  if (sequence === undefined) return rejected('invalid-sequence');
  if (sequence <= context.previousSequence) return rejected('stale-sequence');
  if (
    sequence - context.previousSequence >
    (context.maximumSequenceAdvance ?? MAX_INPUT_SEQUENCE_ADVANCE)
  ) return rejected('sequence-window-exceeded');
  const clientSampleTimeMs = finiteInRange(record.clientSampleTimeMs, 0, Number.MAX_SAFE_INTEGER);
  const aimAngle = finiteNumber(record.aimAngle);
  if (clientSampleTimeMs === undefined || aimAngle === undefined) return rejected('invalid-number');
  if (
    context.minimumClientSampleTimeMs !== undefined &&
    clientSampleTimeMs < context.minimumClientSampleTimeMs
  ) return rejected('stale-sample-time');
  const controlledEntityId = boundedId(record.controlledEntityId);
  if (!controlledEntityId || controlledEntityId !== context.expectedControlledEntityId) {
    return rejected('invalid-controlled-entity');
  }
  return {
    accepted: true,
    value: Object.freeze({
      protocolVersion: COMBAT_PROTOCOL_VERSION,
      sequence,
      clientSampleTimeMs,
      controlledEntityId,
      aimAngle: normalizeAngle(aimAngle)
    })
  };
}

function rejected(reason: CombatFireRejection): CombatFireValidationResult {
  return {accepted: false, reason};
}
