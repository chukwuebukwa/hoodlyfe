import assert from 'node:assert/strict';
import {test} from 'node:test';
import fc from 'fast-check';
import {createTileWorld, isBlockedAt, isBlockedTile, traceTiles} from '../../engine/world/tile-world';
import {createWorldState, upsertBody, removeBody, findBody, cloneWorldState} from '../../engine/world/world-state';
import {buildBroadphase, candidatePairs, queryBroadphase} from '../../engine/world/broadphase';
import {overlapCircle, raycast} from '../../engine/world/queries';
import {createWorldHistory, overlapAtTick, raycastAtTick, recordSnapshot, stateAtTick} from '../../engine/world/history';
import {deserializeWorldState, hashWorldState, serializeWorldState} from '../../engine/world/snapshot';
import {LAYER_HUMANOID, LAYER_VEHICLE, type EngineBody} from '../../engine/core/types';
import {shapesOverlap} from '../../engine/geometry/overlap';
import {posedShape} from '../../engine/world/world-state';

function humanoid(id: string, x: number, y: number, radius = 11): EngineBody {
  return {
    id,
    layer: LAYER_HUMANOID,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'circle', radius},
    mass: 70,
    restitution: 0,
    friction: 0.4,
    dominance: 0,
    state: {x, y, angle: 0, linvelX: 0, linvelY: 0, angvel: 0},
  };
}

function vehicle(id: string, x: number, y: number, angle = 0): EngineBody {
  return {
    id,
    layer: LAYER_VEHICLE,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'box', halfLength: 40, halfWidth: 18},
    mass: 1200,
    restitution: 0.2,
    friction: 0.6,
    dominance: 1,
    state: {x, y, angle, linvelX: 0, linvelY: 0, angvel: 0},
  };
}

const GEOMETRY = {
  width: 8,
  height: 8,
  tileWidth: 64,
  tileHeight: 64,
  // Border of walls plus a pillar at (3,3).
  collisions: Array.from({length: 64}, (_, i) => {
    const col = i % 8;
    const row = Math.floor(i / 8);
    if (col === 0 || row === 0 || col === 7 || row === 7) return 1;
    return col === 3 && row === 3 ? 1 : 0;
  }),
};

test('tile world matches CollisionMap semantics including out-of-bounds solidity', () => {
  const world = createTileWorld(GEOMETRY);
  assert.equal(isBlockedAt(world, -5, 100), true);
  assert.equal(isBlockedAt(world, 100, -5), true);
  assert.equal(isBlockedAt(world, 10_000, 100), true);
  assert.equal(isBlockedAt(world, 100, 100), false);
  assert.equal(isBlockedAt(world, 3 * 64 + 1, 3 * 64 + 1), true);
  assert.equal(isBlockedTile(world, 3, 3), true);
  assert.equal(isBlockedTile(world, 4, 3), false);
});

test('traceTiles finds the pillar with an exact axis-aligned normal', () => {
  const world = createTileWorld(GEOMETRY);
  const hit = traceTiles(world, 100, 3.5 * 64, 400, 3.5 * 64);
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 3 * 64) < 1e-9);
  assert.equal(hit.normalX, -1);
  assert.equal(hit.normalY, 0);
  assert.equal(traceTiles(world, 100, 100, 120, 120), undefined);
});

test('world state keeps bodies id-sorted through upsert/remove', () => {
  const state = createWorldState();
  upsertBody(state, humanoid('p2', 100, 100));
  upsertBody(state, vehicle('car1', 200, 200));
  upsertBody(state, humanoid('p1', 150, 150));
  assert.deepEqual(state.bodies.map((b) => b.id), ['car1', 'p1', 'p2']);
  upsertBody(state, {...humanoid('p1', 155, 150)});
  assert.equal(state.bodies.length, 3);
  assert.equal(findBody(state, 'p1')?.state.x, 155);
  assert.equal(removeBody(state, 'p2'), true);
  assert.deepEqual(state.bodies.map((b) => b.id), ['car1', 'p1']);
});

