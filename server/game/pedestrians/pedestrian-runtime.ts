import type {WorldStimulusKind} from '../world/world-stimulus-registry.ts';

export type PedestrianObjective =
  | 'wander'
  | 'startle'
  | 'flee'
  | 'investigate'
  | 'recover'
  | 'assault'
  | 'pursue'
  | 'contain'
  | 'search';

export type PedestrianReactionPhase = 'none' | 'orient' | 'respond' | 'recover';
export type PedestrianReactionResponse = 'flee' | 'investigate';

export interface PedestrianReactionRuntime {
  phase: PedestrianReactionPhase;
  cueId: string;
  cueKind: string;
  response: PedestrianReactionResponse;
  x: number;
  y: number;
  severity: number;
  radius: number;
  startedAt: number;
  phaseUntil: number;
  responseUntil: number;
  safeDistance: number;
  destinationX: number;
  destinationY: number;
}

export interface PedestrianNavigationRuntime {
  goalX: number;
  goalY: number;
  waypoints: Array<{x: number; y: number}>;
  waypointIndex: number;
  routeComplete: boolean;
  nextPathAt: number;
}

export type PedestrianMeleePhase = 'idle' | 'windup' | 'recovery';

export interface PedestrianMeleeRuntime {
  phase: PedestrianMeleePhase;
  targetId: string;
  startedAt: number;
  impactAt: number;
  endsAt: number;
  cooldownUntil: number;
  contactApplied: boolean;
}

export interface PedestrianRuntime {
  lifecycle: 'ambient' | 'mission';
  objective: PedestrianObjective;
  bravery: number;
  wanderAngle: number;
  nextThinkAt: number;
  nextPerceptionAt: number;
  lastShotAt: number;
  combatTargetId: string;
  combatWeapon: 'pistol' | 'smg';
  combatFireCooldownMs: number;
  panicUntil: number;
  threatId: string;
  lastKnownThreatX: number;
  lastKnownThreatY: number;
  stimulusId: string;
  stimulusKind: WorldStimulusKind | '';
  stimulusSourceId: string;
  stimulusX: number;
  stimulusY: number;
  stimulusSeverity: number;
  stimulusRadius: number;
  stimulusUntil: number;
  reaction: PedestrianReactionRuntime;
  navigation: PedestrianNavigationRuntime;
  melee: PedestrianMeleeRuntime;
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
    lifecycle: 'ambient',
    objective: 'wander',
    bravery,
    wanderAngle,
    nextThinkAt: 0,
    nextPerceptionAt,
    lastShotAt: 0,
    combatTargetId: '',
    combatWeapon: 'pistol',
    combatFireCooldownMs: 900,
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
    stimulusRadius: 0,
    stimulusUntil: 0,
    reaction: createPedestrianReactionRuntime(),
    navigation: createPedestrianNavigationRuntime(),
    melee: createPedestrianMeleeRuntime(),
    avoidAngle: 0,
    avoidUntil: 0,
    respawnAt: 0
  };
}

export function createPedestrianMeleeRuntime(): PedestrianMeleeRuntime {
  return {
    phase: 'idle',
    targetId: '',
    startedAt: 0,
    impactAt: 0,
    endsAt: 0,
    cooldownUntil: 0,
    contactApplied: false
  };
}

export function createPedestrianReactionRuntime(): PedestrianReactionRuntime {
  return {
    phase: 'none',
    cueId: '',
    cueKind: '',
    response: 'flee',
    x: Number.NaN,
    y: Number.NaN,
    severity: 0,
    radius: 0,
    startedAt: 0,
    phaseUntil: 0,
    responseUntil: 0,
    safeDistance: 0,
    destinationX: Number.NaN,
    destinationY: Number.NaN
  };
}

export function createPedestrianNavigationRuntime(): PedestrianNavigationRuntime {
  return {
    goalX: Number.NaN,
    goalY: Number.NaN,
    waypoints: [],
    waypointIndex: 0,
    routeComplete: false,
    nextPathAt: 0
  };
}

export function clearPedestrianNavigation(runtime: PedestrianRuntime): void {
  runtime.navigation = createPedestrianNavigationRuntime();
}

export function clearPedestrianMelee(runtime: PedestrianRuntime): void {
  runtime.melee = createPedestrianMeleeRuntime();
}

export function clearPedestrianReaction(runtime: PedestrianRuntime): void {
  runtime.reaction = createPedestrianReactionRuntime();
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
  runtime.stimulusRadius = 0;
  runtime.stimulusUntil = 0;
}
