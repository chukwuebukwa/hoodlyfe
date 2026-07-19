import assert from 'node:assert/strict';
import test from 'node:test';
import type {DebugSnapshot} from '../shared/protocol/debug.ts';
import {projectDebugPanel} from '../src/game/debug/debug-panel-policy.ts';
import type {DistrictNetworkState} from '../src/game/types.ts';

test('debug panel uses replicated collection counts while waiting for a snapshot', () => {
  const state = createState();
  const panel = projectDebugPanel(state);
  assert.equal(panel.clock, 'Waiting');
  assert.equal(panel.players, 1);
  assert.equal(panel.vehicles, 1);
  assert.equal(panel.spatial, 0);
  assert.equal(panel.streaming, 'off');
  assert.equal(panel.population, 'off');
  assert.deepEqual(panel.events, ['No recent events']);
});

test('debug panel projects authoritative counters and bounded event summaries', () => {
  const panel = projectDebugPanel(createState(), createSnapshot());
  assert.deepEqual(panel, {
    clock: 'T42 / 1.4s',
    players: 4,
    npcs: 13,
    vehicles: 11,
    bullets: 2,
    spatial: 28,
    streaming: 'off',
    population: 'off',
    dropped: '3ms',
    deferred: 1,
    eventsThisTick: 2,
    incidents: 1,
    pursuits: 1,
    cruisers: '1/1 pursuit / 1/2 ready / 1 dyn',
    response: '5/11 pts / F3/5 / V1/3 / 1 suspects / 0 suppressed',
    arrests: '0 active',
    roadblocks: '0 active',
    stingers: '0 active',
    stimuli: 0,
    signals: '0',
    junctions: '0 active / 0 wait / 0 approach / 0 cross / 0 clear / 0 cycle / 0 recover / 0 shared / 0 conflict / 0 lane / 0 request / 0 pass',
    trafficRisk: 'clear',
    roads: 'off',
    region: 'unknown',
    latency: '0/0ms',
    patchGap: '0ms',
    prediction: '0px',
    clockSync: 'unsynced',
    rollout: 'unavailable',
    interactionIsland: 'off',
    interactionReplay: 'off',
    interactionSelection: 'off',
    playerReaction: 'off',
    simulationPhases: 'off',
    events: ['T41 driver committed vehicle-theft']
  });
});

test('debug panel exposes the local player reaction state', () => {
  const state = createState();
  state.players.set('driver', {
    action: 'hit',
    reactionKind: 'stagger',
    reactionDirection: 'left',
    reactionProgress: 0.35,
    health: 72,
    armor: 8
  } as never);

  assert.equal(
    projectDebugPanel(state, undefined, undefined, undefined, undefined, 'driver').playerReaction,
    'hit / stagger left 35% / HP 72 / armor 8'
  );
});

test('debug panel summarizes server-owned police tactical roles', () => {
  const snapshot = createSnapshot();
  snapshot.policeTactics = [
    {
      unitId: 'police-1',
      unitKind: 'foot',
      suspectId: 'driver',
      role: 'primary',
      phase: 'pursue',
      goalX: 10,
      goalY: 20
    },
    {
      unitId: 'police-2',
      unitKind: 'foot',
      suspectId: 'driver',
      role: 'contain-left',
      phase: 'contain',
      goalX: 10,
      goalY: 125
    },
    {
      unitId: 'vehicle-2',
      unitKind: 'vehicle',
      suspectId: 'driver',
      role: 'intercept-left',
      phase: 'intercept',
      goalX: 120,
      goalY: 98
    }
  ];

  assert.equal(
    projectDebugPanel(createState(), snapshot).response,
    '5/11 pts / F3/5 / V1/3 / 1 suspects / 0 suppressed / T1 primary C1 I1 S0'
  );
});

test('debug panel exposes active custody ownership and remaining secure time', () => {
  const snapshot = createSnapshot();
  snapshot.nowMs = 1000;
  snapshot.policeArrests = [{
    arrestId: 'arrest:driver:42',
    officerId: 'police-1',
    suspectId: 'driver',
    phase: 'securing',
    startedAt: 800,
    completesAt: 3300,
    wantedLevel: 2,
    officerX: 10,
    officerY: 20,
    suspectX: 35,
    suspectY: 20
  }];
  assert.equal(projectDebugPanel(createState(), snapshot).arrests, (
    '1 active / police-1 -> driver / 2.3s'
  ));
});

