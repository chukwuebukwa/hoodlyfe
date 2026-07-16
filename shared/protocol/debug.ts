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
  sourceKind: string;
  subjectId: string;
  subjectKind: string;
  actorId: string;
  actorKind: string;
  spaceId: string;
  x: number;
  y: number;
  intensity: number;
  radius: number;
  channels: string[];
  provenance: string;
  occurredAt: number;
  expiresAt: number;
}

export interface DebugSimulationPhaseEntry {
  id: string;
  order: number;
  runs: number;
  lastTick: number;
  lastDurationMs: number;
  maxDurationMs: number;
  failures: number;
}

export interface DebugTrafficAiEntry {
  vehicleId: string;
  mission: 'cruise-route';
  drivingStyle: 'lawful';
  cruiseSpeed: number;
  desiredSpeed: number;
  speedReason: 'cruise' | 'vehicle' | 'pedestrian' | 'signal' | 'siren' | 'blocked' | 'hijack';
  obstacleId: string;
  obstacleDistance: number;
  timeToContactSeconds: number;
  blockedSince: number;
  recoveryCount: number;
  deadlockCycleId: string;
  deadlockCycleSize: number;
  deadlockRecovering: boolean;
  deadlockRecoveryCount: number;
  maneuverPhase: 'none' | 'reverse' | 'pass-left' | 'pass-right' | 'merge';
  maneuverAttempts: number;
  emergencyYieldPhase: 'none' | 'yield-left' | 'yield-right' | 'wait';
  emergencyVehicleId: string;
  junctionId: string;
  junctionPhase: 'none' | 'waiting' | 'approach' | 'crossing' | 'clearing';
  junctionQueuePosition: number;
  junctionLeaseExpiresAt: number;
  routeSource: 'lane-graph' | 'road-cell-fallback';
  currentLaneNodeId: string;
  destinationLaneNodeId: string;
  routeRemaining: number;
  routeRevision: number;
  routeComplete: boolean;
  routeVisited: number;
  routeWaypoints: Array<{x: number; y: number}>;
}

export interface DebugTrafficLaneNodeEntry {
  id: string;
  x: number;
  y: number;
  junctionId: string;
}

export interface DebugTrafficLaneEdgeEntry {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: 'lane' | 'connector' | 'turnaround';
  turn: 'none' | 'left' | 'right' | 'straight' | 'uturn';
  speedLimit: number;
  junctionId: string;
}

export interface DebugTrafficLaneGraphEntry {
  schemaVersion: number;
  districtId: string;
  nodes: DebugTrafficLaneNodeEntry[];
  edges: DebugTrafficLaneEdgeEntry[];
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

export interface DebugPoliceFleetEntry {
  desiredUnits: number;
  availableUnits: number;
  managedUnits: number;
  nextSpawnAt: number;
  targetSuspectId: string;
  demandedSuspects: number;
}

export interface DebugPoliceResponseAssignmentEntry {
  unitId: string;
  unitKind: 'foot' | 'vehicle';
  suspectId: string;
  reportAt: number;
  assignedAt: number;
  distance: number;
}

export interface DebugPoliceResponseDemandEntry {
  suspectId: string;
  wantedLevel: number;
  desiredFoot: number;
  assignedFoot: number;
  desiredVehicles: number;
  assignedVehicles: number;
}

export interface DebugPoliceResponseChangeEntry {
  unitId: string;
  unitKind: 'foot' | 'vehicle';
  previousSuspectId: string;
  suspectId: string;
  reason: string;
}

export interface DebugPoliceResponseEntry {
  maxResponsePoints: number;
  usedResponsePoints: number;
  maxFootUnits: number;
  maxVehicleUnits: number;
  assignedFootUnits: number;
  assignedVehicleUnits: number;
  suppressedPairs: number;
  demands: DebugPoliceResponseDemandEntry[];
  assignments: DebugPoliceResponseAssignmentEntry[];
  lastChanges: DebugPoliceResponseChangeEntry[];
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
  jamRetirements: number;
  hotActors: number;
  warmActors: number;
  dormantActors: number;
  deferredVisibleActors: number;
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
  trafficLaneGraph?: DebugTrafficLaneGraphEntry;
  trafficSignals?: DebugTrafficSignalEntry[];
  policeVehicles?: DebugPoliceVehicleEntry[];
  policeFleet?: DebugPoliceFleetEntry;
  policeResponse?: DebugPoliceResponseEntry;
  replication?: DebugReplicationEntry[];
  populationStreaming?: DebugPopulationStreamingEntry;
  simulationPhases?: DebugSimulationPhaseEntry[];
  events: DebugEventEntry[];
}
