import type {DebugSnapshot} from '../../../shared/protocol/debug.ts';
import type {DistrictNetworkState} from '../types.ts';
import type {NetworkQualitySnapshot} from '../network/network-quality-controller.ts';
import type {InteractionIslandSelection} from '../prediction/interaction-island-selector.ts';
import type {NetcodeRolloutSnapshot} from '../network/netcode-rollout-controller.ts';
import {interactionIslandSelectionSummary} from './interaction-island-debug-policy.ts';

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
  response: string;
  stimuli: number;
  signals: string;
  junctions: string;
  trafficRisk: string;
  roads: string;
  region: string;
  latency: string;
  patchGap: string;
  prediction: string;
  clockSync: string;
  rollout: string;
  interactionIsland: string;
  interactionReplay: string;
  interactionSelection: string;
  simulationPhases: string;
  events: string[];
}

export function projectDebugPanel(
  state?: DistrictNetworkState,
  snapshot?: DebugSnapshot,
  network?: NetworkQualitySnapshot,
  interactionIsland?: InteractionIslandSelection,
  rollout?: NetcodeRolloutSnapshot
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
    response: policeResponseSummary(snapshot),
    stimuli: snapshot?.stimuli?.length ?? 0,
    signals: trafficSignalSummary(snapshot),
    junctions: trafficJunctionSummary(snapshot),
    trafficRisk: trafficRiskSummary(snapshot),
    roads: trafficLaneGraphSummary(snapshot),
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
    rollout: rolloutSummary(rollout),
    interactionIsland: network
      ? `${network.interactionIslandSize} bodies / ` +
        `${network.interactionIslandPoints}/${network.interactionIslandBudget} pts / ` +
        `${network.interactionIslandOverflow} (${network.interactionIslandOverflowPoints} pts) ` +
        `overflow / ${network.interactionIslandHorizonMs}ms horizon`
      : 'off',
    interactionReplay: network
      ? `${network.interactionSnapshotAgeTicks}t snapshot age / ` +
        `H${network.interactionHistoryFrames} history / ` +
        `R${network.interactionReplayCount}:${network.interactionReplayTicks}t ` +
        `${network.interactionReplayDurationP95Ms}ms p95 / ` +
        `${network.interactionReplayPairSteps} pairs / ` +
        `${network.interactionReplaySuppressedEffects} suppressed / ` +
        `${network.interactionReplayHardResets} reset`
      : 'off',
    interactionSelection: interactionIslandSelectionSummary(interactionIsland),
    simulationPhases: simulationPhaseSummary(snapshot),
    events: events.length > 0
      ? events.map((event) => `T${event.tick} ${event.summary}`)
      : ['No recent events']
  };
}

function simulationPhaseSummary(snapshot?: DebugSnapshot): string {
  const phases = snapshot?.simulationPhases ?? [];
  if (phases.length === 0) return 'off';
  const totalMs = phases.reduce((sum, phase) => sum + phase.lastDurationMs, 0);
  const failures = phases.reduce((sum, phase) => sum + phase.failures, 0);
  const slowest = [...phases].sort((left, right) => (
    right.lastDurationMs - left.lastDurationMs || left.order - right.order
  ))[0];
  return `${phases.length} phases / ${totalMs.toFixed(2)}ms / ` +
    `${slowest.id} ${slowest.lastDurationMs.toFixed(2)}ms / ${failures} fail`;
}

function rolloutSummary(rollout?: NetcodeRolloutSnapshot): string {
  if (!rollout) return 'unavailable';
  const enabled = Object.entries(rollout.manifest.stages)
    .filter(([, value]) => value)
    .map(([key]) => ROLLOUT_STAGE_LABELS[key] ?? key);
  const detail = rollout.rejectionReason ? ` / ${rollout.rejectionReason}` : '';
  return `${rollout.source} / ${rollout.manifest.revision} / ` +
    `${enabled.length > 0 ? enabled.join(',') : 'kernel-only'}${detail}`;
}

