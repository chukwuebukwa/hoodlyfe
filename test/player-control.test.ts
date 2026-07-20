import assert from 'node:assert/strict';
import test from 'node:test';
import {PlayerControlController} from '../server/game/players/player-control-controller.ts';
import type {InteriorController} from '../server/game/interiors/interior-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('player control validates hostile input and clears runtime state', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);
  assert.deepEqual(controller.inputFor('player'), {inputX: 0, inputY: 0, lastSequence: 0});

  controller.setMove('player', {x: 4, y: Number.NaN});
  controller.updateOnFoot(player, 1 / 30);
  assert.deepEqual(controller.inputFor('player'), {inputX: 1, inputY: 0, lastSequence: 1});
  controller.setMove('player', {x: Number.NEGATIVE_INFINITY, y: -3});
  controller.updateOnFoot(player, 1 / 30);
  assert.deepEqual(controller.inputFor('player'), {inputX: 0, inputY: -1, lastSequence: 2});

  controller.reset('player');
  assert.deepEqual(controller.inputFor('player'), {inputX: 0, inputY: 0, lastSequence: 2});
  controller.unregister('player');
  assert.equal(controller.inputFor('player'), undefined);
});

test('player control acknowledges accepted input and rejects stale or implausible sequences', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);

  controller.setMove(player.id, {x: 1, y: 0, sequence: 12});
  assert.equal(player.lastInputSequence, 0, 'Receipt is not an applied simulation acknowledgement.');
  controller.updateOnFoot(player, 1 / 30);
  assert.equal(player.lastInputSequence, 12);
  assert.deepEqual(controller.inputFor(player.id), {inputX: 1, inputY: 0, lastSequence: 12});

  controller.setMove(player.id, {x: -1, y: 0, sequence: 11});
  controller.setMove(player.id, {x: -1, y: 0, sequence: 5_000});
  assert.deepEqual(controller.inputFor(player.id), {inputX: 1, inputY: 0, lastSequence: 12});
  assert.equal(player.lastInputSequence, 12);
});

test('legacy vehicle input holds and releases the handbrake state', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'driver', 100, 100);
  player.vehicleId = 'car';
  controller.register(player.id);

  controller.setMove(player.id, {x: 0.5, y: -1, handbrake: true});
  assert.deepEqual(controller.inputFor(player.id), {
    inputX: 0.5,
    inputY: -1,
    lastSequence: 1,
    handbrake: true
  });
  controller.setMove(player.id, {x: 0.5, y: -1, handbrake: false});
  assert.deepEqual(controller.inputFor(player.id), {inputX: 0.5, inputY: -1, lastSequence: 2});
});

test('on-foot input batches are bounded, ordered, and acknowledged only when applied', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);
  assert.equal(controller.acceptBatch(player.id, {moves: [
    {sequence: 1, x: 1, y: 0},
    {sequence: 2, x: 0, y: 1},
    {sequence: 2, x: -1, y: 0},
    {sequence: 3, x: -1, y: 0}
  ]}), 3);
  assert.equal(player.lastInputSequence, 0);

  controller.updateOnFoot(player, 1 / 30);
  assert.equal(player.lastInputSequence, 1);
  assert.deepEqual(controller.inputFor(player.id), {inputX: 1, inputY: 0, lastSequence: 1});
  controller.updateOnFoot(player, 1 / 30);
  assert.equal(player.lastInputSequence, 2);
  assert.deepEqual(controller.inputFor(player.id), {inputX: 0, inputY: 1, lastSequence: 2});
  controller.updateOnFoot(player, 1 / 30);
  assert.equal(player.lastInputSequence, 3);
  assert.deepEqual(controller.inputFor(player.id), {inputX: -1, inputY: 0, lastSequence: 3});
});

test('legacy held input replaces queued batch history when a client changes transport mode', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);
  controller.acceptBatch(player.id, {moves: [
    {sequence: 1, x: 1, y: 0},
    {sequence: 2, x: 1, y: 0}
  ]});

  controller.setMove(player.id, {sequence: 3, x: 0, y: -1});
  controller.updateOnFoot(player, 1 / 30);
  assert.deepEqual(controller.inputFor(player.id), {inputX: 0, inputY: -1, lastSequence: 3});
  assert.equal(player.lastInputSequence, 3);

  controller.updateOnFoot(player, 1 / 30);
  assert.equal(player.lastInputSequence, 3, 'Discarded batch moves cannot reappear later.');
});

