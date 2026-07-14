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
  assert.equal(controller.latestBaseline()?.serverTick, 1);
  source.emit(snapshot(2));
  assert.deepEqual(observed, [1, 2]);
  assert.equal(controller.latestBaseline()?.serverTick, 2);
  controller.destroy();
  source.emit(snapshot(3));
  assert.deepEqual(observed, [1, 2]);
  assert.equal(controller.latest(), undefined);
  assert.equal(controller.latestBaseline(), undefined);
});

test('interaction island controller can replay through injected family kernels', () => {
  const source = new FakeSnapshotSource();
  const results: boolean[] = [];
  let now = 5;
  const controller = new InteractionIslandController(source, {
    budget: 20,
    networkConditions: () => ({rttMs: 100, interpolationDelayMs: 90, jitterMs: 10}),
    replay: {
      currentServerTick: () => 3,
      worldCollisionRevision: () => 1,
      stepBody: (entity) => ({...entity, x: entity.x + 1}),
      onReplay: (result, durationMs) => {
        results.push(result.replayed);
        assert.equal(durationMs, 1);
      },
      now: () => now++
    }
  });
  source.emit(snapshot(1));
  assert.deepEqual(results, [true]);
  const replay = controller.latestReplay();
  assert.equal(replay?.replayed, true);
  if (replay?.replayed) assert.equal(replay.entities[0].x, 2);
  controller.destroy();
});

test('interaction island rollout gate clears state and resumes on a later snapshot', () => {
  const source = new FakeSnapshotSource();
  let enabled = false;
  const controller = new InteractionIslandController(source, {
    enabled: () => enabled,
    budget: 20,
    networkConditions: () => ({rttMs: 100, interpolationDelayMs: 90, jitterMs: 10})
  });
  source.emit(snapshot(1));
  assert.equal(controller.latest(), undefined);
  enabled = true;
  source.emit(snapshot(2));
  assert.equal(controller.latest()?.serverTick, 2);
  enabled = false;
  source.emit(snapshot(3));
  assert.equal(controller.latest(), undefined);
  assert.equal(controller.latestBaseline(), undefined);
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
    controlRevision: 1,
    controlMode: 'driver',
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
