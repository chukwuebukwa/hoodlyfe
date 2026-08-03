import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import sharp from 'sharp';
import {
  STREET_GROUND_SURFACE_ID,
  SurfaceMap,
  type SurfaceActorKind,
  type SurfaceDefinition,
  type SurfaceManifest,
  type SurfacePoint,
  type SurfaceTransitionDefinition,
  type SurfaceTriangle
} from '../shared/world/surface-map.ts';
import type {
  WorldGeometryChunkDescriptor,
  WorldGeometryChunkPayload,
  WorldGeometryManifest,
  WorldGeometryOccluderDefinition,
  WorldGeometryVertex
} from '../src/game/presentation/map/geometry-format.ts';

const BLOCK_SIZE = 64;
const SOURCE_SIZE = 256;
const GAP_SIZE = 8;
const WORLD_SIZE = SOURCE_SIZE * 2 + GAP_SIZE;
const CHUNK_SIZE = 8;
const PREVIEW_SCALE = 16;
const PHONE_MAP_SIZE = 1040;
const CONNECTOR_TILE_COUNT = 8;
const CONNECTOR_VEHICLE_RADIUS = 20;
const OUTPUT_ROOT = resolve('public/assets/districts/world/maps');
const OUTPUT_GEOMETRY = join(OUTPUT_ROOT, 'geometry');
const OUTPUT_CHUNKS = join(OUTPUT_GEOMETRY, 'chunks');

interface TileLayer {
  name: string;
  data: number[];
  width: number;
  height: number;
  [key: string]: unknown;
}

interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TileLayer[];
  [key: string]: unknown;
}

interface DistrictMetadata {
  source: string;
  tileSize: number;
  origin: {x: number; y: number};
  size: {width: number; height: number};
  spawn: {x: number; y: number};
  [key: string]: unknown;
}

interface SourceDistrict {
  id: 'wil' | 'bil' | 'ste';
  label: string;
  mapsRoot: string;
  offsetColumn: number;
  offsetRow: number;
  atlasIndex: number;
  namespace: string;
  map: TiledMap;
  metadata: DistrictMetadata;
  surfaces: SurfaceManifest;
  geometry: WorldGeometryManifest;
}

interface Connector {
  id: string;
  surfaceId: string;
  label: string;
  orientation: 'horizontal' | 'vertical';
  cells: Array<{column: number; row: number}>;
  bounds: {minX: number; minY: number; maxX: number; maxY: number};
  z: number;
  sourceAliases: Array<{districtId: SourceDistrict['id']; surfaceId: string}>;
}

const sourceDefinitions = [
  {
    id: 'wil',
    label: 'Downtown',
    mapsRoot: resolve('public/assets/districts/wil/maps'),
    offsetColumn: 0,
    offsetRow: 0,
    atlasIndex: 0,
    namespace: 'wil'
  },
  {
    id: 'bil',
    label: 'Industrial',
    mapsRoot: resolve('public/assets/maps'),
    offsetColumn: SOURCE_SIZE + GAP_SIZE,
    offsetRow: 0,
    atlasIndex: 1,
    namespace: ''
  },
  {
    id: 'ste',
    label: 'Residential',
    mapsRoot: resolve('public/assets/districts/ste/maps'),
    offsetColumn: 0,
    offsetRow: SOURCE_SIZE + GAP_SIZE,
    atlasIndex: 2,
    namespace: 'ste'
  }
] as const;

