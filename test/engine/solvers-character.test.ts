import assert from 'node:assert/strict';
import {test} from 'node:test';
import fc from 'fast-check';
import {
  integrateOnFootPose,
  stepInteriorOnFootPose,
  type OnFootWorldOccupancy,
} from '../../shared/simulation/on-foot-step.ts';
import {
  integrateCharacterPose,
  stepCharacterAxisSlide,
  stepCharacterCollideSlide,
  type CharacterOccupancy,
} from '../../engine/solvers/character';
import {circleFitsInTiles, createTileWorld, isBlockedAt} from '../../engine/world/tile-world';

const GEOMETRY = {
  width: 8,
  height: 8,
  tileWidth: 64,
  tileHeight: 64,
  collisions: Array.from({length: 64}, (_, i) => {
    const col = i % 8;
    const row = Math.floor(i / 8);
    return col === 0 || row === 0 || col === 7 || row === 7 ? 1 : 0;
  }),
};

const poseArb = fc.record({
  x: fc.double({min: -500, max: 500, noNaN: true}),
  y: fc.double({min: -500, max: 500, noNaN: true}),
  spaceId: fc.constantFrom('street', 'interior:1', ''),
  surfaceId: fc.option(fc.constantFrom('road', 'sidewalk'), {nil: undefined}),
});
const commandArb = fc.record({
  moveX: fc.double({min: -2, max: 2, noNaN: true}),
  moveY: fc.double({min: -2, max: 2, noNaN: true}),
});
const modifiersArb = fc.record({
  movementScale: fc.option(fc.double({min: 0, max: 3, noNaN: true}), {nil: undefined}),
  radius: fc.option(fc.double({min: 0.5, max: 300, noNaN: true}), {nil: undefined}),
  speed: fc.option(fc.double({min: 0, max: 1200, noNaN: true}), {nil: undefined}),
});
const deltaArb = fc.double({min: 0, max: 0.1, noNaN: true});

test('integrateCharacterPose is bit-identical to integrateOnFootPose', () => {
  fc.assert(
    fc.property(poseArb, commandArb, deltaArb, modifiersArb, (pose, command, delta, modifiers) => {
      const expected = integrateOnFootPose({...pose}, command, delta, modifiers);
      const actual = integrateCharacterPose({...pose}, command, delta, modifiers);
      return (
        Object.is(expected.x, actual.x) &&
        Object.is(expected.y, actual.y) &&
        expected.spaceId === actual.spaceId &&
        expected.surfaceId === actual.surfaceId
      );
    }),
    {numRuns: 500, seed: 2024}
  );
});

test('stepCharacterAxisSlide is bit-identical to stepInteriorOnFootPose', () => {
  // Deterministic occupancy that exercises boolean and string returns.
  const makeOccupancy = (): OnFootWorldOccupancy & CharacterOccupancy =>
    ((spaceId, x, y, radius) => {
      const cell = Math.floor(x / 50) + Math.floor(y / 50);
      if (((cell % 3) + 3) % 3 === 0) return false;
      if (((cell % 5) + 5) % 5 === 0) return 'surface:roof';
      return true;
    }) as OnFootWorldOccupancy & CharacterOccupancy;

  fc.assert(
    fc.property(poseArb, commandArb, deltaArb, modifiersArb, (pose, command, delta, modifiers) => {
      const expected = stepInteriorOnFootPose({...pose}, command, delta, makeOccupancy(), modifiers);
      const actual = stepCharacterAxisSlide({...pose}, command, delta, makeOccupancy(), modifiers);
      return (
        Object.is(expected.pose.x, actual.pose.x) &&
        Object.is(expected.pose.y, actual.pose.y) &&
        expected.pose.spaceId === actual.pose.spaceId &&
        expected.pose.surfaceId === actual.pose.surfaceId &&
        Object.is(expected.attemptedX, actual.attemptedX) &&
        Object.is(expected.attemptedY, actual.attemptedY) &&
        expected.collidedX === actual.collidedX &&
        expected.collidedY === actual.collidedY &&
        Object.is(expected.distance, actual.distance)
      );
    }),
    {numRuns: 500, seed: 4711}
  );
});

test('collide-slide never tunnels or ends overlapping a wall, at any speed', () => {
  const world = createTileWorld(GEOMETRY);
  fc.assert(
    fc.property(
      fc.record({
        x: fc.double({min: 80, max: 7 * 64 - 16, noNaN: true}),
        y: fc.double({min: 80, max: 7 * 64 - 16, noNaN: true}),
        moveX: fc.double({min: -1, max: 1, noNaN: true}),
        moveY: fc.double({min: -1, max: 1, noNaN: true}),
        speed: fc.double({min: 0, max: 1000, noNaN: true}),
        steps: fc.integer({min: 1, max: 30}),
      }),
      ({x, y, moveX, moveY, speed, steps}) => {
        let pose = {x, y, spaceId: 'street'};
        if (!circleFitsInTiles(world, x, y, 11)) return true; // skip blocked spawns
        for (let i = 0; i < steps; i++) {
          const result = stepCharacterCollideSlide(world, pose, {moveX, moveY}, 1 / 60, {speed});
          if (!circleFitsInTiles(world, result.pose.x, result.pose.y, 11)) return false;
          pose = result.pose;
        }
        return true;
      }
    ),
    {numRuns: 300, seed: 20260724}
  );
});

test('collide-slide travels the full distance when unobstructed', () => {
  const world = createTileWorld(GEOMETRY);
  const result = stepCharacterCollideSlide(world, {x: 200, y: 200, spaceId: 'street'}, {moveX: 1, moveY: 0}, 1 / 60, {speed: 190});
  assert.ok(Math.abs(result.pose.x - (200 + 190 / 60)) < 1e-9);
  assert.equal(result.collidedX, false);
  assert.equal(result.collidedY, false);
});

test('collide-slide with a blocked start does not move', () => {
  const world = createTileWorld(GEOMETRY);
  const result = stepCharacterCollideSlide(world, {x: 5, y: 5, spaceId: 'street'}, {moveX: 1, moveY: 1}, 1 / 60, {speed: 400});
  assert.equal(result.pose.x, 5);
  assert.equal(result.pose.y, 5);
  assert.equal(result.distance, 0);
});

test('collide-slide never ends inside a wall and slides along it', () => {
  const world = createTileWorld(GEOMETRY);
  // Walk straight into the right wall from inside the room; expect slide down.
  let pose = {x: 7 * 64 - 12, y: 200, spaceId: 'street'};
  const result = stepCharacterCollideSlide(world, pose, {moveX: 1, moveY: 0.5}, 1 / 60, {speed: 400});
  assert.ok(!isBlockedAt(world, result.pose.x + 11, result.pose.y));
  assert.ok(result.pose.y > pose.y, 'slides along the wall in Y');
  assert.equal(result.collidedX, true);
});



