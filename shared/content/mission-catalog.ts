export const MISSION_TEMPLATE_IDS = ['boost-and-deliver', 'getaway-run'] as const;
export type MissionTemplateId = typeof MISSION_TEMPLATE_IDS[number];

export type MissionObjectiveKind =
  | 'acquire-vehicle'
  | 'vehicle-checkpoints'
  | 'clear-wanted'
  | 'deliver-vehicle';

export type ActiveMissionPhase = 'steal' | 'checkpoints' | 'lose-heat' | 'deliver';

export interface MissionObjectiveDefinition {
  id: string;
  kind: MissionObjectiveKind;
  phase: ActiveMissionPhase;
  checkpointCount?: number;
  maximumSpeed?: number;
  wantedGate?: boolean;
}

export interface MissionTemplateDefinition {
  id: MissionTemplateId;
  label: string;
  summary: string;
  baseReward: number;
  durationMs: number;
  formationDurationMs: number;
  maximumParticipants: number;
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

export function cycleMissionTemplate(id: MissionTemplateId, direction: -1 | 1): MissionTemplateId {
  const index = MISSION_TEMPLATE_IDS.indexOf(id);
  return MISSION_TEMPLATE_IDS[
    (index + direction + MISSION_TEMPLATE_IDS.length) % MISSION_TEMPLATE_IDS.length
  ];
}
