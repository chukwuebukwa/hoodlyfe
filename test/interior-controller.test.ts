import assert from 'node:assert/strict';
import test from 'node:test';
import {InteriorController} from '../server/game/interiors/interior-controller.ts';
import {PlayerState} from '../server/state.ts';

test('walking through the exterior doorway enters and exits one authoritative interior', () => {
  const controller = new InteriorController();
  const player = new PlayerState();
  player.x = 2190;
  player.y = 2112;

  assert.equal(controller.tryEnter(player), true);
  assert.equal(player.spaceId, 'threads-showroom');
  assert.deepEqual({x: player.x, y: player.y}, {x: 2120, y: 2112});

  assert.equal(controller.move(player, 20, 0, 11), true);
  assert.equal(player.spaceId, 'street');
  assert.deepEqual({x: player.x, y: player.y}, {x: 2218, y: 2112});
});

test('interior collision resolves axes and blocks walls and fixtures', () => {
  const controller = new InteriorController();
  const player = new PlayerState();
  player.spaceId = 'threads-showroom';
  player.x = 2020;
  player.y = 2018;

  controller.move(player, 0, -100, 11);
  assert.equal(player.y, 2018);

  player.x = 2020;
  player.y = 2050;
  controller.move(player, 40, 0, 11);
  assert.equal(player.x, 2020);
  assert.equal(player.spaceId, 'threads-showroom');
});
