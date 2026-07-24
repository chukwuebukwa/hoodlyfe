'use client';

import {useState} from 'react';
import {
  Brush,
  Eraser,
  GitFork,
  Hand,
  Lightbulb,
  MapPin,
  MousePointer2,
  Route,
  Search,
  Shield,
  TrafficCone
} from 'lucide-react';
import type {LevelEditorDocument, SpawnKind} from '../../src/tools/level-editor/level-document.ts';
import type {EditorPreferences, EditorSelection, EditorTool} from '../../src/tools/level-editor/editor-ui.ts';

interface LevelEditorSidebarProps {
  document: LevelEditorDocument;
  tool: EditorTool;
  selection: EditorSelection;
  preferences: EditorPreferences;
  open: boolean;
  onToolChange(tool: EditorTool): void;
  onSelectionChange(selection: EditorSelection): void;
  onPreferencesChange(preferences: EditorPreferences): void;
  onGenerateRoadNetwork(): void;
  onSynchronizeJunctions(): void;
}

const TOOLS: Array<{tool: EditorTool; label: string; shortcut: string; icon: typeof MousePointer2}> = [
  {tool: 'select', label: 'Select and move', shortcut: 'V', icon: MousePointer2},
  {tool: 'pan', label: 'Pan map', shortcut: 'H', icon: Hand},
  {tool: 'collision-paint', label: 'Paint collision', shortcut: 'B', icon: Brush},
  {tool: 'collision-erase', label: 'Erase collision', shortcut: 'Shift+B', icon: Eraser},
  {tool: 'road-paint', label: 'Paint road cells', shortcut: 'R', icon: Route},
  {tool: 'road-erase', label: 'Erase road cells', shortcut: 'Shift+R', icon: Eraser},
  {tool: 'corridor', label: 'Draw lane corridor', shortcut: 'C', icon: Route},
  {tool: 'junction', label: 'Place junction', shortcut: 'J', icon: GitFork},
  {tool: 'spawn', label: 'Place spawn', shortcut: 'S', icon: MapPin},
  {tool: 'beacon', label: 'Place colored beacon', shortcut: 'L', icon: Lightbulb},
  {tool: 'roadblock', label: 'Place roadblock', shortcut: 'K', icon: TrafficCone}
];

export function LevelEditorSidebar(props: LevelEditorSidebarProps) {
  return (
    <aside className={`le-sidebar ${props.open ? 'is-open' : ''}`} aria-label="Level editor tools and layers">
      <section className="le-panel le-tool-panel">
        <header><strong>Tools</strong><span>{TOOLS.find((item) => item.tool === props.tool)?.label}</span></header>
        <div className="le-tool-grid">
          {TOOLS.map(({tool, label, shortcut, icon: Icon}) => (
            <button
              key={tool}
              type="button"
              className={props.tool === tool ? 'is-active' : ''}
              aria-pressed={props.tool === tool}
              onClick={() => props.onToolChange(tool)}
              title={`${label} (${shortcut})`}
            >
              <Icon size={17} /><span>{label}</span><kbd>{shortcut}</kbd>
            </button>
          ))}
        </div>
      </section>

      <LayerPanel {...props} />
      <ObjectTree {...props} />
    </aside>
  );
}

