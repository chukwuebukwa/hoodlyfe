import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const sourceMaps = join(root, 'public', 'assets', 'maps');
const targetRoot = join(root, 'public', 'assets', 'districts', 'raceway');
const targetMaps = join(targetRoot, 'maps');
const geometryRoot = join(targetMaps, 'geometry');

const size = 40;
const chunkSize = 8;
const blockSize = 64;
const pixelSize = size * blockSize;
const trackHalfWidth = 3.15;
const tileIds = Object.freeze({
  asphalt: 506,
  centerlineHorizontal: 503,
  centerlineVertical: 533,
  grass: 780,
  startLine: 798,
  barrier: 453
});

// Clockwise centerline. This is the single source for art, collision, lanes and race checkpoints.
const controlPoints = Object.freeze([
  {x: 20, y: 35},
  {x: 10, y: 34},
  {x: 5, y: 29},
  {x: 5, y: 22},
  {x: 10, y: 18},
  {x: 5, y: 13},
  {x: 7, y: 6},
  {x: 15, y: 4},
  {x: 25, y: 5},
  {x: 34, y: 9},
  {x: 35, y: 16},
  {x: 30, y: 20},
  {x: 35, y: 25},
  {x: 33, y: 32},
  {x: 27, y: 35}
]);
const centerline = sampleClosedCatmullRom(controlPoints, 12);
const roadMask = buildRoadMask(centerline);
const map = buildTiledMap(roadMask, centerline);

rmSync(targetRoot, {recursive: true, force: true});
mkdirSync(join(geometryRoot, 'chunks'), {recursive: true});

writeJson(join(targetMaps, 'district-map.json'), map);
writeJson(join(targetMaps, 'district-map.metadata.json'), {
  spawn: worldPoint(24, 35)
});
writeJson(join(targetMaps, 'surface-manifest.json'), flatSurfaceManifest());
writeJson(join(targetMaps, 'district-lanes.json'), raceLaneGraph());
cpSync(join(sourceMaps, 'district-tiles.png'), join(targetMaps, 'district-tiles.png'));
cpSync(join(sourceMaps, 'district-tiles.png'), join(geometryRoot, 'tiles.png'));

const geometry = generateGeometry(map, roadMask);
writeJson(join(geometryRoot, 'world.json'), geometry.manifest);
for (const chunk of geometry.chunks) {
  writeJson(join(geometryRoot, 'chunks', `${chunk.column}-${chunk.row}.json`), chunk);
}
await renderPreview(map.layers.find((layer) => layer.name === 'ground').data);

console.log(
  `Generated custom raceway: ${geometry.chunks.length} chunks, ` +
  `${geometry.manifest.triangleCount} triangles, ${roadMask.filter(Boolean).length} track tiles.`
);

function buildTiledMap(mask, sampledCenterline) {
  const source = readJson(join(sourceMaps, 'district-map.json'));
  const ground = new Array(size * size).fill(tileIds.grass);
  const collisions = new Array(size * size).fill(1);
  const roads = new Array(size * size).fill(0);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const index = row * size + column;
      if (!mask[index]) continue;
      ground[index] = tileIds.asphalt;
      collisions[index] = 0;
      roads[index] = 1;
    }
  }

  // Sparse painted centerline assists readability without turning the track into a city road.
  for (let index = 0; index < sampledCenterline.length; index += 8) {
    const point = sampledCenterline[index];
    const next = sampledCenterline[(index + 2) % sampledCenterline.length];
    const column = clamp(Math.round(point.x), 0, size - 1);
    const row = clamp(Math.round(point.y), 0, size - 1);
    const horizontal = Math.abs(next.x - point.x) >= Math.abs(next.y - point.y);
    ground[row * size + column] = horizontal
      ? tileIds.centerlineHorizontal
      : tileIds.centerlineVertical;
  }

  // The line crosses the full track width at the first checkpoint.
  for (let row = 31; row <= 39; row++) {
    if (mask[row * size + 20]) ground[row * size + 20] = tileIds.startLine;
  }

  return {
    ...source,
    width: size,
    height: size,
    nextlayerid: 4,
    layers: [
      tileLayer(1, 'ground', ground),
      tileLayer(2, 'collisions', collisions),
      tileLayer(3, 'roads', roads)
    ]
  };
}

