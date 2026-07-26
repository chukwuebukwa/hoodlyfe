import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTileWorld} from '../../engine/world/tile-world';
import {createWorldState, upsertBody, findBody} from '../../engine/world/world-state';
import {createWorldHistory, recordSnapshot} from '../../engine/world/history';
import {stepDynamics} from '../../engine/solvers/integrate';
import {stepCharacterAxisSlide} from '../../engine/solvers/character';
import {hasLineOfSight} from '../../engine/adapters/line-of-sight';
import {bodyContacts, hasStaticImpact, staticImpactSpeed} from '../../engine/adapters/impact-events';
import {circleFitsAt, createTileOccupancy} from '../../engine/adapters/occupancy';
import {clampRewindTick, createLagCompensator, rewoundOverlap, rewoundRaycast} from '../../engine/adapters/lag-comp';
import {LAYER_VEHICLE, LAYER_HUMANOID, type EngineBody} from '../../engine/core/types';

const GEOMETRY = {
  width: 10,
  height: 10,
  tileWidth: 64,
  tileHeight: 64,
  collisions: Array.from({length: 100}, (_, i) => {
    const col = i % 10;
    const row = Math.floor(i / 10);
    if (col === 0 || row === 0 || col === 9 || row === 9) return 1;
    return col === 5 && row >= 3 && row <= 6 ? 1 : 0; // vertical wall segment
  }),
};

function vehicle(id: string, x: number, y: number, vx: number): EngineBody {
  return {
    id,
    layer: LAYER_VEHICLE,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'box', halfLength: 40, halfWidth: 18},
    mass: 1200,
    restitution: 0.2,
    friction: 0.6,
    dominance: 1,
    state: {x, y, angle: 0, linvelX: vx, linvelY: 0, angvel: 0},
  };
}

test('line of sight respects walls and the blocking override', () => {
  const tiles = createTileWorld(GEOMETRY);
  // Across the vertical wall at col 5.
  assert.equal(hasLineOfSight(tiles, 2 * 64, 4.5 * 64, 8 * 64, 4.5 * 64), false);
  // Same row but above the wall segment.
  assert.equal(hasLineOfSight(tiles, 2 * 64, 1.5 * 64, 8 * 64, 1.5 * 64), true);
  // Override that sees through everything.
  assert.equal(hasLineOfSight(tiles, 2 * 64, 4.5 * 64, 8 * 64, 4.5 * 64, () => false), true);
});

test('impact-events reports static impact with approach speed, no shortfall inference', () => {
  const tiles = createTileWorld(GEOMETRY);
  const state = createWorldState();
  upsertBody(state, vehicle('car', 350, 96, 380)); // heading toward right wall along row 1
  let impacted = false;
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    const result = stepDynamics(tiles, state, 1 / 60);
    if (hasStaticImpact(result, 'car')) {
      impacted = true;
      peak = Math.max(peak, staticImpactSpeed(result, 'car'));
    }
    assert.deepEqual(bodyContacts(result), [], 'no body-body contacts in a solo run');
  }
  assert.ok(impacted, 'wall hit reported directly');
  assert.ok(peak > 300, `approach speed captured (${peak})`);
});

test('occupancy adapter composes static fit with a game rule', () => {
  const tiles = createTileWorld(GEOMETRY);
  assert.equal(circleFitsAt(tiles, 2 * 64, 2 * 64, 11), true);
  assert.equal(circleFitsAt(tiles, 5.5 * 64, 4.5 * 64, 11), false);
  const occupancy = createTileOccupancy(tiles, {
    rule: (_space, x) => (x > 8 * 64 ? false : x > 7 * 64 ? 'surface:lot' : true),
  });
  const step = stepCharacterAxisSlide(
    {x: 7 * 64 + 5, y: 2 * 64, spaceId: 'street'},
    {moveX: 1, moveY: 0},
    1 / 60,
    occupancy,
    {speed: 300}
  );
  assert.equal(step.pose.surfaceId, 'surface:lot', 'surface transition via rule hook');
});

test('lag compensator clamps rewind and answers historical queries', () => {
  const tiles = createTileWorld(GEOMETRY);
  const history = createWorldHistory();
  const state = createWorldState();
  upsertBody(state, vehicle('mover', 150, 96, 60));
  for (let tick = 0; tick < 100; tick++) {
    state.tick = tick;
    findBody(state, 'mover')!.state.x = 150 + tick;
    recordSnapshot(history, state);
  }
  const compensator = createLagCompensator(history);
  assert.equal(clampRewindTick(compensator, 10), 99 - 24);
  assert.equal(clampRewindTick(compensator, 500), 99);
  const hit = rewoundRaycast(compensator, tiles, 90, 100, 96, 500, 96);
  assert.ok(hit);
  assert.equal(hit.bodyId, 'mover');
  assert.ok(Math.abs(hit.x - (150 + 90 - 40)) < 1e-9, 'hit the rewound bumper position');
  const bodies = rewoundOverlap(compensator, 95, {kind: 'circle', x: 150 + 95, y: 96, angle: 0, radius: 5});
  assert.deepEqual(bodies.map((b) => b.id), ['mover']);
});
