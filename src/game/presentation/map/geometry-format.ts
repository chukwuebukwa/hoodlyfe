export interface WorldGeometryVertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  tile: number;
  shade: number;
}

export interface WorldGeometryAtlas {
  image: string;
  columns: number;
  rows: number;
  tileSize: number;
  tileCount: number;
}

export interface WorldGeometrySurfaceGrid {
  width: number;
  height: number;
  values: number[];
}

export interface WorldGeometryOccluderDefinition {
  id: string;
  bounds: {minX: number; minY: number; maxX: number; maxY: number; minZ: number; maxZ: number};
  exteriorDoor: {x: number; y: number};
  floorZ: number;
  triangleCount: number;
}

export interface WorldGeometryChunkDescriptor {
  id: string;
  column: number;
  row: number;
  x: number;
  y: number;
  size: number;
  file: string;
  triangleCount: number;
}

export interface WorldGeometryManifest {
  version: number;
  revision: string;
  source: string;
  blockSize: number;
  origin: {x: number; y: number};
  size: {width: number; height: number};
  chunkSize: number;
  atlas: WorldGeometryAtlas;
  surfaces: WorldGeometrySurfaceGrid;
  occluders: WorldGeometryOccluderDefinition[];
  chunks: WorldGeometryChunkDescriptor[];
  triangleCount: number;
}

export interface WorldGeometryChunkOccluder {
  id: string;
  opaqueIndices: number[];
  alphaTestedIndices: number[];
  triangleCount: number;
}

export interface WorldGeometryChunkPayload {
  version: number;
  column: number;
  row: number;
  x: number;
  y: number;
  size: number;
  vertices: WorldGeometryVertex[];
  opaqueIndices: number[];
  alphaTestedIndices: number[];
  occluders: WorldGeometryChunkOccluder[];
  triangleCount: number;
}
