export const LEVEL_EDITOR_SCHEMA_VERSION = 1;

export type EditableTileLayer = 'collision' | 'roads';
export type SpawnKind = 'player' | 'pedestrian' | 'traffic' | 'police' | 'mission';
export type LaneVehicleClass = 'civilian' | 'service' | 'emergency';

export interface Point2D {
  x: number;
  y: number;
}

export interface LaneCorridor {
  id: string;
  speedLimit: number;
  points: Point2D[];
  vehicleClasses?: LaneVehicleClass[];
  lanesPerDirection?: number;
}

export interface LaneJunction extends Point2D {
  id: string;
  corridors: string[];
  allowedTurns?: Array<'left' | 'right' | 'straight'>;
}

export interface RoadblockVehiclePose extends Point2D {
  angle: number;
}

export interface RoadblockStinger extends Point2D {
  angle: number;
  officerPose: RoadblockVehiclePose;
}

export interface LaneRoadblock extends Point2D {
  id: string;
  angle: number;
  blockedEdgeIds: string[];
  vehiclePoses: RoadblockVehiclePose[];
  stinger: RoadblockStinger;
}

export interface LaneGraphDocument {
  schemaVersion: number;
  districtId: string;
  driveSide: 'right';
  laneOffset: number;
  laneSpacing: number;
  allowTerminalTurnarounds?: boolean;
  corridors: LaneCorridor[];
  junctions: LaneJunction[];
  roadblocks?: LaneRoadblock[];
}

export interface EditorSpawn extends Point2D {
  id: string;
  label: string;
  kind: SpawnKind;
  angle: number;
  enabled: boolean;
}

export interface LevelEditorDocument {
  schemaVersion: typeof LEVEL_EDITOR_SCHEMA_VERSION;
  id: string;
  title: string;
  map: {
    source: string;
    width: number;
    height: number;
    tileSize: number;
    origin: Point2D;
  };
  layers: {
    collision: number[];
    roads: number[];
  };
  lanes: LaneGraphDocument;
  spawns: EditorSpawn[];
}

export interface TiledLayer {
  id?: number;
  name: string;
  type: string;
  data?: number[];
  [key: string]: unknown;
}

export interface TiledMapDocument {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  [key: string]: unknown;
}

export interface DistrictMapMetadata {
  source: string;
  tileSize: number;
  origin: Point2D;
  size: {width: number; height: number};
  spawn: Point2D;
  walkableCells: number;
  roadCells: number;
  elevatedPassageCells: number;
  [key: string]: unknown;
}

export interface SourceArtifacts {
  map: TiledMapDocument;
  metadata: DistrictMapMetadata;
}

export interface LevelEditorBundle {
  schemaVersion: 1;
  generatedAt: string;
  editorDocument: LevelEditorDocument;
  files: {
    'public/assets/maps/district-map.json': TiledMapDocument;
    'public/assets/maps/district-map.metadata.json': DistrictMapMetadata;
    'public/assets/maps/district-lanes.json': LaneGraphDocument;
  };
}

export function assembleLevelDocument(
  map: TiledMapDocument,
  metadata: DistrictMapMetadata,
  lanes: LaneGraphDocument
): LevelEditorDocument {
  assertMapContract(map, metadata);
  return {
    schemaVersion: LEVEL_EDITOR_SCHEMA_VERSION,
    id: lanes.districtId,
    title: titleFromId(lanes.districtId),
    map: {
      source: metadata.source,
      width: map.width,
      height: map.height,
      tileSize: map.tilewidth,
      origin: {...metadata.origin}
    },
    layers: {
      collision: [...requiredTileLayer(map, 'collisions').data!],
      roads: [...requiredTileLayer(map, 'roads').data!]
    },
    lanes: structuredClone(lanes),
    spawns: [{
      id: 'player-default',
      label: 'Default player spawn',
      kind: 'player',
      x: metadata.spawn.x,
      y: metadata.spawn.y,
      angle: 0,
      enabled: true
    }]
  };
}

