// Rapier2d netcode feasibility spike. Run: npx tsx scripts/spike/rapier-netcode-spike.ts
//
// Answers the three gates for replacing the bespoke movement/contact kernels with
// Rapier while keeping the interaction-island prediction model:
//   Gate 1  determinism: identical runs, snapshot/restore runs, and state-writeback
//           replays must reproduce server results (bit-identical or within correction
//           smoothing tolerance).
//   Gate 2  replay cost: island-scale correction replays must fit the current
//           0.2 ms p95 replay budget (soak baseline: replay-p95 0.184 ms, ~6 saved
//           ticks per correction at 150 ms RTT / 30 Hz).
//   Gate 3  world scale: the greedy-meshed district tile map plus ~150 dynamic bodies
//           must step well inside the 33 ms server tick.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import RAPIER from '@dimforge/rapier2d-compat';

const TIMESTEP = 1 / 30;
const ISLAND_BODY_COUNT = 20;
const REPLAY_TICKS = 6;
const REPLAY_SAMPLES = 2000;
const SCALE_DYNAMIC_BODIES = 150;

interface BodyState {
  x: number;
  y: number;
  rotation: number;
  linvelX: number;
  linvelY: number;
  angvel: number;
}

interface IslandWorld {
  world: RAPIER.World;
  bodies: RAPIER.RigidBody[];
}

// Deterministic LCG so every world build and input script is reproducible.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildIslandWorld(): IslandWorld {
  const world = new RAPIER.World({x: 0, y: 0});
  world.timestep = TIMESTEP;
  const bodies: RAPIER.RigidBody[] = [];
  const random = lcg(0xc0ffee);

  // Arena walls so bodies keep interacting instead of drifting apart.
  const walls = [
    {x: 0, y: -220, hx: 220, hy: 10},
    {x: 0, y: 220, hx: 220, hy: 10},
    {x: -220, y: 0, hx: 10, hy: 220},
    {x: 220, y: 0, hx: 10, hy: 220}
  ];
  for (const wall of walls) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, wall.y));
    world.createCollider(RAPIER.ColliderDesc.cuboid(wall.hx, wall.hy), body);
  }

  // 6 vehicle-sized cuboids (sedan collision 58x32 -> half extents 29x16) and
  // 14 humanoid balls (radius 11), matching the soak's ~19-body islands.
  for (let index = 0; index < ISLAND_BODY_COUNT; index++) {
    const vehicle = index < 6;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation((random() - 0.5) * 360, (random() - 0.5) * 360)
      .setRotation(random() * Math.PI * 2)
      .setLinvel((random() - 0.5) * 300, (random() - 0.5) * 300)
      .setAngvel((random() - 0.5) * 2);
    const body = world.createRigidBody(desc);
    const collider = vehicle
      ? RAPIER.ColliderDesc.cuboid(29, 16).setDensity(1)
      : RAPIER.ColliderDesc.ball(11).setDensity(0.4);
    world.createCollider(collider.setRestitution(0.24).setFriction(0.6), body);
    bodies.push(body);
  }
  return {world, bodies};
}

// Scripted "player inputs": a pure function of tick and body index, so any replay
// regenerates the identical command stream (mirrors saved-move buffers).
function applyScriptedInputs(bodies: RAPIER.RigidBody[], tick: number): void {
  for (let index = 0; index < 4; index++) {
    const body = bodies[index];
    const phase = tick * 0.11 + index * 1.7;
    body.setLinvel({x: Math.cos(phase) * 240, y: Math.sin(phase * 0.7) * 240}, true);
  }
}

function captureStates(bodies: RAPIER.RigidBody[]): BodyState[] {
  return bodies.map((body) => {
    const translation = body.translation();
    const linvel = body.linvel();
    return {
      x: translation.x,
      y: translation.y,
      rotation: body.rotation(),
      linvelX: linvel.x,
      linvelY: linvel.y,
      angvel: body.angvel()
    };
  });
}

