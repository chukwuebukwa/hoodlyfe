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
import type {EditorPlaytestResponse} from '../../shared/content/editor-production.ts';
import {clearLevelDraft, loadLevelDraft, saveLevelDraft} from '../../src/tools/level-editor/level-draft-store.ts';
import {createLocalPlaytestRevision} from '../../src/tools/level-editor/playtest-revision.ts';
import {saveLocalPlaytestRevision} from '../../src/tools/level-editor/playtest-revision-store.ts';
import {
  repairJunctionIntersections,
  synchronizeJunctionIntersections
} from '../../src/tools/level-editor/lane-authoring-geometry.ts';
import {generateRoadNetwork} from '../../src/tools/level-editor/road-network-generator.ts';
import {
  DEFAULT_EDITOR_PREFERENCES,
  reconcileSelection,
  type EditorPreferences,
  type EditorSelection,
  type EditorTool,
  type PointerReadout,
  type ViewportReadout
} from '../../src/tools/level-editor/editor-ui.ts';
import {
  playtestBlockingValidationIssues,
  validateLevelDocument,
  withRuntimeLaneIssues,
  type ValidationIssue
} from '../../src/tools/level-editor/level-validation.ts';
import type {CompiledLaneEdgeDiagnostic} from '../../src/tools/level-editor/compiled-lane-diagnostic.ts';
import {LevelEditorCanvas, type CanvasViewCommand} from './LevelEditorCanvas';
import {LevelEditorInspector} from './LevelEditorInspector';
import {LevelEditorSidebar} from './LevelEditorSidebar';
import {LevelEditorStatusBar} from './LevelEditorStatusBar';
import {LevelEditorToolbar} from './LevelEditorToolbar';
import {LevelEditorValidationPanel} from './LevelEditorValidationPanel';
import {
  DISTRICT_CATALOG,
  districtDefinition,
  districtMapAsset,
  type DistrictDefinition
} from '../../shared/content/district-catalog.ts';

interface LoadedEditor {
  district: DistrictDefinition;
  availableDistricts: DistrictDefinition[];
  previewUrl: string;
  authoredLanes: boolean;
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
  const [status, setStatus] = useState(loaded.restoredAt
    ? `Restored autosave from ${formatTime(loaded.restoredAt)}.`
    : loaded.authoredLanes ? 'Repository source loaded.' : 'District loaded with an empty lane graph.');
  const [autosaveLabel, setAutosaveLabel] = useState(loaded.restoredAt ? `Restored ${formatTime(loaded.restoredAt)}` : 'Autosave ready');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [playDraftBusy, setPlayDraftBusy] = useState(false);
  const [lastPlayDraftUrl, setLastPlayDraftUrl] = useState<string>();
  const [runtimeLaneIssues, setRuntimeLaneIssues] = useState<readonly string[]>([]);
  const [highlightedLaneEdge, setHighlightedLaneEdge] = useState<CompiledLaneEdgeDiagnostic>();
  const importInputRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef(document);
  const historyRef = useRef(history);
  documentRef.current = document;
  historyRef.current = history;
  const structuralReport = useMemo(() => validateLevelDocument(document), [document]);
  const report = useMemo(
    () => withRuntimeLaneIssues(structuralReport, document, runtimeLaneIssues),
    [document, runtimeLaneIssues, structuralReport]
  );

