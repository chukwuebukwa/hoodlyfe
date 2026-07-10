import type {PedestrianStimulusKind} from './pedestrian-stimulus-registry.ts';

export type PedestrianObjective = 'wander' | 'flee' | 'investigate' | 'pursue' | 'search';

export interface PedestrianRuntime {
  objective: PedestrianObjective;
  bravery: number;
  wanderAngle: number;
  nextThinkAt: number;
  nextPerceptionAt: number;
  lastShotAt: number;
  panicUntil: number;
  threatId: string;
  lastKnownThreatX: number;
  lastKnownThreatY: number;
  stimulusId: string;
  stimulusKind: PedestrianStimulusKind | '';
  stimulusSourceId: string;
  stimulusX: number;
  stimulusY: number;
  stimulusSeverity: number;
  stimulusUntil: number;
  avoidAngle: number;
  avoidUntil: number;
  respawnAt: number;
}

export function createPedestrianRuntime(
  wanderAngle: number,
  bravery = 0.45,
  nextPerceptionAt = 0
): PedestrianRuntime {
  return {
    objective: 'wander',
    bravery,
    wanderAngle,
    nextThinkAt: 0,
    nextPerceptionAt,
    lastShotAt: 0,
    panicUntil: 0,
    threatId: '',
    lastKnownThreatX: Number.NaN,
    lastKnownThreatY: Number.NaN,
    stimulusId: '',
    stimulusKind: '',
    stimulusSourceId: '',
    stimulusX: Number.NaN,
    stimulusY: Number.NaN,
    stimulusSeverity: 0,
    stimulusUntil: 0,
    avoidAngle: 0,
    avoidUntil: 0,
    respawnAt: 0
  };
}

export function clearPedestrianThreat(runtime: PedestrianRuntime): void {
  runtime.panicUntil = 0;
  runtime.threatId = '';
  runtime.lastKnownThreatX = Number.NaN;
  runtime.lastKnownThreatY = Number.NaN;
}

export function clearPedestrianStimulus(runtime: PedestrianRuntime): void {
  runtime.stimulusId = '';
  runtime.stimulusKind = '';
  runtime.stimulusSourceId = '';
  runtime.stimulusX = Number.NaN;
  runtime.stimulusY = Number.NaN;
  runtime.stimulusSeverity = 0;
  runtime.stimulusUntil = 0;
}