function restoreStates(bodies: RAPIER.RigidBody[], states: BodyState[]): void {
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index];
    const state = states[index];
    body.setTranslation({x: state.x, y: state.y}, true);
    body.setRotation(state.rotation, true);
    body.setLinvel({x: state.linvelX, y: state.linvelY}, true);
    body.setAngvel(state.angvel, true);
  }
}

interface StateComparison {
  bitIdentical: boolean;
  maxAbsDifference: number;
  mismatchedFloats: number;
  totalFloats: number;
}

function compareStates(left: BodyState[], right: BodyState[]): StateComparison {
  let maxAbsDifference = 0;
  let mismatchedFloats = 0;
  let totalFloats = 0;
  for (let index = 0; index < left.length; index++) {
    const fields: Array<keyof BodyState> = ['x', 'y', 'rotation', 'linvelX', 'linvelY', 'angvel'];
    for (const field of fields) {
      totalFloats++;
      const a = left[index][field];
      const b = right[index][field];
      if (!Object.is(a, b)) {
        mismatchedFloats++;
        maxAbsDifference = Math.max(maxAbsDifference, Math.abs(a - b));
      }
    }
  }
  return {
    bitIdentical: mismatchedFloats === 0,
    maxAbsDifference,
    mismatchedFloats,
    totalFloats
  };
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function runTicks(island: IslandWorld, fromTick: number, toTick: number): void {
  for (let tick = fromTick; tick < toTick; tick++) {
    applyScriptedInputs(island.bodies, tick);
    island.world.step();
  }
}

// Gate 1a: two independent builds, same script, bit-compare.
function experimentRunToRun(): StateComparison {
  const first = buildIslandWorld();
  const second = buildIslandWorld();
  runTicks(first, 0, 300);
  runTicks(second, 0, 300);
  const result = compareStates(captureStates(first.bodies), captureStates(second.bodies));
  first.world.free();
  second.world.free();
  return result;
}

// Gate 1b: snapshot at tick 150, let the live world continue, then restore the
// snapshot and replay the same ticks. Compared at the realistic correction-replay
// horizon (6 ticks) and a stress horizon. Restored bodies are looked up by their
// preserved handles so the comparison and input script hit the same bodies.
function experimentSnapshotRestore(replayTicks: number): StateComparison {
  const island = buildIslandWorld();
  runTicks(island, 0, 150);
  const snapshot = island.world.takeSnapshot();
  const handles = island.bodies.map((body) => body.handle);
  runTicks(island, 150, 150 + replayTicks);
  const expected = captureStates(island.bodies);

  const restoredWorld = RAPIER.World.restoreSnapshot(snapshot);
  restoredWorld.timestep = TIMESTEP;
  const restoredBodies = handles.map((handle) => {
    const body = restoredWorld.getRigidBody(handle);
    if (!body) throw new Error(`restored world is missing body handle ${handle}`);
    return body;
  });
  const restored = {world: restoredWorld, bodies: restoredBodies};
  runTicks(restored, 150, 150 + replayTicks);
  const result = compareStates(expected, captureStates(restored.bodies));
  island.world.free();
  restoredWorld.free();
  return result;
}

// Gate 1c: persistent world, manual state writeback to tick 150, replay the same
// ticks. Contact caches and warm-start impulses are NOT reset by writeback; this
// measures whether that divergence stays inside correction-smoothing tolerance
// (soak baseline replay error: 0.12 px p95) at the realistic replay horizon.
function experimentWriteback(replayTicks: number): StateComparison {
  const island = buildIslandWorld();
  runTicks(island, 0, 150);
  const saved = captureStates(island.bodies);
  runTicks(island, 150, 150 + replayTicks);
  const expected = captureStates(island.bodies);

  restoreStates(island.bodies, saved);
  runTicks(island, 150, 150 + replayTicks);
  const result = compareStates(expected, captureStates(island.bodies));
  island.world.free();
  return result;
}

interface PerfResult {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function measure(iterations: number, run: () => void): PerfResult {
  for (let index = 0; index < 100; index++) run();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99)
  };
}