const connectors: Connector[] = [
  {
    id: 'connector-city-industrial',
    surfaceId: 'connector-ground-network',
    label: 'Crosstown Link',
    orientation: 'horizontal',
    cells: rectangleCells(247, 27, SOURCE_SIZE + GAP_SIZE + 8, 30),
    bounds: {
      minX: 247 * BLOCK_SIZE,
      minY: 27 * BLOCK_SIZE,
      maxX: (SOURCE_SIZE + GAP_SIZE + 9) * BLOCK_SIZE,
      maxY: 31 * BLOCK_SIZE
    },
    z: 128,
    sourceAliases: [
      {districtId: 'wil', surfaceId: STREET_GROUND_SURFACE_ID},
      {districtId: 'bil', surfaceId: 'street-surface-0-0-2'}
    ]
  },
  {
    id: 'connector-harbor-link',
    surfaceId: 'connector-ground-network',
    label: 'Harbor Link',
    orientation: 'horizontal',
    cells: rectangleCells(250, 193, SOURCE_SIZE + GAP_SIZE + 6, 196),
    bounds: {
      minX: 250 * BLOCK_SIZE,
      minY: 193 * BLOCK_SIZE,
      maxX: (SOURCE_SIZE + GAP_SIZE + 7) * BLOCK_SIZE,
      maxY: 197 * BLOCK_SIZE
    },
    z: 128,
    sourceAliases: [
      {districtId: 'wil', surfaceId: STREET_GROUND_SURFACE_ID},
      {districtId: 'bil', surfaceId: 'street-surface-0-0-2'}
    ]
  },
  {
    id: 'connector-city-residential',
    surfaceId: 'connector-southline-elevated',
    label: 'Southline',
    orientation: 'vertical',
    cells: rectangleCells(89, 251, 92, SOURCE_SIZE + GAP_SIZE + 10),
    bounds: {
      minX: 89 * BLOCK_SIZE,
      minY: 251 * BLOCK_SIZE,
      maxX: 93 * BLOCK_SIZE,
      maxY: (SOURCE_SIZE + GAP_SIZE + 11) * BLOCK_SIZE
    },
    z: 384,
    sourceAliases: [
      {districtId: 'wil', surfaceId: 'street-surface-89-254-6'},
      {districtId: 'ste', surfaceId: 'street-surface-77-1-6'}
    ]
  },
  {
    id: 'connector-westline',
    surfaceId: 'connector-ground-network',
    label: 'Westline',
    orientation: 'vertical',
    cells: rectangleCells(20, 246, 23, SOURCE_SIZE + GAP_SIZE + 22),
    bounds: {
      minX: 20 * BLOCK_SIZE,
      minY: 246 * BLOCK_SIZE,
      maxX: 24 * BLOCK_SIZE,
      maxY: (SOURCE_SIZE + GAP_SIZE + 23) * BLOCK_SIZE
    },
    z: 128,
    sourceAliases: [
      {districtId: 'wil', surfaceId: 'street-surface-59-231-2'},
      {districtId: 'ste', surfaceId: STREET_GROUND_SURFACE_ID}
    ]
  }
];

const sources = await Promise.all(sourceDefinitions.map(loadSource));
validateSourceCompatibility(sources);
await rm(OUTPUT_ROOT, {recursive: true, force: true});
await mkdir(OUTPUT_CHUNKS, {recursive: true});

const map = compileMap(sources);
const metadata = compileMetadata(sources, map);
const surfaceManifest = compileSurfaces(sources);
validateConnectors(map, new SurfaceMap(surfaceManifest));
const geometryManifest = await compileGeometry(sources);

await Promise.all([
  writeJson(join(OUTPUT_ROOT, 'district-map.json'), map),
  writeJson(join(OUTPUT_ROOT, 'district-map.metadata.json'), metadata),
  writeJson(join(OUTPUT_ROOT, 'surface-manifest.json'), surfaceManifest),
  writeJson(join(OUTPUT_GEOMETRY, 'world.json'), geometryManifest),
  compileAtlas(sources),
  compilePreview(sources)
]);
await compilePhoneMap(sources);

console.log(
  `World atlas ready: ${WORLD_SIZE}x${WORLD_SIZE} blocks, ` +
  `${geometryManifest.chunks.length} streamed chunks, ` +
  `${surfaceManifest.surfaces.length} surfaces.`
);

async function loadSource(
  definition: typeof sourceDefinitions[number]
): Promise<SourceDistrict> {
  const [map, metadata, surfaces, geometry] = await Promise.all([
    readJson<TiledMap>(join(definition.mapsRoot, 'district-map.json')),
    readJson<DistrictMetadata>(join(definition.mapsRoot, 'district-map.metadata.json')),
    readJson<SurfaceManifest>(join(definition.mapsRoot, 'surface-manifest.json')),
    readJson<WorldGeometryManifest>(join(definition.mapsRoot, 'geometry/world.json'))
  ]);
  return {...definition, map, metadata, surfaces, geometry};
}

