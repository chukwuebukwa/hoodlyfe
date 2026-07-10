import assert from 'node:assert/strict';
import test from 'node:test';
import {PlayerInteractionController} from '../server/game/interactions/player-interaction-controller.ts';

test('player interaction prioritizes services and suppresses same-tick duplicates', () => {
  const calls: string[] = [];
  let serviceAvailable = true;
  const controller = new PlayerInteractionController({
    services: {
      interact: (playerId, nowMs) => {
        calls.push(`service:${playerId}:${nowMs}`);
        return serviceAvailable;
      }
    },
    vehicles: {
      interact: (playerId, nowMs) => calls.push(`vehicle:${playerId}:${nowMs}`)
    }
  });

  assert.equal(controller.interact('driver', 100, 4), 'service');
  assert.equal(controller.interact('driver', 101, 4), 'duplicate');
  assert.deepEqual(calls, ['service:driver:100']);

  serviceAvailable = false;
  assert.equal(controller.interact('driver', 200, 5), 'vehicle');
  assert.deepEqual(calls.slice(-2), ['service:driver:200', 'vehicle:driver:200']);

  controller.clearPlayer('driver');
  assert.equal(controller.interact('driver', 201, 5), 'vehicle');
});

test('player interaction can allow interior services while blocking vehicle access', () => {
  const calls: string[] = [];
  const controller = new PlayerInteractionController({
    services: {
      interact: () => false
    },
    vehicles: {
      interact: () => calls.push('vehicle')
    },
    canUseVehicles: () => false
  });

  assert.equal(controller.interact('driver', 300, 9), 'none');
  assert.deepEqual(calls, []);
});
