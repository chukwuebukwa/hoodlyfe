import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VehicleCollisionSystem,
  type VehicleCollisionBody
} from '../server/game/vehicles/vehicle-collision-system.ts';

const collisions = new VehicleCollisionSystem();

test('oriented vehicle boxes reject separated corners inside their broad-phase bounds', () => {
  const first = body('first', 0, 0, 0);
  const second = body('second', 50, 34, 0);

  assert.equal(collisions.resolve(first, second).collided, false);
});

test('oriented vehicle boxes resolve side and nose contacts along the shallowest axis', () => {
  const side = collisions.resolve(body('first', 0, 0, 0), body('second', 0, 28, 0));
  assert.equal(side.collided, true);
  assert.ok(side.primaryY < 0);
  assert.ok(side.otherY > 28);

  const nose = collisions.resolve(body('first', 0, 0, 0), body('second', 54, 0, 0));
  assert.equal(nose.collided, true);
  assert.ok(nose.primaryX < 0);
  assert.ok(nose.otherX > 54);
});

test('oriented vehicle boxes detect a perpendicular junction collision', () => {
  const result = collisions.resolve(
    body('eastbound', 0, 0, 0, 90),
    body('southbound', 18, 0, Math.PI / 2, 90)
  );

  assert.equal(result.collided, true);
  assert.ok(result.closingSpeed > 0);
});

function body(
  id: string,
  x: number,
  y: number,
  angle: number,
  speed = 0
): VehicleCollisionBody {
  return {
    id,
    x,
    y,
    angle,
    speed,
    halfLength: 29,
    halfWidth: 16,
    mass: 1,
    damageScale: 1
  };
}