function validateSourceCompatibility(input: readonly SourceDistrict[]): void {
  for (const source of input) {
    if (
      source.map.width !== SOURCE_SIZE ||
      source.map.height !== SOURCE_SIZE ||
      source.map.tilewidth !== BLOCK_SIZE ||
      source.map.tileheight !== BLOCK_SIZE ||
      source.geometry.chunkSize !== CHUNK_SIZE ||
      source.geometry.atlas.columns !== 32 ||
      source.geometry.atlas.rows !== 31
    ) {
      throw new Error(`${source.label} does not match the world-atlas source contract.`);
    }
  }
}

function compileMap(input: readonly SourceDistrict[]): TiledMap {
  const template = input.find(({id}) => id === 'bil')!.map;
  const layerNames = template.layers.map(({name}) => name);
  const layers = layerNames.map((name) => {
    const templateLayer = template.layers.find((layer) => layer.name === name)!;
    const fill = name === 'collisions' ? 1 : 0;
    const data = new Array<number>(WORLD_SIZE * WORLD_SIZE).fill(fill);
    for (const source of input) {
      const sourceLayer = source.map.layers.find((layer) => layer.name === name);
      if (!sourceLayer) throw new Error(`${source.label} is missing the ${name} layer.`);
      copyGrid(
        sourceLayer.data,
        SOURCE_SIZE,
        SOURCE_SIZE,
        data,
        WORLD_SIZE,
        source.offsetColumn,
        source.offsetRow
      );
    }
    return {
      ...templateLayer,
      width: WORLD_SIZE,
      height: WORLD_SIZE,
      data
    };
  });
  const collisions = layers.find(({name}) => name === 'collisions')!;
  const roads = layers.find(({name}) => name === 'roads')!;
  const ground = layers.find(({name}) => name === 'ground')!;
  const asphaltTile = mostCommonRoadTile(input.find(({id}) => id === 'bil')!);
  for (const connector of connectors) {
    for (const {column, row} of connector.cells) {
      const index = row * WORLD_SIZE + column;
      collisions.data[index] = 0;
      roads.data[index] = 1;
      ground.data[index] = asphaltTile + 1;
    }
  }
  return {
    ...template,
    width: WORLD_SIZE,
    height: WORLD_SIZE,
    layers
  };
}

function compileMetadata(
  input: readonly SourceDistrict[],
  map: TiledMap
): DistrictMetadata {
  const industrial = input.find(({id}) => id === 'bil')!;
  const collisions = map.layers.find(({name}) => name === 'collisions')!.data;
  const roads = map.layers.find(({name}) => name === 'roads')!.data;
  return {
    source: 'world-atlas:wil+bil+ste',
    tileSize: BLOCK_SIZE,
    origin: {x: 0, y: 0},
    size: {width: WORLD_SIZE, height: WORLD_SIZE},
    spawn: {
      x: industrial.metadata.spawn.x + industrial.offsetColumn * BLOCK_SIZE,
      y: industrial.metadata.spawn.y + industrial.offsetRow * BLOCK_SIZE
    },
    walkableCells: collisions.filter((value) => value === 0).length,
    roadCells: roads.filter((value) => value !== 0).length,
    elevatedPassageCells: input.reduce(
      (total, source) => total + Number(source.metadata.elevatedPassageCells ?? 0),
      0
    ),
    districts: input.map((source) => ({
      id: source.id,
      label: source.label,
      offset: {
        x: source.offsetColumn * BLOCK_SIZE,
        y: source.offsetRow * BLOCK_SIZE
      },
      size: {
        width: SOURCE_SIZE * BLOCK_SIZE,
        height: SOURCE_SIZE * BLOCK_SIZE
      }
    }))
  };
}