function LayerPanel(props: LevelEditorSidebarProps) {
  function setLayer(layer: keyof EditorPreferences['layers'], value: boolean): void {
    props.onPreferencesChange({...props.preferences, layers: {...props.preferences.layers, [layer]: value}});
  }
  return (
    <section className="le-panel">
      <header><strong>Layers</strong><span>Visibility and authoring</span></header>
      <div className="le-layer-list">
        <LayerToggle label="Base map" color="#8b969a" checked={props.preferences.layers.base} onChange={(value) => setLayer('base', value)} />
        <LayerToggle label="Collision" color="#e25083" checked={props.preferences.layers.collision} onChange={(value) => setLayer('collision', value)} />
        <LayerToggle label="Road cells" color="#1dcad3" checked={props.preferences.layers.roads} onChange={(value) => setLayer('roads', value)} />
        <LayerToggle label={`Lane corridors (${props.document.lanes.corridors.length})`} color="#40d9ef" checked={props.preferences.layers.corridors} onChange={(value) => setLayer('corridors', value)} />
        <LayerToggle label={`Junctions (${props.document.lanes.junctions.length})`} color="#56e39f" checked={props.preferences.layers.junctions} onChange={(value) => setLayer('junctions', value)} />
        <LayerToggle label={`Spawns (${props.document.spawns.length})`} color="#f2c94c" checked={props.preferences.layers.spawns} onChange={(value) => setLayer('spawns', value)} />
        <LayerToggle label={`Colored beacons (${props.document.beacons?.length ?? 0})`} color="#20dcff" checked={props.preferences.layers.beacons} onChange={(value) => setLayer('beacons', value)} />
        <LayerToggle label={`Roadblocks (${props.document.lanes.roadblocks?.length ?? 0})`} color="#ff6f61" checked={props.preferences.layers.roadblocks} onChange={(value) => setLayer('roadblocks', value)} />
        <LayerToggle label="Tile grid" color="#d7dcde" checked={props.preferences.layers.grid} onChange={(value) => setLayer('grid', value)} />
      </div>
      <button className="le-wide-command" type="button" onClick={props.onSynchronizeJunctions}>
        <GitFork size={15} /> Sync corridor crossings
      </button>
      <button className="le-wide-command" type="button" onClick={props.onGenerateRoadNetwork}>
        <Route size={15} /> Generate full road network
      </button>

      <div className="le-control-grid">
        <label>Snap
          <select value={props.preferences.snapSize} onChange={(event) => props.onPreferencesChange({...props.preferences, snapSize: Number(event.target.value)})}>
            <option value={1}>1 px</option><option value={8}>8 px</option><option value={16}>16 px</option><option value={32}>32 px</option><option value={64}>64 px</option>
          </select>
        </label>
        <label>Brush
          <select value={props.preferences.brushSize} onChange={(event) => props.onPreferencesChange({...props.preferences, brushSize: Number(event.target.value)})}>
            <option value={1}>1 x 1</option><option value={2}>2 x 2</option><option value={4}>4 x 4</option><option value={8}>8 x 8</option>
          </select>
        </label>
      </div>
      <label className="le-range-label">Base opacity <output>{Math.round(props.preferences.baseOpacity * 100)}%</output>
        <input type="range" min="0" max="1" step="0.05" value={props.preferences.baseOpacity} onChange={(event) => props.onPreferencesChange({...props.preferences, baseOpacity: Number(event.target.value)})} />
      </label>
      <label className="le-range-label">Overlay opacity <output>{Math.round(props.preferences.overlayOpacity * 100)}%</output>
        <input type="range" min="0.1" max="1" step="0.05" value={props.preferences.overlayOpacity} onChange={(event) => props.onPreferencesChange({...props.preferences, overlayOpacity: Number(event.target.value)})} />
      </label>
      {props.tool === 'spawn' && (
        <label>Spawn type
          <select value={props.preferences.spawnKind} onChange={(event) => props.onPreferencesChange({...props.preferences, spawnKind: event.target.value as SpawnKind})}>
            <option value="player">Player</option><option value="pedestrian">Pedestrian</option><option value="traffic">Traffic</option><option value="police">Police</option><option value="mission">Mission</option>
          </select>
        </label>
      )}
    </section>
  );
}

function LayerToggle({label, color, checked, onChange}: {label: string; color: string; checked: boolean; onChange(value: boolean): void}) {
  return (
    <label className="le-layer-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i style={{backgroundColor: color}} />
      <span>{label}</span>
    </label>
  );
}

