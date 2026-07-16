import assert from 'node:assert/strict';
import test from 'node:test';
import type {TrafficJunctionMovement} from '../server/game/traffic/traffic-junction-conflict-policy.ts';
import {TrafficJunctionSystem} from '../server/game/traffic/traffic-junction-system.ts';

test('junction reservations serialize arrivals and renew active ownership', () => {
  const system = new TrafficJunctionSystem(500);
  assert.equal(system.request('car-b', '10,10', 100), true);
  assert.equal(system.request('car-a', '10,10', 100), false);
  assert.deepEqual(system.waiting('10,10'), ['car-a', 'car-b']);

  assert.equal(system.request('car-b', '10,10', 450), true);
  assert.equal(system.request('car-a', '10,10', 800), false);
  assert.equal(system.diagnostic('car-b').leaseExpiresAt, 950);

  system.release('car-b', '10,10');
  assert.equal(system.request('car-a', '10,10', 801), true);
  assert.equal(system.diagnostic('car-a').phase, 'approach');
});

test('blocked queue head waits without surrendering deterministic FIFO order', () => {
  const system = new TrafficJunctionSystem(500);
  assert.equal(system.request('car-b', 'junction', 100, true), false);
  assert.equal(system.request('car-a', 'junction', 101), false);
  assert.deepEqual(system.waiting('junction'), ['car-b', 'car-a']);
  assert.deepEqual(system.diagnostic('car-b'), {
    junctionId: 'junction',
    phase: 'waiting',
    queuePosition: 1,
    leaseExpiresAt: 0,
    movementId: 'exclusive:junction',
    movementTurn: 'uturn',
    movementPath: [],
    activeOwnerCount: 0,
    conflictingOwnerCount: 0
  });

  assert.equal(system.request('car-b', 'junction', 200), true);
  assert.equal(system.request('car-b', 'junction', 250, true), false);
  assert.equal(system.diagnostic('car-b').phase, 'waiting');
  assert.equal(system.request('car-a', 'junction', 251), false);
});

test('crossing ownership ignores new blockers and releases only after rear clearance', () => {
  const system = new TrafficJunctionSystem(500);
  assert.equal(system.request('owner', 'junction', 100), true);
  assert.equal(system.markCrossing('owner', 'junction', 200), true);
  assert.equal(system.request('owner', 'junction', 300, true), true);
  assert.equal(system.diagnostic('owner').phase, 'crossing');

  assert.equal(system.markClearing('owner', 'junction', 100, 200, 400), true);
  assert.equal(system.maintain('owner', 120, 200, 42, 500), true);
  assert.equal(system.diagnostic('owner').phase, 'clearing');
  assert.equal(system.request('next', 'junction', 501), false);

  assert.equal(system.maintain('owner', 142, 200, 42, 600), false);
  assert.equal(system.diagnostic('owner').phase, 'none');
  assert.equal(system.request('next', 'junction', 601), true);
});

test('abandoned reservations expire and allow the next waiter to proceed', () => {
  const system = new TrafficJunctionSystem(500);
  assert.equal(system.request('car-c', 'junction', 300), true);
  assert.equal(system.request('car-d', 'junction', 301), false);
  assert.equal(system.request('car-d', 'junction', 800), true);
  assert.equal(system.diagnostic('car-c').phase, 'none');
});

test('changing routes removes stale queue membership from the prior junction', () => {
  const system = new TrafficJunctionSystem();
  assert.equal(system.request('car', 'first', 100, true), false);
  assert.equal(system.isQueued('car', 'first'), true);
  assert.equal(system.request('car', 'second', 200), true);
  assert.equal(system.isQueued('car', 'first'), false);
  assert.equal(system.diagnostic('car').junctionId, 'second');
});

test('compatible movement owners cross and clear independently', () => {
  const system = new TrafficJunctionSystem(500);
  const northbound = movement('northbound', 'north-entry', 'north-exit', 0);
  const southbound = movement('southbound', 'south-entry', 'south-exit', 40);
  assert.equal(system.request('north-car', 'junction', 100, false, northbound), true);
  assert.equal(system.request('south-car', 'junction', 101, false, southbound), true);
  assert.deepEqual(system.activeOwners('junction'), ['north-car', 'south-car']);
  assert.equal(system.diagnostic('north-car').activeOwnerCount, 2);
  assert.deepEqual(system.compatibleOwnerIds('north-car', 'junction'), new Set(['south-car']));

  assert.equal(system.markCrossing('north-car', 'junction', 150), true);
  assert.equal(system.markCrossing('south-car', 'junction', 151), true);
  assert.equal(system.markClearing('north-car', 'junction', 0, 80, 200), true);
  assert.equal(system.markClearing('south-car', 'junction', 40, -80, 201), true);
  assert.equal(system.maintain('north-car', 0, 122, 42, 250), false);
  assert.deepEqual(system.activeOwners('junction'), ['south-car']);
  assert.equal(system.diagnostic('south-car').phase, 'clearing');
  assert.equal(system.maintain('south-car', 40, -122, 42, 251), false);
  assert.deepEqual(system.activeOwners('junction'), []);
});

test('conflicting FIFO waits while an unrelated compatible stream proceeds', () => {
  const system = new TrafficJunctionSystem(500);
  const owner = movement('owner', 'owner-entry', 'owner-exit', 0);
  const crossing = {
    ...movement('crossing', 'cross-entry', 'cross-exit', 0),
    path: [{x: -80, y: 0}, {x: 80, y: 0}]
  };
  const unrelated = movement('unrelated', 'other-entry', 'other-exit', 140);
  assert.equal(system.request('owner-car', 'junction', 100, false, owner), true);
  assert.equal(system.request('blocked-car', 'junction', 110, false, crossing), false);
  assert.equal(system.diagnostic('blocked-car').conflictingOwnerCount, 1);
  assert.equal(system.request('other-car', 'junction', 120, false, unrelated), true);
  assert.deepEqual(system.activeOwners('junction'), ['other-car', 'owner-car']);

  system.release('owner-car', 'junction');
  system.release('other-car', 'junction');
  assert.equal(system.request('blocked-car', 'junction', 130, false, crossing), true);
});

test('one expired compatible owner does not release another lease', () => {
  const system = new TrafficJunctionSystem(500);
  assert.equal(system.request(
    'first',
    'junction',
    100,
    false,
    movement('first', 'first-entry', 'first-exit', 0)
  ), true);
  assert.equal(system.request(
    'second',
    'junction',
    200,
    false,
    movement('second', 'second-entry', 'second-exit', 40)
  ), true);
  assert.equal(system.request(
    'second',
    'junction',
    650,
    false,
    movement('second', 'second-entry', 'second-exit', 40)
  ), true);
  assert.equal(system.diagnostic('first').phase, 'none');
  assert.equal(system.diagnostic('second').phase, 'approach');
});

function movement(
  id: string,
  entryLaneId: string,
  exitLaneId: string,
  x: number
): TrafficJunctionMovement {
  return {
    id,
    junctionId: 'junction',
    turn: 'straight',
    entryLaneId,
    exitLaneId,
    path: [{x, y: -80}, {x, y: 80}],
    sweptHalfWidth: 18.5,
    exclusive: false
  };
}
