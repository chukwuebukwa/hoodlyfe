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
  events: DebugEventEntry[];
}
