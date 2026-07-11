import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEBUG_SNAPSHOT_MESSAGE,
  DEBUG_SUBSCRIBE_MESSAGE,
  DEBUG_UNSUBSCRIBE_MESSAGE,
  type DebugSnapshot
} from '../shared/protocol/debug.ts';
import {
  DebugSnapshotSubscription,
  type DebugMessageRoom
} from '../src/game/debug/debug-snapshot-subscription.ts';

test('debug subscription installs its handler before subscribing and tears both down once', () => {
  const operations: string[] = [];
  let handler: ((snapshot: DebugSnapshot) => void) | undefined;
  let removals = 0;
  const room: DebugMessageRoom = {
    onMessage: <T>(type: string, callback: (message: T) => void) => {
      operations.push(`listen:${type}`);
      handler = callback as (snapshot: DebugSnapshot) => void;
      return () => {
        removals++;
        handler = undefined;
      };
    },
    send: (type: string) => operations.push(`send:${type}`)
  };
  const received: DebugSnapshot[] = [];
  const subscription = new DebugSnapshotSubscription({
    room,
    onSnapshot: (snapshot) => received.push(snapshot)
  });

  subscription.start();
  subscription.start();
  assert.deepEqual(operations, [
    `listen:${DEBUG_SNAPSHOT_MESSAGE}`,
    `send:${DEBUG_SUBSCRIBE_MESSAGE}`
  ]);
  handler?.(createSnapshot());
  assert.equal(received.length, 1);

  subscription.destroy();
  subscription.destroy();
  assert.equal(removals, 1);
  assert.deepEqual(operations.at(-1), `send:${DEBUG_UNSUBSCRIBE_MESSAGE}`);
});

function createSnapshot(): DebugSnapshot {
  return {
    tick: 1,
    nowMs: 33,
    droppedMs: 0,
    spatialEntities: 0,
    deferredCommands: 0,
    eventsThisTick: 0,
    players: 0,
    npcs: 0,
    vehicles: 0,
    bullets: 0,
    incidents: [],
    pursuits: [],
    events: []
  };
}
