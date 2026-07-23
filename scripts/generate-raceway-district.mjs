import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceMaps = join(root, 'public', 'assets', 'maps');
const targetRoot = join(root, 'public', 'assets', 'districts', 'raceway');
const targetMaps = join(targetRoot, 'maps');
const origin = {x: 96, y: 96};
const size = 64;
const chunkSize = 8;
const blockSize = 64;
const pixelOrigin = {x: origin.x * blockSize, y: origin.y * blockSize};
const pixelSize = size * blockSize;

rmSync(targetRoot, {recursive: true, force: true});
mkdirSync(join(targetMaps, 'geometry', 'chunks'), {recursive: true});

const map = readJson(join(sourceMaps, 'district-map.json'));
const croppedMap = {
  ...map,
  width: size,
  height: size,
  nextlayerid: map.layers.length + 1,
  layers: map.layers.map((layer) => ({
    ...layer,
    width: size,
    height: size,
    data: cropGrid(layer.data, map.width, origin.x, origin.y, size, size)
  }))
};
writeJson(join(targetMaps, 'district-map.json'), croppedMap);
writeJson(join(targetMaps, 'district-map.metadata.json'), {
  spawn: {x: 1_312, y: 3_616}
});
cpSync(join(sourceMaps, 'district-tiles.png'), join(targetMaps, 'district-tiles.png'));

writeJson(join(targetMaps, 'surface-manifest.json'), flatSurfaceManifest());

const sourceGeometryRoot = join(sourceMaps, 'geometry');
const sourceWorld = readJson(join(sourceGeometryRoot, 'world.json'));
const selectedChunks = [];
let triangleCount = 0;
for (const descriptor of sourceWorld.chunks) {
  if (
    descriptor.column < origin.x / chunkSize ||
    descriptor.row < origin.y / chunkSize ||
    descriptor.column >= origin.x / chunkSize + size / chunkSize ||
    descriptor.row >= origin.y / chunkSize + size / chunkSize
  ) continue;
  const column = descriptor.column - origin.x / chunkSize;
  const row = descriptor.row - origin.y / chunkSize;
  const file = `chunks/${column}-${row}.json`;
  const payload = readJson(join(sourceGeometryRoot, descriptor.file));
  const nextPayload = {
    ...payload,
    column,
    row,
    x: payload.x - origin.x,
    y: payload.y - origin.y
  };
  writeJson(join(targetMaps, 'geometry', file), nextPayload);
  const nextDescriptor = {
    ...descriptor,
    id: `${column}:${row}`,
    column,
    row,
    x: descriptor.x - origin.x,
    y: descriptor.y - origin.y,
    file
  };
  selectedChunks.push(nextDescriptor);
  triangleCount += descriptor.triangleCount;
}

const selectedOccluders = sourceWorld.occluders
  .filter((definition) => boundsIntersectCrop(definition.bounds))
  .map((definition) => ({
    ...definition,
    bounds: {
      ...definition.bounds,
      minX: definition.bounds.minX - origin.x,
      maxX: definition.bounds.maxX - origin.x,
      minY: definition.bounds.minY - origin.y,
      maxY: definition.bounds.maxY - origin.y
    },
    exteriorDoor: {
      x: definition.exteriorDoor.x - origin.x,
      y: definition.exteriorDoor.y - origin.y
    }
  }));

writeJson(join(targetMaps, 'geometry', 'world.json'), {
  ...sourceWorld,
  revision: `${sourceWorld.revision}:raceway-96-96-64`,
  source: 'raceway/district-map.json',
  origin: {x: 0, y: 0},
  size: {width: size, height: size},
  surfaces: {
    width: size,
    height: size,
    values: cropGrid(
      sourceWorld.surfaces.values,
      sourceWorld.surfaces.width,
      origin.x,
      origin.y,
      size,
      size
    )
  },
  occluders: selectedOccluders,
  chunks: selectedChunks,
  triangleCount
});
cpSync(join(sourceGeometryRoot, 'tiles.png'), join(targetMaps, 'geometry', 'tiles.png'));

writeJson(join(targetMaps, 'district-lanes.json'), raceLaneGraph());

const crop = spawnSync('sips', [
  '-c', '1024', '1024',
  '--cropOffset', '1536', '1536',
  join(sourceMaps, 'district-preview.png'),
  '--out', join(targetMaps, 'district-preview.png')
], {encoding: 'utf8'});
if (crop.status !== 0) {
  throw new Error(`Could not crop race minimap: ${crop.stderr || crop.stdout}`);
}

console.log(`Generated raceway district: ${selectedChunks.length} chunks, ${triangleCount} triangles.`);

function raceLaneGraph() {
  const points = [
    {x: 1_312, y: 3_488},
    {x: 1_312, y: 1_440},
    {x: 160, y: 1_440},
    {x: 160, y: 544},
    {x: 2_336, y: 544},
    {x: 2_336, y: 3_488}
  ];
  const corridors = points.map((point, index) => ({
    id: `circuit-${index + 1}`,
    speedLimit: 380,
    direction: 'forward',
    lanesPerDirection: 1,
    roadClass: 'arterial',
    trafficDensity: 0,
    points: [point, points[(index + 1) % points.length]]
  }));
  const junctions = points.map((point, index) => ({
    id: `turn-${index + 1}`,
    ...point,
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
    laneOffset: 18,
    laneSpacing: 36,
    allowTerminalTurnarounds: true,
    corridors,
    junctions,
    roadblocks: []
  };
}

function cropGrid(values, width, startX, startY, cropWidth, cropHeight) {
  return Array.from({length: cropHeight}, (_, row) => (
    values.slice(
      (startY + row) * width + startX,
      (startY + row) * width + startX + cropWidth
    )
  )).flat();
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
      spaceId: 'street',
      actorKinds: ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'],
      triangles: [
        {a: point(0, 0), b: point(pixelSize, 0), c: point(pixelSize, pixelSize)},
        {a: point(0, 0), b: point(pixelSize, pixelSize), c: point(0, pixelSize)}
      ]
    }],
    transitions: []
  };
}

function boundsIntersectCrop(bounds) {
  return !(
    bounds.maxX < origin.x ||
    bounds.maxY < origin.y ||
    bounds.minX > origin.x + size ||
    bounds.minY > origin.y + size
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}
