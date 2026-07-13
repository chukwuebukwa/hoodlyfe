import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {VehicleCollisionSystem} from '../server/game/vehicles/vehicle-collision-system.ts';
import {VehicleDamageSystem} from '../server/game/vehicles/vehicle-damage-system.ts';
import {BulletState, DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {attachTestVehicleAccess} from './support/vehicle-access.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';
import {attachTestProjectileController} from './support/projectile-controller.ts';
import {VEHICLE_SIMULATION_STEP_SECONDS} from '../shared/simulation/vehicle-step.ts';

test('vehicle collision separates overlaps and transfers forward momentum', () => {
  const collision = new VehicleCollisionSystem().resolve({
    id: 'moving',
    x: 0,
    y: 0,
    angle: 0,
    speed: 240,
    halfLength: 29,
    halfWidth: 16,
    mass: 1,
    damageScale: 1
  }, {
    id: 'parked',
    x: 35,
    y: 0,
    angle: 0,
    speed: 0,
    halfLength: 29,
    halfWidth: 16,
    mass: 1,
    damageScale: 1
  });

  assert.equal(collision.collided, true);
  assert.equal(collision.closingSpeed, 240);
  assert.ok(collision.primaryX < 0);
  assert.ok(collision.otherX > 35);
  assert.ok(collision.primarySpeed < 240);
  assert.ok(collision.otherSpeed > 0);
  assert.ok(collision.primaryDamage >= 100);
  assert.equal(collision.primaryDamage, collision.otherDamage);
  assert.equal(collision.primaryZone, 'front');
  assert.equal(collision.otherZone, 'rear');
});

test('overlapping vehicles moving apart separate without taking impact damage', () => {
  const collision = new VehicleCollisionSystem().resolve({
    id: 'left',
    x: 0,
    y: 0,
    angle: Math.PI,
    speed: 80,
    halfLength: 29,
    halfWidth: 16,
    mass: 1,
    damageScale: 1
  }, {
    id: 'right',
    x: 38,
    y: 0,
    angle: 0,
    speed: 80,
    halfLength: 29,
    halfWidth: 16,
    mass: 1,
    damageScale: 1
  });

  assert.equal(collision.collided, true);
  assert.equal(collision.closingSpeed, 0);
  assert.equal(collision.primaryDamage, 0);
  assert.equal(collision.otherDamage, 0);
});

test('vehicle damage tracks components, ignition, delayed explosion, and weapon lethality', () => {
  const damage = new VehicleDamageSystem();
  const healthy = damage.reset(1000);
  const frontHit = damage.apply(healthy, 120, 'vehicle', 'front', 1000);
  assert.equal(frontHit.health, 880);
  assert.equal(frontHit.damageFront, 120);
  assert.equal(frontHit.damageRear, 0);
  assert.ok(frontHit.engineDamage > 0);
  assert.equal(frontHit.onFire, false);

  const burning = damage.apply({...frontHit, health: 200}, 400, 'vehicle', 'rear', 2000);
  assert.equal(burning.health, 1);
  assert.equal(burning.destroyed, false);
  assert.equal(burning.ignited, true);
  assert.equal(burning.onFire, true);
  assert.equal(burning.engineDamage, 225);
  assert.equal(damage.shouldExplode(burning, 6999), false);
  assert.equal(damage.shouldExplode(burning, 7000), true);

  const weaponKill = damage.apply(healthy, 1200, 'weapon', 'left', 1000);
  assert.equal(weaponKill.health, 0);
  assert.equal(weaponKill.destroyed, true);
  assert.equal(damage.wallImpactDamage(60), 0);
  assert.ok(damage.wallImpactDamage(400) >= 100);
  assert.equal(damage.speedMultiplier(0, false), 1);
  assert.ok(damage.speedMultiplier(250, false) < damage.speedMultiplier(100, false));
  assert.equal(damage.speedMultiplier(250, true), 0.58);
});

test('player driving consumes distinct model acceleration from the shared catalog', () => {
  assert.deepEqual([
    drivenSpeed('taxi'),
    drivenSpeed('sedan'),
    drivenSpeed('police')
  ].map(Math.round), [360, 390, 440]);
});

test('opposite throttle brakes to zero before changing direction', () => {
  const {room, vehicle, player} = drivingFixture('sedan');
  room.playerControl.setMove(player.id, {x: 0, y: -1});
  updateVehicle(room, vehicle, 3);
  assert.equal(vehicle.speed, 39);
  room.playerControl.setMove(player.id, {x: 0, y: 1});
  updateVehicle(room, vehicle, 5);
  assert.equal(vehicle.speed, 0);
  updateVehicle(room, vehicle, 1);
  assert.ok(vehicle.speed < 0);
});

test('district adapter applies collision movement and damage to both authoritative cars', () => {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const moving = new VehicleState();
  moving.id = 'moving';
  moving.x = 100;
  moving.y = 100;
  moving.angle = 0;
  moving.speed = 240;
  const parked = new VehicleState();
  parked.id = 'parked';
  parked.x = 135;
  parked.y = 100;
  parked.angle = 0;
  room.state.vehicles.set(moving.id, moving);
  room.state.vehicles.set(parked.id, parked);
  attachTestVehicleSimulation(room);
  room.rebuildSpatialIndex();

  room.vehicleSimulation.handleCollision(moving, 1000);
  assert.ok(moving.x < 100);
  assert.ok(parked.x > 135);
  assert.ok(moving.health < 1000);
  assert.ok(parked.health < 1000);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.damaged',
    'vehicle.damaged'
  ]);
});

