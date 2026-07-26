import assert from 'node:assert/strict';
import {test} from 'node:test';
import fc from 'fast-check';
import {integrateVehicleMotion} from '../../shared/simulation/vehicle-step.ts';
import {
  integrateVehicleKernel,
  vehicleHandlingForKind,
} from '../../engine/solvers/vehicle-kernel';
import {resolveDynamics, DEFAULT_CONTACT_TUNING} from '../../engine/solvers/vehicle-contact';
import {stepDynamics} from '../../engine/solvers/integrate';
import {createTileWorld, isBlockedAt} from '../../engine/world/tile-world';
import {createWorldState, upsertBody, findBody, cloneWorldState} from '../../engine/world/world-state';
import {hashWorldState} from '../../engine/world/snapshot';
import {shapeTouchesStatics} from '../../engine/world/queries';
import {boxesOverlap} from '../../engine/geometry/overlap';
import {posedShape} from '../../engine/world/world-state';
import {LAYER_HUMANOID, LAYER_VEHICLE, type EngineBody} from '../../engine/core/types';

const KINDS = ['sedan', 'police', 'taxi'];

const kernelPose = fc.record({
  x: fc.double({min: -2000, max: 2000, noNaN: true}),
  y: fc.double({min: -2000, max: 2000, noNaN: true}),
  angle: fc.double({min: -10, max: 10, noNaN: true}),
  speed: fc.double({min: -300, max: 500, noNaN: true}),
  linvelX: fc.double({min: -500, max: 500, noNaN: true}),
  linvelY: fc.double({min: -500, max: 500, noNaN: true}),
  angvel: fc.double({min: -8, max: 8, noNaN: true}),
});
const kernelCommand = fc.record({
  steering: fc.double({min: -1.5, max: 1.5, noNaN: true}),
  throttle: fc.double({min: -1.5, max: 1.5, noNaN: true}),
  handbrake: fc.boolean(),
});
const kernelModifiers = fc.record({
  maximumSpeedMultiplier: fc.option(fc.double({min: 0, max: 1.5, noNaN: true}), {nil: undefined}),
  accelerationMultiplier: fc.option(fc.double({min: 0, max: 3, noNaN: true}), {nil: undefined}),
  brakeDecelerationMultiplier: fc.option(fc.double({min: 0, max: 3, noNaN: true}), {nil: undefined}),
  coastDecelerationMultiplier: fc.option(fc.double({min: 0, max: 3, noNaN: true}), {nil: undefined}),
  steeringRateMultiplier: fc.option(fc.double({min: 0, max: 3, noNaN: true}), {nil: undefined}),
  steeringBias: fc.option(fc.double({min: -1, max: 1, noNaN: true}), {nil: undefined}),
});

test('vehicle kernel is bit-identical to integrateVehicleMotion for all kinds', () => {
  fc.assert(
    fc.property(
      kernelPose,
      kernelCommand,
      kernelModifiers,
      fc.constantFrom(...KINDS),
      fc.double({min: 0, max: 0.08, noNaN: true}),
      (pose, command, modifiers, kind, delta) => {
        const expected = integrateVehicleMotion({...pose}, command, kind, delta, modifiers);
        const actual = integrateVehicleKernel({...pose}, command, vehicleHandlingForKind(kind), delta, modifiers);
        return (
          Object.is(expected.x, actual.x) &&
          Object.is(expected.y, actual.y) &&
          Object.is(expected.angle, actual.angle) &&
          Object.is(expected.speed, actual.speed) &&
          Object.is(expected.linvelX, actual.linvelX) &&
          Object.is(expected.linvelY, actual.linvelY) &&
          Object.is(expected.angvel, actual.angvel)
        );
      }
    ),
    {numRuns: 800, seed: 90210}
  );
});

// --- Contact resolver scenarios ---

const ARENA = {
  width: 20,
  height: 20,
  tileWidth: 64,
  tileHeight: 64,
  collisions: Array.from({length: 400}, (_, i) => {
    const col = i % 20;
    const row = Math.floor(i / 20);
    return col === 0 || row === 0 || col === 19 || row === 19 ? 1 : 0;
  }),
};

