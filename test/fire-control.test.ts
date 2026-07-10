import assert from 'node:assert/strict';
import test from 'node:test';
import {FireControlController} from '../server/game/combat/fire-control-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
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
  const events = new GameEventStream();
  const cancelledProtection: string[] = [];
  const fire = new FireControlController({
    state,
    random: new DeterministicRandom('fire-control-test'),
    clock: () => clock,
    events,
    cancelSpawnProtection: (playerId) => cancelledProtection.push(playerId)
  });

  fire.shoot(player.id);
  assert.equal(player.ammoPistol, 119);
  assert.equal(state.bullets.size, 1);
  assert.deepEqual(cancelledProtection, ['shooter']);
  assert.deepEqual(events.drain().map((event) => event.type), ['weapon.fired']);
  fire.shoot(player.id);
  assert.equal(state.bullets.size, 1);
  assert.deepEqual(cancelledProtection, ['shooter']);
  assert.equal(events.size, 0);

  clock.nowMs += 700;
  clock.tick += 1;
  player.weapon = 'shotgun';
  fire.shoot(player.id);
  assert.equal(player.ammoShotgun, 47);
  assert.equal(state.bullets.size, 7);
  assert.deepEqual(events.drain().map((event) => event.type), ['weapon.fired']);

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
  assert.equal(events.size, 0);

  player.vehicleSeat = 1;
  player.weapon = 'pistol';
  fire.shoot(player.id);
  assert.equal(state.bullets.size, 8);
  assert.deepEqual(events.drain().map((event) => event.type), ['weapon.fired']);
  const passengerBullet = [...state.bullets.values()].at(-1);
  assert.ok(passengerBullet);
  assert.ok(Math.hypot(passengerBullet.x - vehicle.x, passengerBullet.y - vehicle.y) < 40);

  player.vehicleId = '';
  player.vehicleSeat = -1;
  player.weapon = 'grenade';
  clock.nowMs += 700;
  let thrown = 0;
  const grenadeFire = new FireControlController({
    state,
    random: new DeterministicRandom('grenade-fire-test'),
    clock: () => clock,
    events,
    throwExplosive: () => {
      thrown++;
      return true;
    }
  });
  grenadeFire.shoot(player.id);
  assert.equal(thrown, 1);
  assert.equal(player.ammoGrenade, 1);
  assert.equal(state.bullets.size, 8);
  assert.equal(events.drain()[0]?.type, 'weapon.fired');
  player.vehicleId = vehicle.id;
  player.vehicleSeat = 1;
  clock.nowMs += 700;
  grenadeFire.shoot(player.id);
  assert.equal(thrown, 1);
  assert.equal(player.ammoGrenade, 1);

  fire.createNpcBullet('hostile', 50, 60, 0, clock.nowMs, 'smg', 'hostile');
  const hostileBullet = [...state.bullets.values()].at(-1);
  assert.equal(hostileBullet?.ownerKind, 'hostile');
  assert.equal(hostileBullet?.weapon, 'smg');
  const hostileEvent = events.drain()[0];
  assert.equal(hostileEvent?.type, 'weapon.fired');
  if (hostileEvent?.type === 'weapon.fired') assert.equal(hostileEvent.ownerKind, 'hostile');
});
