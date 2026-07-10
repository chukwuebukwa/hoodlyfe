import assert from 'node:assert/strict';
import test from 'node:test';
import {InteriorController} from '../server/game/interiors/interior-controller.ts';
import {PlayerState} from '../server/state.ts';
import {INTERIORS} from '../shared/content/interior-catalog.ts';

test('walking through the exterior doorway enters and exits one authoritative interior', () => {
  const controller = new InteriorController();
  const interior = INTERIORS[0];
  const player = new PlayerState();
  player.x = interior.exteriorDoor.x;
  player.y = interior.exteriorDoor.y;

  assert.equal(controller.tryEnter(player), true);
  assert.equal(player.spaceId, interior.id);
  assert.deepEqual({x: player.x, y: player.y}, {
    x: interior.entry.x,
    y: interior.entry.y
  });

  assert.equal(controller.move(player, 0, 10, 11), true);
  assert.equal(player.spaceId, 'street');
  assert.deepEqual({x: player.x, y: player.y}, {
    x: interior.exteriorDoor.exitX,
    y: interior.exteriorDoor.exitY
  });
});

test('interior collision resolves axes and blocks walls and fixtures', () => {
  const controller = new InteriorController();
  const interior = INTERIORS[0];
  const player = new PlayerState();
  player.spaceId = interior.id;
  player.x = 2632;
  player.y = 1680;

  controller.move(player, 0, -100, 11);
  assert.equal(player.y, 1680);

  player.x = 2664;
  player.y = 1712;
  controller.move(player, -30, 0, 11);
  assert.equal(player.x, 2664);
  assert.equal(player.spaceId, interior.id);
});
