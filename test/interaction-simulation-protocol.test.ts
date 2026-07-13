import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERACTION_PROTOCOL_VERSION,
  PLAYER_INPUT_BUTTON,
  validateInteractionSnapshot,
  validatePlayerInputCommand
} from '../shared/protocol/interaction-simulation.ts';

test('player input validation clamps independent axes and freezes accepted commands', () => {
  const result = validatePlayerInputCommand({
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    sequence: 8,
    clientTick: 104,
    clientSampleTimeMs: 12_345.5,
    moveX: 1,
    moveY: -1,
    aimAngle: Math.PI * 5,
    buttons: PLAYER_INPUT_BUTTON.fire | PLAYER_INPUT_BUTTON.sprint,
    selectedWeaponSlot: 3,
    controlledEntityId: 'vehicle-7',
    predictedSpawnIds: [41, 42]
  }, {
    previousSequence: 7,
    minimumClientTick: 90,
    maximumClientTick: 110,
    expectedControlledEntityId: 'vehicle-7'
  });
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.value.moveX, 1);
  assert.equal(result.value.moveY, -1);
  assert.ok(Math.abs(result.value.aimAngle - Math.PI) < 1e-12);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.predictedSpawnIds), true);
});

test('player input validation rejects stale, incompatible, non-finite, and forged commands', () => {
  const valid = inputCommand();
  const context = {
    previousSequence: 9,
    minimumClientTick: 90,
    maximumClientTick: 110,
    expectedControlledEntityId: 'player-1'
  };
  assert.equal(validatePlayerInputCommand({...valid, sequence: 9}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, sequence: 50_000}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, clientTick: 89}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, clientTick: 111}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, moveX: Number.NaN}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, buttons: 1 << 20}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, controlledEntityId: 'other'}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, predictedSpawnIds: [4, 4]}, context).accepted, false);
  assert.equal(validatePlayerInputCommand({...valid, protocolVersion: 99}, context).accepted, false);
});

test('interaction snapshot validation returns one immutable same-tick physical baseline', () => {
  const result = validateInteractionSnapshot(snapshot(), {
    currentServerTick: 105,
    expectedWorldCollisionRevision: 3
  });
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.value.serverTick, 100);
  assert.equal(result.value.entities.length, 2);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.entities), true);
  assert.equal(Object.isFrozen(result.value.entities[0]), true);
  assert.equal(Object.isFrozen(result.value.remoteIntents), true);
  assert.equal(Object.isFrozen(result.value.remoteIntents[0]), true);
});

test('interaction snapshot validation fails closed on stale or incompatible baselines', () => {
  const context = {currentServerTick: 105, expectedWorldCollisionRevision: 3};
  assert.equal(validateInteractionSnapshot({...snapshot(), serverTick: 70}, context).accepted, false);
  assert.equal(validateInteractionSnapshot({...snapshot(), serverTick: 107}, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    worldCollisionRevision: 4
  }, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    controlRevision: 0
  }, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    controlMode: 'spectator'
  }, context).accepted, false);
  const missingControl = snapshot();
  delete missingControl.controlRevision;
  assert.equal(validateInteractionSnapshot(missingControl, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    entities: [vehicleEntity(), {...vehicleEntity(), id: 'vehicle-1'}]
  }, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    entities: [vehicleEntity(), {...playerEntity(), spaceId: 'hospital'}]
  }, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    entities: [{...vehicleEntity(), lifecycleRevision: 0}, playerEntity()]
  }, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    entities: [{...vehicleEntity(), x: Number.POSITIVE_INFINITY}, playerEntity()]
  }, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    entities: [{...vehicleEntity(), interactionPriority: 'secret-mission'}, playerEntity()]
  }, context).accepted, false);
  assert.equal(validateInteractionSnapshot({
    ...snapshot(),
    remoteIntents: [{...remoteIntent(), entityId: 'missing'}]
  }, context).accepted, false);
});

function inputCommand(): Record<string, unknown> {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    sequence: 10,
    clientTick: 100,
    clientSampleTimeMs: 4_000,
    moveX: 0,
    moveY: -1,
    aimAngle: 0,
    buttons: 0,
    selectedWeaponSlot: 0,
    controlledEntityId: 'player-1'
  };
}

function snapshot(): Record<string, unknown> {
  return {
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick: 100,
    serverTimeMs: 10_000,
    worldCollisionRevision: 3,
    controlRevision: 1,
    controlMode: 'driver',
    acknowledgedLocalInputSequence: 44,
    entities: [vehicleEntity(), playerEntity()],
    remoteIntents: [remoteIntent()],
    confirmedEventsThrough: 100
  };
}

function vehicleEntity(): Record<string, unknown> {
  return {
    id: 'vehicle-1',
    kind: 'vehicle',
    vehicleKind: 'sedan',
    spaceId: 'street',
    layerId: 'ground',
    x: 100,
    y: 200,
    angle: 0.2,
    velocityX: 30,
    velocityY: 2,
    angularVelocity: 0.1,
    colliderRevision: 1,
    lifecycleRevision: 2,
    interactionPriority: 'player-controlled',
    speed: 30,
    steering: 0.25,
    engineDamage: 12,
    onFire: false,
    destroyed: false
  };
}

function playerEntity(): Record<string, unknown> {
  return {
    id: 'player-1',
    kind: 'player',
    spaceId: 'street',
    layerId: 'ground',
    x: 130,
    y: 200,
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
    surfaceId: 'asphalt',
    alive: true
  };
}

function remoteIntent(): Record<string, unknown> {
  return {
    entityId: 'vehicle-1',
    appliedAtServerTick: 100,
    moveX: 0,
    moveY: 0,
    steering: 0.2,
    throttle: 0.8
  };
}
