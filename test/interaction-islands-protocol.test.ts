import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERACTION_PROTOCOL_VERSION,
  validateInteractionSnapshot,
  type InteractionSnapshot
} from '../shared/protocol/interaction-islands.ts';

function snapshot(): InteractionSnapshot {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick: 100,
    baselineTick: 99,
    serverTimeMs: 10_000,
    worldCollisionRevision: 2,
    streamRevision: 4,
    surfaceRevision: 7,
    controlRevision: 3,
    rootLifecycleRevision: 5,
    rootBodyKey: 'vehicle:local',
    rootMode: 'driver',
    acknowledgedLocalInputSequence: 22,
    confirmedEventsThrough: 99,
    bodies: [{
      key: 'vehicle:local',
      actorType: 'vehicle',
      entityId: 'local',
      spaceId: 'street',
      surfaceId: 'ground',
      shapeKey: 'vehicle:cop-car',
      shapeRevision: 1,
      lifecycleRevision: 5,
      priority: 'player-controlled',
      x: 10,
      y: 20,
      rotation: 0,
      linvelX: 3,
      linvelY: 0,
      angvel: 0
    }, {
      key: 'vehicle:remote',
      actorType: 'vehicle',
      entityId: 'remote',
      spaceId: 'street',
      surfaceId: 'ground',
      shapeKey: 'vehicle:cop-car',
      shapeRevision: 1,
      lifecycleRevision: 2,
      priority: 'ambient',
      x: 30,
      y: 20,
      rotation: 0,
      linvelX: -2,
      linvelY: 0,
      angvel: 0
    }],
    intents: [{
      bodyKey: 'vehicle:remote',
      appliedAtServerTick: 99,
      moveX: 0,
      moveY: 0,
      steering: 0.2,
      throttle: 1,
      handbrake: false,
      movementScale: 1
    }],
    contacts: [{firstBodyKey: 'vehicle:local', secondBodyKey: 'vehicle:remote'}]
  };
}

const CONTEXT = Object.freeze({
  currentServerTick: 100,
  expectedWorldCollisionRevision: 2,
  expectedStreamRevision: 4,
  expectedSurfaceRevision: 7,
  expectedControlRevision: 3,
  expectedRootBodyKey: 'vehicle:local'
});

test('interaction snapshot validates and freezes a same-surface baseline', () => {
  const result = validateInteractionSnapshot(snapshot(), CONTEXT);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.bodies), true);
  assert.equal(result.value.rootBodyKey, 'vehicle:local');
});

test('interaction snapshot fails closed across streaming, surface, and lifecycle changes', () => {
  assert.deepEqual(validateInteractionSnapshot(snapshot(), {...CONTEXT, expectedStreamRevision: 5}), {
    accepted: false,
    reason: 'stream-revision-mismatch'
  });
  assert.deepEqual(validateInteractionSnapshot(snapshot(), {...CONTEXT, expectedSurfaceRevision: 8}), {
    accepted: false,
    reason: 'surface-revision-mismatch'
  });
  assert.deepEqual(validateInteractionSnapshot({
    ...snapshot(),
    rootLifecycleRevision: 6
  }, CONTEXT), {accepted: false, reason: 'invalid-root'});
});

test('interaction snapshot rejects mixed surfaces and dangling contact pairs', () => {
  const mixed = snapshot();
  assert.deepEqual(validateInteractionSnapshot({
    ...mixed,
    bodies: [mixed.bodies[0], {...mixed.bodies[1], surfaceId: 'bridge'}]
  }, CONTEXT), {accepted: false, reason: 'mixed-surface-baseline'});
  assert.deepEqual(validateInteractionSnapshot({
    ...snapshot(),
    contacts: [{firstBodyKey: 'vehicle:local', secondBodyKey: 'vehicle:missing'}]
  }, CONTEXT), {accepted: false, reason: 'missing-contact-body'});
});
