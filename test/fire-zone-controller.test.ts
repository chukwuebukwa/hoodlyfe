import assert from 'node:assert/strict';
import test from 'node:test';
import {FireZoneController} from '../server/game/combat/fire-zone-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import type {VehicleSimulationController} from '../server/game/vehicles/vehicle-simulation-controller.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';

test('fire zones damage exposed actors on cadence and expire deterministically', () => {
  const state = new DistrictState();
  const exposed = player('exposed', 20, 0);
  const occupant = player('occupant', 10, 0);
  occupant.vehicleId = 'car';
  const safe = player('safe', 100, 0);
  for (const value of [exposed, occupant, safe]) state.players.set(value.id, value);
  const npc = new NpcState();
  npc.id = 'civilian';
  npc.x = 30;
  state.npcs.set(npc.id, npc);
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.x = 12;
  state.vehicles.set(vehicle.id, vehicle);
  const playerIgnitions: string[] = [];
  const npcIgnitions: string[] = [];
  const vehicleDamage: string[] = [];
  const events = new GameEventStream();
  const controller = new FireZoneController({
    state,
    events,
    clock: () => ({tick: 7}),
    burn: {
      ignitePlayer: (target: PlayerState) => (playerIgnitions.push(target.id), true),
      igniteNpc: (target: NpcState) => (npcIgnitions.push(target.id), true)
    },
    vehicles: {
      damage: (target: VehicleState) => vehicleDamage.push(target.id)
    } as unknown as VehicleSimulationController,
    queryPlayers: () => [...state.players.values()],
    queryNpcs: () => [...state.npcs.values()],
    queryVehicles: () => [...state.vehicles.values()]
  });

  const id = controller.ignite(0, 0, 'thrower', 1000);
  assert.equal(events.drain()[0]?.type, 'fire.created');
  controller.update(1000);
  controller.update(1200);
  assert.deepEqual(playerIgnitions, ['exposed']);
  assert.deepEqual(npcIgnitions, ['civilian']);
  assert.deepEqual(vehicleDamage, ['car']);
  controller.update(1500);
  assert.deepEqual(playerIgnitions, ['exposed', 'exposed']);
  controller.update(7000);
  assert.equal(state.fires.has(id), false);
});

test('fire zones evict the oldest owner zone when capacity is exceeded', () => {
  const state = new DistrictState();
  const controller = new FireZoneController({
    state,
    events: new GameEventStream(),
    clock: () => ({tick: 1}),
    burn: {ignitePlayer: () => false, igniteNpc: () => false},
    vehicles: {damage: () => undefined} as unknown as VehicleSimulationController,
    queryPlayers: () => [],
    queryNpcs: () => [],
    queryVehicles: () => []
  });
  const first = controller.ignite(0, 0, 'driver', 1);
  controller.ignite(10, 0, 'driver', 2);
  controller.ignite(20, 0, 'driver', 3);
  controller.ignite(30, 0, 'driver', 4);
  assert.equal(state.fires.size, 3);
  assert.equal(state.fires.has(first), false);
});

function player(id: string, x: number, y: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}
