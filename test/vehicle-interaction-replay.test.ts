import assert from 'node:assert/strict';
import test from 'node:test';
import {VEHICLE_SIMULATION_STEP_SECONDS} from '../shared/simulation/vehicle-step.ts';
import type {InteractionIslandBaseline} from '../src/game/prediction/island-state-history.ts';
import {replayInteractionIsland} from '../src/game/prediction/interaction-island-replay.ts';
import {SavedVehiclePrediction} from '../src/game/prediction/saved-vehicle-prediction.ts';
import {
  applyVehicleInteractionReplay,
  createVehicleInteractionBodyStep,
  createVehicleInteractionPairStep,
  prepareVehicleInteractionReplay
} from '../src/game/prediction/vehicle-interaction-replay.ts';

test('vehicle replay maps contiguous saved moves onto authoritative server ticks', () => {
  const prediction = predictedDriver();
  const source = baseline();
  const preparation = prepareVehicleInteractionReplay(prediction, source);

  assert.deepEqual(preparation, {
    targetServerTick: 101,
    localCommands: [{
      serverTick: 101,
      entityId: 'local',
      moveX: 0,
      moveY: 0,
      steering: 0,
      throttle: 1,
      movementScale: 1
    }]
  });
});

test('vehicle island replay shares movement, OBB impulse, and server-only damage suppression', () => {
  const prediction = predictedDriver();
  const source = baseline();
  const preparation = prepareVehicleInteractionReplay(prediction, source);
  assert.ok(preparation);
  const replay = replayInteractionIsland({
    baseline: source,
    targetServerTick: preparation.targetServerTick,
    expectedWorldCollisionRevision: source.worldCollisionRevision,
    localCommands: preparation.localCommands,
    stepBody: createVehicleInteractionBodyStep(() => true),
    resolvePair: createVehicleInteractionPairStep(() => true)
  });

  assert.equal(replay.replayed, true);
  if (!replay.replayed) return;
  const local = replay.entities.find(({id}) => id === 'local');
  const remote = replay.entities.find(({id}) => id === 'remote');
  assert.equal(local?.kind, 'vehicle');
  assert.equal(remote?.kind, 'vehicle');
  assert.ok((local?.x ?? 0) < 8, 'The moving local body is separated from the contact.');
  assert.ok((remote?.x ?? 0) > 35, 'The remote body receives separation and impulse.');
  assert.equal(replay.suppressedEffects['authoritative-gameplay'], 2);
  assert.equal(replay.rootStates.length, 1);

  const correction = applyVehicleInteractionReplay(prediction, source, replay);
  assert.ok(correction?.resimulated);
  assert.equal(correction?.pendingMoveCount, 1);
  assert.deepEqual(prediction.pendingMovesAfter(10), [{sequence: 11, x: 0, y: -1}]);
});

test('vehicle replay fails closed when saved command history no longer covers the baseline', () => {
  const prediction = predictedDriver();
  assert.equal(prepareVehicleInteractionReplay(prediction, {
    ...baseline(),
    acknowledgedLocalInputSequence: 9
  }), undefined);
});

function predictedDriver(): SavedVehiclePrediction {
  const prediction = new SavedVehiclePrediction();
  prediction.initialize({x: 0, y: 0, angle: 0, speed: 240}, 10);
  prediction.advance(
    {x: 0, y: -1},
    'sedan',
    VEHICLE_SIMULATION_STEP_SECONDS,
    () => true
  );
  return prediction;
}

function baseline(): InteractionIslandBaseline {
  return {
    serverTick: 100,
    serverTimeMs: 1000,
    worldCollisionRevision: 7,
    controlRevision: 1,
    controlMode: 'driver',
    acknowledgedLocalInputSequence: 10,
    confirmedEventsThrough: 100,
    rootId: 'local',
    entities: [vehicle('local', 0, 240), vehicle('remote', 35, 0)],
    remoteIntents: []
  };
}

function vehicle(id: string, x: number, speed: number) {
  return {
    id,
    kind: 'vehicle' as const,
    spaceId: 'street',
    layerId: 'ground',
    x,
    y: 0,
    angle: 0,
    velocityX: speed,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: 'player-controlled' as const,
    vehicleKind: 'sedan' as const,
    speed,
    steering: 0,
    engineDamage: 0,
    onFire: false,
    destroyed: false
  };
}
