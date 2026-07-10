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
  cruisers: string;
  stimuli: number;
  signals: string;
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
    cruisers: policeVehicleSummary(snapshot),
    stimuli: snapshot?.stimuli?.length ?? 0,
    signals: trafficSignalSummary(snapshot),
    events: events.length > 0
      ? events.map((event) => `T${event.tick} ${event.summary}`)
      : ['No recent events']
  };
}

function trafficSignalSummary(snapshot?: DebugSnapshot): string {
  const signals = snapshot?.trafficSignals ?? [];
  if (signals.length === 0) return '0';
  const waiting = signals.reduce((sum, signal) => sum + signal.waitingVehicleIds.length, 0);
  return `${signals.length} / ${waiting} wait`;
}

function policeVehicleSummary(snapshot?: DebugSnapshot): string {
  const units = snapshot?.policeVehicles ?? [];
  if (units.length === 0) return '0';
  const active = units.filter((unit) => unit.strategy !== 'idle' && unit.strategy !== 'hijack');
  return active.length === 0
    ? `0/${units.length} idle`
    : `${active.length}/${units.length} ${active[0].strategy}`;
}