function compileSurfaces(input: readonly SourceDistrict[]): SurfaceManifest {
  const definitions = new Map<string, {
    spaceId: string;
    actorKinds: Set<SurfaceActorKind>;
    triangles: SurfaceTriangle[];
  }>();
  const transitions: SurfaceTransitionDefinition[] = [];
  for (const source of input) {
    for (const surface of source.surfaces.surfaces) {
      const id = globalSurfaceId(source, surface.id);
      const current = definitions.get(id) ?? {
        spaceId: surface.spaceId,
        actorKinds: new Set<SurfaceActorKind>(),
        triangles: []
      };
      for (const actorKind of surface.actorKinds) current.actorKinds.add(actorKind);
      current.triangles.push(...surface.triangles.map((triangle) => (
        translateTriangle(triangle, source.offsetColumn, source.offsetRow)
      )));
      definitions.set(id, current);
    }
    for (const transition of source.surfaces.transitions) {
      const fromSurfaceId = globalSurfaceId(source, transition.fromSurfaceId);
      const toSurfaceId = globalSurfaceId(source, transition.toSurfaceId);
      if (fromSurfaceId === toSurfaceId) continue;
      transitions.push({
        ...transition,
        id: `${source.id}:${transition.id}`,
        fromSurfaceId,
        toSurfaceId,
        from: translatePoint2d(transition.from, source.offsetColumn, source.offsetRow),
        to: translatePoint2d(transition.to, source.offsetColumn, source.offsetRow)
      });
    }
  }
  for (const connector of connectors) {
    const current = definitions.get(connector.surfaceId);
    if (!current) throw new Error(`Connector ${connector.id} did not resolve an authored surface.`);
    current.triangles.push(...rectangleTriangles(connector.bounds, connector.z));
  }
  const surfaces: SurfaceDefinition[] = [...definitions].map(([id, definition]) => ({
    id,
    spaceId: definition.spaceId,
    actorKinds: [...definition.actorKinds],
    triangles: definition.triangles
  }));
  return {
    version: 1,
    collisionRevision: input[0].surfaces.collisionRevision,
    blockSize: BLOCK_SIZE,
    defaultSurfaceId: STREET_GROUND_SURFACE_ID,
    surfaces,
    transitions
  };
}

function validateConnectors(map: TiledMap, surfaces: SurfaceMap): void {
  const collisions = map.layers.find(({name}) => name === 'collisions')?.data;
  if (!collisions) throw new Error('World atlas is missing its collision layer.');
  for (const connector of connectors) {
    for (const {column, row} of connector.cells) {
      const x = (column + 0.5) * BLOCK_SIZE;
      const y = (row + 0.5) * BLOCK_SIZE;
      if (
        collisions[row * WORLD_SIZE + column] !== 0 ||
        !surfaces.canOccupy(
          connector.surfaceId,
          x,
          y,
          CONNECTOR_VEHICLE_RADIUS,
          'vehicle'
        )
      ) {
        throw new Error(`${connector.id} is not driveable at ${column},${row}.`);
      }
    }
  }
}

