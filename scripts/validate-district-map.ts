import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  DISTRICT_ACTIVE_FRAME,
  DISTRICT_WORLD_SIZE
} from '../shared/content/district-map-frame.ts';
import {DISTRICT_POPULATION_ZONES} from '../shared/content/district-population-zones.ts';
import {INTERIORS} from '../shared/content/interior-catalog.ts';
import {STREET_LIGHT_FIXTURES} from '../shared/content/lighting-fixtures.ts';
import {TRAFFIC_SIGNALS} from '../shared/content/traffic-signals.ts';
import {LaneGraph} from '../server/game/traffic/lane-graph.ts';
import {CollisionMap} from '../server/world-map.ts';

interface MapMetadata {
  tileSize: number;
  origin: {x: number; y: number};
  size: {width: number; height: number};
  spawn: {x: number; y: number};
}

interface PrototypePayload {
  chunk: {x: number; y: number; size: number};
  surfaces: {width: number; height: number; values: number[]};
  occluders: Array<{id: string}>;
}

const projectRoot = resolve(import.meta.dirname, '..');
const metadata = readJson<MapMetadata>('public/assets/maps/district-map.metadata.json');
const prototype = readJson<PrototypePayload>('public/assets/maps/three/prototype.json');
const world = CollisionMap.load(projectRoot);
const issues: string[] = [];

compare('generated origin x', DISTRICT_ACTIVE_FRAME.origin.x, metadata.origin.x);
compare('generated origin y', DISTRICT_ACTIVE_FRAME.origin.y, metadata.origin.y);
compare('generated width', DISTRICT_ACTIVE_FRAME.size.width, metadata.size.width);
compare('generated height', DISTRICT_ACTIVE_FRAME.size.height, metadata.size.height);
compare('generated tile size', DISTRICT_ACTIVE_FRAME.tileSize, metadata.tileSize);
compare('world width', world.width * world.tileWidth, DISTRICT_WORLD_SIZE.width);
compare('world height', world.height * world.tileHeight, DISTRICT_WORLD_SIZE.height);
compare('prototype origin x', prototype.chunk.x, metadata.origin.x);
compare('prototype origin y', prototype.chunk.y, metadata.origin.y);
compare('prototype size', prototype.chunk.size, metadata.size.width);
compare('surface width', prototype.surfaces.width, metadata.size.width);
compare('surface height', prototype.surfaces.height, metadata.size.height);
compare(
  'surface value count',
  prototype.surfaces.values.length,
  metadata.size.width * metadata.size.height
);

if (!world.canOccupy(metadata.spawn.x, metadata.spawn.y, 11)) {
  issues.push(`spawn ${metadata.spawn.x},${metadata.spawn.y} is blocked`);
}

try {
  LaneGraph.load(world, projectRoot);
} catch (error) {
  issues.push(error instanceof Error ? error.message : String(error));
}

const occluderIds = new Set(prototype.occluders.map(({id}) => id));
for (const interior of INTERIORS) {
  inside(`${interior.id} bounds min`, interior.bounds.minX, interior.bounds.minY);
  inside(`${interior.id} bounds max`, interior.bounds.maxX, interior.bounds.maxY);
  inside(`${interior.id} exterior door`, interior.exteriorDoor.x, interior.exteriorDoor.y);
  inside(`${interior.id} exterior exit`, interior.exteriorDoor.exitX, interior.exteriorDoor.exitY);
  if (!occluderIds.has(interior.id)) issues.push(`${interior.id} has no Three.js roof occluder`);
}

for (const signal of TRAFFIC_SIGNALS) {
  inside(`${signal.id} center`, signal.x, signal.y);
  for (const approach of signal.approaches) {
    inside(`${signal.id}/${approach.id}`, approach.stopX, approach.stopY);
  }
}

for (const fixture of STREET_LIGHT_FIXTURES) inside(fixture.id, fixture.x, fixture.y);
for (const zone of DISTRICT_POPULATION_ZONES) {
  inside(`${zone.id} bounds min`, zone.bounds.minX, zone.bounds.minY);
  inside(`${zone.id} bounds max`, zone.bounds.maxX, zone.bounds.maxY);
}

if (issues.length > 0) {
  throw new Error(`District validation failed:\n- ${issues.join('\n- ')}`);
}

console.log(
  `District validation passed: ${metadata.size.width}x${metadata.size.height} tiles, ` +
  `${DISTRICT_WORLD_SIZE.width}x${DISTRICT_WORLD_SIZE.height} world pixels.`
);

function inside(label: string, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= DISTRICT_WORLD_SIZE.width || y >= DISTRICT_WORLD_SIZE.height) {
    issues.push(`${label} ${x},${y} lies outside the active world`);
  }
}

function compare(label: string, actual: number, expected: number): void {
  if (actual !== expected) issues.push(`${label} is ${actual}, expected ${expected}`);
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8')) as T;
}
