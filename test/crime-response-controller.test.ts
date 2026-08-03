import assert from 'node:assert/strict';
import test from 'node:test';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {CrimeResponseController} from '../server/game/police/crime-response-controller.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('witness reports feed one bounded response pool for simultaneous suspects', () => {
  const fixture = createFixture();
  fixture.controller.record('alpha', 'murder-police', 0, 'victim-a');
  fixture.controller.record('bravo', 'murder-police', 0, 'victim-b');
  fixture.clock.nowMs = 120;
  fixture.controller.processReports(120);
  fixture.controller.updateResponse(120);

  const response = fixture.controller.responseAllocationSnapshot();
  assert.equal(fixture.state.players.get('alpha')?.wanted, 2);
  assert.equal(fixture.state.players.get('bravo')?.wanted, 2);
  assert.equal(response.assignedFootUnits, 4);
  assert.equal(response.assignedVehicleUnits, 2);
  assert.equal(response.usedResponsePoints, 8);
  assert.deepEqual(response.demands.map((demand) => ({
    suspectId: demand.suspectId,
    foot: demand.assignedFoot,
    vehicles: demand.assignedVehicles
  })), [{suspectId: 'alpha', foot: 2, vehicles: 1}, {
    suspectId: 'bravo', foot: 2, vehicles: 1
  }]);
  assert.equal(new Set(response.assignments.map((entry) => (
    `${entry.unitKind}:${entry.unitId}`
  ))).size, 6);
  assert.equal(fixture.controller.responseFleetPlan().desiredUnits, 2);
  assert.equal(fixture.controller.responseFleetPlan().targets.length, 2);

  const events = fixture.events.drain();
  assert.equal(events.filter((event) => event.type === 'incident.reported').length, 2);
  assert.equal(events.filter((event) => event.type === 'pursuit.changed').length, 6);
});

test('foot search expiry releases only the expired report and a newer report reassigns', () => {
  const fixture = createFixture({footUnits: 1, vehicleUnits: 0});
  fixture.controller.record('alpha', 'vehicle-theft', 0, 'car-a');
  fixture.clock.nowMs = 120;
  fixture.controller.processReports(120);
  fixture.controller.updateResponse(120);
  const officer = fixture.state.npcs.get('police-1')!;
  assert.equal(fixture.controller.policeTarget(officer, 121)?.pursuit?.mode, 'pursuit');

  fixture.lineOfSight.value = false;
  assert.equal(fixture.controller.policeTarget(officer, 8_122), undefined);
  assert.equal(fixture.controller.responseAllocationSnapshot().assignedFootUnits, 0);
  fixture.controller.updateResponse(9_500);
  assert.equal(fixture.controller.responseAllocationSnapshot().assignedFootUnits, 0);
  assert.equal(fixture.controller.responseAllocationSnapshot().suppressedPairs, 1);

  fixture.lineOfSight.value = true;
  fixture.controller.record('alpha', 'assault-police', 10_000, 'police-victim');
  fixture.clock.nowMs = 10_120;
  fixture.controller.processReports(10_120);
  fixture.controller.updateResponse(10_120);
  assert.equal(fixture.controller.responseAllocationSnapshot().assignedFootUnits, 1);
  assert.equal(fixture.controller.responseAllocationSnapshot().suppressedPairs, 0);
});

test('roadblock-reserved cruisers do not consume ordinary pursuit slots', () => {
  const fixture = createFixture({
    footUnits: 1,
    vehicleUnits: 2,
    reservedVehicleIds: new Set(['cruiser-1'])
  });
  fixture.controller.record('alpha', 'murder-police', 0, 'victim-a');
  fixture.clock.nowMs = 120;
  fixture.controller.processReports(120);
  fixture.controller.updateResponse(120);

  const response = fixture.controller.responseAllocationSnapshot();
  assert.equal(response.assignedVehicleUnits, 1);
  assert.deepEqual(response.assignments
    .filter((entry) => entry.unitKind === 'vehicle')
    .map((entry) => entry.unitId), ['cruiser-2']);
});

