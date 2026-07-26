import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceGrid} from '../../engine/geometry/grid-trace';
import {createTileWorld, circleFitsInTiles} from '../../engine/world/tile-world';
import {createWorldState, upsertBody, findBody} from '../../engine/world/world-state';
import {createWorldHistory, recordSnapshot, stateAtTick} from '../../engine/world/history';
import {deserializeWorldState, hashWorldState, serializeWorldState} from '../../engine/world/snapshot';
import {buildBroadphase, candidatePairs} from '../../engine/world/broadphase';
import {driveVehicleState, integrateVehicleKernel, vehicleHandlingForKind} from '../../engine/solvers/vehicle-kernel';
import {stepDynamics} from '../../engine/solvers/integrate';
import {hasLineOfSight} from '../../engine/adapters/line-of-sight';
import {type EngineBody} from '../../engine/core/types';

function circle(id: string, x: number, y: number, layer = 1, mask = 1): EngineBody {
  return {
    id, layer, mask,
    shape: {kind: 'circle', radius: 10},
    mass: 1, restitution: 0, friction: 0, dominance: 0,
    state: {x, y, angle: 0, linvelX: 0, linvelY: 0, angvel: 0},
  };
}

test('-0 in state survives serialize round-trip with identical hash', () => {
  const state = createWorldState();
  upsertBody(state, {...circle('a', 0, 0), state: {x: -0, y: 0, angle: 0, linvelX: -0, linvelY: 0, angvel: 0}});
  const restored = deserializeWorldState(serializeWorldState(state));
  assert.equal(hashWorldState(restored), hashWorldState(state));
});

test('DDA corner crossing is symmetric and sees corner-adjacent blocks', () => {
  const blocked = (c: number, r: number) => c === 1 && r === 0;
  const forward = traceGrid(0.5, 0.5, 1.5, 1.5, blocked, 1, 1);
  const reverse = traceGrid(1.5, 1.5, 0.5, 0.5, blocked, 1, 1);
  assert.ok(forward, 'forward diagonal through the corner hits the blocked neighbor');
  assert.ok(reverse, 'reverse hits too');
  assert.ok(Math.abs(forward.t - 0.5) < 1e-9);
});

test('recording an older tick cannot destroy a newer snapshot in its slot', () => {
  const history = createWorldHistory(4);
  const state = createWorldState();
  upsertBody(state, circle('a', 0, 0));
  for (let t = 0; t <= 4; t++) {
    state.tick = t;
    recordSnapshot(history, state);
  }
  state.tick = 0;
  recordSnapshot(history, state); // shares slot with tick 4
  assert.ok(stateAtTick(history, 4), 'tick 4 still resolvable');
});

test('circle fit detects tile corners between probe points', () => {
  const tiles = createTileWorld({width: 3, height: 3, tileWidth: 64, tileHeight: 64,
    collisions: [0, 0, 0, 0, 1, 0, 0, 0, 0]});
  // Center placed so the blocked tile's corner (64, 64) is inside the circle
  // but off every 8-point probe direction.
  assert.equal(circleFitsInTiles(tiles, 53.5, 62, 11), false);
  assert.equal(circleFitsInTiles(tiles, 40, 40, 11), true);
});

test('broadphase requires BOTH masks to permit a pair', () => {
  const state = createWorldState();
  upsertBody(state, circle('a', 0, 0, 1, 0)); // mask 0: collides with nothing
  upsertBody(state, circle('b', 5, 0, 2, 1)); // wants to hit layer 1
  assert.deepEqual(candidatePairs(state, buildBroadphase(state)), []);
});

test('driveVehicleState + resolver reproduces the kernel pose when uncontacted', () => {
  const handling = vehicleHandlingForKind('sedan');
  const dt = 1 / 60;
  const start = {x: 300, y: 300, angle: 0.2, speed: 100, linvelX: 100, linvelY: 0, angvel: 0.5};
  const kernel = integrateVehicleKernel(start, {steering: 0.8, throttle: 0.5}, handling, dt);

  const tiles = createTileWorld({width: 10, height: 10, tileWidth: 64, tileHeight: 64,
    collisions: Array(100).fill(0)});
  const state = createWorldState();
  upsertBody(state, {
    id: 'v', layer: 2, mask: 2,
    shape: {kind: 'box', halfLength: 40, halfWidth: 18},
    mass: 1200, restitution: 0.2, friction: 0.6, dominance: 1,
    state: {x: start.x, y: start.y, angle: start.angle, linvelX: start.linvelX, linvelY: start.linvelY, angvel: start.angvel},
  });
  driveVehicleState(findBody(state, 'v')!.state, {steering: 0.8, throttle: 0.5}, handling, dt);
  stepDynamics(tiles, state, dt);
  const body = findBody(state, 'v')!.state;
  assert.ok(Math.abs(body.x - kernel.x) < 1e-9, `x ${body.x} vs ${kernel.x}`);
  assert.ok(Math.abs(body.y - kernel.y) < 1e-9);
  assert.ok(Math.abs(body.angle - kernel.angle) < 1e-9, `angle ${body.angle} vs ${kernel.angle}`);
});

test('LOS with a custom predicate still cannot see out of bounds', () => {
  const tiles = createTileWorld({width: 3, height: 3, tileWidth: 64, tileHeight: 64,
    collisions: Array(9).fill(0)});
  assert.equal(hasLineOfSight(tiles, 32, 32, 500, 32, () => false), false);
  assert.equal(hasLineOfSight(tiles, 32, 32, 150, 32, () => false), true);
});
