import assert from 'node:assert/strict';
import test from 'node:test';
import {missionTemplate} from '../shared/content/mission-catalog.ts';
import {
  advanceMissionObjectives,
  evaluateMissionObjective,
  type MissionObjectiveContext
} from '../server/game/missions/mission-objective-system.ts';

test('objective sequence skips satisfied gates and preserves the next active phase', () => {
  const template = missionTemplate('boost-and-deliver');
  const waiting = advanceMissionObjectives(template, {objectiveIndex: 0, checkpointIndex: 0}, context());
  assert.equal(waiting.status, 'active');
  if (waiting.status === 'active') assert.equal(waiting.objective.kind, 'acquire-vehicle');

  const acquired = advanceMissionObjectives(
    template,
    {objectiveIndex: 0, checkpointIndex: 0},
    context({targetOccupiedByCrew: true})
  );
  assert.equal(acquired.status, 'active');
  if (acquired.status === 'active') {
    assert.equal(acquired.objective.kind, 'deliver-vehicle');
    assert.equal(acquired.phase, 'deliver');
  }

  const wanted = advanceMissionObjectives(
    template,
    {objectiveIndex: 0, checkpointIndex: 0},
    context({targetOccupiedByCrew: true, teamWantedLevel: 2})
  );
  assert.equal(wanted.status, 'active');
  if (wanted.status === 'active') assert.equal(wanted.objective.kind, 'clear-wanted');
});

test('checkpoint objective advances only the occupied target through ordered zones', () => {
  const objective = missionTemplate('getaway-run').objectives[1];
  const base = context({
    checkpoints: [
      {id: 'one', x: 100, y: 0, radius: 40},
      {id: 'two', x: 200, y: 0, radius: 40},
      {id: 'three', x: 300, y: 0, radius: 40}
    ],
    targetX: 100,
    targetY: 0
  });
  assert.equal(evaluateMissionObjective(objective, base, 0).checkpointIndex, 0);
  const first = evaluateMissionObjective(objective, {...base, targetOccupiedByCrew: true}, 0);
  assert.deepEqual(first, {status: 'active', phase: 'checkpoints', checkpointIndex: 1});
  const outOfOrder = evaluateMissionObjective(
    objective,
    {...base, targetOccupiedByCrew: true, targetX: 300},
    1
  );
  assert.equal(outOfOrder.checkpointIndex, 1);
  const final = evaluateMissionObjective(
    objective,
    {...base, targetOccupiedByCrew: true, targetX: 300},
    2
  );
  assert.deepEqual(final, {status: 'completed', phase: 'checkpoints', checkpointIndex: 3});
});

test('delivery enforces target occupancy, heat gate, zone, and maximum speed', () => {
  const objective = missionTemplate('boost-and-deliver').objectives[2];
  assert.equal(evaluateMissionObjective(
    objective,
    context({targetOccupiedByCrew: true, teamWantedLevel: 1, targetX: 900, targetY: 900}),
    0
  ).phase, 'lose-heat');
  assert.equal(evaluateMissionObjective(
    objective,
    context({targetOccupiedByCrew: true, targetX: 900, targetY: 900, targetSpeed: 40}),
    0
  ).status, 'active');
  assert.equal(evaluateMissionObjective(
    objective,
    context({targetOccupiedByCrew: true, targetX: 900, targetY: 900, targetSpeed: 10}),
    0
  ).status, 'completed');
});

function context(overrides: Partial<MissionObjectiveContext> = {}): MissionObjectiveContext {
  return {
    targetOccupiedByCrew: false,
    teamWantedLevel: 0,
    targetX: 0,
    targetY: 0,
    targetSpeed: 0,
    deliveryX: 900,
    deliveryY: 900,
    deliveryRadius: 72,
    checkpoints: [],
    ...overrides
  };
}
