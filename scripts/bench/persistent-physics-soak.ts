import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {PhysicsBodyRegistry, type PhysicsActorDescriptor} from '../../server/game/vehicles/physics-body-registry.ts';
import {initializePhysicsEngine, PhysicsWorld, type PhysicsWorldGeometry} from '../../shared/physics/physics-world.ts';

const TICKS = positiveInteger(process.env.PHYSICS_SOAK_TICKS, 60_000);
const BODY_COUNT = positiveInteger(process.env.PHYSICS_SOAK_BODIES, 90);
const SURFACE_COUNT = positiveInteger(process.env.PHYSICS_SOAK_SURFACES, 10);
const WARMUP_TICK = Math.min(10_000, Math.floor(TICKS / 2));
const MEMORY_LIMIT_MB = 25;

interface Actor {
  key: string;
  actorType: 'vehicle' | 'player' | 'pedestrian';
  entityId: string;
  surfaceId: string;
  shapeKey: string;
  initialX: number;
  initialY: number;
}

await initializePhysicsEngine();
const geometry = loadGeometry();
const root = PhysicsWorld.create(geometry);
const worlds = new Map<string, PhysicsWorld>();
const defaultSurface = 'surface-0';
const worldForSurface = (surfaceId: string): PhysicsWorld => {
  const existing = worlds.get(surfaceId);
  if (existing) return existing;
  const world = surfaceId === defaultSurface ? root : root.fork(false);
  worlds.set(surfaceId, world);
  return world;
};
const registry = new PhysicsBodyRegistry(worldForSurface);
const actors = createActors(geometry, BODY_COUNT, SURFACE_COUNT);
const timings: number[] = [];
const memory: Array<ReturnType<typeof memorySnapshot> & {tick: number}> = [];

for (let tick = 0; tick <= TICKS; tick++) {
  const startedAt = performance.now();
  const descriptors: PhysicsActorDescriptor[] = actors.map((actor, index) => {
    const world = worldForSurface(actor.surfaceId);
    const current = world.capture(actor.key);
    return {
      key: actor.key,
      actorType: actor.actorType,
      entityId: actor.entityId,
      surfaceId: actor.surfaceId,
      shapeKey: actor.shapeKey,
      state: {
        x: current?.x ?? actor.initialX,
        y: current?.y ?? actor.initialY,
        rotation: current?.rotation ?? 0,
        linvelX: (((tick * 31 + index * 17) % 17) - 8) * 8,
        linvelY: (((tick * 13 + index * 7) % 15) - 7) * 8,
        angvel: actor.actorType === 'vehicle' ? 0 : (((tick + index) % 5) - 2) * 0.1
      }
    };
  });
  registry.reconcile(descriptors);
  for (const world of worlds.values()) world.step();
  timings.push(performance.now() - startedAt);

  if (tick % 10_000 === 0 || tick === TICKS) {
    const sample = {tick, ...memorySnapshot()};
    memory.push(sample);
    console.log(JSON.stringify({kind: 'memory', ...sample}));
  }
}

const sorted = timings.slice(WARMUP_TICK).sort((left, right) => left - right);
const warm = memory.find((sample) => sample.tick === WARMUP_TICK) ?? memory[0];
const final = memory.at(-1)!;
const rssGrowthMb = Math.round((final.rssMb - warm.rssMb) * 100) / 100;
const report = {
  ticks: TICKS,
  bodies: registry.bodyCount,
  worlds: worlds.size,
  timingsMs: {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0
  },
  postWarmupRssGrowthMb: rssGrowthMb,
  memory,
  lifecycle: registry.cumulativeOperations(),
  acceptance: {rssGrowthBelow25Mb: rssGrowthMb < MEMORY_LIMIT_MB}
};
console.log(JSON.stringify({kind: 'summary', ...report}, null, 2));
registry.clear();
root.free();
if (!report.acceptance.rssGrowthBelow25Mb) process.exitCode = 1;

function createActors(
  geometry: PhysicsWorldGeometry,
  count: number,
  surfaceCount: number
): Actor[] {
  const openCells: Array<{column: number; row: number}> = [];
  for (let row = 2; row < geometry.height - 2; row++) {
    for (let column = 2; column < geometry.width - 2; column++) {
      if (geometry.collisions[row * geometry.width + column] === 0) {
        openCells.push({column, row});
      }
    }
  }
  if (openCells.length < count) throw new Error(`Map only has ${openCells.length} open soak cells.`);
  const stride = Math.max(1, Math.floor(openCells.length / count));
  return Array.from({length: count}, (_, index) => {
    const actorType = index % 3 === 0 ? 'vehicle' : index % 3 === 1 ? 'player' : 'pedestrian';
    const cell = openCells[(index * stride) % openCells.length];
    return {
      key: `${actorType}:soak-${index}`,
      actorType,
      entityId: `soak-${index}`,
      surfaceId: `surface-${index % surfaceCount}`,
      shapeKey: actorType === 'vehicle' ? 'vehicle:sedan' : `humanoid:${actorType === 'player' ? 11 : 10}`,
      initialX: (cell.column + 0.5) * geometry.tileWidth,
      initialY: (cell.row + 0.5) * geometry.tileHeight
    };
  });
}

function loadGeometry(): PhysicsWorldGeometry {
  const map = JSON.parse(readFileSync('public/assets/maps/district-map.json', 'utf8')) as {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: Array<{name: string; data: number[]}>;
  };
  const collisions = map.layers.find((layer) => layer.name === 'collisions');
  if (!collisions) throw new Error('District map has no collisions layer.');
  return {
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    collisions: collisions.data
  };
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  const mb = (value: number) => Math.round(value / 1024 / 1024 * 100) / 100;
  return {
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    externalMb: mb(memory.external),
    arrayBuffersMb: mb(memory.arrayBuffers)
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] * 1000) / 1000;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new RangeError(`Expected a positive integer, got ${value}.`);
  return parsed;
}
