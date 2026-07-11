import assert from 'node:assert/strict';
import test from 'node:test';
import type {DebugSnapshot, DebugTrafficAiEntry} from '../shared/protocol/debug.ts';
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

  fixture.incident.status = 'reported';
  fixture.pursuit.mode = 'pursuit';
  fixture.pedestrian.objective = 'wander';
  fixture.pedestrian.waypoints[0].x = 999;
  fixture.stimulus.kind = 'impact';
  fixture.traffic.speedReason = 'cruise';
  assert.equal(first.incidents[0].status, 'scheduled');
  assert.equal(first.pursuits[0].mode, 'search');
  assert.equal(first.pedestrianAi?.[0].objective, 'flee');
  assert.equal(first.pedestrianAi?.[0].waypoints[0].x, 150);
  assert.equal(first.stimuli?.[0].kind, 'gunshot');
  assert.equal(first.trafficAi?.[0].speedReason, 'vehicle');

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
    type: 'damage.applied',
    tick: 4,
    nowMs: 120,
    targetId: 'civilian-1',
    targetKind: 'npc',
    attackerId: 'driver',
    amount: 25,
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
    subjectId: 'driver',
    x: 100,
    y: 200,
    severity: 0.84,
    radius: 500,
    occurredAt: 100,
    expiresAt: 1500
  };
  const traffic: DebugTrafficAiEntry = {
    vehicleId: 'traffic-1',
    cruiseSpeed: 118,
    desiredSpeed: 42,
    speedReason: 'vehicle',
    obstacleId: 'traffic-2',
    obstacleDistance: 44,
    blockedSince: 0,
    recoveryCount: 0,
    maneuverPhase: 'none',
    maneuverAttempts: 0
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
    traffic: () => [traffic],
    publish: (_messageType, snapshot) => published.push(snapshot)
  });
  return {controller, state, clock, incident, pursuit, pedestrian, stimulus, traffic, published};
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
