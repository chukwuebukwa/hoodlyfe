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
  assert.equal(player.wanted, 1);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), ['crime.committed']);
});
