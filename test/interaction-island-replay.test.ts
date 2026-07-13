import assert from 'node:assert/strict';
import test from 'node:test';
import type {InteractionEntityState} from '../shared/protocol/interaction-contracts.ts';
import type {InteractionIslandBaseline} from '../src/game/prediction/island-state-history.ts';
import {
  replayInteractionIsland,
  type InteractionReplayPairStep
} from '../src/game/prediction/interaction-island-replay.ts';

test('whole-island replay restores one tick, applies intent, and resolves stable pairs', () => {
  const pairOrder: string[] = [];
  const replay = replayInteractionIsland({
    baseline: baseline(),
    targetServerTick: 12,
    expectedWorldCollisionRevision: 7,
    localCommands: [
      command(11, 'local', 1),
      command(12, 'local', 1)
    ],
    stepBody: (entity, control, context) => {
      context.sideEffects.dispatch('one-shot-presentation', () => {
        throw new Error('replay emitted presentation');
      });
      context.sideEffects.dispatch('authoritative-gameplay', () => {
        throw new Error('replay emitted damage');
      });
      return {...entity, x: entity.x + control.throttle, velocityX: control.throttle};
    },
    resolvePair: recordPairs(pairOrder)
  });
  assert.equal(replay.replayed, true);
  if (!replay.replayed) return;
  assert.equal(replay.replayedTicks, 2);
  assert.equal(replay.bodySteps, 6);
  assert.equal(replay.pairSteps, 6);
  assert.equal(replay.entities[0].id, 'local');
  assert.equal(replay.entities.find(({id}) => id === 'local')?.x, 2);
  assert.equal(replay.entities.find(({id}) => id === 'remote')?.x, 12);
  assert.equal(replay.entities.find(({id}) => id === 'npc')?.x, 30);
  assert.deepEqual(pairOrder, [
    'pedestrian:npc|vehicle:local',
    'pedestrian:npc|vehicle:remote',
    'vehicle:local|vehicle:remote',
    'pedestrian:npc|vehicle:local',
    'pedestrian:npc|vehicle:remote',
    'vehicle:local|vehicle:remote'
  ]);
  assert.deepEqual(replay.suppressedEffects, {
    'idempotent-presentation': 0,
    'one-shot-presentation': 6,
    'authoritative-gameplay': 6,
    'durable-transaction': 0
  });
});

test('whole-island replay is deterministic when non-root baseline order changes', () => {
  const first = run(baseline());
  const source = baseline();
  const reordered = {...source, entities: [source.entities[0], source.entities[2], source.entities[1]]};
  const second = run(reordered);
  assert.deepEqual(second, first);
});

test('whole-island replay fails closed across revision, history, and kernel discontinuities', () => {
  const source = baseline();
  assert.deepEqual(replayInteractionIsland({
    baseline: source,
    targetServerTick: 11,
    expectedWorldCollisionRevision: 8,
    stepBody: identityStep
  }), {replayed: false, reason: 'world-revision-mismatch'});
  assert.deepEqual(replayInteractionIsland({
    baseline: source,
    targetServerTick: 40,
    expectedWorldCollisionRevision: 7,
    stepBody: identityStep
  }), {replayed: false, reason: 'history-window-exceeded'});
  const changed = source.entities.map((entity, index) => (
    index === 1 ? {...entity, colliderRevision: 2} : entity
  ));
  assert.deepEqual(replayInteractionIsland({
    baseline: source,
    targetServerTick: 11,
    expectedWorldCollisionRevision: 7,
    currentEntities: changed,
    stepBody: identityStep
  }), {replayed: false, reason: 'entity-revision-mismatch'});
  assert.deepEqual(replayInteractionIsland({
    baseline: source,
    targetServerTick: 11,
    expectedWorldCollisionRevision: 7,
    stepBody: (entity) => ({...entity, id: 'forged'})
  }), {replayed: false, reason: 'kernel-error'});
});

test('maximum 32-body desktop replay has an exact bounded work envelope', () => {
  const source = baseline();
  const entities = Array.from({length: 32}, (_, index) => pedestrian(`ped-${index}`, index * 16));
  const replay = replayInteractionIsland({
    baseline: {...source, rootId: entities[0].id, entities, remoteIntents: []},
    targetServerTick: source.serverTick + 24,
    expectedWorldCollisionRevision: source.worldCollisionRevision,
    stepBody: identityStep,
    resolvePair: (left, right) => [left, right]
  });
  assert.equal(replay.replayed, true);
  if (!replay.replayed) return;
  assert.equal(replay.bodySteps, 32 * 24);
  assert.equal(replay.pairSteps, (32 * 31 / 2) * 24);
});

function run(source: InteractionIslandBaseline) {
  return replayInteractionIsland({
    baseline: source,
    targetServerTick: 12,
    expectedWorldCollisionRevision: 7,
    localCommands: [command(11, 'local', 1), command(12, 'local', 1)],
    stepBody: (entity, control) => ({
      ...entity,
      x: entity.x + control.throttle,
      velocityX: control.throttle
    }),
    resolvePair: (left, right) => [left, right]
  });
}

function baseline(): InteractionIslandBaseline {
  return {
    serverTick: 10,
    serverTimeMs: 1000 / 3,
    worldCollisionRevision: 7,
    acknowledgedLocalInputSequence: 10,
    confirmedEventsThrough: 10,
    rootId: 'local',
    entities: [vehicle('local', 0), vehicle('remote', 10), pedestrian('npc', 30)],
    remoteIntents: [{
      entityId: 'remote',
      appliedAtServerTick: 10,
      moveX: 0,
      moveY: 0,
      steering: 0,
      throttle: 1
    }]
  };
}

function command(serverTick: number, entityId: string, throttle: number) {
  return {serverTick, entityId, moveX: 0, moveY: 0, steering: 0, throttle};
}

function recordPairs(order: string[]): InteractionReplayPairStep {
  return (left, right) => {
    order.push(`${left.kind}:${left.id}|${right.kind}:${right.id}`);
    return [left, right];
  };
}

function identityStep(entity: InteractionEntityState): InteractionEntityState {
  return entity;
}

function vehicle(id: string, x: number) {
  return {
    id,
    kind: 'vehicle' as const,
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
    interactionPriority: 'player-controlled' as const,
    vehicleKind: 'sedan' as const,
    speed: 0,
    steering: 0,
    engineDamage: 0,
    onFire: false,
    destroyed: false
  };
}

function pedestrian(id: string, x: number) {
  return {
    id,
    kind: 'pedestrian' as const,
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
    interactionPriority: 'ambient' as const,
    radius: 11,
    movementMode: 'idle' as const,
    actionPhase: 'free' as const,
    actionTick: 0,
    surfaceId: 'street',
    alive: true
  };
}
