'use client';

import {Plus, Trash2} from 'lucide-react';
import type {
  EditorSpawn,
  LaneCorridor,
  LaneCorridorDirection,
  LaneRoadClass,
  LaneJunction,
  LaneRoadblock,
  LevelEditorDocument,
  SpawnKind
} from '../../src/tools/level-editor/level-document.ts';
import {selectionKey, type EditorSelection} from '../../src/tools/level-editor/editor-ui.ts';
import {synchronizeJunctionIntersections} from '../../src/tools/level-editor/lane-authoring-geometry.ts';
import {compileLaneNetwork} from '../../shared/traffic/lane-network-compiler.ts';
import type {ColoredBeaconDefinition} from '../../shared/content/colored-beacons.ts';

interface LevelEditorInspectorProps {
  document: LevelEditorDocument;
  selection: EditorSelection;
  open: boolean;
  onCommit(label: string, update: (document: LevelEditorDocument) => LevelEditorDocument): void;
  onSelectionChange(selection: EditorSelection): void;
  onDelete(): void;
}

export function LevelEditorInspector(props: LevelEditorInspectorProps) {
  return (
    <aside className={`le-inspector ${props.open ? 'is-open' : ''}`} aria-label="Selection inspector">
      <header>
        <div><strong>Inspector</strong><span>{selectionTitle(props.selection)}</span></div>
        {props.selection && props.selection.kind !== 'cell' && (
          <button className="le-icon-button is-danger" type="button" onClick={props.onDelete} title="Delete selection" aria-label="Delete selection"><Trash2 size={16} /></button>
        )}
      </header>
      <div className="le-inspector__body" key={selectionKey(props.selection)}>
        <InspectorBody {...props} />
      </div>
    </aside>
  );
}

function InspectorBody(props: LevelEditorInspectorProps) {
  if (!props.selection) return <DocumentInspector document={props.document} onCommit={props.onCommit} />;
  if (props.selection.kind === 'cell') return <CellInspector document={props.document} selection={props.selection} />;
  if (props.selection.kind === 'spawn') {
    const selectedId = props.selection.id;
    const spawn = props.document.spawns.find((candidate) => candidate.id === selectedId);
    return spawn ? <SpawnInspector {...props} spawn={spawn} /> : <MissingSelection />;
  }
  if (props.selection.kind === 'beacon') {
    const selectedId = props.selection.id;
    const beacon = (props.document.beacons ?? []).find((candidate) => candidate.id === selectedId);
    return beacon ? <BeaconInspector {...props} beacon={beacon} /> : <MissingSelection />;
  }
  if (props.selection.kind === 'corridor') {
    const selectedId = props.selection.id;
    const corridor = props.document.lanes.corridors.find((candidate) => candidate.id === selectedId);
    return corridor ? <CorridorInspector {...props} corridor={corridor} pointIndex={props.selection.pointIndex} /> : <MissingSelection />;
  }
  if (props.selection.kind === 'junction') {
    const selectedId = props.selection.id;
    const junction = props.document.lanes.junctions.find((candidate) => candidate.id === selectedId);
    return junction ? <JunctionInspector {...props} junction={junction} /> : <MissingSelection />;
  }
  const selectedId = props.selection.id;
  const roadblock = (props.document.lanes.roadblocks ?? []).find((candidate) => candidate.id === selectedId);
  return roadblock ? <RoadblockInspector {...props} roadblock={roadblock} /> : <MissingSelection />;
}

function DocumentInspector({document, onCommit}: Pick<LevelEditorInspectorProps, 'document' | 'onCommit'>) {
  return (
    <>
      <InspectorSection title="District">
        <TextField label="Title" value={document.title} onCommit={(value) => onCommit('Rename district', (current) => ({...current, title: value}))} />
        <Readout label="ID" value={document.id} />
        <Readout label="Source" value={document.map.source} />
      </InspectorSection>
      <InspectorSection title="Map contract">
        <div className="le-field-grid">
          <Readout label="Tiles" value={`${document.map.width} x ${document.map.height}`} />
          <Readout label="Tile size" value={`${document.map.tileSize}px`} />
          <Readout label="World" value={`${document.map.width * document.map.tileSize} x ${document.map.height * document.map.tileSize}`} />
          <Readout label="Origin" value={`${document.map.origin.x}, ${document.map.origin.y}`} />
        </div>
      </InspectorSection>
      <InspectorSection title="Lane defaults">
        <div className="le-field-grid">
          <NumberField label="Lane offset" value={document.lanes.laneOffset} onCommit={(value) => onCommit('Change lane offset', (current) => ({...current, lanes: {...current.lanes, laneOffset: value}}))} />
          <NumberField label="Lane spacing" value={document.lanes.laneSpacing} onCommit={(value) => onCommit('Change lane spacing', (current) => ({...current, lanes: {...current.lanes, laneSpacing: value}}))} />
        </div>
        <CheckField label="Terminal turnarounds" checked={document.lanes.allowTerminalTurnarounds ?? false} onCommit={(checked) => onCommit('Toggle terminal turnarounds', (current) => ({...current, lanes: {...current.lanes, allowTerminalTurnarounds: checked}}))} />
      </InspectorSection>
    </>
  );
}

