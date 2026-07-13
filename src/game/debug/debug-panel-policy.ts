import type {DebugSnapshot} from '../../../shared/protocol/debug.ts';
import type {DistrictNetworkState} from '../types.ts';
import type {NetworkQualitySnapshot} from '../network/network-quality-controller.ts';

export interface DebugPanelProjection {
  clock: string;
  players: number;
  npcs: number;
  vehicles: number;
  bullets: number;
  spatial: number;
  streaming: string;
  population: string;
  dropped: string;
  deferred: number;
  eventsThisTick: number;
  incidents: number;
  pursuits: number;
  cruisers: string;
  stimuli: number;
  signals: string;
  region: string;
  latency: string;
  patchGap: string;
  prediction: string;
  clockSync: string;
  interactionIsland: string;
  events: string[];
}

export function projectDebugPanel(
  state?: DistrictNetworkState,
  snapshot?: DebugSnapshot,
  network?: NetworkQualitySnapshot
): DebugPanelProjection {
  const events = snapshot?.events ?? [];
  return {
    clock: snapshot ? `T${snapshot.tick} / ${(snapshot.nowMs / 1000).toFixed(1)}s` : 'Waiting',
    players: snapshot?.players ?? state?.players?.size ?? 0,
    npcs: snapshot?.npcs ?? state?.npcs?.size ?? 0,
    vehicles: snapshot?.vehicles ?? state?.vehicles?.size ?? 0,
    bullets: snapshot?.bullets ?? state?.bullets?.size ?? 0,
    spatial: snapshot?.spatialEntities ?? 0,
    streaming: replicationSummary(snapshot),
    population: populationSummary(snapshot),
    dropped: `${Math.round(snapshot?.droppedMs ?? 0)}ms`,
    deferred: snapshot?.deferredCommands ?? 0,
    eventsThisTick: snapshot?.eventsThisTick ?? 0,
    incidents: snapshot?.incidents.length ?? 0,
    pursuits: snapshot?.pursuits.length ?? 0,
    cruisers: policeVehicleSummary(snapshot),
    stimuli: snapshot?.stimuli?.length ?? 0,
    signals: trafficSignalSummary(snapshot),
    region: network ? `${network.region} / ${network.buildId}` : 'unknown',
    latency: network
      ? `${network.rttMedianMs}/${network.rttP95Ms}ms +/-${network.jitterMs}`
      : '0/0ms',
    patchGap: network ? `${network.patchGapP95Ms}ms / T${network.serverTick}` : '0ms',
    prediction: network
      ? `${network.predictionError}px now / ${network.predictionErrorP95}px p95 / ` +
        `${network.predictionCorrections} corr / ${network.reconciliations} snap / ` +
        `V A${network.vehicleAcknowledgedMove} P${network.vehiclePendingMoves} ` +
        `R${network.vehicleResimulations} / F A${network.onFootAcknowledgedMove} ` +
        `P${network.onFootPendingMoves} R${network.onFootResimulations}`
      : '0px',
    clockSync: network
      ? `${network.clockOffsetMs}ms / ${Math.round(network.interpolationDelayMs)}ms buffer / ` +
        `${network.remoteSnapshotAgeP95Ms}ms age / ` +
        `${network.remoteBufferUnderrunPercent}% under / ` +
        `${network.remoteExtrapolationPercent}% extra`
      : 'unsynced',
    interactionIsland: network
      ? `${network.interactionIslandSize} bodies / ` +
        `${network.interactionIslandPoints}/${network.interactionIslandBudget} pts / ` +
        `${network.interactionIslandOverflow} (${network.interactionIslandOverflowPoints} pts) ` +
        `overflow / ${network.interactionIslandHorizonMs}ms horizon / ` +
        `${network.interactionSnapshotAgeTicks}t age / H${network.interactionHistoryFrames} / ` +
        `R${network.interactionReplayCount}:${network.interactionReplayTicks}t ` +
        `${network.interactionReplayDurationP95Ms}ms p95 / ` +
        `${network.interactionReplayHardResets} reset`
      : 'off',
    events: events.length > 0
      ? events.map((event) => `T${event.tick} ${event.summary}`)
      : ['No recent events']
  };
}

function populationSummary(snapshot?: DebugSnapshot): string {
  const population = snapshot?.populationStreaming;
  if (!population) return 'off';
  const active = population.activePedestrians + population.activeTraffic;
  const potential = population.potentialPedestrians + population.potentialTraffic;
  const pinned = population.pinnedPedestrians + population.pinnedTraffic;
  return `${active}/${potential}${pinned > 0 ? ` / ${pinned} pinned` : ''}`;
}

function replicationSummary(snapshot?: DebugSnapshot): string {
  const world = snapshot?.spatialEntities ?? 0;
  const views = snapshot?.replication ?? [];
  if (views.length === 0) return 'off';
  const visible = views.reduce((sum, entry) => sum + entry.visible, 0);
  const average = Math.round(visible / views.length);
  const pending = views.reduce((sum, entry) => sum + entry.pendingAdds + entry.pendingRemoves, 0);
  return `${average} avg / ${world} world${pending > 0 ? ` / ${pending} queued` : ''}`;
}

function trafficSignalSummary(snapshot?: DebugSnapshot): string {
  const signals = snapshot?.trafficSignals ?? [];
  if (signals.length === 0) return '0';
  const waiting = signals.reduce((sum, signal) => sum + signal.waitingVehicleIds.length, 0);
  return `${signals.length} / ${waiting} wait`;
}

function policeVehicleSummary(snapshot?: DebugSnapshot): string {
  const units = snapshot?.policeVehicles ?? [];
  const fleet = snapshot?.policeFleet;
  const fleetSummary = fleet
    ? `${fleet.availableUnits}/${fleet.desiredUnits} ready / ${fleet.managedUnits} dyn`
    : '';
  if (units.length === 0) return fleetSummary || '0';
  const active = units.filter((unit) => unit.strategy !== 'idle' && unit.strategy !== 'hijack');
  const activity = active.length === 0
    ? `0/${units.length} idle`
    : `${active.length}/${units.length} ${active[0].strategy}`;
  return fleetSummary ? `${activity} / ${fleetSummary}` : activity;
}