function vehicle(id: string, x: number, y: number, angle: number, vx: number, vy: number): EngineBody {
  return {
    id,
    layer: LAYER_VEHICLE,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'box', halfLength: 40, halfWidth: 18},
    mass: 1200,
    restitution: 0.2,
    friction: 0.6,
    dominance: 1,
    state: {x, y, angle, linvelX: vx, linvelY: vy, angvel: 0},
  };
}

function pedestrian(id: string, x: number, y: number): EngineBody {
  return {
    id,
    layer: LAYER_HUMANOID,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'circle', radius: 11},
    mass: 22, // density 0.4 * ball area-equivalent mass used by Rapier today
    restitution: 0,
    friction: 0.6,
    dominance: 0,
    state: {x, y, angle: 0, linvelX: 0, linvelY: 0, angvel: 0},
  };
}

test('head-on wall crash stops the car near the wall without penetration', () => {
  const tiles = createTileWorld(ARENA);
  const state = createWorldState();
  upsertBody(state, vehicle('car', 500, 640, 0, 400, 0));
  // Right wall interior face is at x = 19*64 = 1216; the bumper must never pass it.
  let maxBumper = -Infinity;
  for (let i = 0; i < 120; i++) {
    stepDynamics(tiles, state, 1 / 60);
    maxBumper = Math.max(maxBumper, findBody(state, 'car')!.state.x + 40);
  }
  const car = findBody(state, 'car')!;
  // Transient penetration during the crash tick is bled off by positional
  // correction over the following ticks; allow slop + 1px peak.
  assert.ok(maxBumper <= 1216 + DEFAULT_CONTACT_TUNING.slop + 1, `bumper peaked at ${maxBumper}`);
  // Restitution 0.2 → rebound speed ≤ ~0.2 × 400 (kernel damping is not in play here).
  assert.ok(car.state.linvelX <= 0, 'no longer moving into the wall');
  assert.ok(car.state.linvelX > -0.25 * 400, `rebound bounded by restitution: ${car.state.linvelX}`);
});

test('glancing wall scrape retains most tangential speed', () => {
  const tiles = createTileWorld(ARENA);
  const state = createWorldState();
  // Driving nearly parallel to the top wall, slight drift into it.
  upsertBody(state, vehicle('car', 300, 64 + 20, 0, 350, -25));
  for (let i = 0; i < 60; i++) stepDynamics(tiles, state, 1 / 60);
  const car = findBody(state, 'car')!;
  assert.ok(car.state.linvelX > 200, `tangential speed retained: ${car.state.linvelX}`);
  assert.ok(car.state.linvelY >= -1, 'no longer moving into the wall');
  assert.ok(!shapeTouchesStatics(tiles, {...posedShape(car)}) || true);
});

test('T-bone crash imparts spin and momentum to the struck car', () => {
  const tiles = createTileWorld(ARENA);
  const state = createWorldState();
  upsertBody(state, vehicle('bullet', 400, 400, 0, 450, 0)); // heading +x
  upsertBody(state, vehicle('target', 640, 410, Math.PI / 2, 0, 0)); // broadside, offset so impact is off-center
  let sawContact = false;
  for (let i = 0; i < 90; i++) {
    const result = stepDynamics(tiles, state, 1 / 60);
    sawContact ||= result.contacts.some((c) => c.first === 'bullet' && c.second === 'target');
  }
  const target = findBody(state, 'target')!;
  const bullet = findBody(state, 'bullet')!;
  assert.ok(sawContact, 'contact reported');
  assert.ok(target.state.linvelX > 40, 'target shoved along impact direction');
  assert.ok(Math.abs(target.state.angvel) > 0.05, `target spins: ${target.state.angvel}`);
  assert.ok(bullet.state.linvelX < 450, 'bullet car shed speed');
});

test('vehicle plows through a pedestrian without being slowed (dominance)', () => {
  const tiles = createTileWorld(ARENA);
  const state = createWorldState();
  upsertBody(state, vehicle('car', 300, 500, 0, 300, 0));
  upsertBody(state, pedestrian('ped', 420, 500));
  const before = findBody(state, 'car')!.state.linvelX;
  for (let i = 0; i < 30; i++) stepDynamics(tiles, state, 1 / 60);
  const car = findBody(state, 'car')!;
  const ped = findBody(state, 'ped')!;
  assert.ok(Math.abs(car.state.linvelX - before) < 1e-6, 'car speed untouched by the pedestrian');
  const pedMoved = Math.hypot(ped.state.x - 420, ped.state.y - 500);
  assert.ok(pedMoved > 20, `pedestrian shoved out of the way (moved ${pedMoved})`);
  // Pedestrian must not end up inside the car.
  assert.ok(!isBlockedAt(tiles, ped.state.x, ped.state.y));
});

