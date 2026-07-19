'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  createEditorHistory,
  documentCommand,
  executeCommand,
  redoCommand,
  undoCommand,
  type EditorCommand,
  type EditorHistory,
  type HistoryResult
} from '../../src/tools/level-editor/editor-history.ts';
import {
  assembleLevelDocument,
  createArtifactBundle,
  isLevelEditorBundle,
  isLevelEditorDocument,
  type DistrictMapMetadata,
  type LaneGraphDocument,
  type LevelEditorDocument,
  type SourceArtifacts,
  type TiledMapDocument
} from '../../src/tools/level-editor/level-document.ts';
import {clearLevelDraft, loadLevelDraft, saveLevelDraft} from '../../src/tools/level-editor/level-draft-store.ts';
import {
  DEFAULT_EDITOR_PREFERENCES,
  reconcileSelection,
  type EditorPreferences,
  type EditorSelection,
  type EditorTool,
  type PointerReadout,
  type ViewportReadout
} from '../../src/tools/level-editor/editor-ui.ts';
import {validateLevelDocument, type ValidationIssue} from '../../src/tools/level-editor/level-validation.ts';
import {LevelEditorCanvas, type CanvasViewCommand} from './LevelEditorCanvas';
import {LevelEditorInspector} from './LevelEditorInspector';
import {LevelEditorSidebar} from './LevelEditorSidebar';
import {LevelEditorStatusBar} from './LevelEditorStatusBar';
import {LevelEditorToolbar} from './LevelEditorToolbar';
import {LevelEditorValidationPanel} from './LevelEditorValidationPanel';

interface LoadedEditor {
  source: SourceArtifacts;
  sourceDocument: LevelEditorDocument;
  initialDocument: LevelEditorDocument;
  restoredAt?: string;
}

const EMPTY_POINTER: PointerReadout = {world: {x: 0, y: 0}, tile: {x: 0, y: 0}};
const EMPTY_VIEWPORT: ViewportReadout = {zoom: 0, visibleWorld: {minX: 0, minY: 0, maxX: 0, maxY: 0}};

