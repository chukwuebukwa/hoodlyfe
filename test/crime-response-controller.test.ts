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
  assert.equal(fixture.state.players.get('alpha')?.wanted, 3);
  assert.equal(fixture.state.players.get('bravo')?.wanted, 3);
  assert.equal(response.assignedFootUnits, 5);
  assert.equal(response.assignedVehicleUnits, 3);
  assert.equal(response.usedResponsePoints, 11);
  assert.deepEqual(response.demands.map((demand) => ({
    suspectId: demand.suspectId,
    foot: demand.assignedFoot,
    vehicles: demand.assignedVehicles
  })), [{suspectId: 'alpha', foot: 3, vehicles: 1}, {
    suspectId: 'bravo', foot: 2, vehicles: 2
  }]);
  assert.equal(new Set(response.assignments.map((entry) => (
    `${entry.unitKind}:${entry.unitId}`
  ))).size, 8);
  assert.equal(fixture.controller.responseFleetPlan().desiredUnits, 3);
  assert.equal(fixture.controller.responseFleetPlan().targets.length, 2);

  const events = fixture.events.drain();
  assert.equal(events.filter((event) => event.type === 'incident.reported').length, 2);
  assert.equal(events.filter((event) => event.type === 'pursuit.changed').length, 8);
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

function createFixture(options: {footUnits?: number; vehicleUnits?: number} = {}) {
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
    queryVehicles: () => [...state.vehicles.values()],
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
