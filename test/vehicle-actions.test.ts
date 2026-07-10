import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('hijacking stops traffic, ejects its driver, and gives the player control', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());

  const spawn = room.world.trafficSpawn(91, 20);
  const player = new PlayerState();
  player.id = 'hijacker';
  player.name = 'Hijacker';
  player.x = spawn.x + 40;
  player.y = spawn.y;
  room.state.players.set(player.id, player);
  room.runtimePlayers.set(player.id, {
    inputX: 0,
    inputY: 0,
    lastShotAt: 0,
    lastCrimeAt: 0,
    lastHeatDecayAt: 0
  });

  const vehicle = new VehicleState();
  vehicle.id = 'traffic-test';
  vehicle.x = spawn.x;
  vehicle.y = spawn.y;
  vehicle.angle = spawn.angle;
  vehicle.traffic = true;
  room.state.vehicles.set(vehicle.id, vehicle);
  room.runtimeTraffic.set(vehicle.id, {
    previousColumn: spawn.column,
    previousRow: spawn.row,
    targetColumn: spawn.targetColumn,
    targetRow: spawn.targetRow,
    cruiseSpeed: 110
  });
  room.rebuildSpatialIndex();

  room.interact(player.id);
  assert.equal(player.action, 'hijacking');
  assert.equal(vehicle.hijackBy, player.id);

  room.updatePlayerAction(player, Date.now() + 2000);
  assert.equal(player.action, '');
  assert.equal(player.vehicleId, vehicle.id);
  assert.equal(player.vehicleSeat, 0);
  assert.equal(vehicle.driverId, player.id);
  assert.equal(vehicle.traffic, false);
  assert.equal(room.state.npcs.size, 1);
  assert.equal(player.wanted, 0);
  room.processIncidentReports(Date.now() + 3000);
  assert.equal(player.wanted, 1);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'crime.committed',
    'incident.reported'
  ]);
});

test('destroying a vehicle ejects occupants and restores the wreck after its cooldown', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());

  const player = new PlayerState();
  player.id = 'driver';
  player.x = room.world.spawn.x;
  player.y = room.world.spawn.y;
  player.vehicleId = 'wreck-test';
  player.vehicleSeat = 0;
  room.state.players.set(player.id, player);
  room.runtimePlayers.set(player.id, {inputX: 0, inputY: 0, lastShotAt: 0});

  const vehicle = new VehicleState();
  vehicle.id = 'wreck-test';
  vehicle.x = player.x;
  vehicle.y = player.y;
  vehicle.driverId = player.id;
  room.state.vehicles.set(vehicle.id, vehicle);

  room.applyVehicleDamage(vehicle, 200, 'attacker', 'weapon', 1000);
  assert.equal(vehicle.destroyed, true);
  assert.equal(vehicle.health, 0);
  assert.equal(vehicle.driverId, '');
  assert.equal(player.vehicleId, '');
  assert.equal(player.health, 65);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.damaged',
    'damage.applied',
    'vehicle.destroyed'
  ]);

  room.updateDestroyedVehicle(vehicle, 8999);
  assert.equal(vehicle.destroyed, true);
  room.updateDestroyedVehicle(vehicle, 9000);
  assert.equal(vehicle.destroyed, false);
  assert.equal(vehicle.health, 100);
  assert.equal(vehicle.respawnAt, 0);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.restored'
  ]);
});
