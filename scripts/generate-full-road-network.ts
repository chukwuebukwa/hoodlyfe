import {readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LaneGraph} from '../server/game/traffic/lane-graph.ts';
import {CollisionMap} from '../server/world-map.ts';
import {
  assembleLevelDocument,
  type DistrictMapMetadata,
  type LaneGraphDocument,
  type TiledMapDocument
} from '../src/tools/level-editor/level-document.ts';
import {generateRoadNetwork} from '../src/tools/level-editor/road-network-generator.ts';
import {validateLevelDocument} from '../src/tools/level-editor/level-validation.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = resolve(projectRoot, 'public/assets/maps/district-map.json');
const metadataPath = resolve(projectRoot, 'public/assets/maps/district-map.metadata.json');
const lanesPath = resolve(projectRoot, 'public/assets/maps/district-lanes.json');
const roadblockSitesPath = resolve(projectRoot, 'public/assets/maps/district-roadblock-sites.json');

const [map, metadata, lanes, roadblocks] = await Promise.all([
  readJson<TiledMapDocument>(mapPath),
  readJson<DistrictMapMetadata>(metadataPath),
  readJson<LaneGraphDocument>(lanesPath),
  readJson<NonNullable<LaneGraphDocument['roadblocks']>>(roadblockSitesPath)
]);
const document = assembleLevelDocument(map, metadata, lanes);
const generated = generateRoadNetwork(document, {roadblocks});
const generatedDocument = {...document, lanes: generated.lanes};
const report = validateLevelDocument(generatedDocument);
if (report.counts.error > 0) {
  throw new Error(report.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join('\n'));
}

const graph = LaneGraph.fromDocument(generated.lanes, CollisionMap.load());
if (graph.nodes().some((node) => graph.outgoing(node.id).length === 0)) {
  throw new Error('Generated lane graph contains a terminal node without an outgoing edge.');
}

const temporaryPath = `${lanesPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryPath, `${JSON.stringify(generated.lanes, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, lanesPath);
} finally {
  await rm(temporaryPath, {force: true});
}

console.log([
  `Generated ${generated.stats.corridors} corridors and ${generated.stats.junctions} junctions.`,
  `Covered ${generated.stats.retainedRoadCells}/${generated.stats.sourceRoadCells} authored road cells.`,
  `Compiled ${graph.nodes().length} lane nodes and ${graph.edges().length} directed edges.`,
  `Wrote ${lanesPath}.`
].join('\n'));

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
