export interface ThreeMapVertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  tile: number;
  shade: number;
}

export interface ThreeMapAtlas {
  image: string;
  columns: number;
  rows: number;
  tileSize: number;
  tileCount: number;
}

export interface ThreeMapSurfaceGrid {
  width: number;
  height: number;
  values: number[];
}

export interface ThreeMapOccluderDefinition {
  id: string;
  bounds: {minX: number; minY: number; maxX: number; maxY: number; minZ: number; maxZ: number};
  exteriorDoor: {x: number; y: number};
  floorZ: number;
  triangleCount: number;
}

export interface ThreeMapChunkDescriptor {
  id: string;
  column: number;
  row: number;
  x: number;
  y: number;
  size: number;
  file: string;
  triangleCount: number;
}

export interface ThreeMapManifest {
  version: number;
  revision: string;
  source: string;
  blockSize: number;
  origin: {x: number; y: number};
  size: {width: number; height: number};
  chunkSize: number;
  atlas: ThreeMapAtlas;
  surfaces: ThreeMapSurfaceGrid;
  occluders: ThreeMapOccluderDefinition[];
  chunks: ThreeMapChunkDescriptor[];
  triangleCount: number;
}

export interface ThreeMapChunkOccluder {
  id: string;
  opaqueIndices: number[];
  alphaTestedIndices: number[];
  triangleCount: number;
}

export interface ThreeMapChunkPayload {
  version: number;
  column: number;
  row: number;
  x: number;
  y: number;
  size: number;
  vertices: ThreeMapVertex[];
  opaqueIndices: number[];
  alphaTestedIndices: number[];
  occluders: ThreeMapChunkOccluder[];
  triangleCount: number;
}