function tileLayer(id, name, data) {
  return {
    id,
    name,
    type: 'tilelayer',
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    width: size,
    height: size,
    data
  };
}

function buildRoadMask(sampledCenterline) {
  const mask = new Array(size * size).fill(false);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const center = {x: column + 0.5, y: row + 0.5};
      mask[row * size + column] = sampledCenterline.some((point) => (
        Math.hypot(center.x - point.x, center.y - point.y) <= trackHalfWidth
      ));
    }
  }
  return mask;
}

function raceLaneGraph() {
  const corridors = controlPoints.map((point, index) => ({
    id: `circuit-${index + 1}`,
    speedLimit: 420,
    direction: 'forward',
    lanesPerDirection: 1,
    roadClass: 'arterial',
    trafficDensity: 0,
    points: [
      worldPoint(point.x, point.y),
      worldPoint(
        controlPoints[(index + 1) % controlPoints.length].x,
        controlPoints[(index + 1) % controlPoints.length].y
      )
    ]
  }));
  const junctions = controlPoints.map((point, index) => ({
    id: `turn-${index + 1}`,
    ...worldPoint(point.x, point.y),
    corridors: [
      corridors[(index + corridors.length - 1) % corridors.length].id,
      corridors[index].id
    ],
    allowedTurns: ['straight', 'left', 'right']
  }));
  return {
    schemaVersion: 2,
    districtId: 'industrial-arena-circuit',
    driveSide: 'right',
    laneOffset: 0,
    laneSpacing: 36,
    allowTerminalTurnarounds: false,
    corridors,
    junctions,
    roadblocks: []
  };
}

function generateGeometry(tiledMap, mask) {
  const ground = tiledMap.layers.find((layer) => layer.name === 'ground').data;
  const chunks = [];
  const descriptors = [];
  let totalTriangles = 0;
  for (let chunkRow = 0; chunkRow < size / chunkSize; chunkRow++) {
    for (let chunkColumn = 0; chunkColumn < size / chunkSize; chunkColumn++) {
      const vertices = [];
      const opaqueIndices = [];
      for (let localRow = 0; localRow < chunkSize; localRow++) {
        for (let localColumn = 0; localColumn < chunkSize; localColumn++) {
          const column = chunkColumn * chunkSize + localColumn;
          const row = chunkRow * chunkSize + localRow;
          addGroundQuad(
            vertices,
            opaqueIndices,
            localColumn,
            localRow,
            ground[row * size + column] - 1
          );
          if (!mask[row * size + column]) continue;
          addBoundaryWalls(vertices, opaqueIndices, mask, column, row, localColumn, localRow);
        }
      }
      const triangleCount = opaqueIndices.length / 3;
      const chunk = {
        version: 1,
        column: chunkColumn,
        row: chunkRow,
        x: chunkColumn * chunkSize,
        y: chunkRow * chunkSize,
        size: chunkSize,
        vertices,
        opaqueIndices,
        alphaTestedIndices: [],
        occluders: [],
        triangleCount
      };
      chunks.push(chunk);
      descriptors.push({
        id: `${chunkColumn}:${chunkRow}`,
        column: chunkColumn,
        row: chunkRow,
        x: chunk.x,
        y: chunk.y,
        size: chunkSize,
        file: `chunks/${chunkColumn}-${chunkRow}.json`,
        triangleCount
      });
      totalTriangles += triangleCount;
    }
  }
  return {
    chunks,
    manifest: {
      version: 1,
      revision: 'raceway-custom-circuit-v2',
      source: 'raceway/district-map.json',
      blockSize,
      origin: {x: 0, y: 0},
      size: {width: size, height: size},
      chunkSize,
      atlas: {
        image: 'tiles.png',
        columns: 16,
        rows: 172,
        tileSize: 64,
        tileCount: 2_747
      },
      surfaces: {
        width: size,
        height: size,
        values: new Array(size * size).fill(0)
      },
      occluders: [],
      chunks: descriptors,
      triangleCount: totalTriangles
    }
  };
}

