import type {EditableTileLayer, LevelEditorDocument} from './level-document.ts';

export interface CellChange {
  index: number;
  before: number;
  after: number;
}

export interface EditorCommand {
  label: string;
  apply(document: LevelEditorDocument): LevelEditorDocument;
  revert(document: LevelEditorDocument): LevelEditorDocument;
}

export interface EditorHistory {
  past: EditorCommand[];
  future: EditorCommand[];
  limit: number;
}

export interface HistoryResult {
  document: LevelEditorDocument;
  history: EditorHistory;
  label?: string;
}

export function createEditorHistory(limit = 100): EditorHistory {
  return {past: [], future: [], limit};
}

export function executeCommand(
  document: LevelEditorDocument,
  history: EditorHistory,
  command: EditorCommand
): HistoryResult {
  return {
    document: command.apply(document),
    history: {
      ...history,
      past: [...history.past, command].slice(-history.limit),
      future: []
    },
    label: command.label
  };
}

export function recordAppliedCommand(history: EditorHistory, command: EditorCommand): EditorHistory {
  return {
    ...history,
    past: [...history.past, command].slice(-history.limit),
    future: []
  };
}

export function undoCommand(document: LevelEditorDocument, history: EditorHistory): HistoryResult {
  const command = history.past.at(-1);
  if (!command) return {document, history};
  return {
    document: command.revert(document),
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [command, ...history.future]
    },
    label: command.label
  };
}

export function redoCommand(document: LevelEditorDocument, history: EditorHistory): HistoryResult {
  const command = history.future[0];
  if (!command) return {document, history};
  return {
    document: command.apply(document),
    history: {
      ...history,
      past: [...history.past, command].slice(-history.limit),
      future: history.future.slice(1)
    },
    label: command.label
  };
}

export function cellPatchCommand(
  label: string,
  layer: EditableTileLayer,
  changes: readonly CellChange[]
): EditorCommand {
  const normalized = compactChanges(changes);
  return {
    label,
    apply: (document) => patchCells(document, layer, normalized, 'after'),
    revert: (document) => patchCells(document, layer, normalized, 'before')
  };
}

export function documentCommand(
  label: string,
  before: LevelEditorDocument,
  after: LevelEditorDocument
): EditorCommand {
  return {
    label,
    apply: () => after,
    revert: () => before
  };
}

function patchCells(
  document: LevelEditorDocument,
  layer: EditableTileLayer,
  changes: readonly CellChange[],
  value: 'before' | 'after'
): LevelEditorDocument {
  if (changes.length === 0) return document;
  const data = [...document.layers[layer]];
  for (const change of changes) data[change.index] = change[value];
  return {...document, layers: {...document.layers, [layer]: data}};
}

function compactChanges(changes: readonly CellChange[]): CellChange[] {
  const byIndex = new Map<number, CellChange>();
  for (const change of changes) {
    const previous = byIndex.get(change.index);
    byIndex.set(change.index, {
      index: change.index,
      before: previous?.before ?? change.before,
      after: change.after
    });
  }
  return [...byIndex.values()].filter((change) => change.before !== change.after);
}
