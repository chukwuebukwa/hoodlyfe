import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOCCER_BALL_ID,
  SOCCER_BALL_KICK_IMPULSE,
  SOCCER_BALL_RADIUS
} from '../shared/content/soccer-ball.ts';
import {SoccerBallController} from '../server/game/props/soccer-ball-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('soccer ball initializes near spawn and queues a server-authored kick impulse', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'player';
  player.x = 1_000;
  player.y = 1_000;
  player.surfaceId = 'street-ground';
  state.players.set(player.id, player);
  const impulses: Array<{ballId: string; x: number; y: number}> = [];
  const controller = new SoccerBallController({
    state,
    world: openWorld(),
    queueImpulse: (ballId, x, y) => {
      impulses.push({ballId, x, y});
      return true;
    }
  });

  const ball = controller.initialize();
  assert.equal(ball.id, SOCCER_BALL_ID);
  assert.equal(ball.x, 1_056);
  assert.equal(ball.y, 1_000);
  assert.equal(controller.initialize(), ball);

  assert.equal(controller.kick(player.id, 1_000), true);
  assert.deepEqual(impulses, [{ballId: ball.id, x: SOCCER_BALL_KICK_IMPULSE, y: 0}]);
  assert.equal(controller.kick(player.id, 1_100), false);
  assert.equal(controller.kick(player.id, 1_200, {ballId: ball.id}), true);
});

test('soccer ball kick rejects invalid player state, surface, range, and requested IDs', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'player';
  player.x = 1_000;
  player.y = 1_000;
  state.players.set(player.id, player);
  let queued = 0;
  const controller = new SoccerBallController({
    state,
    world: openWorld(),
    queueImpulse: () => {
      queued++;
      return true;
    }
  });
  const ball = controller.initialize();

  assert.equal(controller.kick(player.id, 1_000, {ballId: 'missing'}), false);
  ball.x = 2_000;
  assert.equal(controller.kick(player.id, 1_000), false);
  ball.x = 1_040;
  ball.surfaceId = 'bridge-deck';
  assert.equal(controller.kick(player.id, 1_000), false);
  ball.surfaceId = player.surfaceId;
  player.vehicleId = 'car';
  assert.equal(controller.kick(player.id, 1_000), false);
  player.vehicleId = '';
  player.alive = false;
  assert.equal(controller.kick(player.id, 1_000), false);
  assert.equal(queued, 0);
});

function openWorld(): CollisionMap {
  return {
    spawnFor: () => ({x: 1_000, y: 1_000, surfaceId: 'street-ground'}),
    openPoint: () => ({x: 2_000, y: 2_000, surfaceId: 'street-ground'}),
    canOccupy: (_x: number, _y: number, radius: number) => radius === SOCCER_BALL_RADIUS
  } as unknown as CollisionMap;
}