function addGroundQuad(vertices, indices, x, y, tile) {
  const offset = vertices.length;
  vertices.push(
    vertex(x, y, 0, 0, 0, tile),
    vertex(x + 1, y, 0, 1, 0, tile),
    vertex(x, y + 1, 0, 0, 1, tile),
    vertex(x + 1, y + 1, 0, 1, 1, tile)
  );
  indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
}

function addBoundaryWalls(vertices, indices, mask, column, row, x, y) {
  const wallTile = tileIds.barrier - 1;
  const height = 0.42;
  if (!roadAt(mask, column, row - 1)) addWall(vertices, indices, x, y, x + 1, y, height, wallTile);
  if (!roadAt(mask, column + 1, row)) addWall(vertices, indices, x + 1, y, x + 1, y + 1, height, wallTile);
  if (!roadAt(mask, column, row + 1)) addWall(vertices, indices, x + 1, y + 1, x, y + 1, height, wallTile);
  if (!roadAt(mask, column - 1, row)) addWall(vertices, indices, x, y + 1, x, y, height, wallTile);
}

function addWall(vertices, indices, x1, y1, x2, y2, height, tile) {
  const offset = vertices.length;
  vertices.push(
    vertex(x1, y1, 0, 0, 1, tile),
    vertex(x2, y2, 0, 1, 1, tile),
    vertex(x1, y1, height, 0, 0, tile),
    vertex(x2, y2, height, 1, 0, tile)
  );
  indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
}

function vertex(x, y, z, u, v, tile) {
  return {x, y, z, u, v, tile, shade: 0};
}

function roadAt(mask, column, row) {
  return column >= 0 && row >= 0 && column < size && row < size && mask[row * size + column];
}

async function renderPreview(ground) {
  const previewTileSize = 16;
  const tileCache = new Map();
  const composites = [];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const id = ground[row * size + column];
      let tile = tileCache.get(id);
      if (!tile) {
        const atlasIndex = id - 1;
        tile = await sharp(join(sourceMaps, 'district-tiles.png'))
          .extract({
            left: atlasIndex % 16 * blockSize,
            top: Math.floor(atlasIndex / 16) * blockSize,
            width: blockSize,
            height: blockSize
          })
          .resize(previewTileSize, previewTileSize, {kernel: 'nearest'})
          .png()
          .toBuffer();
        tileCache.set(id, tile);
      }
      composites.push({
        input: tile,
        left: column * previewTileSize,
        top: row * previewTileSize
      });
    }
  }
  await sharp({
    create: {
      width: size * previewTileSize,
      height: size * previewTileSize,
      channels: 4,
      background: '#243529'
    }
  }).composite(composites).png().toFile(join(targetMaps, 'district-preview.png'));
}

function sampleClosedCatmullRom(points, samplesPerSegment) {
  const sampled = [];
  for (let index = 0; index < points.length; index++) {
    const p0 = points[(index - 1 + points.length) % points.length];
    const p1 = points[index];
    const p2 = points[(index + 1) % points.length];
    const p3 = points[(index + 2) % points.length];
    for (let sample = 0; sample < samplesPerSegment; sample++) {
      const t = sample / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      sampled.push({
        x: 0.5 * (
          2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        ),
        y: 0.5 * (
          2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        )
      });
    }
  }
  return sampled;
}

function worldPoint(x, y) {
  return {x: x * blockSize + blockSize / 2, y: y * blockSize + blockSize / 2};
}

function flatSurfaceManifest() {
  const point = (x, y) => ({x, y, z: 0});
  return {
    version: 1,
    collisionRevision: 2,
    blockSize,
    defaultSurfaceId: 'street-ground',
    surfaces: [{
      id: 'street-ground',
      spaceId: 'raceway',
      actorKinds: ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'],
      triangles: [
        {a: point(0, 0), b: point(pixelSize, 0), c: point(pixelSize, pixelSize)},
        {a: point(0, 0), b: point(pixelSize, pixelSize), c: point(0, pixelSize)}
      ]
    }],
    transitions: []
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
