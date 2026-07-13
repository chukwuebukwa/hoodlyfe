import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERACTION_PROTOCOL_VERSION,
  INTERACTION_SNAPSHOT_MESSAGE,
  type InteractionSnapshot
} from '../shared/protocol/interaction-contracts.ts';
import {
  InteractionSnapshotInbox,
  type InteractionSnapshotMessageRoom
} from '../src/game/network/interaction-snapshot-inbox.ts';

test('snapshot inbox validates, orders, replaces, and bounds accepted baselines', () => {
  const room = new FakeRoom();
  let currentTick = 1;
  const inbox = new InteractionSnapshotInbox(room, {
    currentServerTick: () => currentTick,
    worldCollisionRevision: 3,
    historyTicks: 4
  });
  const received: number[] = [];
  inbox.subscribe((snapshot) => received.push(snapshot.serverTick));

  for (let tick = 1; tick <= 6; tick++) {
    currentTick = tick;
    room.emit(snapshot(tick, tick * 10));
  }
  room.emit(snapshot(6, 999));

  assert.deepEqual(inbox.history().map(({serverTick}) => serverTick), [3, 4, 5, 6]);
  assert.equal(inbox.latest()?.serverTimeMs, 999);
  assert.equal(inbox.at(2), undefined);
  assert.deepEqual(received, [1, 2, 3, 4, 5, 6, 6]);
  assert.equal(Object.isFrozen(inbox.history()), true);
});

test('snapshot inbox rejects incompatible messages and unregisters on destroy', () => {
  const room = new FakeRoom();
  let currentTick = 10;
  const inbox = new InteractionSnapshotInbox(room, {
    currentServerTick: () => currentTick,
    worldCollisionRevision: 3
  });
  room.emit({...snapshot(10, 100), worldCollisionRevision: 4});
  room.emit(snapshot(12, 120));
  room.emit({...snapshot(10, 100), serverTick: 40});
  assert.deepEqual(inbox.history().map(({serverTick}) => serverTick), [12]);
  assert.equal(inbox.rejections().get('collision-revision-mismatch'), 1);
  assert.equal(inbox.rejections().get('future-snapshot'), 1);
  inbox.destroy();
  currentTick = 11;
  room.emit(snapshot(11, 110));
  assert.equal(inbox.history().length, 0);
});

test('snapshot inbox rejects invalid retention, lead, and collision configuration', () => {
  const room = new FakeRoom();
  const base = {currentServerTick: () => 0, worldCollisionRevision: 1};
  assert.throws(() => new InteractionSnapshotInbox(room, {...base, historyTicks: 0}));
  assert.throws(() => new InteractionSnapshotInbox(room, {...base, maximumFutureTicks: -1}));
  assert.throws(() => new InteractionSnapshotInbox(room, {...base, worldCollisionRevision: 0}));
});

class FakeRoom implements InteractionSnapshotMessageRoom {
  private listener?: (message: unknown) => void;

  onMessage<T>(type: string, callback: (message: T) => void): () => void {
    assert.equal(type, INTERACTION_SNAPSHOT_MESSAGE);
    this.listener = callback as (message: unknown) => void;
    return () => { this.listener = undefined; };
  }

  emit(message: unknown): void {
    this.listener?.(message);
  }
}

function snapshot(serverTick: number, serverTimeMs: number): InteractionSnapshot {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    serverTimeMs,
    worldCollisionRevision: 3,
    acknowledgedLocalInputSequence: serverTick,
    confirmedEventsThrough: serverTick,
    entities: [{
      id: 'local',
      kind: 'player',
      spaceId: 'street',
      layerId: 'ground',
      x: serverTick,
      y: 0,
      angle: 0,
      velocityX: 0,
      velocityY: 0,
      angularVelocity: 0,
      colliderRevision: 1,
      lifecycleRevision: 1,
      interactionPriority: 'player-controlled',
      radius: 11,
      movementMode: 'idle',
      actionPhase: 'free',
      actionTick: 0,
      surfaceId: 'street',
      alive: true
    }],
    remoteIntents: []
  };
}
