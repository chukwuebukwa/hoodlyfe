import {
  createNetcodeRolloutManifest,
  type NetcodeRolloutManifest,
  type NetcodeRolloutStage
} from '../../../shared/protocol/netcode-rollout.ts';

const STAGE_CONFIGURATION: Readonly<Record<
  NetcodeRolloutStage,
  Readonly<{environmentKey: string; defaultEnabled: boolean}>
>> = Object.freeze({
  localOnFootPrediction: {
    environmentKey: 'GAME_NETCODE_LOCAL_ON_FOOT_PREDICTION',
    defaultEnabled: true
  },
  localVehiclePrediction: {
    environmentKey: 'GAME_NETCODE_LOCAL_VEHICLE_PREDICTION',
    defaultEnabled: true
  },
  remoteTimelines: {environmentKey: 'GAME_NETCODE_REMOTE_TIMELINES', defaultEnabled: true},
  combatRewind: {environmentKey: 'GAME_NETCODE_COMBAT_REWIND', defaultEnabled: true},
  interactionSnapshots: {
    environmentKey: 'GAME_NETCODE_INTERACTION_SNAPSHOTS',
    defaultEnabled: false
  },
  interactionSelection: {
    environmentKey: 'GAME_NETCODE_INTERACTION_SELECTION',
    defaultEnabled: false
  },
  vehicleIslandReplay: {
    environmentKey: 'GAME_NETCODE_VEHICLE_ISLAND_REPLAY',
    defaultEnabled: false
  },
  mixedIslandReplay: {
    environmentKey: 'GAME_NETCODE_MIXED_ISLAND_REPLAY',
    defaultEnabled: false
  }
});

export function resolveNetcodeRolloutManifest(
  environment: Readonly<Record<string, string | undefined>> = process.env
): NetcodeRolloutManifest {
  const stages = {} as Record<NetcodeRolloutStage, boolean>;
  for (const [stage, configuration] of Object.entries(STAGE_CONFIGURATION) as Array<
    [NetcodeRolloutStage, {environmentKey: string; defaultEnabled: boolean}]
  >) {
    stages[stage] = parseBoolean(
      environment[configuration.environmentKey],
      configuration.environmentKey,
      configuration.defaultEnabled
    );
  }
  const revision = environment.GAME_NETCODE_ROLLOUT_REVISION?.trim() || 'server-authority';
  return createNetcodeRolloutManifest(revision, {
    localOnFootPrediction: stages.localOnFootPrediction,
    localVehiclePrediction: stages.localVehiclePrediction,
    remoteTimelines: stages.remoteTimelines,
    combatRewind: stages.combatRewind,
    interactionSnapshots: stages.interactionSnapshots,
    interactionSelection: stages.interactionSelection,
    vehicleIslandReplay: stages.vehicleIslandReplay,
    mixedIslandReplay: stages.mixedIslandReplay
  });
}

function parseBoolean(
  value: string | undefined,
  environmentKey: string,
  defaultEnabled: boolean
): boolean {
  if (value === undefined || value.trim() === '') return defaultEnabled;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'disabled'].includes(normalized)) return false;
  throw new Error(`${environmentKey} must be a boolean rollout flag.`);
}
