import assert from 'node:assert/strict';
import test from 'node:test';
import {stableInteractionPairs} from '../src/game/prediction/stable-interaction-pairs.ts';

test('stable interaction pairs are independent of collection order', () => {
  const entities = [vehicle('z'), player('b'), vehicle('a')];
  const forward = stableInteractionPairs(entities);
  const reverse = stableInteractionPairs([...entities].reverse());
  assert.deepEqual(reverse, forward);
  assert.deepEqual(forward.map(({leftKey, rightKey}) => `${leftKey}|${rightKey}`), [
    'player:b|vehicle:a',
    'player:b|vehicle:z',
    'vehicle:a|vehicle:z'
  ]);
  assert.equal(Object.isFrozen(forward), true);
});

function player(id: string) {
  return {
    id,
    kind: 'player' as const,
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
    interactionPriority: 'player-controlled' as const,
    radius: 11,
    movementMode: 'idle' as const,
    actionPhase: 'free' as const,
    actionTick: 0,
    surfaceId: 'street',
    alive: true
  };
}

function vehicle(id: string) {
  return {
    id,
    kind: 'vehicle' as const,
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
    interactionPriority: 'ambient' as const,
    vehicleKind: 'sedan' as const,
    speed: 0,
    steering: 0,
    engineDamage: 0,
    tyreDamageMask: 0,
    onFire: false,
    destroyed: false
  };
}