function CellInspector({document, selection}: {document: LevelEditorDocument; selection: Extract<EditorSelection, {kind: 'cell'}>}) {
  return (
    <InspectorSection title="Tile cell">
      <div className="le-field-grid">
        <Readout label="Layer" value={selection.layer} />
        <Readout label="Index" value={selection.index.toString()} />
        <Readout label="Tile X" value={selection.tileX.toString()} />
        <Readout label="Tile Y" value={selection.tileY.toString()} />
        <Readout label="Value" value={document.layers[selection.layer][selection.index]?.toString() ?? 'out of range'} />
      </div>
    </InspectorSection>
  );
}

function SpawnInspector(props: LevelEditorInspectorProps & {spawn: EditorSpawn}) {
  const {spawn} = props;
  function update(label: string, patch: Partial<EditorSpawn>, nextId?: string): void {
    props.onCommit(label, (document) => ({...document, spawns: document.spawns.map((candidate) => candidate.id === spawn.id ? {...candidate, ...patch} : candidate)}));
    if (nextId) props.onSelectionChange({kind: 'spawn', id: nextId});
  }
  return (
    <>
      <InspectorSection title="Spawn identity">
        <TextField label="ID" value={spawn.id} onCommit={(value) => update('Rename spawn', {id: value}, value)} />
        <TextField label="Label" value={spawn.label} onCommit={(value) => update('Rename spawn label', {label: value})} />
        <label className="le-field">Type
          <select value={spawn.kind} onChange={(event) => update('Change spawn type', {kind: event.target.value as SpawnKind})}>
            <option value="player">Player</option><option value="pedestrian">Pedestrian</option><option value="traffic">Traffic</option><option value="police">Police</option><option value="mission">Mission</option>
          </select>
        </label>
        <CheckField label="Enabled" checked={spawn.enabled} onCommit={(enabled) => update('Toggle spawn', {enabled})} />
      </InspectorSection>
      <InspectorSection title="Transform">
        <div className="le-field-grid">
          <NumberField label="X" value={spawn.x} onCommit={(x) => update('Move spawn', {x})} />
          <NumberField label="Y" value={spawn.y} onCommit={(y) => update('Move spawn', {y})} />
          <NumberField label="Angle deg" value={radiansToDegrees(spawn.angle)} onCommit={(angle) => update('Rotate spawn', {angle: degreesToRadians(angle)})} />
        </div>
      </InspectorSection>
    </>
  );
}