test('district projectile resolution damages vehicles and consumes the bullet', () => {
  const room = new DistrictRoom() as any;
  room.world = {isBlockedAt: () => false};
  room.setState(new DistrictState());
  attachTestVehicleAccess(room);
  attachTestVehicleSimulation(room);
  attachTestProjectileController(room);
  const vehicle = new VehicleState();
  vehicle.id = 'target-car';
  vehicle.x = 40;
  vehicle.y = 100;
  room.state.vehicles.set(vehicle.id, vehicle);
  const bullet = new BulletState();
  bullet.id = 'bullet';
  bullet.ownerId = 'shooter';
  bullet.x = 0;
  bullet.y = 100;
  bullet.angle = 0;
  bullet.createdAt = 0;
  bullet.weapon = 'pistol';
  room.state.bullets.set(bullet.id, bullet);
  room.rebuildSpatialIndex();

  room.projectileController.update(bullet, bullet.id, 0.05, 50);
  room.lifecycle.flush();
  assert.equal(vehicle.health, 975);
  assert.equal(room.state.bullets.has(bullet.id), false);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.damaged'
  ]);
});

function drivenSpeed(kind: string): number {
  const {room, vehicle, player} = drivingFixture(kind);
  room.playerControl.setMove(player.id, {x: 0, y: -1});
  updateVehicle(room, vehicle, 30);
  return vehicle.speed;
}

function updateVehicle(room: any, vehicle: VehicleState, steps: number): void {
  for (let step = 1; step <= steps; step++) {
    room.vehicleSimulation.beginTick();
    room.vehicleSimulation.update(
      vehicle,
      VEHICLE_SIMULATION_STEP_SECONDS,
      step * VEHICLE_SIMULATION_STEP_SECONDS * 1_000
    );
  }
}

function drivingFixture(kind: string) {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const player = new PlayerState();
  player.id = `driver-${kind}`;
  player.vehicleId = `vehicle-${kind}`;
  player.vehicleSeat = 0;
  room.state.players.set(player.id, player);
  const vehicle = new VehicleState();
  vehicle.id = player.vehicleId;
  vehicle.kind = kind;
  vehicle.driverId = player.id;
  room.state.vehicles.set(vehicle.id, vehicle);
  attachTestVehicleSimulation(room);
  room.playerControl.register(player.id);
  return {room, vehicle, player};
}
