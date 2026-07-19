import {
  createNetcodeRolloutManifest,
  type NetcodeRolloutManifest,
  type NetcodeRolloutStage
} from '../../../shared/protocol/netcode-rollout.ts';

type LegacyStage = Exclude<NetcodeRolloutStage, 'serverVehiclePhysics'>;

const ENVIRONMENT_KEYS: Readonly<Record<LegacyStage, string>> = Object.freeze({
  remoteTimelines: 'GAME_NETCODE_REMOTE_TIMELINES',
  interactionSnapshots: 'GAME_NETCODE_INTERACTION_SNAPSHOTS',
  interactionReplay: 'GAME_NETCODE_INTERACTION_REPLAY',
  combatRewind: 'GAME_NETCODE_COMBAT_REWIND',
  projectilePrediction: 'GAME_NETCODE_PROJECTILE_PREDICTION'
});

export interface ServerPhysicsRollout {
  readonly vehicles: boolean;
}

// Default on; the environment flag remains the no-redeploy rollback lever until
// stage 4 of RAPIER_MIGRATION_ADAPTATION_CONTRACT.md removes the kernel path.
export function resolveServerPhysicsRollout(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ServerPhysicsRollout {
  return {
    vehicles: parseBoolean(
      environment.GAME_NETCODE_SERVER_VEHICLE_PHYSICS,
      'GAME_NETCODE_SERVER_VEHICLE_PHYSICS'
    )
  };
}

export function resolveNetcodeRolloutManifest(
  environment: Readonly<Record<string, string | undefined>> = process.env
): NetcodeRolloutManifest {
  const stages = {} as Record<LegacyStage, boolean>;
  for (const [stage, environmentKey] of Object.entries(ENVIRONMENT_KEYS) as Array<
    [LegacyStage, string]
  >) {
    stages[stage] = parseBoolean(environment[environmentKey], environmentKey);
  }
  const revision = environment.GAME_NETCODE_ROLLOUT_REVISION?.trim() || 'm11-all-on';
  return createNetcodeRolloutManifest(revision, {
    remoteTimelines: stages.remoteTimelines,
    interactionSnapshots: stages.interactionSnapshots,
    interactionReplay: stages.interactionReplay,
    combatRewind: stages.combatRewind,
    projectilePrediction: stages.projectilePrediction,
    serverVehiclePhysics: resolveServerPhysicsRollout(environment).vehicles
  });
}

function parseBoolean(value: string | undefined, environmentKey: string): boolean {
  if (value === undefined || value.trim() === '') return true;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'disabled'].includes(normalized)) return false;
  throw new Error(`${environmentKey} must be a boolean rollout flag.`);
}
