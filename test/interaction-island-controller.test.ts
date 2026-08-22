import assert from 'node:assert/strict';
import test from 'node:test';
import {INTERACTION_SNAPSHOT_MESSAGE, type InteractionSnapshot} from '../shared/protocol/interaction-islands.ts';
import {InteractionIslandController} from '../src/game/network/interaction-island-controller.ts';

test('controller keeps admission observational until selection rollout is enabled', () => {
  let receive: (message: unknown) => void = () => undefined;
  let selectionEnabled = false;
  const controller = new InteractionIslandController({
    onMessage(type, callback) {
      assert.equal(type, INTERACTION_SNAPSHOT_MESSAGE);
      receive = (message) => callback(message as never);
    }
  }, {
    currentServerTick: () => 4,
    estimatedServerTimeMs: () => 80,
    snapshotsEnabled: () => true,
    selectionEnabled: () => selectionEnabled
  });
  receive(snapshot(4));
  assert.equal(controller.snapshot().mode, 'admission');
  assert.equal(controller.latestSelection(), undefined);
  selectionEnabled = true;
  receive(snapshot(4));
  assert.equal(controller.snapshot().mode, 'selection');
  assert.deepEqual(controller.latestSelection()?.bodyKeys, ['player:p1', 'vehicle:v1']);
  assert.equal(controller.snapshot().snapshotAgeMs, 16);
});

function snapshot(serverTick: number): InteractionSnapshot {
  return {
    protocolVersion: 7,
    serverTick,
    baselineTick: serverTick,
    serverTimeMs: 64,
    worldCollisionRevision: 2,
    streamRevision: 1,
    surfaceRevision: 1,
    controlRevision: 1,
    rootLifecycleRevision: 1,
    rootBodyKey: 'player:p1',
    rootMode: 'on-foot',
    acknowledgedLocalInputSequence: 0,
    confirmedEventsThrough: serverTick,
    bodies: [body('player:p1', 'player'), body('vehicle:v1', 'vehicle')],
    intents: [],
    contacts: []
  };
}

function body(key: string, actorType: 'player' | 'vehicle') {
  return {
    key,
    actorType,
    entityId: key,
    spaceId: 'street',
    surfaceId: 'street:ground',
    shapeKey: actorType,
    shapeRevision: 1,
    lifecycleRevision: 1,
    priority: 'player-controlled' as const,
    x: 0,
    y: 0,
    rotation: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0
  };
}
