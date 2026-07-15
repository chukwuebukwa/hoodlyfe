import {INTERACTION_PROTOCOL_VERSION, MAX_INPUT_SEQUENCE_ADVANCE, MAX_PREDICTED_SPAWN_IDS} from './interaction-contracts.ts';
import type {BulletWeaponId} from '../content/weapon-catalog.ts';
import {
  boundedId,
  finiteInRange,
  finiteNumber,
  normalizeAngle,
  objectRecord,
  safeNonnegativeInteger,
  safePositiveInteger
} from './interaction-validation.ts';

export const COMBAT_FIRE_MESSAGE = 'combat.fire';
export const COMBAT_FIRE_RECEIPT_MESSAGE = 'combat.fire.receipt';

export interface CombatFireCommand {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly clientSampleTimeMs: number;
  readonly controlledEntityId: string;
  readonly aimAngle: number;
  readonly predictedSpawnIds: readonly number[];
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
  | 'invalid-controlled-entity'
  | 'invalid-predicted-spawn-id';

export type CombatFireValidationResult =
  | {readonly accepted: true; readonly value: CombatFireCommand}
  | {readonly accepted: false; readonly reason: CombatFireRejection};

export interface CombatProjectileReceipt {
  readonly clientSpawnId: number;
  readonly authoritativeSpawnId: string;
  readonly status: 'active' | 'resolved';
  readonly weapon: BulletWeaponId;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface CombatFireReceipt {
  readonly sequence: number;
  readonly status: 'accepted' | 'rejected';
  readonly reason?: string;
  readonly serverTick: number;
  readonly serverTimeMs: number;
  readonly effectiveServerShotTimeMs: number;
  readonly rewindMs: number;
  readonly projectiles: readonly CombatProjectileReceipt[];
}

export function validateCombatFireCommand(
  message: unknown,
  context: CombatFireValidationContext
): CombatFireValidationResult {
  const record = objectRecord(message);
  if (!record) return rejected('invalid-shape');
  if (record.protocolVersion !== INTERACTION_PROTOCOL_VERSION) {
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
  const predictedSpawnIds = parsePredictedSpawnIds(record.predictedSpawnIds);
  if (!predictedSpawnIds) return rejected('invalid-predicted-spawn-id');
  return {
    accepted: true,
    value: Object.freeze({
      protocolVersion: INTERACTION_PROTOCOL_VERSION,
      sequence,
      clientSampleTimeMs,
      controlledEntityId,
      aimAngle: normalizeAngle(aimAngle),
      predictedSpawnIds
    })
  };
}

function parsePredictedSpawnIds(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PREDICTED_SPAWN_IDS) return undefined;
  const unique = new Set<number>();
  const ids: number[] = [];
  for (const candidate of value) {
    const id = safePositiveInteger(candidate);
    if (id === undefined || unique.has(id)) return undefined;
    unique.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
}

function rejected(reason: CombatFireRejection): CombatFireValidationResult {
  return {accepted: false, reason};
}