test('debug panel exposes roadblock lifecycle and closed-edge pressure', () => {
  const snapshot = createSnapshot();
  snapshot.policeRoadblocks = [{
    roadblockId: 'roadblock-1',
    slotId: 'central-avenue-mid',
    suspectId: 'driver',
    phase: 'deployed',
    x: 2336,
    y: 1700,
    angle: Math.PI / 2,
    reservedAt: 800,
    deployedAt: 1000,
    vehicleIds: ['barrier-1', 'barrier-2'],
    blockedEdgeIds: ['edge-a', 'edge-b'],
    clearReason: ''
  }, {
    roadblockId: 'roadblock-2',
    slotId: 'south-boulevard-east',
    suspectId: 'driver-2',
    phase: 'clearing',
    x: 3000,
    y: 3488,
    angle: 0,
    reservedAt: 1200,
    deployedAt: 0,
    vehicleIds: [],
    blockedEdgeIds: ['edge-b', 'edge-c'],
    clearReason: ''
  }];

  assert.equal(
    projectDebugPanel(createState(), snapshot).roadblocks,
    '2 active / C1 D1 R0 / 3 edges / 2 vehicles'
  );
});

test('debug panel exposes stinger deployment, segment, and tyre contact state', () => {
  const snapshot = createSnapshot();
  snapshot.policeStingers = [{
    stingerId: 'police-stinger:roadblock-1',
    roadblockId: 'roadblock-1',
    slotId: 'central-avenue-mid',
    suspectId: 'driver',
    officerId: 'police-stinger:roadblock-1:officer',
    phase: 'deployed',
    x: 2336,
    y: 1628,
    angle: 0,
    activeSegmentCount: 12,
    contacts: 2,
    lastVehicleId: 'traffic-7',
    lastBurstMask: 5
  }, {
    stingerId: 'police-stinger:roadblock-2',
    roadblockId: 'roadblock-2',
    slotId: 'south-boulevard-east',
    suspectId: 'driver-2',
    officerId: 'police-stinger:roadblock-2:officer',
    phase: 'deploying',
    x: 2928,
    y: 3488,
    angle: Math.PI / 2,
    activeSegmentCount: 6,
    contacts: 0,
    lastVehicleId: '',
    lastBurstMask: 0
  }];

  assert.equal(
    projectDebugPanel(createState(), snapshot).stingers,
    '2 active / P0 E1 D1 R0 / 18 segments / 2 contacts / traffic-7 mask 5'
  );
});

test('debug panel exposes hot, warm, cold, and pop-guarded population tiers', () => {
  const snapshot = createSnapshot();
  snapshot.populationStreaming = {
    potentialPedestrians: 80,
    activePedestrians: 12,
    potentialTraffic: 64,
    activeTraffic: 8,
    pinnedPedestrians: 1,
    pinnedTraffic: 1,
    jamRetirements: 3,
    hotActors: 14,
    warmActors: 6,
    dormantActors: 124,
    deferredVisibleActors: 4,
    lookaheadAnchors: 2,
    interestClusters: 2,
    quotaPressureClusters: 1,
    quotaRebalances: 7,
    worldMinute: 19 * 60 + 30,
    populationDayWeight: 0.16,
    zoneActivity: 'civic-east:8,west-market:12',
    profileDeferredActors: 3,
    profileRebalances: 5
  };
  assert.equal(
    projectDebugPanel(createState(), snapshot).population,
    '20/144 / 14 hot / 6 warm / 124 cold / 19:30 16% day / civic-east:8,west-market:12 / 2 clusters / 2 lookahead / 1 quota pressure / 7 rebalanced / 4 pop guarded / 3 profile held / 5 profile rebalanced / 2 pinned / 3 jam retired'
  );
});