function BeaconInspector(props: LevelEditorInspectorProps & {beacon: ColoredBeaconDefinition}) {
  const {beacon} = props;
  function update(label: string, patch: Partial<ColoredBeaconDefinition>, nextId?: string): void {
    props.onCommit(label, (document) => ({
      ...document,
      beacons: (document.beacons ?? []).map((candidate) => (
        candidate.id === beacon.id ? {...candidate, ...patch} : candidate
      ))
    }));
    if (nextId) props.onSelectionChange({kind: 'beacon', id: nextId});
  }
  return (
    <>
      <InspectorSection title="Colored beacon">
        <TextField label="ID" value={beacon.id} onCommit={(value) => update('Rename colored beacon', {id: value}, value)} />
        <TextField label="Label" value={beacon.label} onCommit={(value) => update('Rename colored beacon label', {label: value})} />
        <CheckField label="Enabled" checked={beacon.enabled} onCommit={(enabled) => update('Toggle colored beacon', {enabled})} />
      </InspectorSection>
      <InspectorSection title="Source">
        <div className="le-field-grid">
          <NumberField label="X" value={beacon.x} onCommit={(x) => update('Move beacon source', {x})} />
          <NumberField label="Y" value={beacon.y} onCommit={(y) => update('Move beacon source', {y})} />
          <NumberField label="Height" value={beacon.z} min={0} onCommit={(z) => update('Change beacon height', {z})} />
        </div>
        <button className="le-wide-command" type="button" onClick={() => props.onSelectionChange({kind: 'beacon', id: beacon.id, handle: 'source'})}>Select source handle</button>
      </InspectorSection>
      <InspectorSection title="Target">
        <div className="le-field-grid">
          <NumberField label="X" value={beacon.targetX} onCommit={(targetX) => update('Aim colored beacon', {targetX})} />
          <NumberField label="Y" value={beacon.targetY} onCommit={(targetY) => update('Aim colored beacon', {targetY})} />
          <NumberField label="Height" value={beacon.targetZ} min={0} onCommit={(targetZ) => update('Aim colored beacon', {targetZ})} />
        </div>
        <button className="le-wide-command" type="button" onClick={() => props.onSelectionChange({kind: 'beacon', id: beacon.id, handle: 'target'})}>Select target handle</button>
      </InspectorSection>
      <InspectorSection title="Appearance">
        <ColorField label="Color" value={beacon.color} onCommit={(color) => update('Change beacon color', {color})} />
        <div className="le-field-grid">
          <NumberField label="Intensity" value={beacon.intensity} min={0.01} onCommit={(intensity) => update('Change beacon intensity', {intensity})} />
          <NumberField label="Cone radius" value={beacon.radius} min={1} onCommit={(radius) => update('Change beacon radius', {radius})} />
          <NumberField label="Footprint width" value={beacon.footprintWidth} min={1} onCommit={(footprintWidth) => update('Change beacon footprint', {footprintWidth})} />
          <NumberField label="Footprint height" value={beacon.footprintHeight} min={1} onCommit={(footprintHeight) => update('Change beacon footprint', {footprintHeight})} />
        </div>
      </InspectorSection>
    </>
  );
}

