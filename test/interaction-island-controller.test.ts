import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  InteractionSnapshot
} from '../shared/protocol/interaction-contracts.ts';
import {INTERACTION_PROTOCOL_VERSION} from '../shared/protocol/interaction-contracts.ts';
import {
  InteractionIslandController,
  type InteractionSnapshotSource
} from '../src/game/network/interaction-island-controller.ts';

test('interaction island controller consumes the latest baseline and stops on destroy', () => {
  const source = new FakeSnapshotSource(snapshot(1));
  const observed: number[] = [];
  const controller = new InteractionIslandController(source, {
    budget: 20,
    networkConditions: () => ({rttMs: 100, interpolationDelayMs: 90, jitterMs: 10}),
    onSelection: (selection) => observed.push(selection.serverTick)
  });
  assert.equal(controller.latest()?.serverTick, 1);
  assert.equal(controller.latest()?.budget, 20);
  source.emit(snapshot(2));
  assert.deepEqual(observed, [1, 2]);
  controller.destroy();
  source.emit(snapshot(3));
  assert.deepEqual(observed, [1, 2]);
  assert.equal(controller.latest(), undefined);
});

class FakeSnapshotSource implements InteractionSnapshotSource {
  private listener?: (snapshot: InteractionSnapshot) => void;

  constructor(private current?: InteractionSnapshot) {}

  latest(): InteractionSnapshot | undefined {
    return this.current;
  }

  subscribe(listener: (snapshot: InteractionSnapshot) => void): () => void {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }

  emit(snapshot: InteractionSnapshot): void {
    this.current = snapshot;
    this.listener?.(snapshot);
  }
}

function snapshot(serverTick: number): InteractionSnapshot {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    serverTimeMs: serverTick * 1000 / 30,
    worldCollisionRevision: 1,
    acknowledgedLocalInputSequence: serverTick,
    confirmedEventsThrough: serverTick,
    entities: [{
      id: 'local',
      kind: 'player',
      spaceId: 'street',
      layerId: 'ground',
      x: 0,
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
