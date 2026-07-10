export type PedestrianObjective = 'wander' | 'flee' | 'pursue' | 'search';

export interface PedestrianRuntime {
  objective: PedestrianObjective;
  wanderAngle: number;
  nextThinkAt: number;
  lastShotAt: number;
  panicUntil: number;
  threatId: string;
  lastKnownThreatX: number;
  lastKnownThreatY: number;
  avoidAngle: number;
  avoidUntil: number;
  respawnAt: number;
}

export function createPedestrianRuntime(wanderAngle: number): PedestrianRuntime {
  return {
    objective: 'wander',
    wanderAngle,
    nextThinkAt: 0,
    lastShotAt: 0,
    panicUntil: 0,
    threatId: '',
    lastKnownThreatX: Number.NaN,
    lastKnownThreatY: Number.NaN,
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
