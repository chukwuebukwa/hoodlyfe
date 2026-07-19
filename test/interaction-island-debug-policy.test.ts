import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  HumanoidInteractionState,
  VehicleInteractionState
} from '../shared/protocol/interaction-contracts.ts';
import {
  INTERACTION_ISLAND_DEBUG_COLOR,
  projectInteractionIslandDebug
} from '../src/game/debug/interaction-island-debug-policy.ts';
import type {InteractionIslandSelection} from '../src/game/prediction/interaction-island-selector.ts';

test('interaction debug projection exposes root, reasons, links, overflow, and presented poses', () => {
  const root = vehicle('root', 10);
  const contact = humanoid('contact', 40);
  const overflow = vehicle('overflow', 90);
  const selection: InteractionIslandSelection = {
    serverTick: 20,
    rootId: root.id,
    members: [
      {entity: root, weight: 4, reason: 'root', timeToContactMs: 0},
      {entity: contact, weight: 1, reason: 'current-contact', timeToContactMs: 0}
    ],
    memberIds: [root.id, contact.id],
    overflowMembers: [
      {entity: overflow, weight: 4, reason: 'imminent-contact', timeToContactMs: 120}
    ],
    weightedPoints: 5,
    budget: 5,
    overflowIds: ['vehicle:overflow'],
    overflowPoints: 4,
    candidateCount: 2,
    currentContactCount: 1,
    retainedContactCount: 0,
    closureCount: 0,
    horizonMs: 180,
    exitHorizonMs: 225
  };

  const projection = projectInteractionIslandDebug(selection, ({entity}) => (
    entity.id === 'contact' ? {x: 44, y: 2, angle: 0.2} : undefined
  ));

  assert.equal(projection.bodies.length, 3);
  assert.deepEqual(projection.bodies.map(({role}) => role), ['root', 'member', 'overflow']);
  assert.equal(projection.bodies[0].color, INTERACTION_ISLAND_DEBUG_COLOR.root);
  assert.equal(projection.bodies[1].color, INTERACTION_ISLAND_DEBUG_COLOR.currentContact);
  assert.equal(projection.bodies[2].color, INTERACTION_ISLAND_DEBUG_COLOR.overflow);
  assert.match(projection.bodies[1].label, /contact/);
  assert.match(projection.bodies[2].label, /OVERFLOW/);
  assert.deepEqual(projection.bodies[1].presented, {x: 44, y: 2, angle: 0.2});
  assert.deepEqual(projection.links, [{
    rootId: 'root',
    memberId: 'contact',
    fromX: 10,
    fromY: 0,
    toX: 40,
    toY: 0,
    color: INTERACTION_ISLAND_DEBUG_COLOR.currentContact
  }]);
});

test('interaction debug projection suppresses indistinguishable presented transforms', () => {
  const root = vehicle('root', 10);
  const selection = selectionFor(root);
  const projection = projectInteractionIslandDebug(selection, () => ({
    x: root.x + 0.1,
    y: root.y + 0.1,
    angle: root.angle + 0.001
  }));
  assert.equal(projection.bodies[0].presented, undefined);
  assert.deepEqual(projectInteractionIslandDebug(undefined, () => undefined), {
    bodies: [],
    links: []
  });
});

function selectionFor(root: VehicleInteractionState): InteractionIslandSelection {
  return {
    serverTick: 1,
    rootId: root.id,
    members: [{entity: root, weight: 4, reason: 'root', timeToContactMs: 0}],
    memberIds: [root.id],
    overflowMembers: [],
    weightedPoints: 4,
    budget: 32,
    overflowIds: [],
    overflowPoints: 0,
    candidateCount: 0,
    currentContactCount: 0,
    retainedContactCount: 0,
    closureCount: 0,
    horizonMs: 100,
    exitHorizonMs: 125
  };
}

function vehicle(id: string, x: number): VehicleInteractionState {
  return {
    id,
    kind: 'vehicle',
    spaceId: 'street',
    layerId: 'ground',
    surfaceId: 'street-ground',
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
    tyreDamageMask: 0,
    onFire: false,
    destroyed: false
  };
}

function humanoid(id: string, x: number): HumanoidInteractionState {
  return {
    id,
    kind: 'player',
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
    radius: 11,
    movementMode: 'walk',
    actionPhase: 'free',
    actionTick: 0,
    surfaceId: 'street',
    alive: true
  };
}
