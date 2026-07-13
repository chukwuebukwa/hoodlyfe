import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERACTION_PROTOCOL_VERSION,
  type InteractionSnapshot
} from '../shared/protocol/interaction-contracts.ts';
import {IslandStateHistory} from '../src/game/prediction/island-state-history.ts';
import type {InteractionIslandSelection} from '../src/game/prediction/interaction-island-selector.ts';

test('island history owns immutable same-tick baselines and remains bounded', () => {
  const history = new IslandStateHistory(2);
  const first = snapshot(1);
  const recorded = history.record(first, selection(first));
  assert.ok(recorded);
  assert.equal(Object.isFrozen(recorded), true);
  assert.equal(Object.isFrozen(recorded.entities), true);
  assert.equal(Object.isFrozen(recorded.entities[0]), true);
  assert.equal(Object.isFrozen(recorded.remoteIntents[0]), true);
  history.record(snapshot(2), selection(snapshot(2)));
  const third = snapshot(3);
  history.record(third, selection(third));
  assert.equal(history.size(), 2);
  assert.equal(history.at(1), undefined);
  assert.deepEqual(history.history().map(({serverTick}) => serverTick), [2, 3]);
});

test('island history rejects mixed frames and resets across controlled-root changes', () => {
  const history = new IslandStateHistory();
  const first = snapshot(1);
  assert.ok(history.record(first, selection(first)));
  const mismatched = {...selection(first), serverTick: 2};
  assert.equal(history.record(first, mismatched), undefined);
  const changed = snapshot(2, 'vehicle-root');
  assert.ok(history.record(changed, selection(changed)));
  assert.equal(history.size(), 1);
  assert.equal(history.latest()?.rootId, 'vehicle-root');
});

function snapshot(serverTick: number, rootId = 'local'): InteractionSnapshot {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    serverTimeMs: serverTick * 1000 / 30,
    worldCollisionRevision: 1,
    acknowledgedLocalInputSequence: serverTick,
    confirmedEventsThrough: serverTick,
    entities: [vehicle(rootId, 0), vehicle('remote', 20)],
    remoteIntents: [{
      entityId: 'remote',
      appliedAtServerTick: serverTick,
      moveX: 0,
      moveY: 0,
      steering: 0.25,
      throttle: 1
    }]
  };
}

function selection(source: InteractionSnapshot): InteractionIslandSelection {
  return {
    serverTick: source.serverTick,
    rootId: source.entities[0].id,
    members: source.entities.map((entity, index) => ({
      entity,
      weight: 4,
      reason: index === 0 ? 'root' as const : 'imminent-contact' as const,
      timeToContactMs: index === 0 ? 0 : 100
    })),
    memberIds: source.entities.map(({id}) => id),
    weightedPoints: 8,
    budget: 32,
    overflowIds: [],
    overflowPoints: 0,
    candidateCount: 1,
    currentContactCount: 0,
    retainedContactCount: 0,
    closureCount: 0,
    horizonMs: 200,
    exitHorizonMs: 250
  };
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
