import type {DebugSnapshot} from '../../../shared/protocol/debug.ts';
import type {DistrictNetworkState} from '../types.ts';

export interface DebugPanelProjection {
  clock: string;
  players: number;
  npcs: number;
  vehicles: number;
  bullets: number;
  spatial: number;
  dropped: string;
  deferred: number;
  eventsThisTick: number;
  incidents: number;
  pursuits: number;
  events: string[];
}

export function projectDebugPanel(
  state?: DistrictNetworkState,
  snapshot?: DebugSnapshot
): DebugPanelProjection {
  const events = snapshot?.events ?? [];
  return {
    clock: snapshot ? `T${snapshot.tick} / ${(snapshot.nowMs / 1000).toFixed(1)}s` : 'Waiting',
    players: snapshot?.players ?? state?.players?.size ?? 0,
    npcs: snapshot?.npcs ?? state?.npcs?.size ?? 0,
    vehicles: snapshot?.vehicles ?? state?.vehicles?.size ?? 0,
    bullets: snapshot?.bullets ?? state?.bullets?.size ?? 0,
    spatial: snapshot?.spatialEntities ?? 0,
    dropped: `${Math.round(snapshot?.droppedMs ?? 0)}ms`,
    deferred: snapshot?.deferredCommands ?? 0,
    eventsThisTick: snapshot?.eventsThisTick ?? 0,
    incidents: snapshot?.incidents.length ?? 0,
    pursuits: snapshot?.pursuits.length ?? 0,
    events: events.length > 0
      ? events.map((event) => `T${event.tick} ${event.summary}`)
      : ['No recent events']
  };
}
