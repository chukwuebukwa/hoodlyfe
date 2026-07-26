import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PhysicsBodyRegistry,
  type PhysicsActorDescriptor,
  type PhysicsLifecycleOperations
} from '../server/game/vehicles/physics-body-registry.ts';
import {initializePhysicsEngine, PhysicsWorld} from '../engine/adapters/surface-physics.ts';

await initializePhysicsEngine();

test('registry reuses ordinary bodies and counts only explicit teleports', () => {
  const root = createWorld();
  const registry = new PhysicsBodyRegistry(() => root);
  const descriptor = vehicleDescriptor();

  assert.deepEqual(registry.reconcile([descriptor]), operations({created: 1}));
  const identity = registry.bodyIdentity(descriptor.key);
  assert.equal(root.bodyCount, 1);

  root.step();
  const authoritative = root.capture(descriptor.key)!;
  assert.deepEqual(registry.reconcile([{...descriptor, state: authoritative}]), operations());
  assert.equal(registry.bodyIdentity(descriptor.key), identity);

  assert.deepEqual(registry.reconcile([{
    ...descriptor,
    state: {...authoritative, x: authoritative.x + 2}
  }]), operations({teleported: 1}));
  assert.equal(registry.bodyIdentity(descriptor.key), identity);
  root.free();
});

test('registry deterministically migrates, replaces, and removes bodies', () => {
  const root = createWorld();
  const upper = root.fork(false);
  const registry = new PhysicsBodyRegistry((surfaceId) => (
    surfaceId === 'street-ground' ? root : upper
  ));
  const descriptor = vehicleDescriptor();
  registry.reconcile([descriptor]);

  assert.deepEqual(registry.reconcile([{
    ...descriptor,
    surfaceId: 'bridge-deck'
  }]), operations({migrated: 1}));
  assert.equal(root.has(descriptor.key), false);
  assert.equal(upper.has(descriptor.key), true);

  assert.deepEqual(registry.reconcile([{
    ...descriptor,
    surfaceId: 'bridge-deck',
    shapeKey: 'vehicle:taxi'
  }]), operations({replaced: 1}));
  assert.deepEqual(registry.reconcile([]), operations({removed: 1}));
  assert.equal(registry.bodyCount, 0);
  assert.equal(upper.bodyCount, 0);
  assert.deepEqual(registry.cumulativeOperations(), operations({
    created: 1,
    removed: 1,
    migrated: 1,
    replaced: 1
  }));
  root.free();
});

test('registry rejects duplicate actor keys before mutating the world', () => {
  const root = createWorld();
  const registry = new PhysicsBodyRegistry(() => root);
  const descriptor = vehicleDescriptor();
  assert.throws(() => registry.reconcile([descriptor, descriptor]), /Duplicate physics actor key/);
  assert.equal(root.bodyCount, 0);
  root.free();
});

function createWorld(): PhysicsWorld {
  return PhysicsWorld.create({
    width: 64,
    height: 64,
    tileWidth: 64,
    tileHeight: 64,
    collisions: new Array(64 * 64).fill(0)
  });
}

function vehicleDescriptor(): PhysicsActorDescriptor {
  return {
    key: 'vehicle:car',
    actorType: 'vehicle',
    entityId: 'car',
    surfaceId: 'street-ground',
    shapeKey: 'vehicle:sedan',
    state: {x: 1000, y: 1000, rotation: 0, linvelX: 30, linvelY: 0, angvel: 0}
  };
}

function operations(overrides: Partial<PhysicsLifecycleOperations> = {}): PhysicsLifecycleOperations {
  return {created: 0, removed: 0, migrated: 0, replaced: 0, teleported: 0, ...overrides};
}
