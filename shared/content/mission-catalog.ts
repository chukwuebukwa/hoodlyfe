export const MISSION_TEMPLATE_IDS = [
  'boost-and-deliver',
  'getaway-run',
  'checkpoint-rush',
  'crew-holdout',
  'most-wanted'
] as const;
export type MissionTemplateId = typeof MISSION_TEMPLATE_IDS[number];

export type MissionTargetMode = 'reserved-traffic-vehicle' | 'crew-members';
export type MissionRewardPolicy = 'vehicle-condition' | 'fixed';
export type MissionHostileWeapon = 'pistol' | 'smg';
export type MissionEncounterRole = 'guard' | 'target';

export interface MissionContactDefinition {
  id: string;
  templateId: MissionTemplateId;
  letter: string;
  color: number;
  x: number;
  y: number;
}

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
  | 'eliminate-target'
  | 'clear-wanted'
  | 'deliver-vehicle';

export type ActiveMissionPhase = 'steal' | 'checkpoints' | 'hold' | 'eliminate' | 'lose-heat' | 'deliver';

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
  additionalPerParticipant?: number;
  role?: MissionEncounterRole;
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
  contact: MissionContactDefinition;
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
export const MISSION_CONTACT_RADIUS = 130;

export const MISSION_TEMPLATES: Readonly<Record<MissionTemplateId, MissionTemplateDefinition>> =
  Object.freeze({
    'boost-and-deliver': Object.freeze({
      id: 'boost-and-deliver',
      label: 'Boost and Deliver',
      summary: 'Steal a marked traffic vehicle, lose the heat, and deliver it intact.',
      contact: Object.freeze({
        id: 'mission-contact:boost-and-deliver',
        templateId: 'boost-and-deliver',
        letter: 'B',
        color: 0xff9d3f,
        x: 8372,
        y: 8371
      }),
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
      contact: Object.freeze({
        id: 'mission-contact:getaway-run',
        templateId: 'getaway-run',
        letter: 'G',
        color: 0x55d6ff,
        x: 2592,
        y: 9312
      }),
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
      contact: Object.freeze({
        id: 'mission-contact:checkpoint-rush',
        templateId: 'checkpoint-rush',
        letter: 'R',
        color: 0xf6c945,
        x: 12448,
        y: 6368
      }),
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
      contact: Object.freeze({
        id: 'mission-contact:crew-holdout',
        templateId: 'crew-holdout',
        letter: 'H',
        color: 0xff5e4d,
        x: 8376,
        y: 8984
      }),
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
    }),
    'most-wanted': Object.freeze({
      id: 'most-wanted',
      label: 'Most Wanted',
      summary: 'Raid a guarded hideout and eliminate the marked crime boss.',
      contact: Object.freeze({
        id: 'mission-contact:most-wanted',
        templateId: 'most-wanted',
        letter: 'M',
        color: 0xd979ff,
        x: 13088,
        y: 13600
      }),
      baseReward: 1_500,
      durationMs: 180_000,
      formationDurationMs: 15_000,
      maximumParticipants: 4,
      targetMode: 'crew-members',
      rewardPolicy: 'fixed',
      encounter: Object.freeze({
        spawnMinDistance: 120,
        spawnMaxDistance: 230,
        spawnCadenceMs: 300,
        interWaveDelayMs: 1_800,
        waves: Object.freeze([
          Object.freeze({
            count: 2,
            additionalPerParticipant: 1,
            role: 'guard',
            health: 85,
            weapon: 'pistol',
            fireCooldownMs: 780
          }),
          Object.freeze({
            count: 1,
            role: 'target',
            health: 220,
            weapon: 'smg',
            fireCooldownMs: 560
          })
        ])
      }),
      objectives: Object.freeze([
        Object.freeze({
          id: 'eliminate-boss',
          kind: 'eliminate-target',
          phase: 'eliminate'
        })
      ])
    })
  });

export const MISSION_CONTACTS: readonly MissionContactDefinition[] = Object.freeze(
  MISSION_TEMPLATE_IDS.map((templateId) => MISSION_TEMPLATES[templateId].contact)
);

export function isMissionTemplateId(value: unknown): value is MissionTemplateId {
  return typeof value === 'string' && MISSION_TEMPLATE_IDS.includes(value as MissionTemplateId);
}

export function missionTemplate(id: MissionTemplateId): MissionTemplateDefinition {
  return MISSION_TEMPLATES[id];
}

export function missionContact(id: MissionTemplateId): MissionContactDefinition {
  return missionTemplate(id).contact;
}

export function missionContactNear(
  x: number,
  y: number,
  radius = MISSION_CONTACT_RADIUS
): MissionContactDefinition | undefined {
  let nearest: MissionContactDefinition | undefined;
  let nearestDistance = Math.max(0, radius);
  for (const contact of MISSION_CONTACTS) {
    const distance = Math.hypot(contact.x - x, contact.y - y);
    if (distance > nearestDistance) continue;
    nearest = contact;
    nearestDistance = distance;
  }
  return nearest;
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
