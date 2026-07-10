import assert from 'node:assert/strict';
import test from 'node:test';
import {FireControlController} from '../server/game/combat/fire-control-controller.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';

test('fire control enforces cooldown, ammo, pellet count, driver rules, and passenger origin', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'shooter';
  player.x = 100;
  player.y = 120;
  player.angle = 0;
  state.players.set(player.id, player);
  const clock = {tick: 1, nowMs: 1000};
  const fire = new FireControlController({
    state,
    random: new DeterministicRandom('fire-control-test'),
    clock: () => clock
  });

  fire.shoot(player.id);
  assert.equal(player.ammoPistol, 119);
  assert.equal(state.bullets.size, 1);
  fire.shoot(player.id);
  assert.equal(state.bullets.size, 1);

  clock.nowMs += 700;
  clock.tick += 1;
  player.weapon = 'shotgun';
  fire.shoot(player.id);
  assert.equal(player.ammoShotgun, 47);
  assert.equal(state.bullets.size, 7);

  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.x = 400;
  vehicle.y = 500;
  vehicle.angle = Math.PI / 2;
  state.vehicles.set(vehicle.id, vehicle);
  player.vehicleId = vehicle.id;
  player.vehicleSeat = 0;
  clock.nowMs += 700;
  fire.shoot(player.id);
  assert.equal(state.bullets.size, 7);

  player.vehicleSeat = 1;
  player.weapon = 'pistol';
  fire.shoot(player.id);
  assert.equal(state.bullets.size, 8);
  const passengerBullet = [...state.bullets.values()].at(-1);
  assert.ok(passengerBullet);
  assert.ok(Math.hypot(passengerBullet.x - vehicle.x, passengerBullet.y - vehicle.y) < 40);
});