test('on-foot locomotion preserves analog magnitude and caps diagonal speed', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);

  controller.setMove(player.id, {x: 0.5, y: 0});
  controller.updateOnFoot(player, 1 / 30);
  assert.ok(Math.abs(player.x - (100 + 190 * 0.5 / 30)) < 0.0001);
  assert.equal(player.y, 100);

  player.x = 100;
  player.y = 100;
  controller.setMove(player.id, {x: 1, y: 1});
  controller.updateOnFoot(player, 1 / 30);
  assert.ok(Math.abs(Math.hypot(player.x - 100, player.y - 100) - 190 / 30) < 0.0001);
});

test('on-foot control authors desired motion and respects control states', () => {
  const state = new DistrictState();
  const world = {
    canOccupy: (x: number) => x <= 100
  } as unknown as CollisionMap;
  const controller = new PlayerControlController({state, world});
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);
  controller.setMove(player.id, {x: 1, y: 1});
  controller.updateOnFoot(player, 1 / 30);
  assert.ok(player.x > 100);
  assert.ok(player.y > 100);

  const blockedPosition = {x: player.x, y: player.y};
  player.action = 'entering';
  controller.updateOnFoot(player, 1);
  assert.deepEqual({x: player.x, y: player.y}, blockedPosition);
  player.action = '';
  player.vehicleId = 'car';
  controller.updateOnFoot(player, 1);
  assert.deepEqual({x: player.x, y: player.y}, blockedPosition);
  player.vehicleId = '';
  player.alive = false;
  controller.updateOnFoot(player, 1);
  assert.deepEqual({x: player.x, y: player.y}, blockedPosition);
});

test('active melee preserves full desired movement without entering doors', () => {
  const state = new DistrictState();
  let entryAttempts = 0;
  const world = {
    canOccupy: (x: number) => x <= 100
  } as unknown as CollisionMap;
  const interiors = {
    move: () => false,
    tryEnter: () => {
      entryAttempts++;
      return false;
    }
  } as unknown as InteriorController;
  const controller = new PlayerControlController({state, world, interiors});
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);
  controller.setMove(player.id, {x: 1, y: 1});
  player.action = 'melee';
  player.weapon = 'fists';
  player.attackCombo = 0;

  controller.updateOnFoot(player, 1 / 30);

  assert.ok(Math.abs(player.x - (100 + 190 / 30 / Math.sqrt(2))) < 0.0001);
  assert.ok(Math.abs(player.y - (100 + 190 / 30 / Math.sqrt(2))) < 0.0001);
  assert.equal(entryAttempts, 0, 'An active swing cannot transition into an interior.');
});

test('aim normalizes angles for on-foot players and passengers but rejects gated states', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);

  controller.setAim(player.id, {angle: Math.PI * 3});
  assert.ok(Math.abs(Math.abs(player.angle) - Math.PI) < 0.0001);
  const acceptedAngle = player.angle;

  player.vehicleId = 'car';
  player.vehicleSeat = 0;
  controller.setAim(player.id, {angle: 0.4});
  assert.equal(player.angle, acceptedAngle);
  player.vehicleSeat = 1;
  controller.setAim(player.id, {angle: 0.4});
  assert.equal(player.angle, 0.4);

  player.action = 'exiting';
  controller.setAim(player.id, {angle: 1.2});
  assert.equal(player.angle, 0.4);
  player.action = '';
  player.alive = false;
  controller.setAim(player.id, {angle: 1.2});
  assert.equal(player.angle, 0.4);
  controller.setAim(player.id, {angle: Number.NaN});
  assert.equal(player.angle, 0.4);
});

function createController() {
  const state = new DistrictState();
  const world = {canOccupy: () => true} as unknown as CollisionMap;
  return {state, controller: new PlayerControlController({state, world})};
}

function addPlayer(
  state: DistrictState,
  id: string,
  x: number,
  y: number
): PlayerState {
  const player = new PlayerState();
  player.id = id;
  player.x = x;
  player.y = y;
  state.players.set(id, player);
  return player;
}