test('wanted awareness changes from spotted to a private last-known search', () => {
  const fixture = createFixture({footUnits: 1, vehicleUnits: 0});
  fixture.controller.record('alpha', 'vehicle-theft', 0, 'car-a');
  fixture.clock.nowMs = 120;
  fixture.controller.processReports(120);
  fixture.controller.updateResponse(120);
  const officer = fixture.state.npcs.get('police-1')!;

  assert.equal(fixture.controller.policeTarget(officer, 121)?.canSeeTarget, true);
  assert.deepEqual(fixture.controller.policeAwarenessSnapshot('alpha', 121), {
    phase: 'spotted',
    wantedLevel: 1,
    lastKnownX: 0,
    lastKnownY: 0,
    lastSeenAt: 121,
    searchStartedAt: 0,
    zones: []
  });

  fixture.lineOfSight.value = false;
  assert.equal(fixture.controller.policeTarget(officer, 1_000)?.pursuit?.mode, 'search');
  const searching = fixture.controller.policeAwarenessSnapshot('alpha', 1_000);
  assert.equal(searching.phase, 'searching');
  assert.equal(searching.searchStartedAt, 1_000);
  assert.deepEqual(searching.zones.map((zone) => ({
    id: zone.id,
    unitId: zone.unitId,
    unitKind: zone.unitKind,
    x: zone.x,
    y: zone.y
  })), [{
    id: 'foot:police-1',
    unitId: 'police-1',
    unitKind: 'foot',
    x: 0,
    y: 20
  }]);
});

test('visible police hold wanted decay while an unseen player can escape', () => {
  const fixture = createFixture({footUnits: 1, vehicleUnits: 0});
  fixture.controller.record('alpha', 'vehicle-theft', 0, 'car-a');
  fixture.clock.nowMs = 120;
  fixture.controller.processReports(120);
  fixture.controller.updateResponse(120);
  const player = fixture.state.players.get('alpha')!;
  const officer = fixture.state.npcs.get('police-1')!;

  fixture.controller.policeTarget(officer, 11_000);
  fixture.controller.decay(player, 11_000);
  assert.equal(player.wanted, 1);

  fixture.lineOfSight.value = false;
  fixture.controller.policeTarget(officer, 12_000);
  fixture.controller.decay(player, 17_499);
  assert.equal(player.wanted, 1);
  fixture.controller.decay(player, 17_501);
  assert.equal(player.wanted, 0);
  assert.equal(fixture.controller.policeAwarenessSnapshot('alpha', 17_501).phase, 'clear');
});

function createFixture(options: {
  footUnits?: number;
  vehicleUnits?: number;
  reservedVehicleIds?: ReadonlySet<string>;
} = {}) {
  const state = new DistrictState();
  const alpha = player('alpha', 0, 0);
  const bravo = player('bravo', 1_000, 0);
  state.players.set(alpha.id, alpha);
  state.players.set(bravo.id, bravo);
  const footUnits = options.footUnits ?? 5;
  const vehicleUnits = options.vehicleUnits ?? 3;
  for (let index = 0; index < footUnits; index++) {
    const npc = new NpcState();
    npc.id = `police-${index + 1}`;
    npc.kind = 'police';
    npc.x = index < Math.ceil(footUnits / 2) ? index * 30 : 900 + index * 20;
    npc.y = 20;
    state.npcs.set(npc.id, npc);
  }
  for (let index = 0; index < vehicleUnits; index++) {
    const vehicle = new VehicleState();
    vehicle.id = `cruiser-${index + 1}`;
    vehicle.kind = 'police';
    vehicle.x = index === 0 ? 50 : 900 + index * 30;
    vehicle.y = 40;
    state.vehicles.set(vehicle.id, vehicle);
  }

  const lineOfSight = {value: true};
  const clock = {tick: 1, nowMs: 0};
  const events = new GameEventStream();
  const controller = new CrimeResponseController({
    state,
    world: {hasLineOfSight: () => lineOfSight.value} as unknown as CollisionMap,
    events,
    clock: () => clock,
    queryNpcs: () => [...state.npcs.values()],
    isReservedPoliceUnit: (kind, unitId) => (
      kind === 'vehicle' && Boolean(options.reservedVehicleIds?.has(unitId))
    ),
    panicWitness() {}
  });
  return {state, controller, events, clock, lineOfSight};
}

function player(id: string, x: number, y: number): PlayerState {
  const result = new PlayerState();
  result.id = id;
  result.name = id;
  result.x = x;
  result.y = y;
  return result;
}
