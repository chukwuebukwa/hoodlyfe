import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {
  type SourceBounds3D
} from '../shared/content/building-manifest.ts';
import {
  parseBuilderDraft,
  promoteBuildingDraft,
  type PromoteBuildingDraftOptions
} from '../shared/content/building-draft.ts';
export {parseBuilderDraft, promoteBuildingDraft} from '../shared/content/building-draft.ts';
import type {BuildingAuthorDraft} from '../src/game/building-author/building-candidate-policy.ts';

interface GeometryVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface GeometryOccluderGroup {
  readonly opaqueIndices?: readonly number[];
  readonly alphaTestedIndices?: readonly number[];
}

interface GeometryChunk {
  readonly x: number;
  readonly y: number;
  readonly vertices: readonly GeometryVertex[];
  readonly opaqueIndices: readonly number[];
  readonly alphaTestedIndices: readonly number[];
  readonly occluders?: readonly GeometryOccluderGroup[];
}

interface GeometryWorld {
  readonly chunks: readonly {readonly file: string}[];
}

const DEFAULT_MANIFEST_PATH = 'shared/content/buildings/buildings.json';
const DEFAULT_GEOMETRY_WORLD_PATH = 'public/assets/maps/geometry/world.json';
const BOUNDS_EPSILON = 0.0001;
const NORMAL_EPSILON = 0.0001;

export async function countDraftRoofTriangles(
  building: BuildingAuthorDraft['building'],
  worldPath = DEFAULT_GEOMETRY_WORLD_PATH
): Promise<number> {
  const absoluteWorldPath = path.resolve(worldPath);
  const world = JSON.parse(await readFile(absoluteWorldPath, 'utf8')) as GeometryWorld;
  let count = 0;
  for (const reference of world.chunks) {
    const chunkPath = path.resolve(path.dirname(absoluteWorldPath), reference.file);
    const chunk = JSON.parse(await readFile(chunkPath, 'utf8')) as GeometryChunk;
    const indexSets = [chunk.opaqueIndices, chunk.alphaTestedIndices];
    for (const group of chunk.occluders ?? []) {
      indexSets.push(group.opaqueIndices ?? [], group.alphaTestedIndices ?? []);
    }
    for (const indices of indexSets) {
      count += selectedTriangleCount(
        chunk.vertices,
        indices,
        chunk.x,
        chunk.y,
        building.shell.bounds,
        building.shell.cutawayMode === 'complete-above-floor'
      );
    }
  }
  if (count <= 0) throw new Error(`Building "${building.id}" selected no roof triangles.`);
  return count;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const draft = JSON.parse(await readFile(path.resolve(args.draftPath), 'utf8')) as unknown;
  const manifestPath = path.resolve(args.manifestPath);
  const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const parsedDraft = parseBuilderDraft(draft);
  const triangleCount = await countDraftRoofTriangles(parsedDraft.building, args.geometryWorldPath);
  const promoted = promoteBuildingDraft(draft, rawManifest, triangleCount, args);

  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(promoted.buildings.at(-1), null, 2)}\n`);
    return;
  }

  await writeFile(manifestPath, `${JSON.stringify(promoted, null, 2)}\n`, 'utf8');
  process.stdout.write(`Promoted ${args.id ?? parsedDraft.building.id} with ${triangleCount} roof triangles.\n`);
  if (!args.runExport) {
    process.stdout.write('Run npm run assets:export-buildings before committing.\n');
    return;
  }

  run('npm', ['run', 'assets:export-buildings']);
  run('npm', ['run', 'map:validate']);
  run('npx', ['tsx', '--test',
    'test/building-manifest.test.ts',
    'test/map-interior-contract.test.ts',
    'test/seamless-interior.test.ts'
  ]);
  process.stdout.write('Building publish pipeline completed. Perform browser visual QA before committing.\n');
}

function selectedTriangleCount(
  vertices: readonly GeometryVertex[],
  indices: readonly number[],
  offsetX: number,
  offsetY: number,
  bounds: SourceBounds3D,
  includeVerticalFaces: boolean
): number {
  if (indices.length % 3 !== 0) throw new Error('Geometry index array contains an incomplete triangle.');
  let count = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const first = worldVertex(vertices[indices[offset]], offsetX, offsetY);
    const second = worldVertex(vertices[indices[offset + 1]], offsetX, offsetY);
    const third = worldVertex(vertices[indices[offset + 2]], offsetX, offsetY);
    if (!contains(bounds, first) || !contains(bounds, second) || !contains(bounds, third)) continue;
    if (!includeVerticalFaces && !isRoofFacing(first, second, third)) continue;
    count++;
  }
  return count;
}

function worldVertex(vertex: GeometryVertex | undefined, offsetX: number, offsetY: number): GeometryVertex {
  if (!vertex) throw new Error('Geometry index references a missing vertex.');
  return {x: vertex.x + offsetX, y: vertex.y + offsetY, z: vertex.z};
}

function contains(bounds: SourceBounds3D, point: GeometryVertex): boolean {
  return point.x >= bounds.minX - BOUNDS_EPSILON && point.x <= bounds.maxX + BOUNDS_EPSILON &&
    point.y >= bounds.minY - BOUNDS_EPSILON && point.y <= bounds.maxY + BOUNDS_EPSILON &&
    point.z >= bounds.minZ - BOUNDS_EPSILON && point.z <= bounds.maxZ + BOUNDS_EPSILON;
}

function isRoofFacing(first: GeometryVertex, second: GeometryVertex, third: GeometryVertex): boolean {
  const ab = {x: second.x - first.x, y: second.y - first.y, z: second.z - first.z};
  const ac = {x: third.x - first.x, y: third.y - first.y, z: third.z - first.z};
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x
  };
  const horizontal = Math.hypot(normal.x, normal.y);
  return Math.abs(normal.z) > NORMAL_EPSILON && Math.abs(normal.z) >= horizontal;
}

function parseArguments(values: readonly string[]): {
  draftPath: string;
  manifestPath: string;
  geometryWorldPath: string;
  id?: string;
  label?: string;
  replace: boolean;
  dryRun: boolean;
  runExport: boolean;
} {
  const positional = values.find((value) => !value.startsWith('--'));
  if (!positional) throw new Error('Usage: npm run buildings:publish -- <draft.json> [--id value] [--label value] [--replace]');
  const valueAfter = (flag: string): string | undefined => {
    const index = values.indexOf(flag);
    return index >= 0 ? values[index + 1] : undefined;
  };
  return {
    draftPath: positional,
    manifestPath: valueAfter('--manifest') ?? DEFAULT_MANIFEST_PATH,
    geometryWorldPath: valueAfter('--geometry') ?? DEFAULT_GEOMETRY_WORLD_PATH,
    id: valueAfter('--id'),
    label: valueAfter('--label'),
    replace: values.includes('--replace'),
    dryRun: values.includes('--dry-run'),
    runExport: process.env.BUILDING_RUN_EXPORT === '1'
  };
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {stdio: 'inherit', env: process.env});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
