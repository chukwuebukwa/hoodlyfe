import assert from 'node:assert/strict';
import test from 'node:test';
import {INTERIORS, STREET_SPACE_ID} from '../shared/content/interior-catalog.ts';
import {BUILDING_MANIFEST} from '../shared/content/building-manifest.ts';
import {
  QA_TELEPORT_DESTINATIONS,
  isQaTeleportMessage,
  type QaTeleportDestinationId
} from '../shared/protocol/qa-teleport.ts';
import {resolveQaTeleportTarget} from '../server/game/qa/qa-teleport.ts';
import {PLAYER_RADIUS} from '../server/game/players/player-control-controller.ts';
import {CollisionMap} from '../server/world-map.ts';

test('QA teleport protocol only accepts catalog destinations', () => {
  assert.equal(isQaTeleportMessage({destinationId: 'quick-stop-market'}), true);
  assert.equal(isQaTeleportMessage({destinationId: 'eastside-quick-mart'}), true);
  assert.equal(isQaTeleportMessage({destinationId: 'westside-auto-garage'}), true);
  assert.equal(isQaTeleportMessage({destinationId: 'unknown-place'}), false);
  assert.equal(isQaTeleportMessage({destinationId: 7}), false);
  assert.equal(isQaTeleportMessage(null), false);
});

test('QA teleport destinations are generated from the building manifest', () => {
  assert.deepEqual(
    QA_TELEPORT_DESTINATIONS.slice(1),
    BUILDING_MANIFEST.buildings.map(({id, label}) => ({id, label}))
  );
});

test('every QA teleport destination resolves against the production map', () => {
  const world = CollisionMap.load();
  for (const destination of QA_TELEPORT_DESTINATIONS) {
    const target = resolveQaTeleportTarget(destination.id, world, 0, PLAYER_RADIUS);
    assert.ok(target, destination.id);
    if (target.spaceId === STREET_SPACE_ID) {
      assert.equal(
        world.canOccupy(target.x, target.y, PLAYER_RADIUS, target.surfaceId, 'player'),
        true,
        destination.id
      );
    }
  }
});

test('isolated interior QA destinations use their authored entry poses', () => {
  const world = CollisionMap.load();
  for (const interior of INTERIORS) {
    const target = resolveQaTeleportTarget(
      interior.id as QaTeleportDestinationId,
      world,
      0,
      PLAYER_RADIUS
    );
    assert.deepEqual(target, {
      ...interior.entry,
      spaceId: interior.id,
      surfaceId: 'street-ground'
    });
  }
});

test('QA teleport resolver rejects destinations outside the catalog', () => {
  const world = CollisionMap.load();
  assert.equal(
    resolveQaTeleportTarget('unknown-place' as QaTeleportDestinationId, world, 0, PLAYER_RADIUS),
    undefined
  );
});