test('debug panel summarizes authored road topology and route planner pressure', () => {
  const snapshot = createSnapshot();
  snapshot.trafficLaneGraph = {
    schemaVersion: 1,
    districtId: 'industrial-district',
    nodes: [
      {id: 'a', x: 0, y: 0, junctionId: ''},
      {id: 'b', x: 100, y: 0, junctionId: ''}
    ],
    edges: [{
      id: 'a-b',
      fromNodeId: 'a',
      toNodeId: 'b',
      kind: 'lane',
      turn: 'none',
      speedLimit: 100,
      junctionId: ''
    }]
  };
  snapshot.trafficAi = [trafficDebugEntry('traffic-1', true, 3), trafficDebugEntry('traffic-2', false, 1)];
  assert.equal(
    projectDebugPanel(createState(), snapshot).roads,
    'v1 / 2 nodes / 1 edges / 2 routed / 1 partial / 2 replans'
  );
});

test('debug panel summarizes junction queue and traversal phases', () => {
  const snapshot = createSnapshot();
  snapshot.trafficAi = [
    {...trafficDebugEntry('waiting', true, 1), junctionPhase: 'waiting', junctionQueuePosition: 2},
    {...trafficDebugEntry('approach', true, 1), junctionPhase: 'approach'},
    {...trafficDebugEntry('crossing', true, 1), junctionPhase: 'crossing'},
    {...trafficDebugEntry('clearing', true, 1), junctionPhase: 'clearing'}
  ];
  assert.equal(
    projectDebugPanel(createState(), snapshot).junctions,
    '4 active / 1 wait / 1 approach / 1 cross / 1 clear / 0 cycle / 0 recover / 0 shared / 0 conflict / 0 lane / 0 request / 0 pass'
  );
});

test('debug panel summarizes visible traffic blocker cycles and recovery owners', () => {
  const snapshot = createSnapshot();
  snapshot.trafficAi = [
    {
      ...trafficDebugEntry('cycle-a', true, 1),
      deadlockCycleId: 'cycle-a|cycle-b',
      deadlockCycleSize: 2,
      deadlockRecovering: true,
      deadlockRecoveryCount: 1
    },
    {
      ...trafficDebugEntry('cycle-b', true, 1),
      deadlockCycleId: 'cycle-a|cycle-b',
      deadlockCycleSize: 2
    }
  ];
  assert.equal(
    projectDebugPanel(createState(), snapshot).junctions,
    '0 active / 0 wait / 0 approach / 0 cross / 0 clear / 1 cycle / 1 recover / 0 shared / 0 conflict / 0 lane / 0 request / 0 pass'
  );
});

test('debug panel summarizes authored lane-change ownership and completions', () => {
  const snapshot = createSnapshot();
  snapshot.trafficAi = [
    {
      ...trafficDebugEntry('changing', true, 1),
      laneChangePhase: 'change-out',
      laneChangeFromLane: 0,
      laneChangeToLane: 1,
      laneChangeAttempts: 1
    },
    {
      ...trafficDebugEntry('requesting', true, 1),
      laneChangePhase: 'requesting',
      laneChangeAttempts: 2,
      laneChangeCompletions: 1
    }
  ];
  assert.equal(
    projectDebugPanel(createState(), snapshot).junctions,
    '0 active / 0 wait / 0 approach / 0 cross / 0 clear / 0 cycle / 0 recover / 0 shared / 0 conflict / 1 lane / 1 request / 1 pass'
  );
});

test('debug panel summarizes compatible junction owners and conflict waits', () => {
  const snapshot = createSnapshot();
  snapshot.trafficAi = [
    {
      ...trafficDebugEntry('owner-a', true, 1),
      junctionId: 'shared',
      junctionPhase: 'crossing',
      junctionActiveOwnerCount: 2
    },
    {
      ...trafficDebugEntry('owner-b', true, 1),
      junctionId: 'shared',
      junctionPhase: 'approach',
      junctionActiveOwnerCount: 2
    },
    {
      ...trafficDebugEntry('waiter', true, 1),
      junctionId: 'shared',
      junctionPhase: 'waiting',
      junctionConflictingOwnerCount: 1
    }
  ];
  assert.equal(
    projectDebugPanel(createState(), snapshot).junctions,
    '3 active / 1 wait / 1 approach / 1 cross / 0 clear / 0 cycle / 0 recover / 1 shared / 1 conflict / 0 lane / 0 request / 0 pass'
  );
});