const ROLLOUT_STAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  remoteTimelines: 'timeline',
  interactionSnapshots: 'snapshot',
  interactionReplay: 'island',
  combatRewind: 'rewind',
  projectilePrediction: 'projectile'
});

function populationSummary(snapshot?: DebugSnapshot): string {
  const population = snapshot?.populationStreaming;
  if (!population) return 'off';
  const active = population.activePedestrians + population.activeTraffic;
  const potential = population.potentialPedestrians + population.potentialTraffic;
  const pinned = population.pinnedPedestrians + population.pinnedTraffic;
  return `${active}/${potential} / ${population.hotActors} hot / ${population.warmActors} warm` +
    ` / ${population.dormantActors} cold` +
    ` / ${population.interestClusters} clusters` +
    `${population.lookaheadAnchors > 0 ? ` / ${population.lookaheadAnchors} lookahead` : ''}` +
    `${population.quotaPressureClusters > 0 ? ` / ${population.quotaPressureClusters} quota pressure` : ''}` +
    `${population.quotaRebalances > 0 ? ` / ${population.quotaRebalances} rebalanced` : ''}` +
    `${population.deferredVisibleActors > 0 ? ` / ${population.deferredVisibleActors} pop guarded` : ''}` +
    `${pinned > 0 ? ` / ${pinned} pinned` : ''}` +
    `${population.jamRetirements > 0 ? ` / ${population.jamRetirements} jam retired` : ''}`;
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

function trafficJunctionSummary(snapshot?: DebugSnapshot): string {
  const traffic = snapshot?.trafficAi ?? [];
  const waiting = traffic.filter((entry) => entry.junctionPhase === 'waiting').length;
  const approach = traffic.filter((entry) => entry.junctionPhase === 'approach').length;
  const crossing = traffic.filter((entry) => entry.junctionPhase === 'crossing').length;
  const clearing = traffic.filter((entry) => entry.junctionPhase === 'clearing').length;
  const cycles = new Set(traffic
    .filter((entry) => entry.deadlockCycleId)
    .map((entry) => entry.deadlockCycleId)).size;
  const recovering = traffic.filter((entry) => entry.deadlockRecovering).length;
  const active = waiting + approach + crossing + clearing;
  return `${active} active / ${waiting} wait / ${approach} approach / ` +
    `${crossing} cross / ${clearing} clear / ${cycles} cycle / ${recovering} recover`;
}

function trafficRiskSummary(snapshot?: DebugSnapshot): string {
  const predicted = (snapshot?.trafficAi ?? []).filter((entry) => entry.timeToContactSeconds >= 0);
  if (predicted.length === 0) return 'clear';
  const minimum = Math.min(...predicted.map((entry) => entry.timeToContactSeconds));
  const urgent = predicted.filter((entry) => entry.timeToContactSeconds < 0.75).length;
  return `${predicted.length} predicted / ${urgent} urgent / ${Math.round(minimum * 1000)}ms min`;
}

function trafficLaneGraphSummary(snapshot?: DebugSnapshot): string {
  const graph = snapshot?.trafficLaneGraph;
  if (!graph) return 'off';
  const routed = (snapshot?.trafficAi ?? []).filter((entry) => entry.routeSource === 'lane-graph');
  const incomplete = routed.filter((entry) => !entry.routeComplete).length;
  const replans = routed.reduce((sum, entry) => sum + Math.max(0, entry.routeRevision - 1), 0);
  return `v${graph.schemaVersion} / ${graph.nodes.length} nodes / ${graph.edges.length} edges / ` +
    `${routed.length} routed / ${incomplete} partial / ${replans} replans`;
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

function policeResponseSummary(snapshot?: DebugSnapshot): string {
  const response = snapshot?.policeResponse;
  if (!response) return 'off';
  return `${response.usedResponsePoints}/${response.maxResponsePoints} pts / ` +
    `F${response.assignedFootUnits}/${response.maxFootUnits} / ` +
    `V${response.assignedVehicleUnits}/${response.maxVehicleUnits} / ` +
    `${response.demands.length} suspects / ${response.suppressedPairs} suppressed`;
}
