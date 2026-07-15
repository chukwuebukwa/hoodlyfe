import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  HumanoidInteractionState,
  InteractionEntityState,
  InteractionSnapshot,
  VehicleInteractionState
} from '../shared/protocol/interaction-contracts.ts';
import {INTERACTION_PROTOCOL_VERSION} from '../shared/protocol/interaction-contracts.ts';
import {InteractionIslandSelector} from '../src/game/prediction/interaction-island-selector.ts';
import {
  interactionEntityWeight,
  interactionHorizonSeconds
} from '../src/game/prediction/interaction-island-policy.ts';

const network = {rttMs: 100, interpolationDelayMs: 100, jitterMs: 20};

test('island horizon includes half RTT, interpolation, and doubled jitter within bounds', () => {
  assert.equal(interactionHorizonSeconds(network), 0.19);
  assert.equal(interactionHorizonSeconds({rttMs: 0, interpolationDelayMs: 0, jitterMs: 0}), 0.1);
  assert.equal(interactionHorizonSeconds({rttMs: 900, interpolationDelayMs: 400, jitterMs: 100}), 0.5);
  assert.equal(interactionEntityWeight(player('root', 0)), 1);
  assert.equal(interactionEntityWeight(vehicle('car', 0)), 4);
});

test('current contacts outrank future contacts and overflow is deterministic', () => {
  const root = vehicle('root', 0);
  const current = vehicle('current', 48);
  const imminent = vehicle('imminent', 120, -400);
  const left = new InteractionIslandSelector().select(
    snapshot(1, [root, imminent, current]),
    {budget: 8, network}
  );
  const right = new InteractionIslandSelector().select(
    snapshot(1, [root, current, imminent]),
    {budget: 8, network}
  );
  assert.deepEqual(left?.memberIds, ['root', 'current']);
  assert.deepEqual(right?.memberIds, left?.memberIds);
  assert.deepEqual(left?.overflowIds, ['vehicle:imminent']);
  assert.deepEqual(left?.overflowMembers.map(({entity, reason}) => ({
    id: entity.id,
    reason
  })), [{id: 'imminent', reason: 'imminent-contact'}]);
  assert.ok((left?.overflowMembers[0]?.timeToContactMs ?? 0) > 0);
  assert.equal(left?.weightedPoints, 8);
  assert.equal(left?.overflowPoints, 4);
});

test('selector uses relative velocity and excludes bodies moving away', () => {
  const selection = new InteractionIslandSelector().select(snapshot(1, [
    player('root', 0),
    player('approaching', 60, -200),
    player('separating', 100, 200)
  ]), {budget: 32, network});
  assert.deepEqual(selection?.memberIds, ['root', 'approaching']);
  assert.equal(selection?.candidateCount, 2);
});

test('equal-TTC player-controlled bodies outrank ambient traffic', () => {
  const root = vehicle('root', 0);
  const ambient = vehicle('ambient-car', 120, -400);
  const controlled = {
    ...vehicle('player-car', 120, -400),
    interactionPriority: 'player-controlled' as const
  };
  const selection = new InteractionIslandSelector().select(
    snapshot(1, [root, ambient, controlled]),
    {budget: 8, network}
  );
  assert.deepEqual(selection?.memberIds, ['root', 'player-car']);
  assert.deepEqual(selection?.overflowIds, ['vehicle:ambient-car']);
});

test('destroyed vehicles remain physical island obstacles', () => {
  const wreck = {...vehicle('wreck', 30), destroyed: true};
  const selection = new InteractionIslandSelector().select(
    snapshot(1, [player('root', 0), wreck]),
    {budget: 20, network}
  );
  assert.deepEqual(selection?.memberIds, ['root', 'wreck']);
  assert.equal(selection?.members[1]?.reason, 'current-contact');
});

test('membership exit hysteresis resets on collider revision changes', () => {
  const selector = new InteractionIslandSelector();
  const first = selector.select(snapshot(1, [player('root', 0), player('candidate', 68, -200)]), {
    budget: 32,
    network
  });
  assert.deepEqual(first?.memberIds, ['root', 'candidate']);
  const retained = selector.select(snapshot(2, [player('root', 0), player('candidate', 72, -200)]), {
    budget: 32,
    network
  });
  assert.equal(retained?.members[1]?.reason, 'exit-hysteresis');
  const changed = player('candidate', 72, -200);
  const reset = selector.select(snapshot(3, [player('root', 0), {...changed, colliderRevision: 2}]), {
    budget: 32,
    network
  });
  assert.deepEqual(reset?.memberIds, ['root']);
});

