import assert from 'node:assert/strict';
import test from 'node:test';
import {PlayerControlController} from '../server/game/players/player-control-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('player control validates hostile input and clears runtime state', () => {
  const {controller} = createController();
  controller.register('player');
  assert.deepEqual(controller.inputFor('player'), {inputX: 0, inputY: 0});

  controller.setMove('player', {x: 4, y: Number.NaN});
  assert.deepEqual(controller.inputFor('player'), {inputX: 1, inputY: 0});
  controller.setMove('player', {x: Number.NEGATIVE_INFINITY, y: -3});
  assert.deepEqual(controller.inputFor('player'), {inputX: 0, inputY: -1});

  controller.reset('player');
  assert.deepEqual(controller.inputFor('player'), {inputX: 0, inputY: 0});
  controller.unregister('player');
  assert.equal(controller.inputFor('player'), undefined);
});

test('on-foot locomotion preserves analog magnitude and caps diagonal speed', () => {
  const {controller, state} = createController();
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);

  controller.setMove(player.id, {x: 0.5, y: 0});
  controller.updateOnFoot(player, 1);
  assert.equal(player.x, 195);
  assert.equal(player.y, 100);

  player.x = 100;
  player.y = 100;
  controller.setMove(player.id, {x: 1, y: 1});
  controller.updateOnFoot(player, 1);
  assert.ok(Math.abs(Math.hypot(player.x - 100, player.y - 100) - 190) < 0.0001);
});

test('on-foot locomotion resolves collision per axis and respects control states', () => {
  const state = new DistrictState();
  const world = {
    canOccupy: (x: number) => x <= 100
  } as unknown as CollisionMap;
  const controller = new PlayerControlController({state, world});
  const player = addPlayer(state, 'player', 100, 100);
  controller.register(player.id);
  controller.setMove(player.id, {x: 1, y: 1});
  controller.updateOnFoot(player, 1 / 30);
  assert.equal(player.x, 100);
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
