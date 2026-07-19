import {INTERACTION_PROTOCOL_VERSION} from './interaction-contracts.ts';
import {boundedString, objectRecord, safePositiveInteger} from './interaction-validation.ts';

export const NETCODE_ROLLOUT_REQUEST_MESSAGE = 'netcode.rollout.request';
export const NETCODE_ROLLOUT_MANIFEST_MESSAGE = 'netcode.rollout.manifest';
export const NETCODE_ROLLOUT_PROTOCOL_VERSION = 1;

export const NETCODE_ROLLOUT_STAGE_KEYS = Object.freeze([
  'remoteTimelines',
  'interactionSnapshots',
  'interactionReplay',
  'combatRewind',
  'projectilePrediction',
  'serverVehiclePhysics'
] as const);

// Stages appended after initial deployment: absent in manifests from older peers,
// validated as off rather than rejected so rolling deployments stay compatible.
const APPENDED_STAGE_KEYS: ReadonlySet<NetcodeRolloutStage> =
  new Set(['serverVehiclePhysics']);

export type NetcodeRolloutStage = typeof NETCODE_ROLLOUT_STAGE_KEYS[number];

export interface NetcodeRolloutStages {
  readonly remoteTimelines: boolean;
  readonly interactionSnapshots: boolean;
  readonly interactionReplay: boolean;
  readonly combatRewind: boolean;
  readonly projectilePrediction: boolean;
  readonly serverVehiclePhysics: boolean;
}

export interface NetcodeRolloutRequest {
  readonly protocolVersion: number;
}

export interface NetcodeRolloutManifest {
  readonly protocolVersion: number;
  readonly interactionProtocolVersion: number;
  readonly revision: string;
  readonly stages: NetcodeRolloutStages;
}

export type NetcodeRolloutRejection =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'invalid-interaction-version'
  | 'invalid-revision'
  | 'invalid-stages'
  | 'invalid-dependencies';

export type NetcodeRolloutValidation =
  | {readonly accepted: true; readonly value: NetcodeRolloutManifest}
  | {readonly accepted: false; readonly reason: NetcodeRolloutRejection};

export const LEGACY_NETCODE_ROLLOUT_MANIFEST: NetcodeRolloutManifest = freezeManifest({
  protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
  interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
  revision: 'legacy-fallback',
  stages: {
    remoteTimelines: false,
    interactionSnapshots: false,
    interactionReplay: false,
    combatRewind: false,
    projectilePrediction: false,
    serverVehiclePhysics: false
  }
});

export function createNetcodeRolloutManifest(
  revision: string,
  stages: NetcodeRolloutStages
): NetcodeRolloutManifest {
  const validated = validateNetcodeRolloutManifest({
    protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
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
    if (stageRecord[key] === undefined && APPENDED_STAGE_KEYS.has(key)) {
      stages[key] = false;
      continue;
    }
    if (typeof stageRecord[key] !== 'boolean') return rejected('invalid-stages');
    stages[key] = stageRecord[key];
  }
  if (
    (stages.interactionReplay && !stages.interactionSnapshots) ||
    (stages.projectilePrediction && !stages.combatRewind)
  ) return rejected('invalid-dependencies');
  return {accepted: true, value: freezeManifest({
    protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION,
    interactionProtocolVersion,
    revision,
    stages: {
      remoteTimelines: stages.remoteTimelines,
      interactionSnapshots: stages.interactionSnapshots,
      interactionReplay: stages.interactionReplay,
      combatRewind: stages.combatRewind,
      projectilePrediction: stages.projectilePrediction,
      serverVehiclePhysics: stages.serverVehiclePhysics
    }
  })};
}

function freezeManifest(manifest: NetcodeRolloutManifest): NetcodeRolloutManifest {
  return Object.freeze({...manifest, stages: Object.freeze({...manifest.stages})});
}

function rejected(reason: NetcodeRolloutRejection): NetcodeRolloutValidation {
  return {accepted: false, reason};
}
