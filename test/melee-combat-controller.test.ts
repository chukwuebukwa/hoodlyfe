import assert from 'node:assert/strict';
import test from 'node:test';
import {MeleeCombatController} from '../server/game/combat/melee-combat-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('fist contact resolves once at impact time and progresses per-player combo state', () => {
  const fixture = createFixture();
  fixture.attacker.weapon = 'fists';
  const target = player('target', 37, 0);
  fixture.state.players.set(target.id, target);

  const first = fixture.controller.begin('attacker', 'fists', 1000);
  assert.deepEqual(first, {accepted: true, combo: 0});
  assert.equal(fixture.attacker.action, 'melee');
  assert.equal(fixture.attacker.attackSequence, 1);
  assert.equal(fixture.attacker.attackProgress, 0);
  assert.deepEqual(fixture.cancelledProtection, ['attacker']);
  assert.equal(fixture.events.drain()[0]?.type, 'melee.started');
  assert.equal(fixture.attacker.angle, 0);
  fixture.controller.update(1134);
  assert.equal(fixture.playerDamage.length, 0);
  assert.ok(fixture.attacker.attackProgress > 0 && fixture.attacker.attackProgress < 1);
  fixture.controller.update(1135);
  fixture.controller.update(1200);
  assert.deepEqual(fixture.playerDamage, [{id: 'target', damage: 9, attackerId: 'attacker'}]);
  const buffered = fixture.controller.begin('attacker', 'fists', 1200);
  assert.deepEqual(buffered, {accepted: true, combo: 1});
  fixture.controller.update(1340);
  assert.equal(fixture.attacker.action, 'melee');
  assert.equal(fixture.attacker.attackSequence, 2);
  assert.equal(fixture.attacker.attackCombo, 1);
  assert.equal(fixture.attacker.attackProgress, 0);
  assert.equal(fixture.events.drain()[0]?.type, 'melee.started');
  fixture.controller.update(1485);
  assert.equal(fixture.playerDamage.at(-1)?.damage, 11);
  fixture.controller.update(1700);
  assert.equal(fixture.attacker.action, '');

  const reset = fixture.controller.begin('attacker', 'fists', 2500);
  assert.deepEqual(reset, {accepted: true, combo: 0});
});

test('bat applies bounded multi-ped contact and deliberate low vehicle damage', () => {
  const fixture = createFixture();
  fixture.attacker.weapon = 'bat';
  for (let index = 0; index < 4; index++) {
    const npc = new NpcState();
    npc.id = `npc-${index}`;
    npc.x = 30 + index * 3;
    npc.y = index % 2 === 0 ? 4 : -4;
    fixture.state.npcs.set(npc.id, npc);
  }
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.x = 40;
  vehicle.y = 0;
  fixture.state.vehicles.set(vehicle.id, vehicle);

  assert.equal(fixture.controller.begin('attacker', 'bat', 1000).accepted, true);
  fixture.controller.update(1285);
  assert.equal(fixture.npcDamage.length, 3);
  assert.equal(new Set(fixture.npcDamage.map((entry) => entry.id)).size, 3);
  assert.deepEqual(fixture.vehicleDamage, [{id: 'car', damage: 16, attackerId: 'attacker'}]);
});

test('combo progression is isolated per player instead of using single-player global state', () => {
  const fixture = createFixture();
  fixture.attacker.weapon = 'fists';
  assert.equal(fixture.controller.begin('attacker', 'fists', 1000).combo, 0);
  fixture.controller.update(1340);
  assert.equal(fixture.controller.begin('attacker', 'fists', 1360).combo, 1);

  const second = player('attacker-two', 0, 50);
  second.weapon = 'fists';
  fixture.state.players.set(second.id, second);
  assert.equal(fixture.controller.begin(second.id, 'fists', 1360).combo, 0);
});

test('melee rejects busy, vehicle, interior, dead, and cross-space targets', () => {
  const fixture = createFixture();
  fixture.attacker.weapon = 'fists';
  const interiorTarget = player('interior-target', 20, 0);
  interiorTarget.spaceId = 'mercy-hospital';
  fixture.state.players.set(interiorTarget.id, interiorTarget);

  fixture.attacker.spaceId = 'mercy-hospital';
  assert.equal(fixture.controller.begin('attacker', 'fists', 1000).accepted, false);
  fixture.attacker.spaceId = 'street';
  fixture.attacker.vehicleId = 'car';
  assert.equal(fixture.controller.begin('attacker', 'fists', 1000).accepted, false);
  fixture.attacker.vehicleId = '';
  fixture.attacker.action = 'entering';
  assert.equal(fixture.controller.begin('attacker', 'fists', 1000).accepted, false);
  fixture.attacker.action = '';
  fixture.attacker.alive = false;
  assert.equal(fixture.controller.begin('attacker', 'fists', 1000).accepted, false);
  fixture.attacker.alive = true;

  assert.equal(fixture.controller.begin('attacker', 'fists', 1000).accepted, true);
  fixture.controller.update(1135);
  assert.equal(fixture.playerDamage.length, 0);
  fixture.controller.clearPlayer('attacker');
  assert.equal(fixture.attacker.action, '');
});

function createFixture() {
  const state = new DistrictState();
  const attacker = player('attacker', 0, 0);
  state.players.set(attacker.id, attacker);
  const playerDamage: Array<{id: string; damage: number; attackerId: string}> = [];
  const npcDamage: Array<{id: string; damage: number; attackerId: string}> = [];
  const vehicleDamage: Array<{id: string; damage: number; attackerId: string}> = [];
  const events = new GameEventStream();
  const cancelledProtection: string[] = [];
  const controller = new MeleeCombatController({
    state,
    world: {hasLineOfSight: () => true} as unknown as CollisionMap,
    events,
    clock: () => ({tick: 1}),
    cancelSpawnProtection: (playerId) => cancelledProtection.push(playerId),
    queryPlayers: () => [...state.players.values()],
    queryNpcs: () => [...state.npcs.values()],
    queryVehicles: () => [...state.vehicles.values()],
    damagePlayer: (target, damage, attackerId) => playerDamage.push({
      id: target.id,
      damage,
      attackerId
    }),
    damageNpc: (target, damage, attackerId) => npcDamage.push({
      id: target.id,
      damage,
      attackerId
    }),
    damageVehicle: (target, damage, attackerId) => vehicleDamage.push({
      id: target.id,
      damage,
      attackerId
    })
  });
  return {
    state,
    attacker,
    controller,
    playerDamage,
    npcDamage,
    vehicleDamage,
    events,
    cancelledProtection
  };
}

function player(id: string, x: number, y: number): PlayerState {
  const result = new PlayerState();
  result.id = id;
  result.x = x;
  result.y = y;
  result.angle = 0;
  return result;
}
