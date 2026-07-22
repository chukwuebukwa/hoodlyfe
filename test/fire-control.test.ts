import assert from 'node:assert/strict';
import test from 'node:test';
import {FireControlController} from '../server/game/combat/fire-control-controller.ts';
import {WeaponRuntimeController} from '../server/game/combat/weapon-runtime-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {COMBAT_PROTOCOL_VERSION} from '../shared/protocol/combat-fire.ts';

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
  const meleeAttacks: string[] = [];
  const weaponRuntime = new WeaponRuntimeController({state, clock: () => clock});
  const fire = new FireControlController({
    state,
    random: new DeterministicRandom('fire-control-test'),
    clock: () => clock,
    events,
    weaponRuntime,
    cancelSpawnProtection: (playerId) => cancelledProtection.push(playerId),
    meleeAttack: ({weapon}) => {
      meleeAttacks.push(weapon);
      return {accepted: weapon === 'fists', combo: 2};
    }
  });

  fire.shoot(player.id);
  assert.equal(player.magazinePistol, 11);
  assert.equal(player.ammoPistol, 108);
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
  assert.equal(player.magazineShotgun, 5);
  assert.equal(player.ammoShotgun, 42);
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
    weaponRuntime,
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

  player.vehicleId = '';
  player.vehicleSeat = -1;
  player.weapon = 'fists';
  const ammoBeforeMelee = {
    pistol: player.ammoPistol,
    smg: player.ammoSmg,
    shotgun: player.ammoShotgun,
    grenade: player.ammoGrenade
  };
  clock.nowMs += 700;
  fire.shoot(player.id);
  assert.equal(state.bullets.size, 9);
  assert.deepEqual(
    {
      pistol: player.ammoPistol,
      smg: player.ammoSmg,
      shotgun: player.ammoShotgun,
      grenade: player.ammoGrenade
    },
    ammoBeforeMelee
  );
  assert.deepEqual(meleeAttacks, ['fists']);
  assert.equal(events.size, 0, 'The melee domain publishes its own accepted-swing event.');
  player.action = 'melee';
  clock.nowMs += 30;
  fire.shoot(player.id);
  assert.deepEqual(meleeAttacks, ['fists', 'fists'], 'Active melee input reaches the combo buffer.');
});

test('fire control consumes rocket ammo only after an authoritative launch is accepted', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'rocketeer';
  player.weapon = 'rocket';
  player.ammoRocket = 2;
  state.players.set(player.id, player);
  const clock = {tick: 1, nowMs: 1000};
  const launched: string[] = [];
  let accept = false;
  const fire = new FireControlController({
    state,
    random: new DeterministicRandom('rocket-fire-test'),
    clock: () => clock,
    weaponRuntime: new WeaponRuntimeController({state, clock: () => clock}),
    launchRocket: ({ownerId}) => {
      launched.push(ownerId);
      return accept;
    }
  });

  fire.shoot(player.id);
  assert.equal(player.ammoRocket, 2);
  assert.equal(player.magazineRocket, 1);
  accept = true;
  fire.shoot(player.id);
  assert.equal(player.ammoRocket, 2);
  assert.equal(player.magazineRocket, 0);
  assert.deepEqual(launched, ['rocketeer', 'rocketeer']);
  player.vehicleId = 'car';
  player.vehicleSeat = 1;
  clock.nowMs += 1000;
  fire.shoot(player.id);
  assert.equal(player.ammoRocket, 2, 'Passengers cannot fire the launcher.');
});

test('fire control applies server rewind without client projectile prediction', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'correlated-shooter';
  state.players.set(player.id, player);
  const compensations: string[] = [];
  const clock = {tick: 10, nowMs: 2_000};
  const fire = new FireControlController({
    state,
    random: new DeterministicRandom('correlated-fire-test'),
    clock: () => clock,
    weaponRuntime: new WeaponRuntimeController({state, clock: () => clock}),
    compensateBullet: ({bullet}) => {
      compensations.push(bullet.id);
      return {effectiveServerShotTimeMs: 1_875, rewindMs: 125, resolved: false};
    }
  });
  const result = fire.shoot(player.id, {
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence: 1,
    clientSampleTimeMs: 1_875,
    controlledEntityId: player.id,
    aimAngle: Math.PI / 2
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(compensations, [[...state.bullets.keys()][0]]);
  assert.ok(Math.abs([...state.bullets.values()][0].angle - Math.PI / 2) < 1e-12);
  assert.equal(player.magazinePistol, 11);
  assert.equal(player.ammoPistol, 108);
});
