// Shared by the Node and browser legs of the determinism validation. Everything here
// must stay environment-neutral and avoid JS Math transcendentals in inputs: only
// IEEE-exact integer-derived arithmetic feeds the engine, so any state difference
// between legs is attributable to the WASM binary, not the host's libm.

import {
  PhysicsWorld,
  type PhysicsBodyState,
  type PhysicsWorldGeometry
} from '../../engine/adapters/surface-physics.ts';
import {VEHICLE_KINDS} from '../../shared/content/vehicle-catalog.ts';

const TOTAL_TICKS = 300;
const REPLAY_TICKS = 6;
const VEHICLE_COUNT = 6;
const HUMANOID_COUNT = 14;

export interface DeterminismTraceResult {
  trace: string;
  rerun: string;
  replayBitIdentical: boolean;
  replayDivergence: number;
  bodyCount: number;
}

export interface TiledMapLike {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: Array<{name: string; data: number[]}>;
}

export function geometryFromTiledMap(map: TiledMapLike): PhysicsWorldGeometry {
  const collisions = map.layers.find((layer) => layer.name === 'collisions');
  if (!collisions) throw new Error('map has no collisions layer');
  return {
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    collisions: collisions.data
  };
}

export function runDeterminismTrace(geometry: PhysicsWorldGeometry): DeterminismTraceResult {
  const first = buildWorld(geometry);
  for (let tick = 0; tick < TOTAL_TICKS - REPLAY_TICKS; tick++) drive(first, tick);
  const saved = first.world.captureAll();
  for (let tick = TOTAL_TICKS - REPLAY_TICKS; tick < TOTAL_TICKS; tick++) drive(first, tick);
  const original = serialize(first.world);
  first.world.writebackAll(saved);
  for (let tick = TOTAL_TICKS - REPLAY_TICKS; tick < TOTAL_TICKS; tick++) drive(first, tick);
  const replayed = serialize(first.world);
  const bodyCount = [...first.world.keys()].length;
  first.world.free();

  const second = buildWorld(geometry);
  for (let tick = 0; tick < TOTAL_TICKS; tick++) drive(second, tick);
  const rerun = serialize(second.world);
  second.world.free();

  return {
    trace: toHex(original),
    rerun: toHex(rerun),
    replayBitIdentical: toHex(original) === toHex(replayed),
    replayDivergence: maxAbsDifference(original, replayed),
    bodyCount
  };
}

function buildWorld(geometry: PhysicsWorldGeometry): {world: PhysicsWorld; keys: string[]} {
  const world = PhysicsWorld.create(geometry);
  const cells = spawnCells(geometry, VEHICLE_COUNT + HUMANOID_COUNT);
  const keys: string[] = [];
  for (let index = 0; index < VEHICLE_COUNT; index++) {
    const key = `vehicle-${index}`;
    world.registerVehicle(key, VEHICLE_KINDS[index % VEHICLE_KINDS.length], atCell(geometry, cells[index]));
    keys.push(key);
  }
  for (let index = 0; index < HUMANOID_COUNT; index++) {
    const key = `humanoid-${index}`;
    world.registerHumanoid(key, 11, atCell(geometry, cells[VEHICLE_COUNT + index]));
    keys.push(key);
  }
  return {world, keys};
}

function drive(built: {world: PhysicsWorld; keys: string[]}, tick: number): void {
  built.keys.forEach((key, index) => {
    built.world.setVelocity(
      key,
      (((tick * 31 + index * 17) % 21) - 10) * 22,
      (((tick * 13 + index * 7) % 17) - 8) * 26,
      (((tick + index) % 9) - 4) * 0.375
    );
  });
  built.world.step();
}

// Deterministic spread of distinct open cells away from the map border.
function spawnCells(
  geometry: PhysicsWorldGeometry,
  count: number
): Array<{column: number; row: number}> {
  const open: Array<{column: number; row: number}> = [];
  for (let row = 2; row < geometry.height - 2; row++) {
    for (let column = 2; column < geometry.width - 2; column++) {
      if (geometry.collisions[row * geometry.width + column] === 0) open.push({column, row});
    }
  }
  if (open.length < count) throw new Error('not enough open cells for the trace scenario');
  const stride = Math.floor(open.length / count);
  return Array.from({length: count}, (_, index) => open[index * stride]);
}

function atCell(
  geometry: PhysicsWorldGeometry,
  cell: {column: number; row: number}
): PhysicsBodyState {
  return {
    x: (cell.column + 0.5) * geometry.tileWidth,
    y: (cell.row + 0.5) * geometry.tileHeight,
    rotation: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0
  };
}

function serialize(world: PhysicsWorld): Float64Array {
  const keys = [...world.keys()].sort();
  const values = new Float64Array(keys.length * 6);
  keys.forEach((key, index) => {
    const state = world.capture(key);
    if (!state) throw new Error(`missing body ${key}`);
    values.set(
      [state.x, state.y, state.rotation, state.linvelX, state.linvelY, state.angvel],
      index * 6
    );
  });
  return values;
}

function toHex(values: Float64Array): string {
  const view = new DataView(values.buffer);
  let hex = '';
  for (let offset = 0; offset < view.byteLength; offset += 8) {
    hex += view.getBigUint64(offset, false).toString(16).padStart(16, '0');
  }
  return hex;
}

function maxAbsDifference(left: Float64Array, right: Float64Array): number {
  let worst = 0;
  for (let index = 0; index < left.length; index++) {
    worst = Math.max(worst, Math.abs(left[index] - right[index]));
  }
  return worst;
}
