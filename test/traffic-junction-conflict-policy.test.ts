import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exclusiveJunctionMovement,
  junctionMovementsConflict,
  type TrafficJunctionMovement
} from '../server/game/traffic/traffic-junction-conflict-policy.ts';

test('separated parallel straight movements may share a junction', () => {
  assert.equal(junctionMovementsConflict(
    movement('northbound', 'north-entry', 'north-exit', [[0, -80], [0, 80]]),
    movement('southbound', 'south-entry', 'south-exit', [[40, 80], [40, -80]])
  ), false);
});

test('crossing straights and left turns versus opposing straights remain foes', () => {
  const northbound = movement(
    'northbound',
    'north-entry',
    'north-exit',
    [[0, -80], [0, 80]]
  );
  const eastbound = movement(
    'eastbound',
    'east-entry',
    'east-exit',
    [[-80, 0], [80, 0]]
  );
  const leftTurn = movement(
    'left-turn',
    'south-entry',
    'west-exit',
    [[40, 80], [40, 20], [0, -20], [-80, -20]],
    'left'
  );
  assert.equal(junctionMovementsConflict(northbound, eastbound), true);
  assert.equal(junctionMovementsConflict(northbound, leftTurn), true);
});

test('right turns around different corners may coexist', () => {
  assert.equal(junctionMovementsConflict(
    movement(
      'north-east-right',
      'north-entry',
      'east-exit',
      [[-40, -80], [-40, -40], [-80, -40]],
      'right'
    ),
    movement(
      'south-west-right',
      'south-entry',
      'west-exit',
      [[40, 80], [40, 40], [80, 40]],
      'right'
    )
  ), false);
});

test('shared lanes, malformed paths, and fallback movements fail closed', () => {
  const first = movement('first', 'shared-entry', 'first-exit', [[0, -80], [0, 80]]);
  const sharedEntry = movement('second', 'shared-entry', 'second-exit', [[40, -80], [40, 80]]);
  const sharedExit = movement('third', 'third-entry', 'first-exit', [[80, -80], [80, 80]]);
  const malformed = {...first, id: 'malformed', path: [{x: 0, y: 0}]};
  assert.equal(junctionMovementsConflict(first, sharedEntry), true);
  assert.equal(junctionMovementsConflict(first, sharedExit), true);
  assert.equal(junctionMovementsConflict(first, malformed), true);
  assert.equal(junctionMovementsConflict(first, exclusiveJunctionMovement('junction')), true);
});

function movement(
  id: string,
  entryLaneId: string,
  exitLaneId: string,
  points: ReadonlyArray<readonly [number, number]>,
  turn: TrafficJunctionMovement['turn'] = 'straight'
): TrafficJunctionMovement {
  return {
    id,
    junctionId: 'junction',
    turn,
    entryLaneId,
    exitLaneId,
    path: points.map(([x, y]) => ({x, y})),
    sweptHalfWidth: 18.5,
    exclusive: false
  };
}
