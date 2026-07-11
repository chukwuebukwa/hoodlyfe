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
    cruisers: '1/1 pursuit',
    stimuli: 0,
    signals: '0',
    events: ['T41 driver committed vehicle-theft']
  });
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
    events: [{tick: 41, type: 'crime.committed', summary: 'driver committed vehicle-theft'}]
  };
}
