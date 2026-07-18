import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoliceResponseAssignment} from '../server/game/police/police-response-allocation-system.ts';
import {
  PursuitCoordinator,
  tacticalGoal
} from '../server/game/police/pursuit-coordinator.ts';

test('pursuit roles are deterministic across assignment insertion order', () => {
  const assignments = [
    assignment('foot-3', 'foot', 300, 200),
    assignment('foot-1', 'foot', 100, 200),
    assignment('foot-2', 'foot', 200, 200),
    assignment('car-2', 'vehicle', 240, 200),
    assignment('car-1', 'vehicle', 120, 200)
  ];
  const forward = new PursuitCoordinator();
  const reverse = new PursuitCoordinator();

  forward.update(assignments);
  reverse.update([...assignments].reverse());

  assert.deepEqual(forward.diagnostics(), reverse.diagnostics());
  assert.deepEqual(
    roles(forward),
    [
      ['foot-1', 'primary'],
      ['foot-2', 'contain-left'],
      ['foot-3', 'contain-right'],
      ['car-1', 'primary'],
      ['car-2', 'intercept-left']
    ]
  );
});

test('retained response leases keep tactical roles while distances cross', () => {
  const coordinator = new PursuitCoordinator();
  coordinator.update([
    assignment('foot-a', 'foot', 80, 100),
    assignment('foot-b', 'foot', 180, 100)
  ]);
  assert.equal(coordinator.roleFor('foot', 'foot-a'), 'primary');
  assert.equal(coordinator.roleFor('foot', 'foot-b'), 'contain-left');

  coordinator.update([
    assignment('foot-a', 'foot', 500, 100),
    assignment('foot-b', 'foot', 20, 100)
  ]);
  assert.equal(coordinator.roleFor('foot', 'foot-a'), 'primary');
  assert.equal(coordinator.roleFor('foot', 'foot-b'), 'contain-left');

  coordinator.update([assignment('foot-b', 'foot', 20, 100)]);
  assert.equal(coordinator.roleFor('foot', 'foot-b'), 'primary');
  assert.equal(coordinator.diagnostics().length, 1);
});

test('visible units receive role-specific goals while lost units search last known position', () => {
  const coordinator = new PursuitCoordinator();
  coordinator.update([
    assignment('foot-primary', 'foot', 20, 100),
    assignment('foot-left', 'foot', 30, 100),
    assignment('car-primary', 'vehicle', 40, 100),
    assignment('car-left', 'vehicle', 50, 100)
  ]);
  const target = {x: 500, y: 300, angle: 0, inVehicle: true};

  const primary = coordinator.resolve('foot', 'foot-primary', 'pursuit', true, target);
  assert.deepEqual(
    {phase: primary.phase, goalX: primary.goalX, goalY: primary.goalY},
    {phase: 'pursue', goalX: 500, goalY: 300}
  );
  const containment = coordinator.resolve('foot', 'foot-left', 'pursuit', true, target);
  assert.deepEqual(
    {phase: containment.phase, goalX: containment.goalX, goalY: containment.goalY},
    {phase: 'contain', goalX: 500, goalY: 405}
  );
  const intercept = coordinator.resolve('vehicle', 'car-left', 'pursuit', true, target);
  assert.deepEqual(
    {phase: intercept.phase, goalX: intercept.goalX, goalY: intercept.goalY},
    {phase: 'intercept', goalX: 610, goalY: 378}
  );
  const search = coordinator.resolve('foot', 'foot-left', 'search', false, {
    x: 420,
    y: 260,
    angle: Math.PI,
    inVehicle: false
  });
  assert.deepEqual(
    {phase: search.phase, goalX: search.goalX, goalY: search.goalY},
    {phase: 'search', goalX: 420, goalY: 260}
  );
});

test('tactical flank geometry rotates with target heading', () => {
  const left = tacticalGoal('contain-left', {
    x: 100,
    y: 100,
    angle: Math.PI / 2,
    inVehicle: false
  });
  assert.ok(Math.abs(left.x + 5) < 0.0001);
  assert.ok(Math.abs(left.y - 100) < 0.0001);
});

function assignment(
  unitId: string,
  unitKind: PoliceResponseAssignment['unitKind'],
  distance: number,
  assignedAt: number
): PoliceResponseAssignment {
  return {
    unitId,
    unitKind,
    suspectId: 'suspect',
    reportAt: 50,
    assignedAt,
    distance
  };
}

function roles(coordinator: PursuitCoordinator): Array<[string, string]> {
  return coordinator.diagnostics()
    .map((tactic) => [tactic.unitId, tactic.role] as [string, string])
    .sort((left, right) => (
      Number(left[0].startsWith('car')) - Number(right[0].startsWith('car')) ||
      left[0].localeCompare(right[0])
    ));
}
