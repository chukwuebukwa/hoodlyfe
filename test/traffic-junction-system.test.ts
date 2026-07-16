import assert from 'node:assert/strict';
import test from 'node:test';
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
    leaseExpiresAt: 0
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