async function compileGeometry(
  input: readonly SourceDistrict[]
): Promise<WorldGeometryManifest> {
  const descriptors = new Map<string, {
    source: SourceDistrict;
    descriptor: WorldGeometryChunkDescriptor;
  }>();
  const atlasTileCount = input[0].geometry.atlas.tileCount;
  for (const source of input) {
    for (const descriptor of source.geometry.chunks) {
      const column = descriptor.column + source.offsetColumn / CHUNK_SIZE;
      const row = descriptor.row + source.offsetRow / CHUNK_SIZE;
      descriptors.set(`${column}:${row}`, {source, descriptor});
    }
  }
  const chunks: WorldGeometryChunkDescriptor[] = [];
  let triangleCount = 0;
  for (let row = 0; row < WORLD_SIZE / CHUNK_SIZE; row++) {
    for (let column = 0; column < WORLD_SIZE / CHUNK_SIZE; column++) {
      const sourceChunk = descriptors.get(`${column}:${row}`);
      const x = column * CHUNK_SIZE;
      const y = row * CHUNK_SIZE;
      const payload = sourceChunk
        ? await transformedChunk(sourceChunk.source, sourceChunk.descriptor, x, y, atlasTileCount)
        : emptyChunk(column, row, x, y);
      appendConnectorGeometry(payload, x, y, atlasTileCount * input.length);
      payload.triangleCount = (
        payload.opaqueIndices.length +
        payload.alphaTestedIndices.length
      ) / 3;
      const file = `chunks/${column}-${row}.json`;
      await writeJson(join(OUTPUT_GEOMETRY, file), payload);
      chunks.push({
        id: `${column}:${row}`,
        column,
        row,
        x,
        y,
        size: CHUNK_SIZE,
        file,
        triangleCount: payload.triangleCount
      });
      triangleCount += payload.triangleCount;
    }
  }
  const surfaces = new Array<number>(WORLD_SIZE * WORLD_SIZE).fill(0);
  for (const source of input) {
    copyGrid(
      source.geometry.surfaces.values,
      SOURCE_SIZE,
      SOURCE_SIZE,
      surfaces,
      WORLD_SIZE,
      source.offsetColumn,
      source.offsetRow
    );
  }
  for (const connector of connectors) {
    for (const {column, row} of connector.cells) {
      surfaces[row * WORLD_SIZE + column] = connector.z / BLOCK_SIZE;
    }
  }
  return {
    version: 1,
    revision: 'world-atlas:wil+bil+ste:v1',
    source: 'world-atlas',
    blockSize: BLOCK_SIZE,
    origin: {x: 0, y: 0},
    size: {width: WORLD_SIZE, height: WORLD_SIZE},
    chunkSize: CHUNK_SIZE,
    atlas: {
      image: 'tiles.png',
      columns: input[0].geometry.atlas.columns,
      rows: input[0].geometry.atlas.rows * input.length + 1,
      tileSize: input[0].geometry.atlas.tileSize,
      tileCount: atlasTileCount * input.length +
        input[0].geometry.atlas.columns
    },
    surfaces: {
      width: WORLD_SIZE,
      height: WORLD_SIZE,
      values: surfaces
    },
    occluders: input.flatMap((source) => source.geometry.occluders.map((occluder) => (
      translateOccluder(source, occluder)
    ))),
    chunks,
    triangleCount
  };
}

async function transformedChunk(
  source: SourceDistrict,
  descriptor: WorldGeometryChunkDescriptor,
  x: number,
  y: number,
  atlasTileCount: number
): Promise<WorldGeometryChunkPayload> {
  const payload = await readJson<WorldGeometryChunkPayload>(
    join(source.mapsRoot, 'geometry', descriptor.file)
  );
  return {
    ...payload,
    column: x / CHUNK_SIZE,
    row: y / CHUNK_SIZE,
    x,
    y,
    vertices: payload.vertices.map((vertex) => ({
      ...vertex,
      tile: vertex.tile + source.atlasIndex * atlasTileCount
    })),
    occluders: payload.occluders.map((occluder) => ({
      ...occluder,
      id: globalOccluderId(source, occluder.id)
    }))
  };
}

function emptyChunk(
  column: number,
  row: number,
  x: number,
  y: number
): WorldGeometryChunkPayload {
  return {
    version: 1,
    column,
    row,
    x,
    y,
    size: CHUNK_SIZE,
    vertices: [],
    opaqueIndices: [],
    alphaTestedIndices: [],
    occluders: [],
    triangleCount: 0
  };
}

