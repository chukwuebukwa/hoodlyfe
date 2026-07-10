export const DEBUG_SNAPSHOT_MESSAGE = 'debug.snapshot';
export const DEBUG_SUBSCRIBE_MESSAGE = 'debug.subscribe';
export const DEBUG_UNSUBSCRIBE_MESSAGE = 'debug.unsubscribe';

export interface DebugEventEntry {
  tick: number;
  type: string;
  summary: string;
}

export interface DebugIncidentEntry {
  id: string;
  kind: string;
  suspectId: string;
  witnessId: string;
  status: 'unreported' | 'scheduled' | 'reported';
  x: number;
  y: number;
}

export interface DebugPursuitEntry {
  officerId: string;
  suspectId: string;
  lastKnownX: number;
  lastKnownY: number;
  mode: 'pursuit' | 'search';
}

export interface DebugPedestrianAiEntry {
  id: string;
  objective: string;
  bravery: number;
  threatId: string;
  panicUntil: number;
  stimulusKind: string;
  stimulusSourceId: string;
  stimulusUntil: number;
  reactionPhase: string;
  navigationGoalX: number;
  navigationGoalY: number;
  waypointIndex: number;
  waypoints: Array<{x: number; y: number}>;
}

export interface DebugStimulusEntry {
  id: string;
  kind: string;
  sourceId: string;
  subjectId: string;
  x: number;
  y: number;
  severity: number;
  radius: number;
  occurredAt: number;
  expiresAt: number;
}

export interface DebugTrafficAiEntry {
  vehicleId: string;
  cruiseSpeed: number;
  desiredSpeed: number;
  speedReason: 'cruise' | 'vehicle' | 'pedestrian' | 'blocked' | 'hijack';
  obstacleId: string;
  obstacleDistance: number;
  blockedSince: number;
  recoveryCount: number;
}

export interface DebugSnapshot {
  tick: number;
  nowMs: number;
  droppedMs: number;
  spatialEntities: number;
  deferredCommands: number;
  eventsThisTick: number;
  players: number;
  npcs: number;
  vehicles: number;
  bullets: number;
  incidents: DebugIncidentEntry[];
  pursuits: DebugPursuitEntry[];
  pedestrianAi?: DebugPedestrianAiEntry[];
  stimuli?: DebugStimulusEntry[];
  trafficAi?: DebugTrafficAiEntry[];
  events: DebugEventEntry[];
}