// Gate 2: cost of one correction replay (rewind + REPLAY_TICKS re-steps) under the
// snapshot-restore strategy versus the persistent-world writeback strategy.
function experimentReplayPerf(): {snapshot: PerfResult; writeback: PerfResult} {
  const island = buildIslandWorld();
  runTicks(island, 0, 150);
  const snapshot = island.world.takeSnapshot();
  const saved = captureStates(island.bodies);

  const snapshotPerf = measure(Math.min(REPLAY_SAMPLES, 400), () => {
    const world = RAPIER.World.restoreSnapshot(snapshot);
    world.timestep = TIMESTEP;
    const bodies: RAPIER.RigidBody[] = [];
    world.bodies.forEach((body) => {
      if (body.isDynamic()) bodies.push(body);
    });
    runTicks({world, bodies}, 150, 150 + REPLAY_TICKS);
    world.free();
  });

  const writebackPerf = measure(REPLAY_SAMPLES, () => {
    restoreStates(island.bodies, saved);
    runTicks(island, 150, 150 + REPLAY_TICKS);
  });

  island.world.free();
  return {snapshot: snapshotPerf, writeback: writebackPerf};
}

interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: Array<{name: string; data: number[]}>;
}

// Greedy row-run merge of blocked tiles into static cuboids.
function meshDistrictColliders(world: RAPIER.World, map: TiledMap): number {
  const collisions = map.layers.find((layer) => layer.name === 'collisions');
  if (!collisions) throw new Error('district map is missing a collisions layer');
  let colliderCount = 0;
  for (let row = 0; row < map.height; row++) {
    let runStart = -1;
    for (let column = 0; column <= map.width; column++) {
      const blocked = column < map.width && collisions.data[row * map.width + column] !== 0;
      if (blocked && runStart < 0) runStart = column;
      if (!blocked && runStart >= 0) {
        const runLength = column - runStart;
        const halfWidth = (runLength * map.tilewidth) / 2;
        const halfHeight = map.tileheight / 2;
        const centerX = runStart * map.tilewidth + halfWidth;
        const centerY = row * map.tileheight + halfHeight;
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY)
        );
        world.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight), body);
        colliderCount++;
        runStart = -1;
      }
    }
  }
  return colliderCount;
}

// Gate 3: full district statics plus server-ceiling dynamic bodies, plus a wall
// containment sanity check for a driven vehicle box.
function experimentServerScale(): {
  staticColliders: number;
  stepPerf: PerfResult;
  wallContained: boolean;
} {
  const mapPath = process.env.SPIKE_MAP_PATH ??
    resolve('public', 'assets', 'maps', 'district-map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as TiledMap;
  console.log(`  map: ${mapPath} (${map.width}x${map.height} tiles of ${map.tilewidth}px)`);
  const world = new RAPIER.World({x: 0, y: 0});
  world.timestep = TIMESTEP;
  const staticColliders = meshDistrictColliders(world, map);

  const worldWidth = map.width * map.tilewidth;
  const worldHeight = map.height * map.tileheight;
  const collisions = map.layers.find((layer) => layer.name === 'collisions')!;
  const openCells: Array<{x: number; y: number}> = [];
  for (let row = 0; row < map.height; row++) {
    for (let column = 0; column < map.width; column++) {
      if (collisions.data[row * map.width + column] === 0) {
        openCells.push({
          x: (column + 0.5) * map.tilewidth,
          y: (row + 0.5) * map.tileheight
        });
      }
    }
  }

  // The tile data leaves border cells open (the game's CollisionMap treats
  // out-of-bounds as blocked in code), so add explicit boundary walls.
  const borders = [
    {x: worldWidth / 2, y: -map.tileheight / 2, hx: worldWidth / 2 + map.tilewidth, hy: map.tileheight / 2},
    {x: worldWidth / 2, y: worldHeight + map.tileheight / 2, hx: worldWidth / 2 + map.tilewidth, hy: map.tileheight / 2},
    {x: -map.tilewidth / 2, y: worldHeight / 2, hx: map.tilewidth / 2, hy: worldHeight / 2 + map.tileheight},
    {x: worldWidth + map.tilewidth / 2, y: worldHeight / 2, hx: map.tilewidth / 2, hy: worldHeight / 2 + map.tileheight}
  ];
  for (const border of borders) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(border.x, border.y));
    world.createCollider(RAPIER.ColliderDesc.cuboid(border.hx, border.hy), body);
  }

  const random = lcg(0xd15c0);
  const bodies: RAPIER.RigidBody[] = [];
  const usedCells = new Set<number>();
  for (let index = 0; index < SCALE_DYNAMIC_BODIES; index++) {
    const vehicle = index < 40;
    let cellIndex = Math.floor(random() * openCells.length);
    while (usedCells.has(cellIndex)) cellIndex = (cellIndex + 7) % openCells.length;
    usedCells.add(cellIndex);
    const cell = openCells[cellIndex];
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(cell.x, cell.y)
        .setRotation(random() * Math.PI * 2)
        .setLinvel((random() - 0.5) * 200, (random() - 0.5) * 200)
        .setCcdEnabled(true)
    );
    const collider = vehicle
      ? RAPIER.ColliderDesc.cuboid(29, 16).setDensity(1)
      : RAPIER.ColliderDesc.ball(11).setDensity(0.4);
    world.createCollider(collider.setRestitution(0.2).setFriction(0.6), body);
    bodies.push(body);
  }

  let tick = 0;
  const stepPerf = measure(1000, () => {
    applyScriptedInputs(bodies, tick++);
    world.step();
  });

  const wallContained = bodies.every((body) => {
    const translation = body.translation();
    return translation.x > -map.tilewidth && translation.x < worldWidth + map.tilewidth &&
      translation.y > -map.tileheight && translation.y < worldHeight + map.tileheight;
  });

  world.free();
  return {staticColliders, stepPerf, wallContained};
}

