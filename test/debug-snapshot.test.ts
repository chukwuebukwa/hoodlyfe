import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DebugPoliceArrestEntry,
  DebugPoliceTacticEntry,
  DebugPoliceResponseEntry,
  DebugSnapshot,
  DebugTrafficAiEntry,
  DebugTrafficLaneGraphEntry
} from '../shared/protocol/debug.ts';
import {
  DebugSnapshotController,
  summarizeGameEvent
} from '../server/game/debug/debug-snapshot-controller.ts';
import type {GameEvent} from '../server/game/events/game-events.ts';
import type {Incident} from '../server/game/incidents/incident-registry.ts';
import type {PursuitRecord} from '../server/game/police/pursuit-memory.ts';
import {BulletState, DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';

test('disabled debug projection stores and publishes nothing', () => {
  const fixture = createFixture(false);
  fixture.clock.tick = 12;
  fixture.controller.update([respawnEvent(12)]);
  assert.equal(fixture.published.length, 0);
});

test('debug projection bounds history, samples cadence, and copies domain records', () => {
  const fixture = createFixture(true);
  addEntities(fixture.state);
  const events = Array.from({length: 10}, (_value, index) => respawnEvent(index + 1));

  fixture.clock.tick = 5;
  fixture.clock.nowMs = 500;
  fixture.controller.update(events);
  assert.equal(fixture.published.length, 0);

  fixture.clock.tick = 6;
  fixture.clock.nowMs = 600;
  fixture.clock.droppedMs = 20;
  fixture.controller.update([]);
  assert.equal(fixture.published.length, 1);
  const first = fixture.published[0];
  assert.equal(first.tick, 6);
  assert.equal(first.nowMs, 600);
  assert.equal(first.droppedMs, 20);
  assert.equal(first.spatialEntities, 25);
  assert.equal(first.deferredCommands, 2);
  assert.equal(first.eventsThisTick, 0);
  assert.deepEqual(
    {players: first.players, npcs: first.npcs, vehicles: first.vehicles, bullets: first.bullets},
    {players: 1, npcs: 1, vehicles: 1, bullets: 1}
  );
  assert.equal(first.events.length, 8);
  assert.deepEqual(first.events.map((event) => event.tick), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(first.incidents[0].status, 'scheduled');
  assert.equal(first.pursuits[0].mode, 'search');
  assert.equal(first.pedestrianAi?.[0].objective, 'flee');
  assert.equal(first.stimuli?.[0].kind, 'gunshot');
  assert.equal(first.trafficAi?.[0].speedReason, 'vehicle');
  assert.equal(first.trafficAi?.[0].routeWaypoints[0].x, 120);
  assert.equal(first.trafficLaneGraph?.edges[0].kind, 'lane');
  assert.equal(first.policeResponse?.usedResponsePoints, 3);
  assert.equal(first.policeResponse?.demands[0].assignedFoot, 1);
  assert.equal(first.policeResponse?.assignments[0].distance, 40);
  assert.equal(first.policeResponse?.lastChanges[0].reason, 'assigned');
  assert.equal(first.policeTactics?.[0].role, 'contain-left');
  assert.equal(first.policeTactics?.[0].goalX, 180);
  assert.equal(first.policeArrests?.[0].phase, 'securing');
  assert.equal(first.policeArrests?.[0].suspectX, 120);

  fixture.incident.status = 'reported';
  fixture.pursuit.mode = 'pursuit';
  fixture.pedestrian.objective = 'wander';
  fixture.pedestrian.waypoints[0].x = 999;
  fixture.stimulus.kind = 'impact';
  fixture.traffic.speedReason = 'cruise';
  fixture.traffic.routeWaypoints[0].x = 999;
  fixture.laneGraph.edges[0].kind = 'turnaround';
  fixture.response.usedResponsePoints = 0;
  fixture.response.demands[0].assignedFoot = 0;
  fixture.response.assignments[0].distance = 999;
  fixture.response.lastChanges[0].reason = 'mutated';
  fixture.tactic.role = 'support-left';
  fixture.tactic.goalX = 999;
  fixture.arrest.suspectX = 999;
  assert.equal(first.incidents[0].status, 'scheduled');
  assert.equal(first.pursuits[0].mode, 'search');
  assert.equal(first.pedestrianAi?.[0].objective, 'flee');
  assert.equal(first.pedestrianAi?.[0].waypoints[0].x, 150);
  assert.equal(first.stimuli?.[0].kind, 'gunshot');
  assert.equal(first.trafficAi?.[0].speedReason, 'vehicle');
  assert.equal(first.trafficAi?.[0].routeWaypoints[0].x, 120);
  assert.equal(first.trafficLaneGraph?.edges[0].kind, 'lane');
  assert.equal(first.policeResponse?.usedResponsePoints, 3);
  assert.equal(first.policeResponse?.demands[0].assignedFoot, 1);
  assert.equal(first.policeResponse?.assignments[0].distance, 40);
  assert.equal(first.policeResponse?.lastChanges[0].reason, 'assigned');
  assert.equal(first.policeTactics?.[0].role, 'contain-left');
  assert.equal(first.policeTactics?.[0].goalX, 180);
  assert.equal(first.policeArrests?.[0].suspectX, 120);

  fixture.clock.tick = 11;
  fixture.controller.update([respawnEvent(11)]);
  assert.equal(fixture.published.length, 1);
  fixture.clock.tick = 12;
  fixture.controller.update([respawnEvent(12)]);
  assert.equal(fixture.published.length, 2);
  assert.equal(fixture.published[1].eventsThisTick, 1);
  assert.equal(fixture.published[1].events.at(-1)?.tick, 12);
});

test('event summaries preserve compact gameplay context', () => {
  assert.equal(summarizeGameEvent({
    type: 'melee.started',
    tick: 3,
    nowMs: 90,
    playerId: 'driver',
    weapon: 'bat',
    combo: 0,
    x: 10,
    y: 20
  }), 'driver swung bat combo 1');
  assert.equal(summarizeGameEvent({
    type: 'npc.melee.started',
    tick: 3,
    nowMs: 95,
    npcId: 'hostile',
    targetId: 'driver',
    x: 10,
    y: 20
  }), 'hostile punched driver');
  assert.equal(summarizeGameEvent({
    type: 'damage.applied',
    tick: 4,
    nowMs: 120,
    targetId: 'civilian-1',
    targetKind: 'npc',
    attackerId: 'driver',
    amount: 25,
    armorDamage: 0,
    healthDamage: 25,
    remainingArmor: 0,
    remainingHealth: 25
  }), 'driver -> npc:civilian-1 -25');
  assert.equal(summarizeGameEvent({
    type: 'pursuit.changed',
    tick: 5,
    nowMs: 150,
    officerId: 'police-1',
    previousSuspectId: 'driver',
    suspectId: ''
  }), 'police-1 cleared from driver');
  assert.equal(summarizeGameEvent({
    type: 'police.arrest-started',
    tick: 6,
    nowMs: 180,
    arrestId: 'arrest:driver:6',
    officerId: 'police-1',
    suspectId: 'driver',
    wantedLevel: 2
  }), 'police-1 securing driver (arrest:driver:6)');
  assert.equal(summarizeGameEvent({
    type: 'player.busted',
    tick: 7,
    nowMs: 2800,
    arrestId: 'arrest:driver:6',
    officerId: 'police-1',
    playerId: 'driver',
    wantedLevel: 2,
    fine: 800,
    x: 100,
    y: 200
  }), 'driver busted by police-1; $800 seized');
});

function createFixture(enabled: boolean) {
  const state = new DistrictState();
  const clock = {tick: 0, nowMs: 0, droppedMs: 0};
  const incident: Incident = {
    id: 'incident-1',
    kind: 'assault',
    suspectId: 'driver',
    victimId: 'civilian-1',
    x: 100,
    y: 200,
    severity: 10,
    createdAt: 100,
    expiresAt: 5000,
    status: 'scheduled',
    witnessId: 'civilian-2',
    reportAt: 600,
    reportedAt: 0
  };
  const pursuit: PursuitRecord = {
    officerId: 'police-1',
    suspectId: 'driver',
    lastKnownX: 110,
    lastKnownY: 210,
    lastSeenAt: 400,
    searchUntil: 8400,
    mode: 'search'
  };
  const published: DebugSnapshot[] = [];
  const pedestrian = {
    id: 'civilian-1',
    objective: 'flee',
    bravery: 0.4,
    threatId: '',
    panicUntil: 0,
    stimulusKind: 'gunshot',
    stimulusSourceId: 'driver',
    stimulusUntil: 1400,
    reactionPhase: 'respond',
    navigationGoalX: 300,
    navigationGoalY: 200,
    waypointIndex: 0,
    waypoints: [{x: 150, y: 200}]
  };
  const stimulus = {
    id: 'stimulus-1',
    kind: 'gunshot',
    sourceId: 'driver',
    sourceKind: 'player',
    subjectId: 'driver',
    subjectKind: 'player',
    actorId: 'driver',
    actorKind: 'player',
    spaceId: 'street',
    x: 100,
    y: 200,
    intensity: 0.84,
    radius: 500,
    channels: ['hearing'],
    provenance: 'weapon.fired',
    occurredAt: 100,
    expiresAt: 1500
  };
  const traffic: DebugTrafficAiEntry = {
    vehicleId: 'traffic-1',
    mission: 'cruise-route',
    drivingStyle: 'lawful',
    cruiseSpeed: 118,
    desiredSpeed: 42,
    speedReason: 'vehicle',
    obstacleId: 'traffic-2',
    obstacleDistance: 44,
    timeToContactSeconds: 0.42,
    blockedSince: 0,
    recoveryCount: 0,
    deadlockCycleId: '',
    deadlockCycleSize: 0,
    deadlockRecovering: false,
    deadlockRecoveryCount: 0,
    maneuverPhase: 'none',
    maneuverAttempts: 0,
    laneChangePhase: 'none',
    laneChangeLeadId: '',
    laneChangeFromLane: -1,
    laneChangeToLane: -1,
    laneChangeAttempts: 0,
    laneChangeCompletions: 0,
    laneChangeRejectReason: 'none',
    laneChangeReservationKey: '',
    laneChangeTargets: [],
    emergencyYieldPhase: 'none',
    emergencyVehicleId: '',
    junctionId: '',
    junctionPhase: 'none',
    junctionQueuePosition: 0,
    junctionLeaseExpiresAt: 0,
    junctionMovementId: '',
    junctionMovementTurn: 'straight',
    junctionMovementPath: [],
    junctionActiveOwnerCount: 0,
    junctionConflictingOwnerCount: 0,
    routeSource: 'lane-graph',
    currentLaneNodeId: 'lane:0',
    destinationLaneNodeId: 'lane:2',
    routeRemaining: 2,
    routeRevision: 1,
    routeComplete: true,
    routeVisited: 3,
    routeWaypoints: [{x: 120, y: 200}, {x: 220, y: 200}]
  };
  const laneGraph: DebugTrafficLaneGraphEntry = {
    schemaVersion: 1,
    districtId: 'test',
    nodes: [
      {id: 'lane:0', x: 20, y: 200, junctionId: ''},
      {id: 'lane:1', x: 120, y: 200, junctionId: ''}
    ],
    edges: [{
      id: 'edge:0',
      fromNodeId: 'lane:0',
      toNodeId: 'lane:1',
      kind: 'lane',
      turn: 'none',
      speedLimit: 100,
      junctionId: ''
    }]
  };
  const response: DebugPoliceResponseEntry = {
    maxResponsePoints: 11,
    usedResponsePoints: 3,
    maxFootUnits: 5,
    maxVehicleUnits: 3,
    assignedFootUnits: 1,
    assignedVehicleUnits: 1,
    suppressedPairs: 0,
    demands: [{
      suspectId: 'driver',
      wantedLevel: 1,
      desiredFoot: 1,
      assignedFoot: 1,
      desiredVehicles: 1,
      assignedVehicles: 1
    }],
    assignments: [{
      unitId: 'police-1',
      unitKind: 'foot',
      suspectId: 'driver',
      reportAt: 100,
      assignedAt: 120,
      distance: 40
    }],
    lastChanges: [{
      unitId: 'police-1',
      unitKind: 'foot',
      previousSuspectId: '',
      suspectId: 'driver',
      reason: 'assigned'
    }]
  };
  const tactic: DebugPoliceTacticEntry = {
    unitId: 'police-1',
    unitKind: 'foot',
    suspectId: 'driver',
    role: 'contain-left',
    phase: 'contain',
    goalX: 180,
    goalY: 210
  };
  const arrest: DebugPoliceArrestEntry = {
    arrestId: 'arrest:driver:6',
    officerId: 'police-1',
    suspectId: 'driver',
    phase: 'securing',
    startedAt: 200,
    completesAt: 2800,
    wantedLevel: 2,
    officerX: 100,
    officerY: 200,
    suspectX: 120,
    suspectY: 200
  };
  const controller = new DebugSnapshotController({
    enabled,
    state,
    clock: () => clock,
    spatialSize: () => 25,
    deferredSize: () => 2,
    incidents: () => [incident],
    pursuits: () => [pursuit],
    pedestrians: () => [pedestrian],
    stimuli: () => [stimulus],
    simulationPhases: () => [{
      id: 'frame-state',
      order: 0,
      runs: 6,
      lastTick: 6,
      lastDurationMs: 0.1,
      maxDurationMs: 0.2,
      failures: 0
    }],
    traffic: () => [traffic],
    trafficLaneGraph: () => laneGraph,
    policeResponse: () => response,
    policeTactics: () => [tactic],
    policeArrests: () => [arrest],
    publish: (_messageType, snapshot) => published.push(snapshot)
  });
  return {
    controller,
    state,
    clock,
    incident,
    pursuit,
    pedestrian,
    stimulus,
    traffic,
    laneGraph,
    response,
    tactic,
    arrest,
    published
  };
}

function addEntities(state: DistrictState): void {
  const player = new PlayerState();
  player.id = 'driver';
  state.players.set(player.id, player);
  const npc = new NpcState();
  npc.id = 'civilian-1';
  state.npcs.set(npc.id, npc);
  const vehicle = new VehicleState();
  vehicle.id = 'vehicle-1';
  state.vehicles.set(vehicle.id, vehicle);
  const bullet = new BulletState();
  bullet.id = 'bullet-1';
  state.bullets.set(bullet.id, bullet);
}

function respawnEvent(tick: number): GameEvent {
  return {
    type: 'player.respawned',
    tick,
    nowMs: tick * 100,
    playerId: `driver-${tick}`,
    x: tick,
    y: tick
  };
}
