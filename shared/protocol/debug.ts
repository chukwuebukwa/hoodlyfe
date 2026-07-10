export const DEBUG_SNAPSHOT_MESSAGE = 'debug.snapshot';

export interface DebugEventEntry {
  tick: number;
  type: string;
  summary: string;
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
  events: DebugEventEntry[];
}
