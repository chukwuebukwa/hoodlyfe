import {boundedId, objectRecord, safeNonnegativeInteger} from './protocol-validation.ts';

export const WEAPON_RELOAD_REQUEST_MESSAGE = 'weapon.reload.request';
export const WEAPON_RELOAD_RECEIPT_MESSAGE = 'weapon.reload.receipt';
export const WEAPON_RELOAD_PROTOCOL_VERSION = 1;

export interface WeaponReloadRequest {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly controlledEntityId: string;
}

export interface WeaponReloadReceipt {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly accepted: boolean;
  readonly reason?: string;
  readonly weapon?: string;
  readonly magazine?: number;
  readonly reserve?: number;
  readonly reloadSequence?: number;
  readonly reloadEndsAt?: number;
}

export type WeaponReloadValidationResult =
  | {readonly accepted: true; readonly value: WeaponReloadRequest}
  | {readonly accepted: false; readonly reason: string};

export function validateWeaponReloadRequest(
  message: unknown,
  expectedControlledEntityId: string
): WeaponReloadValidationResult {
  const record = objectRecord(message);
  if (!record) return {accepted: false, reason: 'invalid-shape'};
  if (record.protocolVersion !== WEAPON_RELOAD_PROTOCOL_VERSION) {
    return {accepted: false, reason: 'unsupported-version'};
  }
  const sequence = safeNonnegativeInteger(record.sequence);
  if (sequence === undefined || sequence === 0) return {accepted: false, reason: 'invalid-sequence'};
  const controlledEntityId = boundedId(record.controlledEntityId);
  if (!controlledEntityId || controlledEntityId !== expectedControlledEntityId) {
    return {accepted: false, reason: 'invalid-controlled-entity'};
  }
  return {
    accepted: true,
    value: Object.freeze({
      protocolVersion: WEAPON_RELOAD_PROTOCOL_VERSION,
      sequence,
      controlledEntityId
    })
  };
}
