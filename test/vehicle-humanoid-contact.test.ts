import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveVehicleHumanoidContact} from '../shared/simulation/vehicle-humanoid-contact.ts';

test('OBB-circle contact separates a humanoid and transfers bounded momentum', () => {
  const result = resolveVehicleHumanoidContact(vehicle({speed: 180}), humanoid({x: 35}));

  assert.equal(result.valid, true);
  assert.equal(result.collided, true);
  assert.ok(Math.abs(result.normalX - 1) < 1e-9);
  assert.ok(Math.abs(result.normalY) < 1e-9);
  assert.equal(result.closingSpeed, 180);
  assert.equal(result.vehicleImpactSpeed, 180);
  assert.ok(result.vehicleX < 0);
  assert.ok(result.humanoidX > 35);
  assert.ok(result.vehicleSpeed < 180);
  assert.ok(result.humanoidVelocityX > result.vehicleSpeed);
  assert.ok(Math.hypot(result.humanoidVelocityX, result.humanoidVelocityY) <= 460);
});

test('OBB-circle contact handles rotated side and corner geometry without radius false positives', () => {
  const side = resolveVehicleHumanoidContact(
    vehicle({angle: Math.PI / 2}),
    humanoid({x: 20, y: 0})
  );
  const cornerMiss = resolveVehicleHumanoidContact(
    vehicle(),
    humanoid({x: 38, y: 25, radius: 7})
  );

  assert.equal(side.collided, true);
  assert.ok(side.normalX > 0.99);
  assert.equal(cornerMiss.valid, true);
  assert.equal(cornerMiss.collided, false);
});

test('humanoid inside a vehicle is ejected through the nearest stable face', () => {
  const center = resolveVehicleHumanoidContact(vehicle({speed: 0}), humanoid({x: 0, y: 0}));
  const nearSide = resolveVehicleHumanoidContact(vehicle({speed: 0}), humanoid({x: 0, y: -14}));

  assert.equal(center.collided, true);
  assert.equal(center.normalY, 1);
  assert.ok(center.humanoidY > 0);
  assert.equal(nearSide.collided, true);
  assert.ok(nearSide.normalY < -0.99);
});

test('overlapping bodies moving apart separate without generating an impact impulse', () => {
  const result = resolveVehicleHumanoidContact(
    vehicle({speed: -80}),
    humanoid({x: 35, velocityX: 80})
  );

  assert.equal(result.collided, true);
  assert.equal(result.closingSpeed, 0);
  assert.equal(result.vehicleImpactSpeed, 0);
  assert.equal(result.impulse, 0);
  assert.equal(result.vehicleSpeed, -80);
  assert.equal(result.humanoidVelocityX, 80);
});

test('walking into a stationary vehicle closes physically without becoming a vehicle ram', () => {
  const result = resolveVehicleHumanoidContact(
    vehicle({speed: 0}),
    humanoid({x: 35, velocityX: -190})
  );

  assert.equal(result.collided, true);
  assert.equal(result.closingSpeed, 190);
  assert.equal(result.vehicleImpactSpeed, 0);
  assert.ok(result.impulse > 0);
});

test('invalid bodies fail closed without publishing non-finite contact state', () => {
  const result = resolveVehicleHumanoidContact(
    vehicle({x: Number.NaN}),
    humanoid({x: Number.POSITIVE_INFINITY})
  );

  assert.equal(result.valid, false);
  assert.equal(result.collided, false);
  assert.ok(Object.values(result).every((value) => typeof value !== 'number' || Number.isFinite(value)));
});

function vehicle(overrides: Partial<Parameters<typeof resolveVehicleHumanoidContact>[0]> = {}) {
  return {
    id: 'car',
    x: 0,
    y: 0,
    angle: 0,
    speed: 120,
    halfLength: 29,
    halfWidth: 16,
    mass: 1,
    ...overrides
  };
}

function humanoid(overrides: Partial<Parameters<typeof resolveVehicleHumanoidContact>[1]> = {}) {
  return {
    id: 'pedestrian',
    x: 35,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    radius: 11,
    mass: 0.08,
    ...overrides
  };
}
