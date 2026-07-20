import {ACTIVE_DISTRICT_ID} from '../../shared/content/district-catalog.ts';
import type {LevelEditorDocument} from '../../src/tools/level-editor/level-document.ts';
import {isLevelEditorDocument} from '../../src/tools/level-editor/level-document.ts';
import {
  playtestBlockingValidationIssues,
  validateLevelDocument
} from '../../src/tools/level-editor/level-validation.ts';
import {LaneGraph, LaneGraphValidationError} from '../game/traffic/lane-graph.ts';
import {CollisionMap} from '../world-map.ts';
import {
  documentRevision,
  readEditorPlaytestRevision
} from './editor-object-store.ts';
import {verifyPlaytestTicket} from './playtest-ticket.ts';

export interface PlaytestWorldOptions {
  assetSourceId?: string;
  revisionId?: string;
  playtestToken?: string;
}

export interface LoadedPlaytestWorld {
  assetSourceId: string;
  revisionId: string;
  document: LevelEditorDocument;
  world: CollisionMap;
  laneGraph: LaneGraph;
  warnings: string[];
}

export async function loadPlaytestWorld(options: PlaytestWorldOptions): Promise<LoadedPlaytestWorld> {
  const assetSourceId = requiredString(options.assetSourceId, 'asset source');
  const revisionId = requiredString(options.revisionId, 'revision');
  const playtestToken = requiredString(options.playtestToken, 'ticket');
  if (assetSourceId !== ACTIVE_DISTRICT_ID) {
    throw new Error(`Authoritative Play Draft currently supports the active ${ACTIVE_DISTRICT_ID.toUpperCase()} runtime only.`);
  }
  verifyPlaytestTicket(playtestToken, {assetSourceId, revision: revisionId});
  const document = await readEditorPlaytestRevision(assetSourceId, revisionId);
  if (!document || !isLevelEditorDocument(document)) throw new Error('Play Draft revision was not found.');
  if (documentRevision(document) !== revisionId) throw new Error('Play Draft revision content hash does not match its id.');
  if (document.map.origin.x !== 0 || document.map.origin.y !== 0) {
    throw new Error('The current runtime requires a zero-origin district map.');
  }
  const validation = validateLevelDocument(document);
  if (playtestBlockingValidationIssues(validation).length > 0) {
    throw new Error('Play Draft revision no longer passes blocking validation.');
  }
  return compilePlaytestWorld(assetSourceId, revisionId, document);
}

export function compilePlaytestWorld(
  assetSourceId: string,
  revisionId: string,
  document: LevelEditorDocument
): LoadedPlaytestWorld {
  const repositoryWorld = CollisionMap.load();
  if (
    repositoryWorld.width !== document.map.width ||
    repositoryWorld.height !== document.map.height ||
    repositoryWorld.tileWidth !== document.map.tileSize ||
    repositoryWorld.tileHeight !== document.map.tileSize
  ) throw new Error('Play Draft map contract does not match the active presentation assets.');
  const spawn = document.spawns.find((candidate) => candidate.kind === 'player' && candidate.enabled);
  if (!spawn) throw new Error('Play Draft has no enabled player spawn.');
  const world = new CollisionMap({
    width: document.map.width,
    height: document.map.height,
    tilewidth: document.map.tileSize,
    tileheight: document.map.tileSize,
    layers: [
      {name: 'collisions', data: [...document.layers.collision]},
      {name: 'roads', data: [...document.layers.roads]}
    ]
  }, {spawn: {x: spawn.x, y: spawn.y}}, repositoryWorld.surfaces);
  const warnings: string[] = [];
  let laneGraph: LaneGraph;
  try {
    laneGraph = LaneGraph.fromDocument(document.lanes, world);
  } catch (error) {
    if (!(error instanceof LaneGraphValidationError)) throw error;
    laneGraph = LaneGraph.load(world);
    warnings.push(
      `Authored lane graph was rejected; traffic is using repository lanes (${error.issues.length} issue${error.issues.length === 1 ? '' : 's'}).`
    );
  }
  return {assetSourceId, revisionId, document, world, laneGraph, warnings};
}

function requiredString(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Play Draft ${label} is required.`);
  return value;
}
