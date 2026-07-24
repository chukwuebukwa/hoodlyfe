import type {LevelEditorDocument, Point2D, SpawnKind} from './level-document.ts';

export type EditorTool =
  | 'select'
  | 'pan'
  | 'collision-paint'
  | 'collision-erase'
  | 'road-paint'
  | 'road-erase'
  | 'corridor'
  | 'junction'
  | 'spawn'
  | 'beacon'
  | 'roadblock';

export type EditorSelection =
  | {kind: 'spawn'; id: string}
  | {kind: 'beacon'; id: string; handle?: 'source' | 'target'}
  | {kind: 'corridor'; id: string; pointIndex?: number}
  | {kind: 'junction'; id: string}
  | {kind: 'roadblock'; id: string}
  | {kind: 'cell'; layer: 'collision' | 'roads'; index: number; tileX: number; tileY: number}
  | undefined;

export interface LayerVisibility {
  base: boolean;
  collision: boolean;
  roads: boolean;
  corridors: boolean;
  junctions: boolean;
  spawns: boolean;
  beacons: boolean;
  roadblocks: boolean;
  grid: boolean;
}

export interface PointerReadout {
  world: Point2D;
  tile: Point2D;
}

export interface ViewportReadout {
  zoom: number;
  visibleWorld: {minX: number; minY: number; maxX: number; maxY: number};
}

export interface EditorPreferences {
  layers: LayerVisibility;
  baseOpacity: number;
  overlayOpacity: number;
  snapSize: number;
  brushSize: number;
  spawnKind: SpawnKind;
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  layers: {
    base: true,
    collision: false,
    roads: false,
    corridors: true,
    junctions: true,
    spawns: true,
    beacons: true,
    roadblocks: true,
    grid: false
  },
  baseOpacity: 1,
  overlayOpacity: 0.72,
  snapSize: 8,
  brushSize: 1,
  spawnKind: 'player'
};

export function selectionKey(selection: EditorSelection): string {
  if (!selection) return '';
  if (selection.kind === 'cell') return `${selection.kind}:${selection.layer}:${selection.index}`;
  if (selection.kind === 'corridor' && selection.pointIndex !== undefined) {
    return `${selection.kind}:${selection.id}:${selection.pointIndex}`;
  }
  if (selection.kind === 'beacon' && selection.handle) {
    return `${selection.kind}:${selection.id}:${selection.handle}`;
  }
  return `${selection.kind}:${selection.id}`;
}

export function reconcileSelection(
  selection: EditorSelection,
  previous: LevelEditorDocument,
  next: LevelEditorDocument
): EditorSelection {
  if (!selection || selection.kind === 'cell') return selection;
  const previousItems = entityItems(previous, selection.kind);
  const nextItems = entityItems(next, selection.kind);
  if (nextItems.some((item) => item.id === selection.id)) return selection;
  const previousIndex = previousItems.findIndex((item) => item.id === selection.id);
  const replacement = nextItems[previousIndex];
  if (!replacement) return undefined;
  if (selection.kind === 'corridor') {
    return {kind: 'corridor', id: replacement.id, pointIndex: selection.pointIndex};
  }
  if (selection.kind === 'beacon') {
    return {kind: 'beacon', id: replacement.id, handle: selection.handle};
  }
  return {kind: selection.kind, id: replacement.id};
}

function entityItems(document: LevelEditorDocument, kind: Exclude<NonNullable<EditorSelection>['kind'], 'cell'>): Array<{id: string}> {
  if (kind === 'spawn') return document.spawns;
  if (kind === 'beacon') return document.beacons ?? [];
  if (kind === 'corridor') return document.lanes.corridors;
  if (kind === 'junction') return document.lanes.junctions;
  return document.lanes.roadblocks ?? [];
}