test('broadphase candidate pairs equal brute-force AABB-filtered pairs', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          x: fc.double({min: -1000, max: 1000, noNaN: true}),
          y: fc.double({min: -1000, max: 1000, noNaN: true}),
          isVehicle: fc.boolean(),
        }),
        {minLength: 2, maxLength: 30}
      ),
      (specs) => {
        const state = createWorldState();
        specs.forEach((spec, i) => {
          upsertBody(state, spec.isVehicle ? vehicle(`v${String(i).padStart(2, '0')}`, spec.x, spec.y) : humanoid(`h${String(i).padStart(2, '0')}`, spec.x, spec.y));
        });
        const bp = buildBroadphase(state);
        const pairs = candidatePairs(state, bp);
        const pairSet = new Set(pairs.map(([i, j]) => `${i}:${j}`));
        // Every truly-overlapping pair must be among the candidates.
        for (let i = 0; i < state.bodies.length; i++) {
          for (let j = i + 1; j < state.bodies.length; j++) {
            if (shapesOverlap(posedShape(state.bodies[i]), posedShape(state.bodies[j]))) {
              if (!pairSet.has(`${i}:${j}`)) return false;
            }
          }
        }
        // Ordering is canonical.
        for (let k = 1; k < pairs.length; k++) {
          const [pi, pj] = pairs[k - 1];
          const [ci, cj] = pairs[k];
          if (pi > ci || (pi === ci && pj >= cj)) return false;
        }
        return true;
      }
    ),
    {numRuns: 150, seed: 11}
  );
});

test('queryBroadphase returns ascending unique indices covering the region', () => {
  const state = createWorldState();
  upsertBody(state, humanoid('a', 10, 10));
  upsertBody(state, humanoid('b', 300, 300));
  upsertBody(state, vehicle('c', 600, 600));
  const bp = buildBroadphase(state);
  const near = queryBroadphase(bp, 0, 0, 50, 50);
  assert.ok(near.includes(0));
  assert.ok(!near.includes(2));
});

test('unified raycast prefers the nearest hit across statics and bodies', () => {
  const world = createTileWorld(GEOMETRY);
  const state = createWorldState();
  upsertBody(state, humanoid('target', 150, 224));
  // Ray from x=100 toward the pillar at col 3 (x=192..256) passes through the humanoid first.
  const hit = raycast(world, state, 100, 224, 400, 224);
  assert.ok(hit);
  assert.equal(hit.bodyId, 'target');
  const hitExcluded = raycast(world, state, 100, 224, 400, 224, {exclude: ['target']});
  assert.ok(hitExcluded);
  assert.equal(hitExcluded.bodyId, undefined);
  assert.ok(Math.abs(hitExcluded.x - 192) < 1e-9);
});

test('overlapCircle respects layer masks and returns id-sorted results', () => {
  const state = createWorldState();
  upsertBody(state, humanoid('p1', 100, 100));
  upsertBody(state, vehicle('v1', 110, 100));
  upsertBody(state, humanoid('p0', 105, 100));
  const all = overlapCircle(state, 100, 100, 60);
  assert.deepEqual(all.map((b) => b.id), ['p0', 'p1', 'v1']);
  const vehiclesOnly = overlapCircle(state, 100, 100, 60, {mask: LAYER_VEHICLE});
  assert.deepEqual(vehiclesOnly.map((b) => b.id), ['v1']);
});

test('snapshot → serialize → restore → hash is identity', () => {
  const state = createWorldState(42, 7);
  upsertBody(state, humanoid('p1', 123.456, 789.012));
  upsertBody(state, vehicle('v1', 55.5, 66.6, 1.234));
  const hash = hashWorldState(state);
  const restored = deserializeWorldState(serializeWorldState(state));
  assert.equal(hashWorldState(restored), hash);
  const cloned = cloneWorldState(state);
  cloned.bodies[0].state.x += 1;
  assert.notEqual(hashWorldState(cloned), hash);
  assert.equal(hashWorldState(state), hash);
});

test('world history stores and rewinds 48 ticks, evicting older snapshots', () => {
  const world = createTileWorld(GEOMETRY);
  const history = createWorldHistory();
  const state = createWorldState(0);
  upsertBody(state, humanoid('runner', 100, 224));
  for (let tick = 0; tick < 120; tick++) {
    state.tick = tick;
    findBody(state, 'runner')!.state.x = 100 + tick;
    recordSnapshot(history, state);
  }
  assert.equal(stateAtTick(history, 50), undefined);
  const at100 = stateAtTick(history, 100);
  assert.ok(at100);
  assert.equal(findBody(at100, 'runner')?.state.x, 200);
  // Rewound raycast sees the runner where it was at tick 100, not tick 119.
  const hit = raycastAtTick(world, history, 100, 100, 224, 400, 224);
  assert.ok(hit);
  assert.equal(hit.bodyId, 'runner');
  assert.ok(hit.x < 200 && hit.x > 180);
  const bodies = overlapAtTick(history, 110, {kind: 'circle', x: 210, y: 224, angle: 0, radius: 12});
  assert.deepEqual(bodies.map((b) => b.id), ['runner']);
});
