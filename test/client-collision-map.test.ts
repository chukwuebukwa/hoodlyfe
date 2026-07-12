import assert from 'node:assert/strict';
import test from 'node:test';
import {ClientCollisionMap} from '../src/game/world/client-collision-map.ts';

test('client collision map mirrors street radius samples and map boundaries', () => {
  const collision = new ClientCollisionMap({
    width: 3,
    height: 2,
    tilewidth: 64,
    tileheight: 64,
    layers: [{name: 'collisions', data: [1, 0, 1, 1, 0, 1]}]
  });
  assert.equal(collision.canOccupy('street', 96, 64, 11), true);
  assert.equal(collision.canOccupy('street', 70, 64, 11), false);
  assert.equal(collision.canOccupy('street', -1, 64, 11), false);
});

test('client collision map enforces authored interior walls and fixtures', () => {
  const collision = new ClientCollisionMap({
    width: 1,
    height: 1,
    tilewidth: 64,
    tileheight: 64,
    layers: [{name: 'collisions', data: [0]}]
  });
  assert.equal(collision.canOccupy('mercy-hospital', 2720, 1820, 11), false);
  assert.equal(collision.canOccupy('mercy-hospital', 2672, 1760, 11), true);
  assert.equal(collision.canOccupy('missing-interior', 0, 0, 11), false);
});