test('debug panel summarizes predictive traffic contact risk', () => {
  const snapshot = createSnapshot();
  snapshot.trafficAi = [
    {...trafficDebugEntry('near', true, 1), timeToContactSeconds: 0.42},
    {...trafficDebugEntry('far', true, 1), timeToContactSeconds: 1.2},
    trafficDebugEntry('clear', true, 1)
  ];
  assert.equal(
    projectDebugPanel(createState(), snapshot).trafficRisk,
    '2 predicted / 1 urgent / 420ms min'
  );
});

test('debug panel summarizes server phase cost and failures', () => {
  const snapshot = createSnapshot();
  snapshot.simulationPhases = [{
    id: 'frame-state', order: 0, runs: 42, lastTick: 42,
    lastDurationMs: 0.1, maxDurationMs: 0.2, failures: 0
  }, {
    id: 'vehicle-motion', order: 1, runs: 42, lastTick: 42,
    lastDurationMs: 0.8, maxDurationMs: 1.2, failures: 1
  }];
  assert.equal(
    projectDebugPanel(createState(), snapshot).simulationPhases,
    '2 phases / 0.90ms / vehicle-motion 0.80ms / 1 fail'
  );
});

test('debug panel exposes region, network timing, and reconciliation pressure', () => {
  const panel = projectDebugPanel(createState(), undefined, {
    region: 'us-east4',
    buildId: 'abc123',
    rttMedianMs: 72,
    rttP95Ms: 118,
    jitterMs: 14,
    patchGapP95Ms: 61,
    serverTick: 340,
    clockOffsetMs: -18,
    estimatedServerTimeMs: 1_420,
    interpolationDelayMs: 96,
    clockSynchronized: true,
    predictionError: 8.4,
    predictionErrorP95: 12.7,
    predictionErrorMean: 6.2,
    predictionCorrections: 14,
    reconciliations: 2,
    vehicleResimulations: 9,
    vehiclePendingMoves: 5,
    vehicleAcknowledgedMove: 34,
    onFootResimulations: 3,
    onFootPendingMoves: 4,
    onFootAcknowledgedMove: 37,
    remoteSnapshotAgeP95Ms: 104,
    remoteBufferUnderrunPercent: 2.5,
    remoteExtrapolationPercent: 6.7,
    interactionIslandSize: 5,
    interactionIslandPoints: 14,
    interactionIslandBudget: 32,
    interactionIslandOverflow: 2,
    interactionIslandOverflowPoints: 5,
    interactionIslandHorizonMs: 190,
    interactionSnapshotAgeTicks: 1,
    interactionHistoryFrames: 12,
    interactionReplayCount: 4,
    interactionReplayTicks: 9,
    interactionReplayDurationP95Ms: 1.7,
    interactionReplayPairSteps: 18,
    interactionReplaySuppressedEffects: 2,
    interactionReplayHardResets: 1
  });
  assert.equal(panel.region, 'us-east4 / abc123');
  assert.equal(panel.latency, '72/118ms +/-14');
  assert.equal(panel.patchGap, '61ms / T340');
  assert.equal(
    panel.prediction,
    '8.4px now / 12.7px p95 / 14 corr / 2 snap / V A34 P5 R9 / F A37 P4 R3'
  );
  assert.equal(panel.clockSync, '-18ms / 96ms buffer / 104ms age / 2.5% under / 6.7% extra');
  assert.equal(
    panel.interactionIsland,
    '5 bodies / 14/32 pts / 2 (5 pts) overflow / 190ms horizon'
  );
  assert.equal(
    panel.interactionReplay,
    '1t snapshot age / H12 history / R4:9t 1.7ms p95 / 18 pairs / 2 suppressed / 1 reset'
  );
});

test('debug panel projects negotiated netcode stages and fail-closed state', () => {
  const panel = projectDebugPanel(
    createState(),
    undefined,
    undefined,
    undefined,
    {
      source: 'negotiated',
      manifest: {
        protocolVersion: 1,
        interactionProtocolVersion: 4,
        revision: 'canary-2',
        stages: {
          remoteTimelines: true,
          interactionSnapshots: true,
          interactionReplay: false,
          combatRewind: true,
          projectilePrediction: false
        }
      }
    }
  );
  assert.equal(panel.rollout, 'negotiated / canary-2 / timeline,snapshot,rewind');
});

