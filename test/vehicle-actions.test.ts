import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {CrimeResponseController} from '../server/game/police/crime-response-controller.ts';
import {VehicleAccessController} from '../server/game/vehicles/vehicle-access-controller.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {attachTestVehicleAccess} from './support/vehicle-access.ts';
import {attachTestTrafficController} from './support/traffic-controller.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

test('hijacking stops traffic, ejects its driver, and gives the player control', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  attachTestTrafficController(room);
  room.crimeController = new CrimeResponseController({
    state: room.state,
    world: room.world,
    events: room.events,
    clock: () => ({tick: room.simulationClock.tick, nowMs: room.simulationClock.nowMs}),
    queryNpcs: (x, y, radius) => [...room.state.npcs.values()].filter((npc) => (
      Math.hypot(npc.x - x, npc.y - y) <= radius
    )),
    panicWitness: (witnessId, suspectId, untilMs) => {
      const runtime = room.runtimeNpcs.get(witnessId);
      if (!runtime) return;
      runtime.panicUntil = untilMs;
      runtime.threatId = suspectId;
    }
  });
  room.vehicleAccess = new VehicleAccessController({
    state: room.state,
    world: room.world,
    nearbyVehicles: (x, y, radius) => [...room.state.vehicles.values()].filter((vehicle) => (
      Math.hypot(vehicle.x - x, vehicle.y - y) <= radius
    )),
    createEjectedDriver: (vehicle, hijacker, nowMs) => room.spawnEjectedDriver(
      vehicle,
      hijacker,
      nowMs
    ),
    recordTheft: (playerId, victimId, x, y, nowMs) => room.crimeController.record(
      playerId,
      'vehicle-theft',
      nowMs,
      victimId,
      x,
      y
    ),
    releaseTrafficControl: (vehicleId) => room.trafficController.release(vehicleId)
  });

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
  room.trafficController.register(vehicle.id, spawn, 110);
  room.rebuildSpatialIndex();

  room.vehicleAccess.interact(player.id, Date.now());
  assert.equal(player.action, 'hijacking');
  assert.equal(vehicle.hijackBy, player.id);

  room.vehicleAccess.updateAction(player, Date.now() + 2000);
  assert.equal(player.action, '');
  assert.equal(player.vehicleId, vehicle.id);
  assert.equal(player.vehicleSeat, 0);
  assert.equal(vehicle.driverId, player.id);
  assert.equal(vehicle.traffic, false);
  assert.equal(room.state.npcs.size, 1);
  assert.equal(player.wanted, 0);
  room.crimeController.processReports(Date.now() + 3000);
  assert.equal(player.wanted, 1);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'crime.committed',
    'incident.reported'
  ]);
});

test('collision damage ignites a vehicle before explosion, ejection, and restoration', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  attachTestTrafficController(room);
  attachTestVehicleAccess(room);
  attachTestVehicleSimulation(room);

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
  vehicle.health = 200;
  room.state.vehicles.set(vehicle.id, vehicle);

  room.vehicleSimulation.damage(vehicle, 400, 'attacker', 'vehicle', 1000, 'front');
  assert.equal(vehicle.destroyed, false);
  assert.equal(vehicle.health, 1);
  assert.equal(vehicle.onFire, true);
  assert.equal(vehicle.driverId, player.id);
  assert.equal(player.vehicleId, vehicle.id);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.damaged',
    'vehicle.ignited'
  ]);

  room.vehicleSimulation.update(vehicle, 1 / 30, 5999);
  assert.equal(vehicle.destroyed, false);
  room.vehicleSimulation.update(vehicle, 1 / 30, 6000);
  assert.equal(vehicle.destroyed, true);
  assert.equal(vehicle.driverId, '');
  assert.equal(player.vehicleId, '');
  assert.equal(player.health, 65);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'damage.applied',
    'vehicle.destroyed'
  ]);

  room.vehicleSimulation.update(vehicle, 1 / 30, 13_999);
  assert.equal(vehicle.destroyed, true);
  room.vehicleSimulation.update(vehicle, 1 / 30, 14_000);
  assert.equal(vehicle.destroyed, false);
  assert.equal(vehicle.health, 1000);
  assert.equal(vehicle.engineDamage, 0);
  assert.equal(vehicle.damageFront, 0);
  assert.equal(vehicle.respawnAt, 0);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.restored'
  ]);
});
