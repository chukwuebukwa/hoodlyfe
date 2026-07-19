import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DistrictState,
  NpcState,
  PlayerState,
  RocketProjectileState,
  ThrownProjectileState,
  VehicleState
} from '../server/state.ts';
import {InteractionCandidateSource} from '../server/game/network/interaction-candidate-source.ts';

test('candidate source deterministically filters broad-phase actors by physical space', () => {
  const state = new DistrictState();
  const local = player('local', 0, 0);
  const remote = player('remote', 10, 0);
  const passenger = player('passenger', 15, 0);
  passenger.vehicleId = 'car-1';
  const interior = player('interior', 5, 0);
  interior.spaceId = 'mercy-hospital';
  const npc = new NpcState();
  npc.id = 'npc-1';
  npc.x = 20;
  const vehicle = new VehicleState();
  vehicle.id = 'car-1';
  vehicle.x = 30;
  const rocket = new RocketProjectileState();
  rocket.id = 'rocket-1';
  rocket.x = 40;
  const farProjectile = new ThrownProjectileState();
  farProjectile.id = 'far';
  farProjectile.x = 900;
  for (const value of [local, remote, passenger, interior]) state.players.set(value.id, value);
  state.npcs.set(npc.id, npc);
  state.vehicles.set(vehicle.id, vehicle);
  state.rockets.set(rocket.id, rocket);
  state.thrownProjectiles.set(farProjectile.id, farProjectile);
  const actors = [
    {id: 'car-1', kind: 'vehicle' as const, x: 30, y: 0},
    {id: 'npc-1', kind: 'npc' as const, x: 20, y: 0},
    {id: 'passenger', kind: 'player' as const, x: 15, y: 0},
    {id: 'interior', kind: 'player' as const, x: 5, y: 0},
    {id: 'local', kind: 'player' as const, x: 0, y: 0},
    {id: 'remote', kind: 'player' as const, x: 10, y: 0},
    {id: 'remote', kind: 'player' as const, x: 10, y: 0}
  ];
  const source = new InteractionCandidateSource(state, {queryActors: () => actors});

  assert.deepEqual(source.forAnchor({
    id: 'local',
    kind: 'player',
    x: 0,
    y: 0,
    spaceId: 'street',
    layerId: local.surfaceId
  }), [
    {kind: 'player', id: 'remote'},
    {kind: 'pedestrian', id: 'npc-1'},
    {kind: 'vehicle', id: 'car-1'},
    {kind: 'projectile', id: 'rocket-1'}
  ]);
  assert.deepEqual(source.forAnchor({
    id: 'interior',
    kind: 'player',
    x: 5,
    y: 0,
    spaceId: 'mercy-hospital',
    layerId: interior.surfaceId
  }), []);
});

test('candidate source rejects invalid broad-phase radii', () => {
  const state = new DistrictState();
  assert.throws(
    () => new InteractionCandidateSource(state, {queryActors: () => [], radius: 0}),
    /positive finite/
  );
});

function player(id: string, x: number, y: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  return value;
}