function formatComparison(label: string, result: StateComparison): void {
  const verdict = result.bitIdentical
    ? 'BIT-IDENTICAL'
    : `${result.mismatchedFloats}/${result.totalFloats} floats differ, max ${result.maxAbsDifference.toExponential(3)}`;
  console.log(`  ${label}: ${verdict}`);
}

function formatPerf(label: string, perf: PerfResult): void {
  console.log(
    `  ${label}: p50=${perf.p50Ms.toFixed(4)}ms p95=${perf.p95Ms.toFixed(4)}ms p99=${perf.p99Ms.toFixed(4)}ms`
  );
}

async function main(): Promise<void> {
  await RAPIER.init();
  console.log(`rapier2d-compat spike | timestep=${(TIMESTEP * 1000).toFixed(2)}ms | island bodies=${ISLAND_BODY_COUNT} | replay ticks=${REPLAY_TICKS}`);

  console.log('\nGate 1 - determinism');
  formatComparison('run-to-run (fresh builds, 300 ticks)', experimentRunToRun());
  formatComparison(`snapshot/restore, ${REPLAY_TICKS}-tick replay `, experimentSnapshotRestore(REPLAY_TICKS));
  formatComparison('snapshot/restore, 30-tick replay', experimentSnapshotRestore(30));
  formatComparison(`state writeback,  ${REPLAY_TICKS}-tick replay `, experimentWriteback(REPLAY_TICKS));
  formatComparison('state writeback,  30-tick replay', experimentWriteback(30));

  console.log('\nGate 2 - correction replay cost (budget: p95 <= 0.2ms)');
  const replay = experimentReplayPerf();
  formatPerf(`snapshot restore + ${REPLAY_TICKS} steps`, replay.snapshot);
  formatPerf(`writeback        + ${REPLAY_TICKS} steps`, replay.writeback);

  console.log('\nGate 3 - server scale (budget: step well under 33ms tick)');
  const scale = experimentServerScale();
  console.log(`  district static colliders after greedy row merge: ${scale.staticColliders}`);
  formatPerf(`step with ${SCALE_DYNAMIC_BODIES} dynamic bodies`, scale.stepPerf);
  console.log(`  driven bodies contained by meshed walls: ${scale.wallContained}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
