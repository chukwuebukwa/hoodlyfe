import assert from 'node:assert/strict';
import test from 'node:test';
import {INTERACTION_SNAPSHOT_MESSAGE, type InteractionSnapshot} from '../shared/protocol/interaction-islands.ts';
import {InteractionSnapshotInbox} from '../src/game/network/interaction-snapshot-inbox.ts';

test('inbox validates, sorts, replaces, and bounds interaction snapshots', () => {
  let receive: (message: unknown) => void = () => undefined;
  let removed = false;
  let currentTick = 10;
  const inbox = new InteractionSnapshotInbox({
    onMessage(type, callback) {
      assert.equal(type, INTERACTION_SNAPSHOT_MESSAGE);
      receive = (message) => callback(message as never);
      return () => { removed = true; };
    }
  }, {currentServerTick: () => currentTick, enabled: () => true});
  receive(snapshot(10));
  receive(snapshot(9));
  receive({...snapshot(10), serverTimeMs: 11});
  assert.deepEqual(inbox.snapshots().map(({serverTick}) => serverTick), [9, 10]);
  assert.equal(inbox.latest()?.serverTimeMs, 11);
  currentTick = 50;
  receive(snapshot(50));
  assert.deepEqual(inbox.snapshots().map(({serverTick}) => serverTick), [50]);
  assert.equal(inbox.diagnostics().accepted, 4);
  inbox.destroy();
  assert.equal(removed, true);
});

test('inbox ignores disabled delivery and records protocol rejection reasons', () => {
  let receive: (message: unknown) => void = () => undefined;
  let enabled = false;
  const inbox = new InteractionSnapshotInbox({
    onMessage(_type, callback) { receive = (message) => callback(message as never); }
  }, {currentServerTick: () => 20, enabled: () => enabled});
  receive(snapshot(20));
  assert.equal(inbox.latest(), undefined);
  enabled = true;
  receive(snapshot(30));
  receive({...snapshot(20), worldCollisionRevision: 99});
  assert.deepEqual(inbox.diagnostics().rejectionCounts, {
    'future-snapshot': 1,
    'collision-revision-mismatch': 1
  });
});

function snapshot(serverTick: number): InteractionSnapshot {
  return {
    protocolVersion: 7,
    serverTick,
    baselineTick: serverTick,
    serverTimeMs: serverTick,
    worldCollisionRevision: 2,
    streamRevision: 1,
    surfaceRevision: 1,
    controlRevision: 1,
    rootLifecycleRevision: 1,
    rootBodyKey: 'player:p1',
    rootMode: 'on-foot',
    acknowledgedLocalInputSequence: 0,
    confirmedEventsThrough: serverTick,
    bodies: [body('player:p1', 'player')],
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
