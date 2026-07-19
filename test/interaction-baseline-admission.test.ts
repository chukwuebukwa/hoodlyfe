import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  HumanoidInteractionState,
  InteractionEntityState,
  VehicleInteractionState
} from '../shared/protocol/interaction-contracts.ts';
import {
  rankInteractionBaselineCandidates
} from '../server/game/network/interaction-baseline-admission.ts';

test('baseline admission prioritizes contact and TTC before nearby irrelevant bodies', () => {
  const root = vehicle('root', 0);
  const ranked = rankInteractionBaselineCandidates(root, [
    player('near-stationary', 90),
    vehicle('approaching', 180, -500),
    vehicle('touching', 48),
    player('separating', 80, 300)
  ]);
  assert.deepEqual(ranked.map(({id}) => id), [
    'touching', 'approaching', 'separating', 'near-stationary'
  ]);
});

test('baseline admission is stable when broad-phase collection order changes', () => {
  const root = player('root', 0);
  const candidates: InteractionEntityState[] = [
    player('b', 50, -200),
    player('a', 50, -200),
    vehicle('car', 200, -500)
  ];
  const forward = rankInteractionBaselineCandidates(root, candidates).map(({id}) => id);
  const reverse = rankInteractionBaselineCandidates(root, [...candidates].reverse()).map(({id}) => id);
  assert.deepEqual(forward, reverse);
});

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
    interactionPriority: 'player-controlled',
    radius: 11,
    movementMode: 'idle',
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
    surfaceId: 'street-ground',
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
    tyreDamageMask: 0,
    onFire: false,
    destroyed: false
  };
}
