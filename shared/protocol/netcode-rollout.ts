import {COMBAT_PROTOCOL_VERSION} from './combat-fire.ts';
import {boundedString, objectRecord, safePositiveInteger} from './protocol-validation.ts';

export const NETCODE_ROLLOUT_REQUEST_MESSAGE = 'netcode.rollout.request';
export const NETCODE_ROLLOUT_MANIFEST_MESSAGE = 'netcode.rollout.manifest';
export const NETCODE_ROLLOUT_PROTOCOL_VERSION = 5;

export const NETCODE_ROLLOUT_STAGE_KEYS = Object.freeze([
  'localOnFootPrediction',
  'localVehiclePrediction',
  'remoteTimelines',
  'combatRewind'
] as const);

export type NetcodeRolloutStage = typeof NETCODE_ROLLOUT_STAGE_KEYS[number];

export interface NetcodeRolloutStages {
  readonly localOnFootPrediction: boolean;
  readonly localVehiclePrediction: boolean;
  readonly remoteTimelines: boolean;
  readonly combatRewind: boolean;
}

export interface NetcodeRolloutRequest {
  readonly protocolVersion: number;
}

export interface NetcodeRolloutManifest {
  readonly protocolVersion: number;
  readonly combatProtocolVersion: number;
  readonly revision: string;
  readonly stages: NetcodeRolloutStages;
}

export type NetcodeRolloutRejection =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'invalid-combat-version'
  | 'invalid-revision'
  | 'invalid-stages';

export type NetcodeRolloutValidation =
  | {readonly accepted: true; readonly value: NetcodeRolloutManifest}
  | {readonly accepted: false; readonly reason: NetcodeRolloutRejection};

export const LEGACY_NETCODE_ROLLOUT_MANIFEST: NetcodeRolloutManifest = freezeManifest({
  protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
  combatProtocolVersion: COMBAT_PROTOCOL_VERSION,
  revision: 'legacy-fallback',
  stages: {
    localOnFootPrediction: false,
    localVehiclePrediction: false,
    remoteTimelines: false,
    combatRewind: false
  }
});

export function createNetcodeRolloutManifest(
  revision: string,
  stages: NetcodeRolloutStages
): NetcodeRolloutManifest {
  const validated = validateNetcodeRolloutManifest({
    protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
    combatProtocolVersion: COMBAT_PROTOCOL_VERSION,
    revision,
    stages
  });
  if (!validated.accepted) {
    throw new Error(`Invalid netcode rollout manifest: ${validated.reason}`);
  }
  return validated.value;
}

export function validateNetcodeRolloutRequest(message: unknown): boolean {
  const record = objectRecord(message);
  return record?.protocolVersion === NETCODE_ROLLOUT_PROTOCOL_VERSION;
}

export function validateNetcodeRolloutManifest(message: unknown): NetcodeRolloutValidation {
  const record = objectRecord(message);
  if (!record) return rejected('invalid-shape');
  if (record.protocolVersion !== NETCODE_ROLLOUT_PROTOCOL_VERSION) {
    return rejected('unsupported-version');
  }
  const combatProtocolVersion = safePositiveInteger(record.combatProtocolVersion);
  if (combatProtocolVersion !== COMBAT_PROTOCOL_VERSION) {
    return rejected('invalid-combat-version');
  }
  const revision = boundedString(record.revision, 64);
  if (!revision || !/^[a-zA-Z0-9._-]+$/.test(revision)) return rejected('invalid-revision');
  const stageRecord = objectRecord(record.stages);
  if (!stageRecord) return rejected('invalid-stages');
  const stages = {} as Record<NetcodeRolloutStage, boolean>;
  for (const key of NETCODE_ROLLOUT_STAGE_KEYS) {
    if (typeof stageRecord[key] !== 'boolean') return rejected('invalid-stages');
    stages[key] = stageRecord[key];
  }
  return {accepted: true, value: freezeManifest({
    protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
    combatProtocolVersion,
    revision,
    stages: {
      localOnFootPrediction: stages.localOnFootPrediction,
      localVehiclePrediction: stages.localVehiclePrediction,
      remoteTimelines: stages.remoteTimelines,
      combatRewind: stages.combatRewind
    }
  })};
}

function freezeManifest(manifest: NetcodeRolloutManifest): NetcodeRolloutManifest {
  return Object.freeze({...manifest, stages: Object.freeze({...manifest.stages})});
}

function rejected(reason: NetcodeRolloutRejection): NetcodeRolloutValidation {
  return {accepted: false, reason};
}
