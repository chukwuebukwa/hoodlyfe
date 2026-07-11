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
  combatTargetId?: string;
  panicUntil: number;
  stimulusKind: string;
  stimulusSourceId: string;
  stimulusUntil: number;
  reactionPhase: string;
  meleePhase?: string;
  meleeTargetId?: string;
  meleeCooldownUntil?: number;
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
  speedReason: 'cruise' | 'vehicle' | 'pedestrian' | 'signal' | 'siren' | 'blocked' | 'hijack';
  obstacleId: string;
  obstacleDistance: number;
  blockedSince: number;
  recoveryCount: number;
  maneuverPhase: 'none' | 'reverse' | 'pass-left' | 'pass-right' | 'merge';
  maneuverAttempts: number;
  emergencyYieldPhase: 'none' | 'yield-left' | 'yield-right' | 'wait';
  emergencyVehicleId: string;
}

export interface DebugTrafficSignalEntry {
  id: string;
  northSouth: string;
  eastWest: string;
  nextChangeAt: number;
  waitingVehicleIds: string[];
}

export interface DebugPoliceVehicleEntry {
  vehicleId: string;
  suspectId: string;
  strategy: 'idle' | 'hijack' | 'search' | 'pursuit' | 'intercept' | 'ram' | 'route-failed';
  canSeeTarget: boolean;
  lastKnownX: number;
  lastKnownY: number;
  desiredSpeed: number;
  speedReason: string;
  obstacleId: string;
  routeComplete: boolean;
  routeVisited: number;
  waypointIndex: number;
  waypoints: Array<{x: number; y: number}>;
}

export interface DebugReplicationEntry {
  playerId: string;
  spaceId: string;
  visible: number;
  nearbyActors: number;
  pendingAdds: number;
  pendingRemoves: number;
}

export interface DebugPopulationStreamingEntry {
  potentialPedestrians: number;
  activePedestrians: number;
  potentialTraffic: number;
  activeTraffic: number;
  pinnedPedestrians: number;
  pinnedTraffic: number;
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
  trafficSignals?: DebugTrafficSignalEntry[];
  policeVehicles?: DebugPoliceVehicleEntry[];
  replication?: DebugReplicationEntry[];
  populationStreaming?: DebugPopulationStreamingEntry;
  events: DebugEventEntry[];
}