function ObjectTree(props: LevelEditorSidebarProps) {
  const [filter, setFilter] = useState('');
  return (
    <section className="le-panel le-object-panel">
      <header><strong>Objects</strong><span>Authoritative authored data</span></header>
      <label className="le-search"><Search size={15} /><input id="le-object-filter" type="search" placeholder="Filter by id or label" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      <ObjectList document={props.document} selection={props.selection} onSelectionChange={props.onSelectionChange} filter={filter} />
    </section>
  );
}

function ObjectList({document, selection, onSelectionChange, filter}: Pick<LevelEditorSidebarProps, 'document' | 'selection' | 'onSelectionChange'> & {filter: string}) {
  const query = filter.trim().toLowerCase();
  const matches = (...values: string[]) => query.length === 0 || values.some((value) => value.toLowerCase().includes(query));
  return (
    <div className="le-object-list">
      <ObjectGroup label="Spawns" icon={MapPin}>
        {document.spawns.filter((spawn) => matches(spawn.id, spawn.label, spawn.kind)).map((spawn) => <ObjectButton key={spawn.id} active={selection?.kind === 'spawn' && selection.id === spawn.id} label={spawn.label} meta={spawn.kind} onClick={() => onSelectionChange({kind: 'spawn', id: spawn.id})} />)}
      </ObjectGroup>
      <ObjectGroup label="Colored beacons" icon={Lightbulb}>
        {(document.beacons ?? []).filter((beacon) => matches(beacon.id, beacon.label, beacon.color)).map((beacon) => <ObjectButton key={beacon.id} active={selection?.kind === 'beacon' && selection.id === beacon.id} label={beacon.label} meta={`${beacon.color} · ${beacon.intensity.toFixed(2)}x`} onClick={() => onSelectionChange({kind: 'beacon', id: beacon.id})} />)}
      </ObjectGroup>
      <ObjectGroup label="Corridors" icon={Route}>
        {document.lanes.corridors.filter((corridor) => matches(corridor.id)).map((corridor) => <ObjectButton key={corridor.id} active={selection?.kind === 'corridor' && selection.id === corridor.id} label={corridor.id} meta={`${corridor.points.length} pts · ${(corridor.direction ?? 'both').toUpperCase()}`} onClick={() => onSelectionChange({kind: 'corridor', id: corridor.id})} />)}
      </ObjectGroup>
      <ObjectGroup label="Junctions" icon={GitFork}>
        {document.lanes.junctions.filter((junction) => matches(junction.id, ...junction.corridors)).map((junction) => <ObjectButton key={junction.id} active={selection?.kind === 'junction' && selection.id === junction.id} label={junction.id} meta={`${junction.corridors.length} links`} onClick={() => onSelectionChange({kind: 'junction', id: junction.id})} />)}
      </ObjectGroup>
      <ObjectGroup label="Roadblocks" icon={TrafficCone}>
        {(document.lanes.roadblocks ?? []).filter((roadblock) => matches(roadblock.id, ...roadblock.blockedEdgeIds)).map((roadblock) => <ObjectButton key={roadblock.id} active={selection?.kind === 'roadblock' && selection.id === roadblock.id} label={roadblock.id} meta={`${roadblock.vehiclePoses.length} cars`} onClick={() => onSelectionChange({kind: 'roadblock', id: roadblock.id})} />)}
      </ObjectGroup>
    </div>
  );
}

function ObjectGroup({label, icon: Icon, children}: {label: string; icon: typeof Shield; children: React.ReactNode}) {
  return <details open><summary><Icon size={14} /> {label}</summary><div>{children}</div></details>;
}

function ObjectButton({active, label, meta, onClick}: {active: boolean; label: string; meta: string; onClick(): void}) {
  return <button type="button" className={active ? 'is-active' : ''} onClick={onClick}><span>{label}</span><small>{meta}</small></button>;
}
