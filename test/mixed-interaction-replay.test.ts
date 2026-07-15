import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  HumanoidInteractionState,
  VehicleInteractionState
} from '../shared/protocol/interaction-contracts.ts';
import {ON_FOOT_SIMULATION_STEP_SECONDS} from '../shared/simulation/on-foot-step.ts';
import {replayInteractionIsland} from '../src/game/prediction/interaction-island-replay.ts';
import type {InteractionIslandBaseline} from '../src/game/prediction/island-state-history.ts';
import {
  createMixedInteractionBodyStep,
  createMixedInteractionPairStep
} from '../src/game/prediction/mixed-interaction-replay.ts';
import {
  applyOnFootInteractionReplay,
  prepareOnFootInteractionReplay
} from '../src/game/prediction/on-foot-interaction-replay.ts';
import {SavedOnFootPrediction} from '../src/game/prediction/saved-on-foot-prediction.ts';

const canOccupy = () => true;

test('on-foot island replay maps exact movement scale and resolves a moving vehicle contact', () => {
  const prediction = new SavedOnFootPrediction();
  prediction.initialize({x: 0, y: 0, spaceId: 'street'}, 10);
  prediction.advance(
    {x: 1, y: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS,
    canOccupy,
    0.7
  );
  const source = baseline();
  const preparation = prepareOnFootInteractionReplay(prediction, source);
  assert.deepEqual(preparation?.localCommands, [{
    serverTick: 101,
    entityId: 'local',
    moveX: 1,
    moveY: 0,
    steering: 0,
    throttle: 0,
    movementScale: 0.7
  }]);
  assert.ok(preparation);
  const replay = replayInteractionIsland({
    baseline: source,
    targetServerTick: preparation.targetServerTick,
    expectedWorldCollisionRevision: source.worldCollisionRevision,
    localCommands: preparation.localCommands,
    stepBody: createMixedInteractionBodyStep(canOccupy),
    resolvePair: createMixedInteractionPairStep(canOccupy)
  });
  assert.equal(replay.replayed, true);
  if (!replay.replayed) return;
  const local = replay.entities.find(({id}) => id === 'local');
  const vehicle = replay.entities.find(({id}) => id === 'car');
  assert.equal(local?.kind, 'player');
  assert.equal(vehicle?.kind, 'vehicle');
  assert.ok((local?.x ?? 0) < 190 / 30 * 0.7, 'Contact separates the local root backward.');
  assert.ok((vehicle?.x ?? 0) > 39, 'The vehicle receives inverse-mass separation.');
  assert.equal(replay.suppressedEffects['authoritative-gameplay'], 1);
  const correction = applyOnFootInteractionReplay(prediction, source, replay);
  assert.equal(correction?.resimulated, true);
  assert.deepEqual(prediction.pendingMovesAfter(10), [{
    sequence: 11,
    x: 1,
    y: 0,
    movementScale: 0.7
  }]);
});

test('on-foot replay fails closed for passengers and discontinuous saved history', () => {
  const prediction = new SavedOnFootPrediction();
  prediction.initialize({x: 0, y: 0, spaceId: 'street'}, 10);
  prediction.advance({x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS, canOccupy);
  assert.equal(prepareOnFootInteractionReplay(prediction, {
    ...baseline(),
    controlMode: 'passenger'
  }), undefined);
  assert.equal(prepareOnFootInteractionReplay(prediction, {
    ...baseline(),
    acknowledgedLocalInputSequence: 9
  }), undefined);
});

function baseline(): InteractionIslandBaseline {
  return {
    serverTick: 100,
    serverTimeMs: 1000,
    worldCollisionRevision: 7,
    controlRevision: 1,
    controlMode: 'on-foot',
    acknowledgedLocalInputSequence: 10,
    confirmedEventsThrough: 100,
    rootId: 'local',
    entities: [player(), vehicle()],
    remoteIntents: [{
      entityId: 'car',
      appliedAtServerTick: 100,
      moveX: 0,
      moveY: 0,
      steering: 0,
      throttle: 0,
      movementScale: 1
    }]
  };
}

function player(): HumanoidInteractionState {
  return {
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
    movementMode: 'run',
    actionPhase: 'free',
    actionTick: 0,
    surfaceId: 'street',
    alive: true
  };
}

function vehicle(): VehicleInteractionState {
  return {
    id: 'car',
    kind: 'vehicle',
    spaceId: 'street',
    layerId: 'ground',
    x: 45,
    y: 0,
    angle: Math.PI,
    velocityX: -180,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: 'player-controlled',
    vehicleKind: 'sedan',
    speed: 180,
    steering: 0,
    engineDamage: 0,
    onFire: false,
    destroyed: false
  };
}
