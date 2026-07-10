import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {VehicleCollisionSystem} from '../server/game/vehicles/vehicle-collision-system.ts';
import {VehicleDamageSystem} from '../server/game/vehicles/vehicle-damage-system.ts';
import {BulletState, DistrictState, VehicleState} from '../server/state.ts';

test('vehicle collision separates overlaps and transfers forward momentum', () => {
  const collision = new VehicleCollisionSystem().resolve({
    id: 'moving',
    x: 0,
    y: 0,
    angle: 0,
    speed: 240,
    radius: 20,
    mass: 1,
    damageScale: 1
  }, {
    id: 'parked',
    x: 35,
    y: 0,
    angle: 0,
    speed: 0,
    radius: 20,
    mass: 1,
    damageScale: 1
  });

  assert.equal(collision.collided, true);
  assert.equal(collision.closingSpeed, 240);
  assert.ok(collision.primaryX < 0);
  assert.ok(collision.otherX > 35);
  assert.ok(collision.primarySpeed < 240);
  assert.ok(collision.otherSpeed > 0);
  assert.ok(collision.primaryDamage >= 30);
  assert.equal(collision.primaryDamage, collision.otherDamage);
});

test('overlapping vehicles moving apart separate without taking impact damage', () => {
  const collision = new VehicleCollisionSystem().resolve({
    id: 'left',
    x: 0,
    y: 0,
    angle: Math.PI,
    speed: 80,
    radius: 20,
    mass: 1,
    damageScale: 1
  }, {
    id: 'right',
    x: 38,
    y: 0,
    angle: 0,
    speed: 80,
    radius: 20,
    mass: 1,
    damageScale: 1
  });

  assert.equal(collision.collided, true);
  assert.equal(collision.closingSpeed, 0);
  assert.equal(collision.primaryDamage, 0);
  assert.equal(collision.otherDamage, 0);
});

test('vehicle damage clamps health, reports destruction once, and limits damaged speed', () => {
  const damage = new VehicleDamageSystem();
  assert.deepEqual(damage.apply(30, 12), {appliedDamage: 12, health: 18, destroyed: false});
  assert.deepEqual(damage.apply(18, 99), {appliedDamage: 18, health: 0, destroyed: true});
  assert.deepEqual(damage.apply(0, 99), {appliedDamage: 0, health: 0, destroyed: false});
  assert.equal(damage.wallImpactDamage(60), 0);
  assert.ok(damage.wallImpactDamage(400) >= 25);
  assert.equal(damage.speedMultiplier(0, 100), 0);
  assert.ok(damage.speedMultiplier(25, 100) < damage.speedMultiplier(100, 100));
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
  room.rebuildSpatialIndex();

  room.handleVehicleCollision(moving, 1000);
  assert.ok(moving.x < 100);
  assert.ok(parked.x > 135);
  assert.ok(moving.health < 100);
  assert.ok(parked.health < 100);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.damaged',
    'vehicle.damaged'
  ]);
});

test('district projectile resolution damages vehicles and consumes the bullet', () => {
  const room = new DistrictRoom() as any;
  room.world = {isBlockedAt: () => false};
  room.setState(new DistrictState());
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

  room.moveBullet(bullet, bullet.id, 0.05, 50);
  room.lifecycle.flush();
  assert.equal(vehicle.health, 89);
  assert.equal(room.state.bullets.has(bullet.id), false);
  assert.deepEqual(room.events.drain().map((event: {type: string}) => event.type), [
    'vehicle.damaged'
  ]);
});
