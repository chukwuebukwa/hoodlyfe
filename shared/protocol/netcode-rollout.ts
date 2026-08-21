import {COMBAT_PROTOCOL_VERSION} from './combat-fire.ts';
import {INTERACTION_PROTOCOL_VERSION} from './interaction-islands.ts';
import {boundedString, objectRecord, safePositiveInteger} from './protocol-validation.ts';

export const NETCODE_ROLLOUT_REQUEST_MESSAGE = 'netcode.rollout.request';
export const NETCODE_ROLLOUT_MANIFEST_MESSAGE = 'netcode.rollout.manifest';
export const NETCODE_ROLLOUT_PROTOCOL_VERSION = 6;

export const NETCODE_ROLLOUT_STAGE_KEYS = Object.freeze([
  'localOnFootPrediction',
  'localVehiclePrediction',
  'remoteTimelines',
  'combatRewind',
  'interactionSnapshots',
  'interactionSelection',
  'vehicleIslandReplay',
  'mixedIslandReplay'
] as const);

export type NetcodeRolloutStage = typeof NETCODE_ROLLOUT_STAGE_KEYS[number];

export interface NetcodeRolloutStages {
  readonly localOnFootPrediction: boolean;
  readonly localVehiclePrediction: boolean;
  readonly remoteTimelines: boolean;
  readonly combatRewind: boolean;
  readonly interactionSnapshots: boolean;
  readonly interactionSelection: boolean;
  readonly vehicleIslandReplay: boolean;
  readonly mixedIslandReplay: boolean;
}

export interface NetcodeRolloutRequest {
  readonly protocolVersion: number;
}

export interface NetcodeRolloutManifest {
  readonly protocolVersion: number;
  readonly combatProtocolVersion: number;
  readonly interactionProtocolVersion: number;
  readonly revision: string;
  readonly stages: NetcodeRolloutStages;
}

export type NetcodeRolloutRejection =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'invalid-combat-version'
  | 'invalid-interaction-version'
  | 'invalid-revision'
  | 'invalid-stages'
  | 'invalid-dependencies';

export type NetcodeRolloutValidation =
  | {readonly accepted: true; readonly value: NetcodeRolloutManifest}
  | {readonly accepted: false; readonly reason: NetcodeRolloutRejection};

export const LEGACY_NETCODE_ROLLOUT_MANIFEST: NetcodeRolloutManifest = freezeManifest({
  protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
  combatProtocolVersion: COMBAT_PROTOCOL_VERSION,
  interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
  revision: 'legacy-fallback',
  stages: {
    localOnFootPrediction: false,
    localVehiclePrediction: false,
    remoteTimelines: false,
    combatRewind: false,
    interactionSnapshots: false,
    interactionSelection: false,
    vehicleIslandReplay: false,
    mixedIslandReplay: false
  }
});

export function createNetcodeRolloutManifest(
  revision: string,
  stages: NetcodeRolloutStages
): NetcodeRolloutManifest {
  const validated = validateNetcodeRolloutManifest({
    protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
    combatProtocolVersion: COMBAT_PROTOCOL_VERSION,
    interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
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
  const interactionProtocolVersion = safePositiveInteger(record.interactionProtocolVersion);
  if (interactionProtocolVersion !== INTERACTION_PROTOCOL_VERSION) {
    return rejected('invalid-interaction-version');
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
  if (
    (stages.interactionSelection && !stages.interactionSnapshots) ||
    (stages.vehicleIslandReplay && (!stages.interactionSelection || !stages.localVehiclePrediction)) ||
    (stages.mixedIslandReplay && (!stages.vehicleIslandReplay || !stages.localOnFootPrediction))
  ) return rejected('invalid-dependencies');
  return {accepted: true, value: freezeManifest({
    protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
    combatProtocolVersion,
    interactionProtocolVersion,
    revision,
    stages: {
      localOnFootPrediction: stages.localOnFootPrediction,
      localVehiclePrediction: stages.localVehiclePrediction,
      remoteTimelines: stages.remoteTimelines,
      combatRewind: stages.combatRewind,
      interactionSnapshots: stages.interactionSnapshots,
      interactionSelection: stages.interactionSelection,
      vehicleIslandReplay: stages.vehicleIslandReplay,
      mixedIslandReplay: stages.mixedIslandReplay
    }
  })};
}

function freezeManifest(manifest: NetcodeRolloutManifest): NetcodeRolloutManifest {
  return Object.freeze({...manifest, stages: Object.freeze({...manifest.stages})});
}

function rejected(reason: NetcodeRolloutRejection): NetcodeRolloutValidation {
  return {accepted: false, reason};
}