function createState(): DistrictNetworkState {
  return {
    players: new Map([['player', {} as never]]),
    bullets: new Map(),
    thrownProjectiles: new Map(),
    fires: new Map(),
    explosions: new Map(),
    weaponPickups: new Map(),
    npcs: new Map(),
    vehicles: new Map([['vehicle', {} as never]]),
    missions: new Map(),
    services: new Map(),
    missionContactX: 0,
    missionContactY: 0
  };
}

function createSnapshot(): DebugSnapshot {
  return {
    tick: 42,
    nowMs: 1400,
    droppedMs: 2.6,
    spatialEntities: 28,
    deferredCommands: 1,
    eventsThisTick: 2,
    players: 4,
    npcs: 13,
    vehicles: 11,
    bullets: 2,
    incidents: [{
      id: 'incident-1',
      kind: 'vehicle-theft',
      suspectId: 'driver',
      witnessId: 'civilian-1',
      status: 'reported',
      x: 10,
      y: 20
    }],
    pursuits: [{
      officerId: 'police-1',
      suspectId: 'driver',
      lastKnownX: 10,
      lastKnownY: 20,
      mode: 'pursuit'
    }],
    policeVehicles: [{
      vehicleId: 'vehicle-2',
      suspectId: 'driver',
      strategy: 'pursuit',
      canSeeTarget: true,
      lastKnownX: 10,
      lastKnownY: 20,
      desiredSpeed: 175,
      speedReason: 'cruise',
      obstacleId: '',
      routeComplete: true,
      routeVisited: 8,
      waypointIndex: 1,
      waypoints: [{x: 20, y: 20}]
    }],
    policeFleet: {
      desiredUnits: 2,
      availableUnits: 1,
      managedUnits: 1,
      nextSpawnAt: 2000,
      targetSuspectId: 'driver',
      demandedSuspects: 1
    },
    policeResponse: {
      maxResponsePoints: 11,
      usedResponsePoints: 5,
      maxFootUnits: 5,
      maxVehicleUnits: 3,
      assignedFootUnits: 3,
      assignedVehicleUnits: 1,
      suppressedPairs: 0,
      demands: [{
        suspectId: 'driver',
        wantedLevel: 3,
        desiredFoot: 4,
        assignedFoot: 3,
        desiredVehicles: 2,
        assignedVehicles: 1
      }],
      assignments: [],
      lastChanges: []
    },
    events: [{tick: 41, type: 'crime.committed', summary: 'driver committed vehicle-theft'}]
  };
}

function trafficDebugEntry(vehicleId: string, routeComplete: boolean, routeRevision: number) {
  return {
    vehicleId,
    mission: 'cruise-route' as const,
    drivingStyle: 'lawful' as const,
    cruiseSpeed: 100,
    desiredSpeed: 100,
    speedReason: 'cruise' as const,
    obstacleId: '',
    obstacleDistance: -1,
    timeToContactSeconds: -1,
    blockedSince: 0,
    recoveryCount: 0,
    deadlockCycleId: '',
    deadlockCycleSize: 0,
    deadlockRecovering: false,
    deadlockRecoveryCount: 0,
    maneuverPhase: 'none' as const,
    maneuverAttempts: 0,
    laneChangePhase: 'none' as const,
    laneChangeLeadId: '',
    laneChangeFromLane: -1,
    laneChangeToLane: -1,
    laneChangeAttempts: 0,
    laneChangeCompletions: 0,
    laneChangeRejectReason: 'none' as const,
    laneChangeReservationKey: '',
    laneChangeTargets: [],
    emergencyYieldPhase: 'none' as const,
    emergencyVehicleId: '',
    junctionId: '',
    junctionPhase: 'none' as const,
    junctionQueuePosition: 0,
    junctionLeaseExpiresAt: 0,
    junctionMovementId: '',
    junctionMovementTurn: 'straight' as const,
    junctionMovementPath: [],
    junctionActiveOwnerCount: 0,
    junctionConflictingOwnerCount: 0,
    routeSource: 'lane-graph' as const,
    currentLaneNodeId: 'a',
    destinationLaneNodeId: 'b',
    routeRemaining: 1,
    routeRevision,
    routeComplete,
    routeVisited: 2,
    routeWaypoints: [{x: 100, y: 0}]
  };
}