export function createArtifactBundle(
  document: LevelEditorDocument,
  source: SourceArtifacts,
  generatedAt = new Date().toISOString()
): LevelEditorBundle {
  assertCompatibleSource(document, source);
  const map = structuredClone(source.map);
  requiredTileLayer(map, 'collisions').data = [...document.layers.collision];
  requiredTileLayer(map, 'roads').data = [...document.layers.roads];
  const defaultSpawn = document.spawns.find((spawn) => spawn.kind === 'player' && spawn.enabled);
  const metadata: DistrictMapMetadata = {
    ...structuredClone(source.metadata),
    source: document.map.source,
    tileSize: document.map.tileSize,
    origin: {...document.map.origin},
    size: {width: document.map.width, height: document.map.height},
    spawn: defaultSpawn
      ? {x: Math.round(defaultSpawn.x), y: Math.round(defaultSpawn.y)}
      : {...source.metadata.spawn},
    walkableCells: document.layers.collision.reduce((count, value) => count + Number(value === 0), 0),
    roadCells: document.layers.roads.reduce((count, value) => count + Number(value !== 0), 0)
  };
  return {
    schemaVersion: 1,
    generatedAt,
    editorDocument: structuredClone(document),
    files: {
      'public/assets/maps/district-map.json': map,
      'public/assets/maps/district-map.metadata.json': metadata,
      'public/assets/maps/district-lanes.json': structuredClone(document.lanes)
    }
  };
}

export function isLevelEditorDocument(value: unknown): value is LevelEditorDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LevelEditorDocument>;
  return candidate.schemaVersion === LEVEL_EDITOR_SCHEMA_VERSION &&
    typeof candidate.id === 'string' &&
    Boolean(candidate.map) &&
    Array.isArray(candidate.layers?.collision) &&
    Array.isArray(candidate.layers?.roads) &&
    Array.isArray(candidate.lanes?.corridors) &&
    Array.isArray(candidate.spawns);
}

export function isLevelEditorBundle(value: unknown): value is LevelEditorBundle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LevelEditorBundle>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.generatedAt === 'string' &&
    isLevelEditorDocument(candidate.editorDocument) &&
    Boolean(candidate.files?.['public/assets/maps/district-map.json']) &&
    Boolean(candidate.files?.['public/assets/maps/district-map.metadata.json']) &&
    Boolean(candidate.files?.['public/assets/maps/district-lanes.json']);
}

export function tileIndex(document: LevelEditorDocument, tileX: number, tileY: number): number {
  if (tileX < 0 || tileY < 0 || tileX >= document.map.width || tileY >= document.map.height) {
    return -1;
  }
  return tileY * document.map.width + tileX;
}

export function worldToTile(document: LevelEditorDocument, point: Point2D): Point2D {
  return {
    x: Math.floor((point.x - document.map.origin.x) / document.map.tileSize),
    y: Math.floor((point.y - document.map.origin.y) / document.map.tileSize)
  };
}

export function tileToWorldCenter(document: LevelEditorDocument, point: Point2D): Point2D {
  return {
    x: document.map.origin.x + (point.x + 0.5) * document.map.tileSize,
    y: document.map.origin.y + (point.y + 0.5) * document.map.tileSize
  };
}

export function documentWorldSize(document: LevelEditorDocument): {width: number; height: number} {
  return {
    width: document.map.width * document.map.tileSize,
    height: document.map.height * document.map.tileSize
  };
}

function assertMapContract(map: TiledMapDocument, metadata: DistrictMapMetadata): void {
  if (map.width !== metadata.size.width || map.height !== metadata.size.height) {
    throw new Error('Map dimensions do not match district metadata.');
  }
  if (map.tilewidth !== map.tileheight || map.tilewidth !== metadata.tileSize) {
    throw new Error('The level editor requires square tiles matching district metadata.');
  }
  const expectedCells = map.width * map.height;
  for (const name of ['collisions', 'roads']) {
    const layer = requiredTileLayer(map, name);
    if (layer.data!.length !== expectedCells) {
      throw new Error(`Layer ${name} has ${layer.data!.length} cells; expected ${expectedCells}.`);
    }
  }
}

function assertCompatibleSource(document: LevelEditorDocument, source: SourceArtifacts): void {
  assertMapContract(source.map, source.metadata);
  if (
    source.map.width !== document.map.width ||
    source.map.height !== document.map.height ||
    source.map.tilewidth !== document.map.tileSize
  ) {
    throw new Error('Editor document and source map use different dimensions.');
  }
  const expectedCells = document.map.width * document.map.height;
  if (
    document.layers.collision.length !== expectedCells ||
    document.layers.roads.length !== expectedCells
  ) {
    throw new Error('Editor tile layers do not match the map dimensions.');
  }
}

function requiredTileLayer(map: TiledMapDocument, name: string): TiledLayer {
  const layer = map.layers.find((candidate) => candidate.name === name && candidate.type === 'tilelayer');
  if (!layer || !Array.isArray(layer.data)) throw new Error(`Missing tile layer: ${name}`);
  return layer;
}

function titleFromId(id: string): string {
  return id.split('-').map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ');
}
