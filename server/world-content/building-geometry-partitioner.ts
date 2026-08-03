import type {BuildingDefinition, SourceBounds3D} from '../../shared/content/building-manifest.ts';

export interface MutableGeometryVertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  tile: number;
  shade: number;
}

export interface MutableGeometryChunkOccluder {
  id: string;
  opaqueIndices: number[];
  alphaTestedIndices: number[];
  triangleCount: number;
}

export interface MutableGeometryChunk {
  version: number;
  column: number;
  row: number;
  x: number;
  y: number;
  size: number;
  vertices: MutableGeometryVertex[];
  opaqueIndices: number[];
  alphaTestedIndices: number[];
  occluders: MutableGeometryChunkOccluder[];
  triangleCount: number;
}

export interface GeometryOccluderDefinition {
  id: string;
  bounds: SourceBounds3D;
  exteriorDoor: {x: number; y: number};
  floorZ: number;
  triangleCount: number;
}

export interface MutableGeometryWorld {
  version: number;
  revision: string;
  blockSize: number;
  occluders: GeometryOccluderDefinition[];
  chunks: Array<{
    id: string;
    column: number;
    row: number;
    x: number;
    y: number;
    size: number;
    file: string;
    triangleCount: number;
  }>;
  triangleCount: number;
  [key: string]: unknown;
}

const BOUNDS_EPSILON = 0.0001;
const NORMAL_EPSILON = 0.0001;

export function geometryChunkOverlapsBuilding(
  descriptor: {x: number; y: number; size: number},
  building: BuildingDefinition
): boolean {
  const bounds = building.shell.bounds;
  return descriptor.x <= bounds.maxX && descriptor.x + descriptor.size >= bounds.minX &&
    descriptor.y <= bounds.maxY && descriptor.y + descriptor.size >= bounds.minY;
}

export function partitionBuildingChunk(
  source: MutableGeometryChunk,
  building: BuildingDefinition
): {chunk: MutableGeometryChunk; triangleCount: number} {
  if (source.occluders.some(({id}) => id === building.id)) {
    throw new Error(`Geometry chunk already contains occluder "${building.id}".`);
  }
  const chunk = structuredClone(source);
  const includeVerticalFaces = building.shell.cutawayMode === 'complete-above-floor';
  const opaque = partitionIndices(
    chunk.vertices,
    chunk.opaqueIndices,
    chunk.x,
    chunk.y,
    building.shell.bounds,
    includeVerticalFaces
  );
  const alphaTested = partitionIndices(
    chunk.vertices,
    chunk.alphaTestedIndices,
    chunk.x,
    chunk.y,
    building.shell.bounds,
    includeVerticalFaces
  );
  const triangleCount = (opaque.selected.length + alphaTested.selected.length) / 3;
  if (triangleCount === 0) return {chunk: source, triangleCount: 0};
  chunk.opaqueIndices = opaque.remaining;
  chunk.alphaTestedIndices = alphaTested.remaining;
  chunk.occluders.push({
    id: building.id,
    opaqueIndices: opaque.selected,
    alphaTestedIndices: alphaTested.selected,
    triangleCount
  });
  chunk.triangleCount = totalChunkTriangles(chunk);
  return {chunk, triangleCount};
}

export function addBuildingOccluder(
  source: MutableGeometryWorld,
  building: BuildingDefinition,
  triangleCount: number,
  revision: string
): MutableGeometryWorld {
  if (!Number.isSafeInteger(triangleCount) || triangleCount <= 0) {
    throw new Error(`Building "${building.id}" selected no roof geometry.`);
  }
  if (source.occluders.some(({id}) => id === building.id)) {
    throw new Error(`Geometry manifest already contains occluder "${building.id}".`);
  }
  const world = structuredClone(source);
  world.revision = revision;
  world.occluders.push({
    id: building.id,
    bounds: structuredClone(building.shell.bounds),
    exteriorDoor: {x: building.entrance.x, y: building.entrance.y},
    floorZ: building.floorZ,
    triangleCount
  });
  return world;
}

function partitionIndices(
  vertices: readonly MutableGeometryVertex[],
  indices: readonly number[],
  offsetX: number,
  offsetY: number,
  bounds: SourceBounds3D,
  includeVerticalFaces: boolean
): {remaining: number[]; selected: number[]} {
  if (indices.length % 3 !== 0) throw new Error('Geometry index array contains an incomplete triangle.');
  const remaining: number[] = [];
  const selected: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = indices.slice(offset, offset + 3);
    const first = worldVertex(vertices[triangle[0]], offsetX, offsetY);
    const second = worldVertex(vertices[triangle[1]], offsetX, offsetY);
    const third = worldVertex(vertices[triangle[2]], offsetX, offsetY);
    const matches = contains(bounds, first) && contains(bounds, second) && contains(bounds, third) &&
      (includeVerticalFaces || isRoofFacing(first, second, third));
    (matches ? selected : remaining).push(...triangle);
  }
  return {remaining, selected};
}

function totalChunkTriangles(chunk: MutableGeometryChunk): number {
  const indices = chunk.opaqueIndices.length + chunk.alphaTestedIndices.length +
    chunk.occluders.reduce((total, group) => (
      total + group.opaqueIndices.length + group.alphaTestedIndices.length
    ), 0);
  if (indices % 3 !== 0) throw new Error('Geometry chunk contains incomplete triangle indices.');
  return indices / 3;
}

function worldVertex(
  vertex: MutableGeometryVertex | undefined,
  offsetX: number,
  offsetY: number
): {x: number; y: number; z: number} {
  if (!vertex) throw new Error('Geometry index references a missing vertex.');
  return {x: vertex.x + offsetX, y: vertex.y + offsetY, z: vertex.z};
}

function contains(bounds: SourceBounds3D, point: {x: number; y: number; z: number}): boolean {
  return point.x >= bounds.minX - BOUNDS_EPSILON && point.x <= bounds.maxX + BOUNDS_EPSILON &&
    point.y >= bounds.minY - BOUNDS_EPSILON && point.y <= bounds.maxY + BOUNDS_EPSILON &&
    point.z >= bounds.minZ - BOUNDS_EPSILON && point.z <= bounds.maxZ + BOUNDS_EPSILON;
}

function isRoofFacing(
  first: {x: number; y: number; z: number},
  second: {x: number; y: number; z: number},
  third: {x: number; y: number; z: number}
): boolean {
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