export function LevelEditorApp() {
  const [loaded, setLoaded] = useState<LoadedEditor>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void loadEditor().then((result) => {
      if (!cancelled) setLoaded(result);
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, []);

  if (loadError) {
    return <main className="le-load-state is-error"><strong>Level editor unavailable</strong><p>{loadError}</p><button type="button" onClick={() => location.reload()}>Retry</button></main>;
  }
  if (!loaded) return <main className="le-load-state"><strong>Loading district source</strong><p>Map, collision, roads, lane graph, and spawns</p><i /></main>;
  return <LevelEditorWorkspace key={loaded.initialDocument.id} loaded={loaded} />;
}

function LevelEditorWorkspace({loaded}: {loaded: LoadedEditor}) {
  const [document, setDocument] = useState(loaded.initialDocument);
  const [history, setHistory] = useState<EditorHistory>(() => createEditorHistory());
  const [dirty, setDirty] = useState(Boolean(loaded.restoredAt));
  const [selection, setSelection] = useState<EditorSelection>();
  const [tool, setTool] = useState<EditorTool>('select');
  const [preferences, setPreferences] = useState<EditorPreferences>(DEFAULT_EDITOR_PREFERENCES);
  const [pointer, setPointer] = useState(EMPTY_POINTER);
  const [viewport, setViewport] = useState(EMPTY_VIEWPORT);
  const [viewCommand, setViewCommand] = useState<CanvasViewCommand>({id: 0, type: 'fit'});
  const [validationOpen, setValidationOpen] = useState(false);
  const [status, setStatus] = useState(loaded.restoredAt ? `Restored autosave from ${formatTime(loaded.restoredAt)}.` : 'Repository source loaded.');
  const [autosaveLabel, setAutosaveLabel] = useState(loaded.restoredAt ? `Restored ${formatTime(loaded.restoredAt)}` : 'Autosave ready');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef(document);
  const historyRef = useRef(history);
  documentRef.current = document;
  historyRef.current = history;
  const report = useMemo(() => validateLevelDocument(document), [document]);

  const applyHistoryResult = useCallback((result: HistoryResult, message?: string): void => {
    documentRef.current = result.document;
    historyRef.current = result.history;
    setDocument(result.document);
    setHistory(result.history);
    setDirty(true);
    if (message ?? result.label) setStatus(message ?? `${result.label}.`);
  }, []);

  const onExecute = useCallback((command: EditorCommand): void => {
    applyHistoryResult(executeCommand(documentRef.current, historyRef.current, command));
  }, [applyHistoryResult]);

  const onCommit = useCallback((label: string, update: (current: LevelEditorDocument) => LevelEditorDocument): void => {
    const before = documentRef.current;
    const after = update(before);
    if (after !== before) onExecute(documentCommand(label, before, after));
  }, [onExecute]);

  const onUndo = useCallback((): void => {
    const previous = documentRef.current;
    const result = undoCommand(previous, historyRef.current);
    if (result.label) {
      applyHistoryResult(result, `Undid ${result.label}.`);
      setSelection((current) => reconcileSelection(current, previous, result.document));
    }
  }, [applyHistoryResult]);

  const onRedo = useCallback((): void => {
    const previous = documentRef.current;
    const result = redoCommand(previous, historyRef.current);
    if (result.label) {
      applyHistoryResult(result, `Redid ${result.label}.`);
      setSelection((current) => reconcileSelection(current, previous, result.document));
    }
  }, [applyHistoryResult]);

  useEffect(() => {
    if (!dirty) return;
    setAutosaveLabel('Saving draft...');
    const timer = window.setTimeout(() => {
      void saveLevelDraft(document).then((savedAt) => setAutosaveLabel(`Saved ${formatTime(savedAt)}`)).catch((error: unknown) => {
        setAutosaveLabel('Autosave failed');
        setStatus(error instanceof Error ? error.message : String(error));
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [document, dirty]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isFormTarget(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) onRedo(); else onUndo();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'f') requestView('fit');
      if (key === 'v') setTool('select');
      if (key === 'h') setTool('pan');
      if (key === 'b') setTool(event.shiftKey ? 'collision-erase' : 'collision-paint');
      if (key === 'r') setTool(event.shiftKey ? 'road-erase' : 'road-paint');
      if (key === 'c') setTool('corridor');
      if (key === 'j') setTool('junction');
      if (key === 's' && !command) setTool('spawn');
      if (key === 'k') setTool('roadblock');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRedo, onUndo]);

  function requestView(type: CanvasViewCommand['type'], point?: CanvasViewCommand['point']): void {
    setViewCommand((current) => ({id: current.id + 1, type, point}));
  }

  function onDelete(): void {
    const selected = selection;
    if (!selected || selected.kind === 'cell') return;
    onCommit(`Delete ${selected.kind}`, (before) => deleteSelection(before, selected));
    setSelection(undefined);
  }

  function onReset(): void {
    if (dirty && !window.confirm('Reset every editor change back to the current repository source?')) return;
    const before = documentRef.current;
    const after = structuredClone(loaded.sourceDocument);
    applyHistoryResult(executeCommand(before, historyRef.current, documentCommand('Reset to source', before, after)), 'Reset to repository source.');
    void clearLevelDraft(after.id);
    setSelection(undefined);
  }

  function onValidate(): void {
    setValidationOpen(true);
    setStatus(report.issues.length === 0 ? 'Validation passed.' : `Validation found ${report.issues.length} issue${report.issues.length === 1 ? '' : 's'}.`);
  }

  function onSelectIssue(issue: ValidationIssue): void {
    if (issue.entityId) {
      if (issue.entityKind === 'spawn') setSelection({kind: 'spawn', id: issue.entityId});
      if (issue.entityKind === 'corridor') setSelection({kind: 'corridor', id: issue.entityId});
      if (issue.entityKind === 'junction') setSelection({kind: 'junction', id: issue.entityId});
      if (issue.entityKind === 'roadblock') setSelection({kind: 'roadblock', id: issue.entityId});
    }
    if (issue.point) requestView('focus', issue.point);
  }

  function onExportProject(): void {
    downloadJson(`${document.id}.level.json`, document);
    setStatus('Downloaded editable level project.');
  }

  function onExportBundle(): void {
    const currentReport = validateLevelDocument(document);
    if (currentReport.counts.error > 0 && !window.confirm(`Export with ${currentReport.counts.error} validation error${currentReport.counts.error === 1 ? '' : 's'}?`)) {
      setValidationOpen(true);
      return;
    }
    downloadJson(`${document.id}.game-bundle.json`, createArtifactBundle(document, loaded.source));
    setStatus('Downloaded game artifact bundle. Apply it with npm run level:apply.');
  }

  async function onImportFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = isLevelEditorBundle(parsed) ? parsed.editorDocument : isLevelEditorDocument(parsed) ? parsed : undefined;
      if (!imported) throw new Error('File is not a supported NOCK0 level project or game bundle.');
      if (
        imported.map.width !== loaded.sourceDocument.map.width ||
        imported.map.height !== loaded.sourceDocument.map.height ||
        imported.map.tileSize !== loaded.sourceDocument.map.tileSize
      ) throw new Error('Imported level dimensions do not match the current district source.');
      onExecute(documentCommand(`Import ${file.name}`, documentRef.current, structuredClone(imported)));
      setSelection(undefined);
      setStatus(`Imported ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <main id="level-editor">
      <LevelEditorToolbar
        title={document.title}
        dirty={dirty}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        autosaveLabel={autosaveLabel}
        issueCount={report.issues.length}
        onUndo={onUndo}
        onRedo={onRedo}
        onFit={() => requestView('fit')}
        onActual={() => requestView('actual')}
        onZoomIn={() => requestView('zoom-in')}
        onZoomOut={() => requestView('zoom-out')}
        onValidate={onValidate}
        onImport={() => importInputRef.current?.click()}
        onExportProject={onExportProject}
        onExportBundle={onExportBundle}
        onReset={onReset}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onToggleInspector={() => setInspectorOpen((value) => !value)}
      />
      <input ref={importInputRef} className="le-file-input" type="file" accept="application/json,.json" onChange={(event) => void onImportFile(event.target.files?.[0])} />
      <LevelEditorSidebar
        document={document}
        tool={tool}
        selection={selection}
        preferences={preferences}
        open={sidebarOpen}
        onToolChange={setTool}
        onSelectionChange={(next) => { setSelection(next); if (next && next.kind !== 'cell') setInspectorOpen(true); }}
        onPreferencesChange={setPreferences}
      />
      <section className="le-stage">
        <LevelEditorCanvas
          document={document}
          tool={tool}
          selection={selection}
          preferences={preferences}
          viewCommand={viewCommand}
          onExecute={onExecute}
          onSelectionChange={setSelection}
          onPointerChange={setPointer}
          onViewportChange={setViewport}
          onStatus={setStatus}
        />
        <div className="le-stage__badge"><strong>{tool.replaceAll('-', ' ')}</strong><span>{document.map.width} x {document.map.height} tiles</span></div>
      </section>
      <LevelEditorInspector
        document={document}
        selection={selection}
        open={inspectorOpen}
        onCommit={onCommit}
        onSelectionChange={setSelection}
        onDelete={onDelete}
      />
      <LevelEditorValidationPanel report={report} open={validationOpen} onOpenChange={setValidationOpen} onSelectIssue={onSelectIssue} />
      <LevelEditorStatusBar status={status} pointer={pointer} viewport={viewport} />
      {(sidebarOpen || inspectorOpen) && <button className="le-mobile-scrim le-mobile-only" type="button" aria-label="Close panels" onClick={() => { setSidebarOpen(false); setInspectorOpen(false); }} />}
    </main>
  );
}

async function loadEditor(): Promise<LoadedEditor> {
  const [map, metadata, lanes] = await Promise.all([
    fetchJson<TiledMapDocument>('/assets/maps/district-map.json'),
    fetchJson<DistrictMapMetadata>('/assets/maps/district-map.metadata.json'),
    fetchJson<LaneGraphDocument>('/assets/maps/district-lanes.json')
  ]);
  const source = {map, metadata};
  const sourceDocument = assembleLevelDocument(map, metadata, lanes);
  const draft = await loadLevelDraft(sourceDocument).catch(() => undefined);
  return {
    source,
    sourceDocument,
    initialDocument: draft?.document ?? sourceDocument,
    restoredAt: draft?.savedAt
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function deleteSelection(document: LevelEditorDocument, selection: Exclude<EditorSelection, undefined>): LevelEditorDocument {
  if (selection.kind === 'cell') return document;
  if (selection.kind === 'spawn') return {...document, spawns: document.spawns.filter((spawn) => spawn.id !== selection.id)};
  if (selection.kind === 'junction') return {...document, lanes: {...document.lanes, junctions: document.lanes.junctions.filter((junction) => junction.id !== selection.id)}};
  if (selection.kind === 'roadblock') return {...document, lanes: {...document.lanes, roadblocks: (document.lanes.roadblocks ?? []).filter((roadblock) => roadblock.id !== selection.id)}};
  return {
    ...document,
    lanes: {
      ...document.lanes,
      corridors: document.lanes.corridors.filter((corridor) => corridor.id !== selection.id),
      junctions: document.lanes.junctions.map((junction) => ({...junction, corridors: junction.corridors.filter((id) => id !== selection.id)}))
    }
  };
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(value));
}

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