function appendConnectorGeometry(
  payload: WorldGeometryChunkPayload,
  chunkX: number,
  chunkY: number,
  connectorTileBase: number
): void {
  for (const connector of connectors) {
    for (const cell of connector.cells) {
      if (
        cell.column < chunkX || cell.column >= chunkX + CHUNK_SIZE ||
        cell.row < chunkY || cell.row >= chunkY + CHUNK_SIZE
      ) continue;
      const base = payload.vertices.length;
      const x = cell.column - chunkX;
      const y = cell.row - chunkY;
      const z = connector.z / BLOCK_SIZE + 1 / BLOCK_SIZE;
      const tile = connectorTileBase + connectorTileIndex(connector, cell);
      payload.vertices.push(
        vertex(x, y, z, 0, 0, tile),
        vertex(x + 1, y, z, 1, 0, tile),
        vertex(x, y + 1, z, 0, 1, tile),
        vertex(x + 1, y + 1, z, 1, 1, tile)
      );
      payload.opaqueIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
}

function vertex(
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
  tile: number
): WorldGeometryVertex {
  return {x, y, z, u, v, tile, shade: 0};
}

async function compileAtlas(input: readonly SourceDistrict[]): Promise<void> {
  const width = input[0].geometry.atlas.columns * input[0].geometry.atlas.tileSize;
  const sourceHeight = input[0].geometry.atlas.rows * input[0].geometry.atlas.tileSize;
  const connectorTiles = await compileConnectorTiles(input[0].geometry.atlas.tileSize);
  await sharp({
    create: {
      width,
      height: sourceHeight * input.length + input[0].geometry.atlas.tileSize,
      channels: 4,
      background: {r: 0, g: 0, b: 0, alpha: 0}
    }
  }).composite([
    ...input.map((source) => ({
      input: join(source.mapsRoot, 'geometry', source.geometry.atlas.image),
      left: 0,
      top: source.atlasIndex * sourceHeight
    })),
    {input: connectorTiles, left: 0, top: sourceHeight * input.length}
  ]).png().toFile(join(OUTPUT_GEOMETRY, 'tiles.png'));
}

async function compilePreview(input: readonly SourceDistrict[]): Promise<void> {
  const size = WORLD_SIZE * PREVIEW_SCALE;
  const connectorSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    connectors.map((connector) => (
      `<rect x="${connector.bounds.minX / BLOCK_SIZE * PREVIEW_SCALE}" ` +
      `y="${connector.bounds.minY / BLOCK_SIZE * PREVIEW_SCALE}" ` +
      `width="${(connector.bounds.maxX - connector.bounds.minX) / BLOCK_SIZE * PREVIEW_SCALE}" ` +
      `height="${(connector.bounds.maxY - connector.bounds.minY) / BLOCK_SIZE * PREVIEW_SCALE}" ` +
      'fill="#53606a"/>'
    )).join('') +
    '</svg>'
  );
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: {r: 5, g: 8, b: 10}
    }
  }).composite([
    ...input.map((source) => ({
      input: join(source.mapsRoot, 'district-preview.png'),
      left: source.offsetColumn * PREVIEW_SCALE,
      top: source.offsetRow * PREVIEW_SCALE
    })),
    {input: connectorSvg, left: 0, top: 0}
  ]).png().toFile(join(OUTPUT_ROOT, 'district-preview.png'));
}

async function compilePhoneMap(input: readonly SourceDistrict[]): Promise<void> {
  const previewPath = join(OUTPUT_ROOT, 'district-preview.png');
  const labels = Buffer.from(`
    <svg width="${PHONE_MAP_SIZE}" height="${PHONE_MAP_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="future-grid" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="28" height="28" fill="#162127"/>
          <rect width="7" height="28" fill="#1d2b32"/>
        </pattern>
      </defs>
      <style>
        .district { font: 700 30px sans-serif; fill: white; paint-order: stroke; stroke: #111820; stroke-width: 7px; }
        .road { font: 700 18px sans-serif; fill: #f6cb45; paint-order: stroke; stroke: #111820; stroke-width: 5px; }
        .future { font: 700 20px sans-serif; letter-spacing: 4px; fill: #6c7d85; }
      </style>
      <rect x="${(SOURCE_SIZE + GAP_SIZE) / WORLD_SIZE * PHONE_MAP_SIZE}" y="${(SOURCE_SIZE + GAP_SIZE) / WORLD_SIZE * PHONE_MAP_SIZE}" width="${SOURCE_SIZE / WORLD_SIZE * PHONE_MAP_SIZE}" height="${SOURCE_SIZE / WORLD_SIZE * PHONE_MAP_SIZE}" fill="url(#future-grid)"/>
      <text class="future" x="${(SOURCE_SIZE + GAP_SIZE + SOURCE_SIZE / 2) / WORLD_SIZE * PHONE_MAP_SIZE}" y="${(SOURCE_SIZE + GAP_SIZE + SOURCE_SIZE / 2) / WORLD_SIZE * PHONE_MAP_SIZE}" text-anchor="middle">UNDEVELOPED</text>
      ${input.map((source) => {
        const x = (source.offsetColumn + SOURCE_SIZE / 2) / WORLD_SIZE * PHONE_MAP_SIZE;
        const y = (source.offsetRow + SOURCE_SIZE / 2) / WORLD_SIZE * PHONE_MAP_SIZE;
        return `<text class="district" x="${x}" y="${y}" text-anchor="middle">${source.label}</text>`;
      }).join('')}
      ${connectors.map((connector) => {
        const x = (connector.bounds.minX + connector.bounds.maxX) /
          (2 * BLOCK_SIZE * WORLD_SIZE) * PHONE_MAP_SIZE;
        const y = (connector.bounds.minY + connector.bounds.maxY) /
          (2 * BLOCK_SIZE * WORLD_SIZE) * PHONE_MAP_SIZE;
        const rotation = connector.orientation === 'vertical'
          ? ` transform="rotate(-90 ${x} ${y})"`
          : '';
        return `<text class="road" x="${x}" y="${y}" text-anchor="middle"${rotation}>${connector.label}</text>`;
      }).join('')}
    </svg>
  `);
  await sharp(previewPath)
    .resize(PHONE_MAP_SIZE, PHONE_MAP_SIZE, {fit: 'fill'})
    .modulate({brightness: 0.72, saturation: 0.8})
    .composite([{input: labels, left: 0, top: 0}])
    .webp({quality: 82})
    .toFile(join(OUTPUT_ROOT, 'phone-world-map.webp'));
}

