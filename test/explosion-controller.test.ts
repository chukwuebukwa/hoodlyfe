import assert from 'node:assert/strict';
import test from 'node:test';
import {ExplosionController} from '../server/game/combat/explosion-controller.ts';
import type {DamageController} from '../server/game/combat/damage-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import type {VehicleSimulationController} from '../server/game/vehicles/vehicle-simulation-controller.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';

test('grenade blast applies radial damage once and excludes players inside vehicles', () => {
  const state = new DistrictState();
  const source = player('source', 0, 0);
  const nearby = player('nearby', 60, 0);
  const outer = player('outer', 97.5, 0);
  const above = player('above', 0, 0);
  above.surfaceId = 'bridge';
  const occupant = player('occupant', 10, 0);
  occupant.vehicleId = 'car';
  for (const value of [source, nearby, outer, above, occupant]) state.players.set(value.id, value);
  const npc = new NpcState();
  npc.id = 'civilian';
  npc.x = 65;
  state.npcs.set(npc.id, npc);
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.x = 97.5;
  state.vehicles.set(vehicle.id, vehicle);
  const playerDamage: Array<{id: string; amount: number; attackerId: string}> = [];
  const npcDamage: Array<{id: string; amount: number}> = [];
  const vehicleDamage: Array<{id: string; amount: number}> = [];
  const events = new GameEventStream();
  const controller = new ExplosionController({
    state,
    events,
    clock: () => ({tick: 4}),
    damage: {
      player: (target: PlayerState, amount: number, attackerId: string) => {
        playerDamage.push({id: target.id, amount, attackerId});
      },
      npc: (target: NpcState, amount: number) => npcDamage.push({id: target.id, amount})
    } as unknown as DamageController,
    vehicles: {
      damage: (target: VehicleState, amount: number) => vehicleDamage.push({id: target.id, amount})
    } as unknown as VehicleSimulationController,
    queryPlayers: () => [...state.players.values()],
    queryNpcs: () => [...state.npcs.values()],
    queryVehicles: () => [...state.vehicles.values()]
  });

  controller.detonate('grenade', 0, 0, source.id, 'player', 1000, source.surfaceId);
  assert.deepEqual(playerDamage, [
    {id: 'source', amount: 120, attackerId: 'source'},
    {id: 'nearby', amount: 120, attackerId: 'source'},
    {id: 'outer', amount: 60, attackerId: 'source'}
  ]);
  assert.deepEqual(npcDamage, [{id: 'civilian', amount: 120}]);
  assert.deepEqual(vehicleDamage, [{id: 'car', amount: 325}]);
  assert.equal(events.drain()[0]?.type, 'explosion.created');
  assert.equal(state.explosions.size, 1);
  controller.update(1650);
  assert.equal(state.explosions.size, 0);
});

test('vehicle destruction queues a later-tick explosion and drops disconnected attribution', () => {
  const state = new DistrictState();
  const wreck = new VehicleState();
  wreck.id = 'wreck';
  wreck.x = 80;
  wreck.y = 90;
  wreck.destroyed = true;
  state.vehicles.set(wreck.id, wreck);
  const events = new GameEventStream();
  const controller = new ExplosionController({
    state,
    events,
    clock: () => ({tick: 9}),
    damage: {player: () => undefined, npc: () => undefined} as unknown as DamageController,
    vehicles: {damage: () => undefined} as unknown as VehicleSimulationController,
    queryPlayers: () => [],
    queryNpcs: () => [],
    queryVehicles: () => []
  });
  controller.observeEvents([{
    type: 'vehicle.destroyed', tick: 8, nowMs: 800,
    vehicleId: wreck.id, sourceId: 'gone-player', sourceKind: 'weapon', occupantIds: []
  }]);
  assert.equal(state.explosions.size, 0);
  controller.update(900);
  assert.equal(state.explosions.size, 1);
  const event = events.drain()[0];
  assert.equal(event?.type, 'explosion.created');
  if (event?.type === 'explosion.created') {
    assert.equal(event.kind, 'vehicle');
    assert.equal(event.sourceId, '');
    assert.equal(event.sourceKind, 'vehicle');
  }
});

test('rocket blasts use their own damage envelope and retain active-player attribution', () => {
  const state = new DistrictState();
  const source = player('source', 0, 0);
  const target = player('target', 0, 0);
  state.players.set(source.id, source);
  state.players.set(target.id, target);
  const damage: Array<{id: string; amount: number; sourceId: string}> = [];
  const events = new GameEventStream();
  const controller = new ExplosionController({
    state,
    events,
    clock: () => ({tick: 12}),
    damage: {
      player: (value: PlayerState, amount: number, sourceId: string) => {
        damage.push({id: value.id, amount, sourceId});
      },
      npc: () => undefined
    } as unknown as DamageController,
    vehicles: {damage: () => undefined} as unknown as VehicleSimulationController,
    queryPlayers: () => [...state.players.values()],
    queryNpcs: () => [],
    queryVehicles: () => []
  });
  controller.detonate('rocket', 0, 0, source.id, 'player', 1200, source.surfaceId);
  assert.deepEqual(damage, [
    {id: 'source', amount: 165, sourceId: 'source'},
    {id: 'target', amount: 165, sourceId: 'source'}
  ]);
  const event = events.drain()[0];
  assert.equal(event?.type, 'explosion.created');
  if (event?.type === 'explosion.created') assert.equal(event.kind, 'rocket');
});

function player(id: string, x: number, y: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}
