import assert from 'node:assert/strict';
import test from 'node:test';
import {WeaponPickupController} from '../server/game/pickups/weapon-pickup-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('shared grenade pickup resolves contention deterministically and respawns', () => {
  const state = new DistrictState();
  const events = new GameEventStream();
  const notices: string[] = [];
  const controller = new WeaponPickupController({
    state,
    world: {
      spawn: {x: 0, y: 0},
      openPointNear: (_x: number, _y: number, _min: number, _max: number, _radius: number, seed: number) => (
        seed === 5_271 ? {x: 100, y: 120} : {x: 300, y: 320}
      )
    } as unknown as CollisionMap,
    events,
    clock: () => ({tick: 7}),
    nearbyPlayers: () => [...state.players.values()],
    notice: (playerId, message) => notices.push(`${playerId}:${message}`)
  });
  controller.initialize();
  controller.initialize();
  assert.equal(state.weaponPickups.size, 2);
  const pickup = state.weaponPickups.get('grenade-cache');
  assert.ok(pickup);
  for (const id of ['bravo', 'alpha']) {
    const player = new PlayerState();
    player.id = id;
    player.x = pickup.x;
    player.y = pickup.y;
    player.ammoGrenade = 2;
    state.players.set(id, player);
  }

  controller.update(1000);
  assert.equal(state.players.get('alpha')?.ammoGrenade, 5);
  assert.equal(state.players.get('bravo')?.ammoGrenade, 2);
  assert.equal(pickup.available, false);
  assert.equal(pickup.respawnAt, 21_000);
  assert.deepEqual(notices, ['alpha:GRENADES +3']);
  const collected = events.drain()[0];
  assert.equal(collected?.type, 'pickup.collected');

  controller.update(20_999);
  assert.equal(pickup.available, false);
  state.players.get('alpha')!.x = 0;
  state.players.get('bravo')!.x = 0;
  controller.update(21_000);
  assert.equal(pickup.available, true);
  assert.equal(pickup.respawnAt, 0);
});

test('Molotov pickup uses catalog ammo fields, capacity, notice, and respawn policy', () => {
  const state = new DistrictState();
  const events = new GameEventStream();
  const notices: string[] = [];
  const controller = new WeaponPickupController({
    state,
    world: {
      spawn: {x: 0, y: 0},
      openPointNear: (_x: number, _y: number, _min: number, _max: number, _radius: number, seed: number) => (
        seed === 8_419 ? {x: 300, y: 320} : {x: 100, y: 120}
      )
    } as unknown as CollisionMap,
    events,
    clock: () => ({tick: 8}),
    nearbyPlayers: () => [...state.players.values()],
    notice: (playerId, message) => notices.push(`${playerId}:${message}`)
  });
  controller.initialize();
  const pickup = state.weaponPickups.get('molotov-cache');
  assert.ok(pickup);
  const player = new PlayerState();
  player.id = 'collector';
  player.x = pickup.x;
  player.y = pickup.y;
  player.ammoMolotov = 4;
  state.players.set(player.id, player);

  controller.update(5000);
  assert.equal(player.ammoMolotov, 5);
  assert.equal(pickup.respawnAt, 29_000);
  assert.deepEqual(notices, ['collector:MOLOTOVS +1']);
  const collected = events.drain()[0];
  assert.equal(collected?.type, 'pickup.collected');
  if (collected?.type === 'pickup.collected') assert.equal(collected.weapon, 'molotov');
});