function CorridorInspector(props: LevelEditorInspectorProps & {corridor: LaneCorridor; pointIndex?: number}) {
  const {corridor} = props;
  function update(label: string, patch: Partial<LaneCorridor>, nextId?: string): void {
    props.onCommit(label, (document) => {
      const corridors = document.lanes.corridors.map((candidate) => candidate.id === corridor.id ? {...candidate, ...patch} : candidate);
      let junctions = nextId
        ? document.lanes.junctions.map((junction) => ({...junction, corridors: junction.corridors.map((id) => id === corridor.id ? nextId : id)}))
        : document.lanes.junctions;
      if (patch.points) junctions = synchronizeJunctionIntersections(corridors, junctions).junctions;
      return {...document, lanes: {...document.lanes, corridors, junctions}};
    });
    if (nextId) props.onSelectionChange({kind: 'corridor', id: nextId});
  }
  function updatePoint(index: number, patch: {x?: number; y?: number}): void {
    const points = corridor.points.map((point, pointIndex) => pointIndex === index ? {...point, ...patch} : point);
    update('Move corridor point', {points});
  }
  return (
    <>
      <InspectorSection title="Corridor">
        <TextField label="ID" value={corridor.id} onCommit={(value) => update('Rename corridor', {id: value}, value)} />
        <label className="le-field"><span>Traffic direction</span>
          <select
            value={corridor.direction ?? 'both'}
            onChange={(event) => update('Change traffic direction', {direction: event.target.value as LaneCorridorDirection})}
          >
            <option value="both">Both directions (legacy)</option>
            <option value="forward">Forward only</option>
            <option value="reverse">Reverse only</option>
          </select>
        </label>
        <label className="le-field"><span>Road class</span>
          <select
            value={corridor.roadClass ?? 'street'}
            onChange={(event) => update('Change road class', {roadClass: event.target.value as LaneRoadClass})}
          >
            <option value="arterial">Arterial</option>
            <option value="boulevard">Boulevard</option>
            <option value="street">Street</option>
            <option value="service">Service road</option>
            <option value="alley">Alley</option>
          </select>
        </label>
        <div className="le-field-grid">
          <NumberField label="Speed limit" value={corridor.speedLimit} min={1} onCommit={(speedLimit) => update('Change speed limit', {speedLimit})} />
          <NumberField label="Lanes / direction" value={corridor.lanesPerDirection ?? 1} min={1} max={4} onCommit={(lanesPerDirection) => update('Change lane count', {lanesPerDirection})} />
          <NumberField label="Lane offset" value={corridor.laneOffset ?? props.document.lanes.laneOffset} min={1} onCommit={(laneOffset) => update('Change lane offset', {laneOffset})} />
          <NumberField label="Lane spacing" value={corridor.laneSpacing ?? props.document.lanes.laneSpacing} min={1} onCommit={(laneSpacing) => update('Change lane spacing', {laneSpacing})} />
          <NumberField label="Route priority" value={corridor.routePriority ?? 1} min={0.1} max={4} onCommit={(routePriority) => update('Change route priority', {routePriority})} />
          <NumberField label="Traffic density" value={corridor.trafficDensity ?? 1} min={0} max={4} onCommit={(trafficDensity) => update('Change traffic density', {trafficDensity})} />
        </div>
        <Readout label="Measured half-width" value={corridor.measuredHalfWidth === undefined ? 'Not measured' : `${corridor.measuredHalfWidth.toFixed(1)} px`} />
        <Readout label="Clearance" value={corridor.clearanceConstrained ? 'Constrained bend' : 'Full envelope'} />
      </InspectorSection>
      <InspectorSection title={`Points (${corridor.points.length})`}>
        <div className="le-point-list">
          {corridor.points.map((point, index) => (
            <div key={index} className={props.pointIndex === index ? 'is-selected' : ''}>
              <button type="button" onClick={() => props.onSelectionChange({kind: 'corridor', id: corridor.id, pointIndex: index})}>{index + 1}</button>
              <NumberField label="X" value={point.x} onCommit={(x) => updatePoint(index, {x})} />
              <NumberField label="Y" value={point.y} onCommit={(y) => updatePoint(index, {y})} />
              <button type="button" className="le-icon-button is-danger" disabled={corridor.points.length <= 2} onClick={() => update('Delete corridor point', {points: corridor.points.filter((_, pointIndex) => pointIndex !== index)})} title="Delete point" aria-label={`Delete point ${index + 1}`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="le-wide-command" onClick={() => {
          const last = corridor.points.at(-1) ?? {x: 0, y: 0};
          update('Add corridor point', {points: [...corridor.points, {x: last.x + 64, y: last.y}]});
        }}><Plus size={15} /> Add point</button>
      </InspectorSection>
    </>
  );
}

function JunctionInspector(props: LevelEditorInspectorProps & {junction: LaneJunction}) {
  const {junction} = props;
  const compiled = compileLaneNetwork(props.document.lanes);
  const approaches = compiled.approaches.filter((approach) => approach.junctionId === junction.id);
  const movements = compiled.movements.filter((movement) => movement.junctionId === junction.id);
  const signalGroups = compiled.signalGroups.filter((group) => group.junctionId === junction.id);
  const turnCounts = movements.reduce((counts, movement) => {
    counts[movement.turn]++;
    return counts;
  }, {left: 0, right: 0, straight: 0, uturn: 0});
  function update(label: string, patch: Partial<LaneJunction>, nextId?: string): void {
    props.onCommit(label, (document) => ({...document, lanes: {...document.lanes, junctions: document.lanes.junctions.map((candidate) => candidate.id === junction.id ? {...candidate, ...patch} : candidate)}}));
    if (nextId) props.onSelectionChange({kind: 'junction', id: nextId});
  }
  return (
    <>
      <InspectorSection title="Junction">
        <TextField label="ID" value={junction.id} onCommit={(value) => update('Rename junction', {id: value}, value)} />
        <div className="le-field-grid">
          <Readout label="Position" value={`${Math.round(junction.x)}, ${Math.round(junction.y)}`} />
          <Readout label="Connections" value={junction.corridors.length.toString()} />
        </div>
        <Readout label="Connected corridors" value={junction.corridors.join(', ')} />
        <TextAreaField label="Allowed turns" value={(junction.allowedTurns ?? ['straight', 'left', 'right']).join('\n')} onCommit={(value) => update('Change allowed turns', {allowedTurns: lines(value).filter(isAllowedTurn)})} />
        <CheckField label="Terminal lane transfer" checked={junction.terminalTransfer ?? false} onCommit={(terminalTransfer) => update('Change terminal transfer', {terminalTransfer})} />
      </InspectorSection>
      <InspectorSection title="Generated intersection">
        <div className="le-field-grid">
          <Readout label="Incoming lanes" value={approaches.filter(({role}) => role === 'incoming').length.toString()} />
          <Readout label="Outgoing lanes" value={approaches.filter(({role}) => role === 'outgoing').length.toString()} />
          <Readout label="Movements" value={movements.length.toString()} />
          <Readout label="Signal phases" value={signalGroups.length.toString()} />
        </div>
        <Readout label="Turns" value={`Straight ${turnCounts.straight}, left ${turnCounts.left}, right ${turnCounts.right}, U-turn ${turnCounts.uturn}`} />
      </InspectorSection>
    </>
  );
}

function RoadblockInspector(props: LevelEditorInspectorProps & {roadblock: LaneRoadblock}) {
  const {roadblock} = props;
  function update(label: string, patch: Partial<LaneRoadblock>, nextId?: string): void {
    props.onCommit(label, (document) => ({...document, lanes: {...document.lanes, roadblocks: (document.lanes.roadblocks ?? []).map((candidate) => candidate.id === roadblock.id ? {...candidate, ...patch} : candidate)}}));
    if (nextId) props.onSelectionChange({kind: 'roadblock', id: nextId});
  }
  return (
    <>
      <InspectorSection title="Roadblock">
        <TextField label="ID" value={roadblock.id} onCommit={(value) => update('Rename roadblock', {id: value}, value)} />
        <div className="le-field-grid">
          <NumberField label="X" value={roadblock.x} onCommit={(x) => update('Move roadblock', {x})} />
          <NumberField label="Y" value={roadblock.y} onCommit={(y) => update('Move roadblock', {y})} />
          <NumberField label="Angle deg" value={radiansToDegrees(roadblock.angle)} onCommit={(angle) => update('Rotate roadblock', {angle: degreesToRadians(angle)})} />
          <Readout label="Vehicle poses" value={roadblock.vehiclePoses.length.toString()} />
        </div>
        <TextAreaField label="Blocked compiled edge ids" value={roadblock.blockedEdgeIds.join('\n')} onCommit={(value) => update('Change roadblock edges', {blockedEdgeIds: lines(value)})} />
      </InspectorSection>
      <InspectorSection title="Stinger">
        <div className="le-field-grid">
          <NumberField label="X" value={roadblock.stinger.x} onCommit={(x) => update('Move stinger', {stinger: {...roadblock.stinger, x}})} />
          <NumberField label="Y" value={roadblock.stinger.y} onCommit={(y) => update('Move stinger', {stinger: {...roadblock.stinger, y}})} />
          <NumberField label="Angle deg" value={radiansToDegrees(roadblock.stinger.angle)} onCommit={(angle) => update('Rotate stinger', {stinger: {...roadblock.stinger, angle: degreesToRadians(angle)}})} />
        </div>
      </InspectorSection>
    </>
  );
}

function InspectorSection({title, children}: {title: string; children: React.ReactNode}) {
  return <section className="le-inspector-section"><h2>{title}</h2>{children}</section>;
}

function TextField({label, value, onCommit}: {label: string; value: string; onCommit(value: string): void}) {
  return <label className="le-field">{label}<input key={value} type="text" defaultValue={value} onBlur={(event) => event.target.value !== value && onCommit(event.target.value.trim())} /></label>;
}

function NumberField({label, value, min, max, onCommit}: {label: string; value: number; min?: number; max?: number; onCommit(value: number): void}) {
  return <label className="le-field">{label}<input key={value} type="number" defaultValue={round(value)} min={min} max={max} step="any" onBlur={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next) && next !== value) onCommit(next);
  }} /></label>;
}

function ColorField({label, value, onCommit}: {label: string; value: string; onCommit(value: string): void}) {
  return <label className="le-field">{label}<input key={value} type="color" defaultValue={value} onBlur={(event) => event.target.value !== value && onCommit(event.target.value)} /></label>;
}

function TextAreaField({label, value, onCommit}: {label: string; value: string; onCommit(value: string): void}) {
  return <label className="le-field">{label}<textarea key={value} defaultValue={value} rows={5} onBlur={(event) => event.target.value !== value && onCommit(event.target.value)} /></label>;
}

function CheckField({label, checked, onCommit}: {label: string; checked: boolean; onCommit(value: boolean): void}) {
  return <label className="le-check-field"><input type="checkbox" checked={checked} onChange={(event) => onCommit(event.target.checked)} /><span>{label}</span></label>;
}

function Readout({label, value}: {label: string; value: string}) {
  return <div className="le-readout"><span>{label}</span><strong>{value}</strong></div>;
}

function MissingSelection() {
  return <p className="le-empty-state">The selected object no longer exists.</p>;
}

function selectionTitle(selection: EditorSelection): string {
  if (!selection) return 'Document settings';
  if (selection.kind === 'cell') return `${selection.layer} cell ${selection.tileX}, ${selection.tileY}`;
  return `${selection.kind} / ${selection.id}`;
}

function lines(value: string): string[] {
  return value.split(/\r?\n|,/).map((line) => line.trim()).filter(Boolean);
}

function isAllowedTurn(value: string): value is 'left' | 'right' | 'straight' {
  return value === 'left' || value === 'right' || value === 'straight';
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
