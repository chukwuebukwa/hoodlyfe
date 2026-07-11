export const MISSION_TEMPLATE_IDS = [
  'boost-and-deliver',
  'getaway-run',
  'checkpoint-rush',
  'crew-holdout'
] as const;
export type MissionTemplateId = typeof MISSION_TEMPLATE_IDS[number];

export type MissionTargetMode = 'reserved-traffic-vehicle' | 'crew-members';
export type MissionRewardPolicy = 'vehicle-condition' | 'fixed';
export type MissionHostileWeapon = 'pistol' | 'smg';

export const MISSION_TARGET_MODES: readonly MissionTargetMode[] = Object.freeze([
  'reserved-traffic-vehicle',
  'crew-members'
]);
export const MISSION_REWARD_POLICIES: readonly MissionRewardPolicy[] = Object.freeze([
  'vehicle-condition',
  'fixed'
]);

export type MissionObjectiveKind =
  | 'acquire-vehicle'
  | 'vehicle-checkpoints'
  | 'crew-checkpoints'
  | 'hold-area'
  | 'clear-wanted'
  | 'deliver-vehicle';

export type ActiveMissionPhase = 'steal' | 'checkpoints' | 'hold' | 'lose-heat' | 'deliver';

export interface MissionObjectiveDefinition {
  id: string;
  kind: MissionObjectiveKind;
  phase: ActiveMissionPhase;
  checkpointCount?: number;
  durationMs?: number;
  maximumSpeed?: number;
  wantedGate?: boolean;
}

export interface MissionEncounterWaveDefinition {
  count: number;
  health: number;
  weapon: MissionHostileWeapon;
  fireCooldownMs: number;
}

export interface MissionEncounterDefinition {
  spawnMinDistance: number;
  spawnMaxDistance: number;
  spawnCadenceMs: number;
  interWaveDelayMs: number;
  waves: readonly MissionEncounterWaveDefinition[];
}

export interface MissionTemplateDefinition {
  id: MissionTemplateId;
  label: string;
  summary: string;
  baseReward: number;
  durationMs: number;
  formationDurationMs: number;
  maximumParticipants: number;
  targetMode: MissionTargetMode;
  rewardPolicy: MissionRewardPolicy;
  minimumContributionMs?: number;
  encounter?: MissionEncounterDefinition;
  objectives: readonly MissionObjectiveDefinition[];
}

export const DEFAULT_MISSION_TEMPLATE_ID: MissionTemplateId = 'boost-and-deliver';

export const MISSION_TEMPLATES: Readonly<Record<MissionTemplateId, MissionTemplateDefinition>> =
  Object.freeze({
    'boost-and-deliver': Object.freeze({
      id: 'boost-and-deliver',
      label: 'Boost and Deliver',
      summary: 'Steal a marked traffic vehicle, lose the heat, and deliver it intact.',
      baseReward: 750,
      durationMs: 180_000,
      formationDurationMs: 15_000,
      maximumParticipants: 4,
      targetMode: 'reserved-traffic-vehicle',
      rewardPolicy: 'vehicle-condition',
      objectives: Object.freeze([
        Object.freeze({id: 'acquire-target', kind: 'acquire-vehicle', phase: 'steal'}),
        Object.freeze({id: 'clear-heat', kind: 'clear-wanted', phase: 'lose-heat'}),
        Object.freeze({
          id: 'deliver-target',
          kind: 'deliver-vehicle',
          phase: 'deliver',
          maximumSpeed: 32,
          wantedGate: true
        })
      ])
    }),
    'getaway-run': Object.freeze({
      id: 'getaway-run',
      label: 'Getaway Run',
      summary: 'Take the marked car through the route, shake the police, and deliver it.',
      baseReward: 1_100,
      durationMs: 210_000,
      formationDurationMs: 15_000,
      maximumParticipants: 4,
      targetMode: 'reserved-traffic-vehicle',
      rewardPolicy: 'vehicle-condition',
      objectives: Object.freeze([
        Object.freeze({id: 'acquire-target', kind: 'acquire-vehicle', phase: 'steal'}),
        Object.freeze({
          id: 'run-checkpoints',
          kind: 'vehicle-checkpoints',
          phase: 'checkpoints',
          checkpointCount: 3
        }),
        Object.freeze({id: 'clear-heat', kind: 'clear-wanted', phase: 'lose-heat'}),
        Object.freeze({
          id: 'deliver-target',
          kind: 'deliver-vehicle',
          phase: 'deliver',
          maximumSpeed: 32,
          wantedGate: true
        })
      ])
    }),
    'checkpoint-rush': Object.freeze({
      id: 'checkpoint-rush',
      label: 'Crew Checkpoint Rush',
      summary: 'Get any crew vehicle through the shared checkpoint route before time runs out.',
      baseReward: 900,
      durationMs: 150_000,
      formationDurationMs: 15_000,
      maximumParticipants: 4,
      targetMode: 'crew-members',
      rewardPolicy: 'fixed',
      objectives: Object.freeze([
        Object.freeze({
          id: 'run-crew-route',
          kind: 'crew-checkpoints',
          phase: 'checkpoints',
          checkpointCount: 5
        })
      ])
    }),
    'crew-holdout': Object.freeze({
      id: 'crew-holdout',
      label: 'Crew Holdout',
      summary: 'Hold the marked block and clear three escalating waves of armed attackers.',
      baseReward: 1_200,
      durationMs: 180_000,
      formationDurationMs: 15_000,
      maximumParticipants: 4,
      targetMode: 'crew-members',
      rewardPolicy: 'fixed',
      minimumContributionMs: 5_000,
      encounter: Object.freeze({
        spawnMinDistance: 190,
        spawnMaxDistance: 310,
        spawnCadenceMs: 350,
        interWaveDelayMs: 1_600,
        waves: Object.freeze([
          Object.freeze({count: 2, health: 60, weapon: 'pistol', fireCooldownMs: 980}),
          Object.freeze({count: 3, health: 75, weapon: 'pistol', fireCooldownMs: 820}),
          Object.freeze({count: 4, health: 90, weapon: 'smg', fireCooldownMs: 680})
        ])
      }),
      objectives: Object.freeze([
        Object.freeze({
          id: 'defend-holdout',
          kind: 'hold-area',
          phase: 'hold',
          durationMs: 25_000
        })
      ])
    })
  });

export function isMissionTemplateId(value: unknown): value is MissionTemplateId {
  return typeof value === 'string' && MISSION_TEMPLATE_IDS.includes(value as MissionTemplateId);
}

export function missionTemplate(id: MissionTemplateId): MissionTemplateDefinition {
  return MISSION_TEMPLATES[id];
}

export function missionCheckpointCount(id: MissionTemplateId): number {
  return missionTemplate(id).objectives.reduce((maximum, objective) => (
    Math.max(maximum, Math.max(0, Math.floor(objective.checkpointCount ?? 0)))
  ), 0);
}

export function missionHoldDuration(id: MissionTemplateId): number {
  return missionTemplate(id).objectives.reduce((maximum, objective) => (
    objective.kind === 'hold-area'
      ? Math.max(maximum, Math.max(0, Math.floor(objective.durationMs ?? 0)))
      : maximum
  ), 0);
}

export function cycleMissionTemplate(id: MissionTemplateId, direction: -1 | 1): MissionTemplateId {
  const index = MISSION_TEMPLATE_IDS.indexOf(id);
  return MISSION_TEMPLATE_IDS[
    (index + direction + MISSION_TEMPLATE_IDS.length) % MISSION_TEMPLATE_IDS.length
  ];
}