async function compileConnectorTiles(tileSize: number): Promise<Buffer> {
  const tiles = await Promise.all(Array.from({length: CONNECTOR_TILE_COUNT}, (_, index) => (
    sharp(Buffer.from(connectorTileSvg(index, tileSize))).png().toBuffer()
  )));
  return sharp({
    create: {
      width: tileSize * 32,
      height: tileSize,
      channels: 4,
      background: {r: 0, g: 0, b: 0, alpha: 0}
    }
  }).composite(tiles.map((input, index) => ({
    input,
    left: index * tileSize,
    top: 0
  }))).png().toBuffer();
}

function connectorTileSvg(index: number, size: number): string {
  const horizontal = index < 4;
  const lane = index % 4;
  const edge = lane === 0
    ? horizontal
      ? `<rect x="0" y="5" width="${size}" height="4" fill="#d8c26a"/>`
      : `<rect x="5" y="0" width="4" height="${size}" fill="#d8c26a"/>`
    : lane === 3
      ? horizontal
        ? `<rect x="0" y="${size - 9}" width="${size}" height="4" fill="#d8c26a"/>`
        : `<rect x="${size - 9}" y="0" width="4" height="${size}" fill="#d8c26a"/>`
      : '';
  const center = lane === 1
    ? horizontal
      ? `<path d="M0 ${size - 3}H${size}" stroke="#d9ad33" stroke-width="3" stroke-dasharray="18 13"/>`
      : `<path d="M${size - 3} 0V${size}" stroke="#d9ad33" stroke-width="3" stroke-dasharray="18 13"/>`
    : lane === 2
      ? horizontal
        ? `<path d="M0 3H${size}" stroke="#d9ad33" stroke-width="3" stroke-dasharray="18 13"/>`
        : `<path d="M3 0V${size}" stroke="#d9ad33" stroke-width="3" stroke-dasharray="18 13"/>`
      : '';
  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#30363a"/>
      <path d="M0 13H${size}M0 43H${size}" stroke="#3a4247" stroke-width="2" opacity=".8"/>
      <path d="M11 0V${size}M47 0V${size}" stroke="#252a2d" stroke-width="1" opacity=".75"/>
      ${edge}${center}
    </svg>
  `;
}

function connectorTileIndex(
  connector: Connector,
  cell: {column: number; row: number}
): number {
  if (connector.orientation === 'horizontal') {
    return Math.max(0, Math.min(3, cell.row - connector.bounds.minY / BLOCK_SIZE));
  }
  return 4 + Math.max(0, Math.min(3, cell.column - connector.bounds.minX / BLOCK_SIZE));
}

function globalSurfaceId(source: SourceDistrict, surfaceId: string): string {
  const alias = connectors.find((connector) => connector.sourceAliases.some((candidate) => (
    candidate.districtId === source.id && candidate.surfaceId === surfaceId
  )));
  if (alias) return alias.surfaceId;
  return source.namespace ? `${source.namespace}:${surfaceId}` : surfaceId;
}

function globalOccluderId(source: SourceDistrict, occluderId: string): string {
  return source.namespace ? `${source.namespace}:${occluderId}` : occluderId;
}

function translateOccluder(
  source: SourceDistrict,
  occluder: WorldGeometryOccluderDefinition
): WorldGeometryOccluderDefinition {
  const offsetX = source.offsetColumn * BLOCK_SIZE;
  const offsetY = source.offsetRow * BLOCK_SIZE;
  return {
    ...occluder,
    id: globalOccluderId(source, occluder.id),
    bounds: {
      ...occluder.bounds,
      minX: occluder.bounds.minX + offsetX,
      maxX: occluder.bounds.maxX + offsetX,
      minY: occluder.bounds.minY + offsetY,
      maxY: occluder.bounds.maxY + offsetY
    },
    exteriorDoor: {
      x: occluder.exteriorDoor.x + offsetX,
      y: occluder.exteriorDoor.y + offsetY
    }
  };
}

function translateTriangle(
  triangle: SurfaceTriangle,
  offsetColumn: number,
  offsetRow: number
): SurfaceTriangle {
  return {
    a: translateSurfacePoint(triangle.a, offsetColumn, offsetRow),
    b: translateSurfacePoint(triangle.b, offsetColumn, offsetRow),
    c: translateSurfacePoint(triangle.c, offsetColumn, offsetRow)
  };
}

function translateSurfacePoint(
  point: SurfacePoint,
  offsetColumn: number,
  offsetRow: number
): SurfacePoint {
  return {
    x: point.x + offsetColumn * BLOCK_SIZE,
    y: point.y + offsetRow * BLOCK_SIZE,
    z: point.z
  };
}

function translatePoint2d(
  point: Readonly<{x: number; y: number}>,
  offsetColumn: number,
  offsetRow: number
): {x: number; y: number} {
  return {
    x: point.x + offsetColumn * BLOCK_SIZE,
    y: point.y + offsetRow * BLOCK_SIZE
  };
}

function rectangleTriangles(
  bounds: Connector['bounds'],
  z: number
): SurfaceTriangle[] {
  const topLeft = {x: bounds.minX, y: bounds.minY, z};
  const topRight = {x: bounds.maxX, y: bounds.minY, z};
  const bottomLeft = {x: bounds.minX, y: bounds.maxY, z};
  const bottomRight = {x: bounds.maxX, y: bounds.maxY, z};
  return [
    {a: topLeft, b: topRight, c: bottomLeft},
    {a: topRight, b: bottomRight, c: bottomLeft}
  ];
}

function copyGrid(
  source: readonly number[],
  sourceWidth: number,
  sourceHeight: number,
  target: number[],
  targetWidth: number,
  offsetColumn: number,
  offsetRow: number
): void {
  for (let row = 0; row < sourceHeight; row++) {
    const sourceStart = row * sourceWidth;
    const targetStart = (row + offsetRow) * targetWidth + offsetColumn;
    for (let column = 0; column < sourceWidth; column++) {
      target[targetStart + column] = source[sourceStart + column];
    }
  }
}

function mostCommonRoadTile(source: SourceDistrict): number {
  const ground = source.map.layers.find(({name}) => name === 'ground')!.data;
  const roads = source.map.layers.find(({name}) => name === 'roads')!.data;
  const counts = new Map<number, number>();
  for (let index = 0; index < roads.length; index++) {
    if (!roads[index]) continue;
    const tile = Math.max(0, ground[index] - 1);
    counts.set(tile, (counts.get(tile) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0;
}

function rectangleCells(
  minColumn: number,
  minRow: number,
  maxColumn: number,
  maxRow: number
) {
  const cells: Array<{column: number; row: number}> = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let column = minColumn; column <= maxColumn; column++) {
      cells.push({column, row});
    }
  }
  return cells;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), {recursive: true});
  await writeFile(path, `${JSON.stringify(value)}\n`);
}