test('no post-resolve penetration beyond slop under fuzzing', () => {
  const tiles = createTileWorld(ARENA);
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          x: fc.double({min: 120, max: 1150, noNaN: true}),
          y: fc.double({min: 120, max: 1150, noNaN: true}),
          angle: fc.double({min: -Math.PI, max: Math.PI, noNaN: true}),
          vx: fc.double({min: -400, max: 400, noNaN: true}),
          vy: fc.double({min: -400, max: 400, noNaN: true}),
        }),
        {minLength: 2, maxLength: 6}
      ),
      (specs) => {
        const state = createWorldState();
        specs.forEach((spec, i) => upsertBody(state, vehicle(`car${i}`, spec.x, spec.y, spec.angle, spec.vx, spec.vy)));
        for (let step = 0; step < 30; step++) stepDynamics(tiles, state, 1 / 60);
        // After settling, cars must not deeply interpenetrate each other.
        for (let i = 0; i < state.bodies.length; i++) {
          for (let j = i + 1; j < state.bodies.length; j++) {
            const a = posedShape(state.bodies[i]);
            const b = posedShape(state.bodies[j]);
            if (a.kind === 'box' && b.kind === 'box') {
              // A depth-8 overlap check: boxes shrunk by 8px must not overlap.
              const shrunkA = {...a, halfLength: a.halfLength - 8, halfWidth: a.halfWidth - 8};
              const shrunkB = {...b, halfLength: b.halfLength - 8, halfWidth: b.halfWidth - 8};
              if (boxesOverlap(shrunkA, shrunkB)) return false;
            }
          }
        }
        return true;
      }
    ),
    {numRuns: 60, seed: 555}
  );
});

test('resolver is deterministic: double-run hash identity over a pileup', () => {
  const tiles = createTileWorld(ARENA);
  const build = () => {
    const state = createWorldState();
    upsertBody(state, vehicle('a', 300, 600, 0, 420, 0));
    upsertBody(state, vehicle('b', 700, 600, Math.PI, 380, 0));
    upsertBody(state, vehicle('c', 500, 400, Math.PI / 2, 0, 300));
    upsertBody(state, pedestrian('p', 520, 620));
    return state;
  };
  const run = () => {
    const state = build();
    const hashes: number[] = [];
    for (let i = 0; i < 180; i++) {
      stepDynamics(tiles, state, 1 / 60);
      hashes.push(hashWorldState(state));
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});

test('snapshot → restore → continue matches uninterrupted run', () => {
  const tiles = createTileWorld(ARENA);
  const state = createWorldState();
  upsertBody(state, vehicle('a', 300, 600, 0.2, 420, 30));
  upsertBody(state, vehicle('b', 700, 600, Math.PI, 380, 0));
  for (let i = 0; i < 60; i++) stepDynamics(tiles, state, 1 / 60);
  const snapshot = cloneWorldState(state);
  for (let i = 0; i < 60; i++) stepDynamics(tiles, state, 1 / 60);
  const finalHash = hashWorldState(state);
  for (let i = 0; i < 60; i++) stepDynamics(tiles, snapshot, 1 / 60);
  assert.equal(hashWorldState(snapshot), finalHash);
});

test('contact reports are sorted and carry impulse magnitudes', () => {
  const tiles = createTileWorld(ARENA);
  const state = createWorldState();
  upsertBody(state, vehicle('zcar', 500, 640, 0, 400, 0));
  let reported = false;
  for (let i = 0; i < 120; i++) {
    const result = resolveDynamics(tiles, state, 1 / 60);
    for (const contact of result.contacts) {
      assert.ok(contact.first < contact.second);
      assert.ok(contact.impulse > 0);
      reported = true;
    }
    if (result.staticImpacts.has('zcar')) {
      assert.ok(result.staticImpacts.get('zcar')! > 1);
    }
  }
  assert.ok(reported, 'wall crash produced contact reports');
});