  const applyHistoryResult = useCallback((result: HistoryResult, message?: string): void => {
    documentRef.current = result.document;
    historyRef.current = result.history;
    setDocument(result.document);
    setHistory(result.history);
    setDirty(true);
    setRuntimeLaneIssues([]);
    setHighlightedLaneEdge(undefined);
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
    setHighlightedLaneEdge(issue.compiledLaneEdge);
    if (issue.entityId) {
      if (issue.entityKind === 'spawn') setSelection({kind: 'spawn', id: issue.entityId});
      if (issue.entityKind === 'corridor') setSelection({kind: 'corridor', id: issue.entityId});
      if (issue.entityKind === 'junction') setSelection({kind: 'junction', id: issue.entityId});
      if (issue.entityKind === 'roadblock') setSelection({kind: 'roadblock', id: issue.entityId});
    }
    if (issue.point) requestView('focus', issue.point);
  }

  function onRepairJunctions(): void {
    const before = documentRef.current;
    const result = synchronizeJunctionIntersections(before.lanes.corridors, before.lanes.junctions);
    if (result.repaired === 0 && result.removed === 0 && result.added === 0) {
      setStatus(result.unresolved > 0
        ? `${result.unresolved} junction${result.unresolved === 1 ? '' : 's'} could not be repaired because their corridors do not intersect.`
        : 'Every corridor crossing already has a valid junction.');
      return;
    }
    const after = {...before, lanes: {...before.lanes, junctions: result.junctions}};
    onExecute(documentCommand('Synchronize lane junctions', before, after));
    const changes = [
      result.added > 0 ? `added ${result.added} missing` : '',
      result.repaired > 0 ? `repaired ${result.repaired}` : '',
      result.removed > 0 ? `removed ${result.removed} stale` : ''
    ].filter(Boolean).join(' and ');
    const changedCount = result.added + result.repaired + result.removed;
    setStatus(`${changes[0].toUpperCase()}${changes.slice(1)} junction${changedCount === 1 ? '' : 's'}${result.unresolved > 0 ? `; ${result.unresolved} remain unresolved` : ''}.`);
  }

  function onGenerateRoadNetwork(): void {
    const before = documentRef.current;
    const generated = generateRoadNetwork(before);
    const removedRoadblocks = before.lanes.roadblocks?.length ?? 0;
    const summary = [
      `Generate ${generated.stats.corridors} corridors and ${generated.stats.junctions} junctions from the complete road-cell layer?`,
      `Classification: ${Object.entries(generated.stats.roadClasses).map(([roadClass, count]) => `${count} ${roadClass}`).join(', ')}.`,
      `${generated.stats.multiLaneCorridors} wide corridors carry two lanes per direction.`,
      `${generated.stats.clearanceConstrainedCorridors} narrow corridor${generated.stats.clearanceConstrainedCorridors === 1 ? '' : 's'} use reduced lane offsets to preserve the full vehicle envelope.`,
      `This replaces the current ${before.lanes.corridors.length} corridors and ${before.lanes.junctions.length} junctions.`,
      removedRoadblocks > 0 ? `${removedRoadblocks} roadblock definition${removedRoadblocks === 1 ? '' : 's'} will be cleared because their lane-edge references become stale.` : '',
      'The operation is undoable.'
    ].filter(Boolean).join('\n\n');
    if (!window.confirm(summary)) return;
    const after = {...before, lanes: generated.lanes};
    onExecute(documentCommand('Generate full road network', before, after));
    setSelection(undefined);
    setPreferences((current) => ({
      ...current,
      layers: {...current.layers, roads: true, corridors: true, junctions: true}
    }));
    setValidationOpen(false);
    requestView('fit');
    setStatus(`Generated ${generated.stats.corridors} classified corridors and ${generated.stats.junctions} junctions across ${generated.stats.retainedRoadCells.toLocaleString()} connected road cells; ${generated.stats.multiLaneCorridors} are multi-lane and ${generated.stats.clearanceConstrainedCorridors} required clearance fitting.`);
  }

  function onExportProject(): void {
    downloadJson(`${document.id}.level.json`, document);
    setStatus('Downloaded editable level project.');
  }

  function onExportBundle(): void {
    if (!loaded.district.activeRuntime) {
      setStatus('Apply-ready bundle export is disabled for non-runtime districts.');
      return;
    }
    const currentReport = validateLevelDocument(document);
    if (currentReport.counts.error > 0 && !window.confirm(`Export with ${currentReport.counts.error} validation error${currentReport.counts.error === 1 ? '' : 's'}?`)) {
      setValidationOpen(true);
      return;
    }
    downloadJson(`${document.id}.game-bundle.json`, createArtifactBundle(document, loaded.source));
    setStatus('Downloaded game artifact bundle. Apply it with npm run level:apply.');
  }

  async function onPlayDraft(): Promise<void> {
    const currentReport = validateLevelDocument(documentRef.current);
    const blockingErrors = playtestBlockingValidationIssues(currentReport);
    if (blockingErrors.length > 0) {
      setValidationOpen(true);
      setStatus(`Play Draft blocked by ${blockingErrors.length} validation error${blockingErrors.length === 1 ? '' : 's'}.`);
      return;
    }
    const previewWindow = window.open('', '_blank');
    setPlayDraftBusy(true);
    setStatus('Creating authoritative Play Draft room...');
    try {
      if (!loaded.district.activeRuntime) {
        const revision = await createLocalPlaytestRevision(documentRef.current);
        await saveLocalPlaytestRevision(revision);
        const target = `/explore?district=${encodeURIComponent(loaded.district.id)}&revision=${encodeURIComponent(revision.revisionId)}`;
        setLastPlayDraftUrl(target);
        if (previewWindow) {
          previewWindow.location.assign(new URL(target, location.origin).href);
          previewWindow.opener = null;
        } else {
          location.assign(target);
        }
        setStatus(`Geometry preview ${revision.revisionId.slice(0, 8)} created; this district is not connected to multiplayer yet.`);
        return;
      }
      const response = await fetch(`/api/editor/playtest/${encodeURIComponent(loaded.district.id)}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(documentRef.current)
      });
      const payload = await response.json() as EditorPlaytestResponse | {error?: string; issues?: string[]};
      if (!response.ok || !('playUrl' in payload)) {
        if ('issues' in payload && payload.issues?.length) {
          const runtimeReport = withRuntimeLaneIssues(
            validateLevelDocument(documentRef.current),
            documentRef.current,
            payload.issues
          );
          const firstRuntimeIssue = runtimeReport.issues.find((issue) => issue.compiledLaneEdge) ?? runtimeReport.issues.at(-1);
          setRuntimeLaneIssues(payload.issues);
          setValidationOpen(true);
          if (firstRuntimeIssue) onSelectIssue(firstRuntimeIssue);
        }
        throw new Error('error' in payload && payload.error ? payload.error : `Play Draft failed (HTTP ${response.status}).`);
      }
      setRuntimeLaneIssues([]);
      setHighlightedLaneEdge(undefined);
      const target = payload.playUrl;
      setLastPlayDraftUrl(target);
      if (previewWindow) {
        previewWindow.location.assign(new URL(target, location.origin).href);
        previewWindow.opener = null;
      } else {
        location.assign(target);
      }
      setStatus(payload.warnings.length > 0
        ? `Play Draft created with traffic fallback: ${payload.warnings[0]}`
        : `Authoritative Play Draft ${payload.revision.revision.slice(0, 8)} created.`);
    } catch (error) {
      previewWindow?.close();
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPlayDraftBusy(false);
    }
  }

  async function onImportFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = isLevelEditorBundle(parsed) ? parsed.editorDocument : isLevelEditorDocument(parsed) ? parsed : undefined;
      if (!imported) throw new Error('File is not a supported level project or game bundle.');
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
        districtId={loaded.district.id}
        districts={loaded.availableDistricts}
        canExplore={true}
        authoritativePlaytest={loaded.district.activeRuntime}
        playDraftBusy={playDraftBusy}
        canExportBundle={loaded.district.activeRuntime}
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
        onPlayDraft={() => void onPlayDraft()}
        onReset={onReset}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        onToggleInspector={() => setInspectorOpen((value) => !value)}
        onDistrictChange={(id) => {
          if (dirty && !window.confirm('Open another district? Your current edits are preserved in this district draft.')) return;
          location.assign(`/editor?district=${encodeURIComponent(id)}`);
        }}
      />
      <input ref={importInputRef} className="le-file-input" type="file" accept="application/json,.json" onChange={(event) => void onImportFile(event.target.files?.[0])} />
      <LevelEditorSidebar
        document={document}
        tool={tool}
        selection={selection}
        preferences={preferences}
        open={sidebarOpen}
        onToolChange={setTool}
        onSelectionChange={(next) => {
          setSelection(next);
          setHighlightedLaneEdge(undefined);
          if (next && next.kind !== 'cell') setInspectorOpen(true);
        }}
        onPreferencesChange={setPreferences}
        onGenerateRoadNetwork={onGenerateRoadNetwork}
        onSynchronizeJunctions={onRepairJunctions}
      />
      <section className="le-stage">
        <LevelEditorCanvas
          previewUrl={loaded.previewUrl}
          document={document}
          tool={tool}
          selection={selection}
          preferences={preferences}
          viewCommand={viewCommand}
          highlightedLaneEdge={highlightedLaneEdge}
          onExecute={onExecute}
          onSelectionChange={(next) => { setSelection(next); setHighlightedLaneEdge(undefined); }}
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
      <LevelEditorValidationPanel
        report={report}
        open={validationOpen}
        onOpenChange={setValidationOpen}
        onSelectIssue={onSelectIssue}
        onRepairJunctions={onRepairJunctions}
      />
      <LevelEditorStatusBar status={status} playDraftUrl={lastPlayDraftUrl} pointer={pointer} viewport={viewport} />
      {(sidebarOpen || inspectorOpen) && <button className="le-mobile-scrim le-mobile-only" type="button" aria-label="Close panels" onClick={() => { setSidebarOpen(false); setInspectorOpen(false); }} />}
    </main>
  );
}

async function loadEditor(): Promise<LoadedEditor> {
  const availableDistricts = await discoverAvailableDistricts();
  const requestedId = new URLSearchParams(location.search).get('district');
  const requested = districtDefinition(requestedId);
  const district = availableDistricts.find((candidate) => candidate.id === requested.id) ?? availableDistricts[0];
  if (!district) throw new Error('No converted district assets are available.');
  const [map, metadata, authoredLanes] = await Promise.all([
    fetchJson<TiledMapDocument>(districtMapAsset(district, 'district-map.json')),
    fetchJson<DistrictMapMetadata>(districtMapAsset(district, 'district-map.metadata.json')),
    fetchOptionalJson<LaneGraphDocument>(districtMapAsset(district, 'district-lanes.json'))
  ]);
  const lanes = authoredLanes ?? emptyLaneGraph(district.id);
  const source = {map, metadata};
  const assembled = assembleLevelDocument(map, metadata, lanes);
  const sourceDocument = {...assembled, title: district.label};
  const draft = await loadLevelDraft(sourceDocument).catch(() => undefined);
  return {
    district,
    availableDistricts,
    previewUrl: districtMapAsset(district, 'district-preview.png'),
    authoredLanes: Boolean(authoredLanes),
    source,
    sourceDocument,
    initialDocument: draft?.document ?? sourceDocument,
    restoredAt: draft?.savedAt
  };
}

async function discoverAvailableDistricts(): Promise<DistrictDefinition[]> {
  const results = await Promise.all(DISTRICT_CATALOG.map(async (district) => {
    try {
      const response = await fetch(districtMapAsset(district, 'district-map.metadata.json'), {
        cache: 'no-store',
        method: 'HEAD'
      });
      return response.ok ? district : undefined;
    } catch {
      return undefined;
    }
  }));
  return results.filter((district): district is DistrictDefinition => Boolean(district));
}

function emptyLaneGraph(districtId: string): LaneGraphDocument {
  return {
    schemaVersion: 2,
    districtId,
    driveSide: 'right',
    laneOffset: 24,
    laneSpacing: 40,
    corridors: [],
    junctions: [],
    roadblocks: []
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchOptionalJson<T>(path: string): Promise<T | undefined> {
  const response = await fetch(path, {cache: 'no-store'});
  if (response.status === 404) return undefined;
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
      junctions: repairJunctionIntersections(
        document.lanes.corridors.filter((corridor) => corridor.id !== selection.id),
        document.lanes.junctions.map((junction) => ({
          ...junction,
          corridors: junction.corridors.filter((id) => id !== selection.id)
        }))
      ).junctions
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
