import assert from 'node:assert/strict';
import test from 'node:test';
import {RoadClosureRegistry} from '../server/game/traffic/road-closure-registry.ts';

test('road closures retain overlapping owners until the final owner releases', () => {
  const closures = new RoadClosureRegistry();

  closures.acquire('roadblock-a', ['edge-b', 'edge-a', 'edge-a']);
  assert.equal(closures.revision, 1);
  assert.deepEqual(closures.closedEdgeIds(), ['edge-a', 'edge-b']);
  assert.deepEqual(closures.diagnostics(), [{
    revision: 1,
    ownerId: 'roadblock-a',
    edgeIds: ['edge-a', 'edge-b']
  }]);

  closures.acquire('roadblock-a', ['edge-a', 'edge-b']);
  assert.equal(closures.revision, 1, 'idempotent acquisition must not invalidate routes');

  closures.acquire('roadblock-b', ['edge-b', 'edge-c']);
  assert.equal(closures.revision, 2);
  assert.equal(closures.isClosed('edge-b'), true);

  assert.equal(closures.release('roadblock-a'), true);
  assert.equal(closures.revision, 3);
  assert.equal(closures.isClosed('edge-a'), false);
  assert.equal(closures.isClosed('edge-b'), true);
  assert.deepEqual(closures.closedEdgeIds(), ['edge-b', 'edge-c']);

  assert.equal(closures.release('roadblock-b'), true);
  assert.equal(closures.release('roadblock-b'), false);
  assert.equal(closures.revision, 4);
  assert.deepEqual(closures.closedEdgeIds(), []);
});

test('road closures reject anonymous or empty ownership claims', () => {
  const closures = new RoadClosureRegistry();
  assert.throws(() => closures.acquire(' ', ['edge-a']), /owner id/i);
  assert.throws(() => closures.acquire('roadblock-a', [' ', '']), /at least one edge/i);
});
