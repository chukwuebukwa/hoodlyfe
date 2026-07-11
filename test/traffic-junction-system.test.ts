import assert from 'node:assert/strict';
import test from 'node:test';
import {TrafficJunctionSystem} from '../server/game/traffic/traffic-junction-system.ts';

test('junction reservations serialize arrivals and expire abandoned ownership', () => {
  const system = new TrafficJunctionSystem(500);
  assert.equal(system.request('car-b', '10,10', 100), true);
  assert.equal(system.request('car-a', '10,10', 100), false);
  assert.deepEqual(system.waiting('10,10'), ['car-a', 'car-b']);
  system.release('car-b', '10,10');
  assert.equal(system.request('car-a', '10,10', 200), true);

  assert.equal(system.request('car-c', '20,20', 300), true);
  assert.equal(system.request('car-d', '20,20', 301), false);
  assert.equal(system.request('car-c', '20,20', 700), true);
  assert.equal(system.request('car-d', '20,20', 800), true);
});
