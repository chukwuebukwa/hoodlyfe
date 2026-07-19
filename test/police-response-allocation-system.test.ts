import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PoliceResponseAllocationSystem,
  responseLimitsForWanted,
  type PoliceResponseSuspect,
  type PoliceResponseUnit
} from '../server/game/police/police-response-allocation-system.ts';

test('response policy publishes bounded original foot and cruiser limits', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 8].map(responseLimitsForWanted),
    [
      {foot: 0, vehicle: 0},
      {foot: 1, vehicle: 0},
      {foot: 2, vehicle: 1},
      {foot: 4, vehicle: 2},
      {foot: 5, vehicle: 2},
      {foot: 5, vehicle: 3},
      {foot: 5, vehicle: 3}
    ]
  );
});

test('two wanted suspects fairly share one bounded district response pool', () => {
  const allocation = new PoliceResponseAllocationSystem();
  const suspects = [suspect('high', 4, 0), suspect('low', 2, 1_000)];
  const units = responseUnits();
  const first = allocation.update(suspects, units, 0);
  const diagnostics = allocation.diagnostics();

  assert.equal(first.length, 8);
  assert.equal(diagnostics.assignedFootUnits, 5);
  assert.equal(diagnostics.assignedVehicleUnits, 3);
  assert.equal(diagnostics.usedResponsePoints, 11);
  assert.equal(new Set(diagnostics.assignments.map((entry) => (
    `${entry.unitKind}:${entry.unitId}`
  ))).size, diagnostics.assignments.length);
  for (const demand of diagnostics.demands) {
    assert.ok(demand.assignedFoot > 0, `${demand.suspectId} received no foot coverage.`);
    assert.ok(demand.assignedVehicles > 0, `${demand.suspectId} received no cruiser coverage.`);
    assert.ok(demand.assignedFoot <= responseLimitsForWanted(demand.wantedLevel).foot);
    assert.ok(demand.assignedVehicles <= responseLimitsForWanted(demand.wantedLevel).vehicle);
  }

  assert.deepEqual(allocation.update(suspects, units, 100), []);
  assert.deepEqual(allocation.entries(), diagnostics.assignments);
});

test('allocation output is independent of suspect and unit insertion order', () => {
  const suspects = [suspect('bravo', 3, 900), suspect('alpha', 3, 100)];
  const units = responseUnits();
  const forward = new PoliceResponseAllocationSystem();
  const reverse = new PoliceResponseAllocationSystem();

  forward.update(suspects, units, 0);
  reverse.update([...suspects].reverse(), [...units].reverse(), 0);
  assert.deepEqual(reverse.entries(), forward.entries());
  assert.deepEqual(reverse.fleetPlan(), forward.fleetPlan());
});

test('wanted escalation and contraction resize leases without oscillation', () => {
  const allocation = new PoliceResponseAllocationSystem();
  const units = responseUnits();

  allocation.update([suspect('driver', 1, 0)], units, 0);
  assert.equal(allocation.entries().length, 1);

  const escalation = allocation.update([suspect('driver', 5, 0)], units, 100);
  assert.equal(escalation.length, 7);
  assert.equal(allocation.entries().length, 8);
  assert.equal(allocation.diagnostics().usedResponsePoints, 11);

  const contraction = allocation.update([suspect('driver', 1, 0)], units, 200);
  assert.equal(contraction.length, 7);
  assert.ok(contraction.every((change) => change.reason === 'budget'));
  assert.equal(allocation.entries().filter((entry) => entry.unitKind === 'foot').length, 1);
  assert.equal(allocation.entries().filter((entry) => entry.unitKind === 'vehicle').length, 0);
  assert.equal(allocation.diagnostics().usedResponsePoints, 1);

  assert.deepEqual(allocation.update([suspect('driver', 1, 0)], units, 2_000), []);
  assert.equal(allocation.entries().length, 1);
});

test('a materially closer unit replaces a distant lease only after hysteresis', () => {
  const allocation = new PoliceResponseAllocationSystem();
  const target = suspect('driver', 1, 0);
  const distant = unit('far', 'foot', 500);
  const nearby = unit('near', 'foot', 20);

  allocation.update([target], [distant], 0);
  assert.equal(allocation.assignmentFor('foot', 'far')?.suspectId, 'driver');
  assert.deepEqual(allocation.update([target], [distant, nearby], 1_499), []);
  const changes = allocation.update([target], [distant, nearby], 1_500);
  assert.deepEqual(changes.map(({unitId, previousSuspectId, suspectId, reason}) => ({
    unitId,
    previousSuspectId,
    suspectId,
    reason
  })), [{
    unitId: 'far',
    previousSuspectId: 'driver',
    suspectId: '',
    reason: 'replaced'
  }, {
    unitId: 'near',
    previousSuspectId: '',
    suspectId: 'driver',
    reason: 'replaced'
  }]);
  assert.equal(allocation.assignmentFor('foot', 'near')?.suspectId, 'driver');
});

test('unavailable units and cleared suspects release immediately', () => {
  const allocation = new PoliceResponseAllocationSystem();
  const target = suspect('driver', 2, 0);
  const officer = unit('officer', 'foot', 30);
  allocation.update([target], [officer], 0);

  const unavailable = allocation.update([target], [{...officer, available: false}], 100);
  assert.equal(unavailable[0]?.reason, 'unavailable');
  allocation.update([target], [officer], 1_400);
  const cleared = allocation.clearSuspect('driver', 1_500);
  assert.equal(cleared[0]?.reason, 'suspect-cleared');
  assert.equal(allocation.entries().length, 0);
});

test('search expiry suppresses an old unit-report pair until a newer report', () => {
  const allocation = new PoliceResponseAllocationSystem();
  const cruiser = unit('cruiser', 'vehicle', 50);
  const firstReport = suspect('driver', 2, 0, 100);
  allocation.update([firstReport], [cruiser], 0);

  const released = allocation.suppressReport('vehicle', 'cruiser', 'driver', 100, 2_000);
  assert.equal(released?.reason, 'search-expired');
  allocation.update([firstReport], [cruiser], 3_500);
  assert.equal(allocation.assignmentFor('vehicle', 'cruiser'), undefined);
  assert.equal(allocation.diagnostics().suppressedPairs, 1);

  const newerReport = {...firstReport, reportAt: 4_000};
  allocation.update([newerReport], [cruiser], 4_000);
  assert.equal(allocation.assignmentFor('vehicle', 'cruiser')?.suspectId, 'driver');
  assert.equal(allocation.diagnostics().suppressedPairs, 0);
});

function suspect(
  id: string,
  wantedLevel: number,
  x: number,
  reportAt = 100
): PoliceResponseSuspect {
  return {
    id,
    wantedLevel,
    reportAt,
    reportedX: x,
    reportedY: 0,
    currentX: x,
    currentY: 0
  };
}

function unit(
  id: string,
  kind: PoliceResponseUnit['kind'],
  x: number
): PoliceResponseUnit {
  return {id, kind, x, y: 0, available: true};
}

function responseUnits(): PoliceResponseUnit[] {
  return [
    unit('foot-1', 'foot', 0),
    unit('foot-2', 'foot', 80),
    unit('foot-3', 'foot', 920),
    unit('foot-4', 'foot', 1_000),
    unit('foot-5', 'foot', 500),
    unit('vehicle-1', 'vehicle', 40),
    unit('vehicle-2', 'vehicle', 960),
    unit('vehicle-3', 'vehicle', 500)
  ];
}
