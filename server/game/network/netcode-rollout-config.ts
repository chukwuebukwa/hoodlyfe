import {
  createNetcodeRolloutManifest,
  type NetcodeRolloutManifest,
  type NetcodeRolloutStage
} from '../../../shared/protocol/netcode-rollout.ts';

const ENVIRONMENT_KEYS: Readonly<Record<NetcodeRolloutStage, string>> = Object.freeze({
  localOnFootPrediction: 'GAME_NETCODE_LOCAL_ON_FOOT_PREDICTION',
  remoteTimelines: 'GAME_NETCODE_REMOTE_TIMELINES',
  combatRewind: 'GAME_NETCODE_COMBAT_REWIND'
});

export function resolveNetcodeRolloutManifest(
  environment: Readonly<Record<string, string | undefined>> = process.env
): NetcodeRolloutManifest {
  const stages = {} as Record<NetcodeRolloutStage, boolean>;
  for (const [stage, environmentKey] of Object.entries(ENVIRONMENT_KEYS) as Array<
    [NetcodeRolloutStage, string]
  >) {
    stages[stage] = parseBoolean(environment[environmentKey], environmentKey);
  }
  const revision = environment.GAME_NETCODE_ROLLOUT_REVISION?.trim() || 'server-authority';
  return createNetcodeRolloutManifest(revision, {
    localOnFootPrediction: stages.localOnFootPrediction,
    remoteTimelines: stages.remoteTimelines,
    combatRewind: stages.combatRewind
  });
}

function parseBoolean(value: string | undefined, environmentKey: string): boolean {
  if (value === undefined || value.trim() === '') return true;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'disabled'].includes(normalized)) return false;
  throw new Error(`${environmentKey} must be a boolean rollout flag.`);
}