test('direct contact remains selected for six ticks after separation', () => {
  const selector = new InteractionIslandSelector();
  selector.select(snapshot(1, [player('root', 0), player('contact', 20)]), {budget: 32, network});
  const retained = selector.select(snapshot(2, [player('root', 0), player('contact', 500)]), {
    budget: 32,
    network
  });
  assert.equal(retained?.members[1]?.reason, 'contact-retained');
  const expired = selector.select(snapshot(8, [player('root', 0), player('contact', 500)]), {
    budget: 32,
    network
  });
  assert.deepEqual(expired?.memberIds, ['root']);
});

test('one-hop closure admits a body touching a direct member but not the root', () => {
  const selection = new InteractionIslandSelector().select(snapshot(1, [
    player('root', 0),
    player('direct', 20),
    vehicle('closure', 55)
  ]), {budget: 6, network});
  assert.deepEqual(selection?.memberIds, ['root', 'direct', 'closure']);
  assert.equal(selection?.members[2]?.reason, 'contact-closure');
  assert.equal(selection?.closureCount, 1);
  assert.equal(selection?.weightedPoints, 6);
});

test('contact closure stops after one hop', () => {
  const selection = new InteractionIslandSelector().select(snapshot(1, [
    player('root', 0),
    player('direct', 20),
    player('first-hop', 40),
    player('second-hop', 60)
  ]), {budget: 32, network});
  assert.deepEqual(selection?.memberIds, ['root', 'direct', 'first-hop']);
  assert.equal(selection?.closureCount, 1);
});

test('dense traffic remains inside weighted budget and reports every omitted body', () => {
  const entities: InteractionEntityState[] = [vehicle('root', 0)];
  for (let index = 0; index < 20; index++) {
    entities.push(vehicle(`car-${index.toString().padStart(2, '0')}`, 0));
  }
  const selection = new InteractionIslandSelector().select(snapshot(1, entities), {
    budget: 32,
    network
  });
  assert.equal(selection?.members.length, 8);
  assert.equal(selection?.weightedPoints, 32);
  assert.equal(selection?.overflowIds.length, 13);
  assert.equal(selection?.overflowMembers.length, 13);
  assert.deepEqual(
    selection?.overflowMembers.map(({entity}) => entity.id),
    Array.from({length: 13}, (_, index) => `car-${String(index + 7).padStart(2, '0')}`)
  );
  assert.equal(selection?.overflowPoints, 52);
  assert.deepEqual(selection?.memberIds, [
    'root', 'car-00', 'car-01', 'car-02', 'car-03', 'car-04', 'car-05', 'car-06'
  ]);
});

test('dense membership remains stable for 120 ticks despite input order and network jitter', () => {
  const selector = new InteractionIslandSelector();
  const root = vehicle('root', 0);
  const traffic = Array.from({length: 20}, (_, index) => (
    vehicle(`car-${index.toString().padStart(2, '0')}`, 0)
  ));
  let expected: readonly string[] | undefined;
  for (let tick = 1; tick <= 120; tick++) {
    const ordered = tick % 2 === 0 ? [...traffic].reverse() : traffic;
    const selection = selector.select(snapshot(tick, [root, ...ordered]), {
      budget: 32,
      network: {
        rttMs: 80 + tick % 5 * 17,
        interpolationDelayMs: 90 + tick % 3 * 12,
        jitterMs: 8 + tick % 7 * 3
      }
    });
    expected ??= selection?.memberIds;
    assert.deepEqual(selection?.memberIds, expected);
    assert.ok((selection?.weightedPoints ?? Number.POSITIVE_INFINITY) <= 32);
    assert.equal(selection?.overflowIds.length, 13);
  }
});

function snapshot(serverTick: number, entities: InteractionEntityState[]): InteractionSnapshot {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    serverTimeMs: serverTick * 1000 / 30,
    worldCollisionRevision: 1,
    controlRevision: 1,
    controlMode: 'driver',
    acknowledgedLocalInputSequence: serverTick,
    entities,
    remoteIntents: [],
    confirmedEventsThrough: serverTick
  };
}

function player(id: string, x: number, velocityX = 0): HumanoidInteractionState {
  return {
    id,
    kind: 'player',
    spaceId: 'street',
    layerId: 'ground',
    x,
    y: 0,
    angle: 0,
    velocityX,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: id === 'root' ? 'player-controlled' : 'ambient',
    radius: 11,
    movementMode: velocityX === 0 ? 'idle' : 'run',
    actionPhase: 'free',
    actionTick: 0,
    surfaceId: 'street',
    alive: true
  };
}

function vehicle(id: string, x: number, velocityX = 0): VehicleInteractionState {
  return {
    id,
    kind: 'vehicle',
    vehicleKind: 'sedan',
    spaceId: 'street',
    layerId: 'ground',
    x,
    y: 0,
    angle: 0,
    velocityX,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: id === 'root' ? 'player-controlled' : 'ambient',
    speed: velocityX,
    steering: 0,
    engineDamage: 0,
    onFire: false,
    destroyed: false
  };
}
