import assert from 'node:assert/strict';
import test from 'node:test';
import type {VehicleInteractionState} from '../shared/protocol/interaction-contracts.ts';
import {InteractionReplayPresentation} from '../src/game/rendering/interaction-replay-presentation.ts';
import type {InteractionIslandBaseline} from '../src/game/prediction/island-state-history.ts';

test('promoted remote poses survive stale authority and release at replay target time', () => {
  const presentation = new InteractionReplayPresentation();
  const source = baseline();
  assert.equal(presentation.promote(source, {
    replayed: true,
    baselineTick: 100,
    targetServerTick: 103,
    replayedTicks: 3,
    bodySteps: 6,
    pairSteps: 3,
    confirmedEventsThrough: 100,
    entities: [vehicle('local', 20), vehicle('remote', 80)],
    rootStates: [],
    suppressedEffects: suppressionCounts()
  }), 1);
  assert.equal(presentation.pose('vehicle', 'remote')?.x, 80);
  presentation.observeAuthority('vehicle', 'remote', 1_066);
  assert.equal(presentation.pose('vehicle', 'remote')?.x, 80);
  presentation.observeAuthority('vehicle', 'remote', 1_100);
  assert.equal(presentation.pose('vehicle', 'remote'), undefined);
});

test('presentation ignores failed and older replay results and removes despawned actors', () => {
  const presentation = new InteractionReplayPresentation();
  const source = baseline();
  presentation.promote(source, replay(104, 4, 90));
  presentation.promote(source, replay(103, 3, 70));
  presentation.promote(source, {replayed: false, reason: 'kernel-error'});
  assert.equal(presentation.pose('vehicle', 'remote')?.x, 90);
  presentation.remove('vehicle', 'remote');
  assert.equal(presentation.size(), 0);
});

function replay(targetServerTick: number, replayedTicks: number, x: number) {
  return {
    replayed: true as const,
    baselineTick: 100,
    targetServerTick,
    replayedTicks,
    bodySteps: replayedTicks * 2,
    pairSteps: replayedTicks,
    confirmedEventsThrough: 100,
    entities: [vehicle('local', 20), vehicle('remote', x)],
    rootStates: [],
    suppressedEffects: suppressionCounts()
  };
}

function baseline(): InteractionIslandBaseline {
  return {
    serverTick: 100,
    serverTimeMs: 1_000,
    worldCollisionRevision: 1,
    controlRevision: 1,
    controlMode: 'driver',
    acknowledgedLocalInputSequence: 10,
    confirmedEventsThrough: 100,
    rootId: 'local',
    entities: [vehicle('local', 0), vehicle('remote', 50)],
    remoteIntents: []
  };
}

function vehicle(id: string, x: number): VehicleInteractionState {
  return {
    id,
    kind: 'vehicle',
    spaceId: 'street',
    layerId: 'ground',
    x,
    y: 0,
    angle: 0,
    velocityX: 0,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: 'player-controlled',
    vehicleKind: 'sedan',
    speed: 0,
    steering: 0,
    engineDamage: 0,
    onFire: false,
    destroyed: false
  };
}

function suppressionCounts() {
  return Object.freeze({
    'idempotent-presentation': 0,
    'one-shot-presentation': 0,
    'authoritative-gameplay': 0,
    'durable-transaction': 0
  });
}
