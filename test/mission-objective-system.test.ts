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

test('crew checkpoint objective accepts any connected living participant in a vehicle', () => {
  const objective = missionTemplate('checkpoint-rush').objectives[0];
  const checkpoints = [
    {id: 'one', x: 100, y: 0, radius: 40},
    {id: 'two', x: 200, y: 0, radius: 40},
    {id: 'three', x: 300, y: 0, radius: 40},
    {id: 'four', x: 400, y: 0, radius: 40},
    {id: 'five', x: 500, y: 0, radius: 40}
  ];
  const participant = {
    playerId: 'support',
    connected: true,
    alive: true,
    vehicleId: '',
    x: 100,
    y: 0
  };
  const walking = evaluateMissionObjective(
    objective,
    context({checkpoints, participants: [participant]}),
    0
  );
  assert.equal(walking.checkpointIndex, 0);
  const driving = evaluateMissionObjective(
    objective,
    context({checkpoints, participants: [{...participant, vehicleId: 'car'}]}),
    0
  );
  assert.equal(driving.checkpointIndex, 1);
  const outOfOrder = evaluateMissionObjective(
    objective,
    context({checkpoints, participants: [{...participant, vehicleId: 'car', x: 500}]}),
    1
  );
  assert.equal(outOfOrder.checkpointIndex, 1);
  const disconnected = evaluateMissionObjective(
    objective,
    context({
      checkpoints,
      participants: [{...participant, connected: false, vehicleId: 'car', x: 200}]
    }),
    1
  );
  assert.equal(disconnected.checkpointIndex, 1);
});

test('hold objective accrues only with living crew in an uncontested zone and awaits wave completion', () => {
  const objective = missionTemplate('crew-holdout').objectives[0];
  const defender = {
    playerId: 'leader',
    connected: true,
    alive: true,
    vehicleId: '',
    x: 100,
    y: 100
  };
  const outside = evaluateMissionObjective(
    objective,
    context({elapsedMs: 1_000, holdX: 100, holdY: 100, holdRadius: 80}),
    0,
    0
  );
  assert.equal(outside.holdProgressMs, 0);
  const contested = evaluateMissionObjective(
    objective,
    context({
      participants: [defender],
      elapsedMs: 1_000,
      holdX: 100,
      holdY: 100,
      holdRadius: 80,
      holdContested: true
    }),
    0,
    0
  );
  assert.equal(contested.holdProgressMs, 0);
  const defended = evaluateMissionObjective(
    objective,
    context({
      participants: [defender],
      elapsedMs: 1_000,
      holdX: 100,
      holdY: 100,
      holdRadius: 80
    }),
    0,
    0
  );
  assert.equal(defended.holdProgressMs, 1_000);
  const wavesRemain = evaluateMissionObjective(
    objective,
    context({
      participants: [defender],
      elapsedMs: 1_000,
      holdX: 100,
      holdY: 100,
      holdRadius: 80,
      encounterComplete: false
    }),
    0,
    24_500
  );
  assert.equal(wavesRemain.status, 'active');
  assert.equal(wavesRemain.holdProgressMs, 25_000);
  const complete = evaluateMissionObjective(
    objective,
    context({
      participants: [defender],
      holdX: 100,
      holdY: 100,
      holdRadius: 80,
      encounterComplete: true
    }),
    0,
    25_000
  );
  assert.equal(complete.status, 'completed');
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
    participants: [],
    targetOccupiedByCrew: false,
    teamWantedLevel: 0,
    targetX: 0,
    targetY: 0,
    targetSpeed: 0,
    deliveryX: 900,
    deliveryY: 900,
    deliveryRadius: 72,
    checkpoints: [],
    elapsedMs: 0,
    holdX: 0,
    holdY: 0,
    holdRadius: 0,
    holdContested: false,
    encounterComplete: true,
    ...overrides
  };
}
