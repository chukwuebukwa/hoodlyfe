import {
  INTERACTION_PROTOCOL_VERSION,
  MAX_INPUT_SEQUENCE_ADVANCE,
  MAX_PREDICTED_SPAWN_IDS,
  PLAYER_INPUT_BUTTON,
  type PlayerInputCommand,
  type PlayerInputValidationContext,
  type InteractionValidationResult
} from './interaction-contracts.ts';
import {
  accepted,
  boundedId,
  finiteInRange,
  finiteNumber,
  normalizeAngle,
  normalizedVector,
  objectRecord,
  rejected,
  safeNonnegativeInteger,
  safePositiveInteger
} from './interaction-validation.ts';

const VALID_PLAYER_INPUT_BUTTONS = Object.values(PLAYER_INPUT_BUTTON)
  .reduce((mask, button) => mask | button, 0);

export function validatePlayerInputCommand(
  message: unknown,
  context: PlayerInputValidationContext
): InteractionValidationResult<PlayerInputCommand> {
  const record = objectRecord(message);
  if (!record) return rejected('invalid-shape');
  if (record.protocolVersion !== INTERACTION_PROTOCOL_VERSION) {
    return rejected('unsupported-version');
  }
  const sequence = safeNonnegativeInteger(record.sequence);
  if (sequence === undefined) return rejected('invalid-sequence');
  if (sequence <= context.previousSequence) return rejected('stale-sequence');
  const maximumAdvance = context.maximumSequenceAdvance ?? MAX_INPUT_SEQUENCE_ADVANCE;
  if (sequence - context.previousSequence > maximumAdvance) {
    return rejected('sequence-window-exceeded');
  }
  const clientTick = safeNonnegativeInteger(record.clientTick);
  if (clientTick === undefined) return rejected('invalid-client-tick');
  if (clientTick < context.minimumClientTick) return rejected('stale-client-tick');
  if (clientTick > context.maximumClientTick) return rejected('future-client-tick');
  const clientSampleTimeMs = finiteInRange(record.clientSampleTimeMs, 0, Number.MAX_SAFE_INTEGER);
  const moveX = finiteNumber(record.moveX);
  const moveY = finiteNumber(record.moveY);
  const aimAngle = finiteNumber(record.aimAngle);
  if (
    clientSampleTimeMs === undefined || moveX === undefined || moveY === undefined ||
    aimAngle === undefined
  ) return rejected('invalid-number');
  const buttons = safeNonnegativeInteger(record.buttons);
  if (buttons === undefined || (buttons & ~VALID_PLAYER_INPUT_BUTTONS) !== 0) {
    return rejected('invalid-buttons');
  }
  const selectedWeaponSlot = safeNonnegativeInteger(record.selectedWeaponSlot);
  if (selectedWeaponSlot === undefined || selectedWeaponSlot > 15) {
    return rejected('invalid-number');
  }
  const controlledEntityId = boundedId(record.controlledEntityId);
  if (
    !controlledEntityId ||
    (context.expectedControlledEntityId !== undefined &&
      controlledEntityId !== context.expectedControlledEntityId)
  ) return rejected('invalid-controlled-entity');
  const predictedSpawnIds = parsePredictedSpawnIds(record.predictedSpawnIds);
  if (!predictedSpawnIds) return rejected('invalid-predicted-spawn-id');
  const clampedX = clamp(moveX, -1, 1);
  const clampedY = clamp(moveY, -1, 1);
  const movement = normalizedVector(clampedX, clampedY);
  return accepted(Object.freeze({
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    sequence,
    clientTick,
    clientSampleTimeMs,
    moveX: movement.x,
    moveY: movement.y,
    aimAngle: normalizeAngle(aimAngle),
    buttons,
    selectedWeaponSlot,
    controlledEntityId,
    predictedSpawnIds
  }));
}

function parsePredictedSpawnIds(value: unknown): readonly number[] | undefined {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_PREDICTED_SPAWN_IDS) return undefined;
  const ids: number[] = [];
  const unique = new Set<number>();
  for (const candidate of value) {
    const id = safePositiveInteger(candidate);
    if (id === undefined || unique.has(id)) return undefined;
    unique.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
