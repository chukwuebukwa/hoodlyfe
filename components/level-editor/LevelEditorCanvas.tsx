'use client';

import {useEffect, useRef, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent} from 'react';
import {
  cellPatchCommand,
  documentCommand,
  type CellChange,
  type EditorCommand
} from '../../src/tools/level-editor/editor-history.ts';
import {
  documentWorldSize,
  tileIndex,
  tileToWorldCenter,
  worldToTile,
  type EditorSpawn,
  type LaneCorridor,
  type LaneJunction,
  type LaneRoadblock,
  type LevelEditorDocument,
  type Point2D
} from '../../src/tools/level-editor/level-document.ts';
import type {
  EditorPreferences,
  EditorSelection,
  EditorTool,
  PointerReadout,
  ViewportReadout
} from '../../src/tools/level-editor/editor-ui.ts';

export interface CanvasViewCommand {
  id: number;
  type: 'fit' | 'actual' | 'zoom-in' | 'zoom-out' | 'focus';
  point?: Point2D;
}

interface LevelEditorCanvasProps {
  document: LevelEditorDocument;
  tool: EditorTool;
  selection: EditorSelection;
  preferences: EditorPreferences;
  viewCommand: CanvasViewCommand;
  onExecute(command: EditorCommand): void;
  onSelectionChange(selection: EditorSelection): void;
  onPointerChange(readout: PointerReadout): void;
  onViewportChange(readout: ViewportReadout): void;
  onStatus(message: string): void;
}

interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface DragState {
  pointerId: number;
  mode: 'pan' | 'entity' | 'cells';
  startClient: Point2D;
  startWorld: Point2D;
  startViewport: Viewport;
  selection?: EditorSelection;
  beforeDocument?: LevelEditorDocument;
  workingDocument?: LevelEditorDocument;
  cellLayer?: 'collision' | 'roads';
  cellValue?: number;
  workingCells?: number[];
  changes?: Map<number, CellChange>;
}

const MIN_SCALE = 0.025;
const MAX_SCALE = 8;
const ENTITY_HIT_RADIUS_PX = 13;
const PREVIEW_URL = '/assets/maps/district-preview.png';

export function LevelEditorCanvas({
  document,
  tool,
  selection,
  preferences,
  viewCommand,
  onExecute,
  onSelectionChange,
  onPointerChange,
  onViewportChange,
  onStatus
}: LevelEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef(document);
  const selectionRef = useRef(selection);
  const preferencesRef = useRef(preferences);
  const toolRef = useRef(tool);
  const callbacksRef = useRef({onExecute, onSelectionChange, onPointerChange, onViewportChange, onStatus});
  const viewportRef = useRef<Viewport>({scale: 0.08, offsetX: 0, offsetY: 0});
  const dragRef = useRef<DragState | undefined>(undefined);
  const previewRef = useRef<HTMLImageElement | undefined>(undefined);
  const spacePressedRef = useRef(false);
  const draftCorridorRef = useRef<Point2D[]>([]);
  const cursorWorldRef = useRef<Point2D>({x: 0, y: 0});

  documentRef.current = document;
  selectionRef.current = selection;
  preferencesRef.current = preferences;
  toolRef.current = tool;
  callbacksRef.current = {onExecute, onSelectionChange, onPointerChange, onViewportChange, onStatus};

  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.src = PREVIEW_URL;
    image.addEventListener('load', draw);
    previewRef.current = image;
    return () => image.removeEventListener('load', draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      resizeCanvas(canvas);
      if (viewportRef.current.offsetX === 0 && viewportRef.current.offsetY === 0) fitView(canvas, documentRef.current, viewportRef.current);
      emitViewport(canvas);
      draw();
    });
    observer.observe(canvas);
    resizeCanvas(canvas);
    fitView(canvas, documentRef.current, viewportRef.current);
    emitViewport(canvas);
    draw();
    return () => observer.disconnect();
  }, []);

  useEffect(draw, [document, selection, preferences, tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewCommand.id === 0) return;
    if (viewCommand.type === 'fit') fitView(canvas, documentRef.current, viewportRef.current);
    if (viewCommand.type === 'actual') setScaleAround(canvas, viewportRef.current, 1, centerOfCanvas(canvas));
    if (viewCommand.type === 'zoom-in') setScaleAround(canvas, viewportRef.current, viewportRef.current.scale * 1.3, centerOfCanvas(canvas));
    if (viewCommand.type === 'zoom-out') setScaleAround(canvas, viewportRef.current, viewportRef.current.scale / 1.3, centerOfCanvas(canvas));
    if (viewCommand.type === 'focus' && viewCommand.point) {
      viewportRef.current.scale = Math.max(viewportRef.current.scale, 0.65);
      viewportRef.current.offsetX = canvas.clientWidth / 2 - viewCommand.point.x * viewportRef.current.scale;
      viewportRef.current.offsetY = canvas.clientHeight / 2 - viewCommand.point.y * viewportRef.current.scale;
    }
    emitViewport(canvas);
    draw();
  }, [viewCommand]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code === 'Space') {
        spacePressedRef.current = true;
        if (!isFormTarget(event.target)) event.preventDefault();
      }
      if (event.key === 'Escape' && draftCorridorRef.current.length > 0) {
        draftCorridorRef.current = [];
        callbacksRef.current.onStatus('Corridor draft cancelled.');
        draw();
      }
      if (event.key === 'Enter' && draftCorridorRef.current.length >= 2) finishCorridor();
      if ((event.key === 'Delete' || event.key === 'Backspace') && !isFormTarget(event.target)) deleteSelection();
    }
    function onKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space') spacePressedRef.current = false;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  function draw(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = window.devicePixelRatio || 1;
    const viewport = viewportRef.current;
    const activeDocument = dragRef.current?.workingDocument ?? documentRef.current;
    const view = visibleWorld(canvas, viewport);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.fillStyle = '#080b0c';
    context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.save();
    context.translate(viewport.offsetX, viewport.offsetY);
    context.scale(viewport.scale, viewport.scale);

    const worldSize = documentWorldSize(activeDocument);
    context.fillStyle = '#111719';
    context.fillRect(activeDocument.map.origin.x, activeDocument.map.origin.y, worldSize.width, worldSize.height);
    if (preferencesRef.current.layers.base && previewRef.current?.complete) {
      context.save();
      context.globalAlpha = preferencesRef.current.baseOpacity;
      context.imageSmoothingEnabled = viewport.scale < 1;
      context.drawImage(
        previewRef.current,
        activeDocument.map.origin.x,
        activeDocument.map.origin.y,
        worldSize.width,
        worldSize.height
      );
      context.restore();
    }

    drawTileLayers(context, activeDocument, view, viewport.scale, preferencesRef.current);
    if (preferencesRef.current.layers.corridors) drawCorridors(context, activeDocument, viewport.scale, selectionRef.current);
    if (preferencesRef.current.layers.junctions) drawJunctions(context, activeDocument, viewport.scale, selectionRef.current);
    if (preferencesRef.current.layers.spawns) drawSpawns(context, activeDocument, viewport.scale, selectionRef.current);
    if (preferencesRef.current.layers.roadblocks) drawRoadblocks(context, activeDocument, viewport.scale, selectionRef.current);
    drawDraftCorridor(context, draftCorridorRef.current, cursorWorldRef.current, viewport.scale);
    context.restore();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    const client = eventPoint(canvas, event.clientX, event.clientY);
    const world = screenToWorld(client, viewportRef.current);
    cursorWorldRef.current = world;

    if (event.button === 1 || toolRef.current === 'pan' || spacePressedRef.current) {
      dragRef.current = {
        pointerId: event.pointerId,
        mode: 'pan',
        startClient: client,
        startWorld: world,
        startViewport: {...viewportRef.current}
      };
      return;
    }
    if (event.button !== 0) return;

    const paint = paintMode(toolRef.current);
    if (paint) {
      const activeDocument = documentRef.current;
      dragRef.current = {
        pointerId: event.pointerId,
        mode: 'cells',
        startClient: client,
        startWorld: world,
        startViewport: {...viewportRef.current},
        beforeDocument: activeDocument,
        workingDocument: activeDocument,
        cellLayer: paint.layer,
        cellValue: paint.value,
        workingCells: [...activeDocument.layers[paint.layer]],
        changes: new Map()
      };
      paintAt(world);
      return;
    }

    if (toolRef.current === 'corridor') {
      const point = snapPoint(world, preferencesRef.current.snapSize);
      const points = draftCorridorRef.current;
      if (points.length === 0 || distance(points.at(-1)!, point) > 0.5) points.push(point);
      if (event.detail >= 2 && points.length >= 2) finishCorridor();
      else {
        callbacksRef.current.onStatus(`${points.length} corridor point${points.length === 1 ? '' : 's'}; Enter or double-click to finish.`);
        draw();
      }
      return;
    }
    if (toolRef.current === 'junction') {
      createJunction(world);
      return;
    }
    if (toolRef.current === 'spawn') {
      createSpawn(world);
      return;
    }
    if (toolRef.current === 'roadblock') {
      createRoadblock(world);
      return;
    }

    const hit = hitTest(documentRef.current, world, viewportRef.current.scale, preferencesRef.current);
    callbacksRef.current.onSelectionChange(hit);
    if (hit && hit.kind !== 'cell') {
      dragRef.current = {
        pointerId: event.pointerId,
        mode: 'entity',
        startClient: client,
        startWorld: world,
        startViewport: {...viewportRef.current},
        selection: hit,
        beforeDocument: documentRef.current,
        workingDocument: documentRef.current
      };
    }
    draw();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    const client = eventPoint(canvas, event.clientX, event.clientY);
    const world = screenToWorld(client, viewportRef.current);
    cursorWorldRef.current = world;
    const tile = worldToTile(documentRef.current, world);
    callbacksRef.current.onPointerChange({world, tile});
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      draw();
      return;
    }
    if (drag.mode === 'pan') {
      viewportRef.current.offsetX = drag.startViewport.offsetX + client.x - drag.startClient.x;
      viewportRef.current.offsetY = drag.startViewport.offsetY + client.y - drag.startClient.y;
      emitViewport(canvas);
      draw();
      return;
    }
    if (drag.mode === 'cells') {
      paintAt(world);
      return;
    }
    if (drag.mode === 'entity' && drag.beforeDocument && drag.selection) {
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      drag.workingDocument = moveSelection(
        drag.beforeDocument,
        drag.selection,
        dx,
        dy,
        preferencesRef.current.snapSize
      );
      draw();
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.mode === 'cells' && drag.cellLayer && drag.changes && drag.changes.size > 0) {
      const action = drag.cellValue === 0 ? 'Erase' : 'Paint';
      callbacksRef.current.onExecute(cellPatchCommand(`${action} ${drag.cellLayer}`, drag.cellLayer, [...drag.changes.values()]));
      callbacksRef.current.onStatus(`${action}d ${drag.changes.size} ${drag.cellLayer} cell${drag.changes.size === 1 ? '' : 's'}.`);
    }
    if (drag.mode === 'entity' && drag.beforeDocument && drag.workingDocument && drag.workingDocument !== drag.beforeDocument) {
      callbacksRef.current.onExecute(documentCommand('Move selection', drag.beforeDocument, drag.workingDocument));
      callbacksRef.current.onStatus('Selection moved.');
    }
    draw();
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    draw();
  }

  function onWheel(event: ReactWheelEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    const point = eventPoint(event.currentTarget, event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0012);
    setScaleAround(event.currentTarget, viewportRef.current, viewportRef.current.scale * factor, point);
    emitViewport(event.currentTarget);
    draw();
  }

  function paintAt(world: Point2D): void {
    const drag = dragRef.current;
    if (!drag || drag.mode !== 'cells' || !drag.beforeDocument || !drag.cellLayer || drag.cellValue === undefined || !drag.workingCells || !drag.changes) return;
    const tile = worldToTile(drag.beforeDocument, world);
    const radius = Math.floor((preferencesRef.current.brushSize - 1) / 2);
    for (let y = tile.y - radius; y < tile.y - radius + preferencesRef.current.brushSize; y++) {
      for (let x = tile.x - radius; x < tile.x - radius + preferencesRef.current.brushSize; x++) {
        const index = tileIndex(drag.beforeDocument, x, y);
        if (index < 0) continue;
        const before = drag.beforeDocument.layers[drag.cellLayer][index];
        drag.workingCells[index] = drag.cellValue;
        const existing = drag.changes.get(index);
        drag.changes.set(index, {index, before: existing?.before ?? before, after: drag.cellValue});
      }
    }
    drag.workingDocument = {
      ...drag.beforeDocument,
      layers: {...drag.beforeDocument.layers, [drag.cellLayer]: drag.workingCells}
    };
    draw();
  }

  function finishCorridor(): void {
    if (draftCorridorRef.current.length < 2) return;
    const before = documentRef.current;
    const id = uniqueId('corridor', before.lanes.corridors.map((corridor) => corridor.id));
    const corridor: LaneCorridor = {
      id,
      speedLimit: 104,
      lanesPerDirection: 1,
      points: draftCorridorRef.current.map((point) => ({...point}))
    };
    const after = {
      ...before,
      lanes: {...before.lanes, corridors: [...before.lanes.corridors, corridor]}
    };
    draftCorridorRef.current = [];
    callbacksRef.current.onExecute(documentCommand('Add lane corridor', before, after));
    callbacksRef.current.onSelectionChange({kind: 'corridor', id});
    callbacksRef.current.onStatus(`Added ${id}.`);
  }

  function createJunction(world: Point2D): void {
    const before = documentRef.current;
    const point = snapPoint(world, preferencesRef.current.snapSize);
    const nearest = before.lanes.corridors
      .map((corridor) => ({id: corridor.id, distance: distanceToPolyline(point, corridor.points)}))
      .sort((left, right) => left.distance - right.distance)
      .filter((candidate) => candidate.distance <= before.map.tileSize * 2)
      .slice(0, 4)
      .map((candidate) => candidate.id);
    const id = uniqueId('junction', before.lanes.junctions.map((junction) => junction.id));
    const junction: LaneJunction = {id, ...point, corridors: nearest};
    const after = {...before, lanes: {...before.lanes, junctions: [...before.lanes.junctions, junction]}};
    callbacksRef.current.onExecute(documentCommand('Add junction', before, after));
    callbacksRef.current.onSelectionChange({kind: 'junction', id});
    callbacksRef.current.onStatus(`Added ${id} with ${nearest.length} nearby corridor connection${nearest.length === 1 ? '' : 's'}.`);
  }

  function createSpawn(world: Point2D): void {
    const before = documentRef.current;
    const kind = preferencesRef.current.spawnKind;
    const id = uniqueId(`${kind}-spawn`, before.spawns.map((spawn) => spawn.id));
    const point = snapPoint(world, preferencesRef.current.snapSize);
    const spawn: EditorSpawn = {id, label: titleCase(id), kind, ...point, angle: 0, enabled: true};
    const after = {...before, spawns: [...before.spawns, spawn]};
    callbacksRef.current.onExecute(documentCommand('Add spawn', before, after));
    callbacksRef.current.onSelectionChange({kind: 'spawn', id});
    callbacksRef.current.onStatus(`Added ${spawn.label}.`);
  }

  function createRoadblock(world: Point2D): void {
    const before = documentRef.current;
    const point = snapPoint(world, preferencesRef.current.snapSize);
    const id = uniqueId('roadblock', (before.lanes.roadblocks ?? []).map((roadblock) => roadblock.id));
    const roadblock: LaneRoadblock = {
      id,
      ...point,
      angle: 0,
      blockedEdgeIds: [],
      vehiclePoses: [{x: point.x, y: point.y, angle: Math.PI / 2}],
      stinger: {
        x: point.x - 72,
        y: point.y,
        angle: Math.PI / 2,
        officerPose: {x: point.x - 72, y: point.y - 96, angle: Math.PI / 2}
      }
    };
    const after = {...before, lanes: {...before.lanes, roadblocks: [...(before.lanes.roadblocks ?? []), roadblock]}};
    callbacksRef.current.onExecute(documentCommand('Add roadblock', before, after));
    callbacksRef.current.onSelectionChange({kind: 'roadblock', id});
    callbacksRef.current.onStatus(`Added ${id}. Configure compiled edge ids in the inspector.`);
  }

  function deleteSelection(): void {
    const selected = selectionRef.current;
    if (!selected || selected.kind === 'cell') return;
    const before = documentRef.current;
    let after = before;
    if (selected.kind === 'spawn') after = {...before, spawns: before.spawns.filter((spawn) => spawn.id !== selected.id)};
    if (selected.kind === 'corridor') {
      const corridors = before.lanes.corridors.filter((corridor) => corridor.id !== selected.id);
      const junctions = before.lanes.junctions.map((junction) => ({
        ...junction,
        corridors: junction.corridors.filter((id) => id !== selected.id)
      }));
      after = {...before, lanes: {...before.lanes, corridors, junctions}};
    }
    if (selected.kind === 'junction') after = {...before, lanes: {...before.lanes, junctions: before.lanes.junctions.filter((junction) => junction.id !== selected.id)}};
    if (selected.kind === 'roadblock') after = {...before, lanes: {...before.lanes, roadblocks: (before.lanes.roadblocks ?? []).filter((roadblock) => roadblock.id !== selected.id)}};
    if (after !== before) {
      callbacksRef.current.onExecute(documentCommand(`Delete ${selected.kind}`, before, after));
      callbacksRef.current.onSelectionChange(undefined);
      callbacksRef.current.onStatus(`Deleted ${selected.kind}.`);
    }
  }

  function emitViewport(canvas: HTMLCanvasElement): void {
    callbacksRef.current.onViewportChange({
      zoom: viewportRef.current.scale,
      visibleWorld: visibleWorld(canvas, viewportRef.current)
    });
  }

  return (
    <canvas
      ref={canvasRef}
      id="level-editor-canvas"
      tabIndex={0}
      aria-label="Interactive district level map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}

function drawTileLayers(
  context: CanvasRenderingContext2D,
  document: LevelEditorDocument,
  visible: {minX: number; minY: number; maxX: number; maxY: number},
  scale: number,
  preferences: EditorPreferences
): void {
  const tileSize = document.map.tileSize;
  const minTileX = Math.max(0, Math.floor((visible.minX - document.map.origin.x) / tileSize));
  const minTileY = Math.max(0, Math.floor((visible.minY - document.map.origin.y) / tileSize));
  const maxTileX = Math.min(document.map.width - 1, Math.ceil((visible.maxX - document.map.origin.x) / tileSize));
  const maxTileY = Math.min(document.map.height - 1, Math.ceil((visible.maxY - document.map.origin.y) / tileSize));
  context.save();
  context.globalAlpha = preferences.overlayOpacity;
  for (let y = minTileY; y <= maxTileY; y++) {
    for (let x = minTileX; x <= maxTileX; x++) {
      const index = tileIndex(document, x, y);
      const worldX = document.map.origin.x + x * tileSize;
      const worldY = document.map.origin.y + y * tileSize;
      if (preferences.layers.roads && document.layers.roads[index] !== 0) {
        context.fillStyle = '#1dcad3';
        context.fillRect(worldX, worldY, tileSize, tileSize);
      }
      if (preferences.layers.collision && document.layers.collision[index] !== 0) {
        context.fillStyle = '#e25083';
        context.fillRect(worldX, worldY, tileSize, tileSize);
      }
    }
  }
  context.restore();
  if (preferences.layers.grid && tileSize * scale >= 8) {
    context.save();
    context.strokeStyle = 'rgba(255,255,255,0.22)';
    context.lineWidth = 1 / scale;
    context.beginPath();
    for (let x = minTileX; x <= maxTileX + 1; x++) {
      const worldX = document.map.origin.x + x * tileSize;
      context.moveTo(worldX, document.map.origin.y + minTileY * tileSize);
      context.lineTo(worldX, document.map.origin.y + (maxTileY + 1) * tileSize);
    }
    for (let y = minTileY; y <= maxTileY + 1; y++) {
      const worldY = document.map.origin.y + y * tileSize;
      context.moveTo(document.map.origin.x + minTileX * tileSize, worldY);
      context.lineTo(document.map.origin.x + (maxTileX + 1) * tileSize, worldY);
    }
    context.stroke();
    context.restore();
  }
}

function drawCorridors(context: CanvasRenderingContext2D, document: LevelEditorDocument, scale: number, selection: EditorSelection): void {
  for (const corridor of document.lanes.corridors) {
    if (corridor.points.length === 0) continue;
    const selected = selection?.kind === 'corridor' && selection.id === corridor.id;
    context.save();
    context.strokeStyle = selected ? '#ffd44d' : '#40d9ef';
    context.fillStyle = selected ? '#ffd44d' : '#40d9ef';
    context.lineWidth = (selected ? 4 : 2) / scale;
    context.beginPath();
    context.moveTo(corridor.points[0].x, corridor.points[0].y);
    corridor.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.stroke();
    corridor.points.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x, point.y, (selected && selection.pointIndex === index ? 8 : 5) / scale, 0, Math.PI * 2);
      context.fill();
    });
    if (scale >= 0.12) drawLabel(context, corridor.id, corridor.points[0], scale, selected ? '#ffd44d' : '#b9eff7');
    context.restore();
  }
}

function drawJunctions(context: CanvasRenderingContext2D, document: LevelEditorDocument, scale: number, selection: EditorSelection): void {
  for (const junction of document.lanes.junctions) {
    const selected = selection?.kind === 'junction' && selection.id === junction.id;
    context.save();
    context.strokeStyle = selected ? '#ffd44d' : '#56e39f';
    context.fillStyle = 'rgba(86,227,159,0.18)';
    context.lineWidth = (selected ? 4 : 2) / scale;
    context.beginPath();
    context.arc(junction.x, junction.y, 12 / scale, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(junction.x - 8 / scale, junction.y);
    context.lineTo(junction.x + 8 / scale, junction.y);
    context.moveTo(junction.x, junction.y - 8 / scale);
    context.lineTo(junction.x, junction.y + 8 / scale);
    context.stroke();
    if (scale >= 0.18) drawLabel(context, junction.id, {x: junction.x, y: junction.y - 18 / scale}, scale, '#b9f8d7');
    context.restore();
  }
}

function drawSpawns(context: CanvasRenderingContext2D, document: LevelEditorDocument, scale: number, selection: EditorSelection): void {
  const colors: Record<EditorSpawn['kind'], string> = {
    player: '#f2c94c', pedestrian: '#f299c2', traffic: '#53c7ff', police: '#6e8cff', mission: '#ff8a5b'
  };
  for (const spawn of document.spawns) {
    if (!spawn.enabled) continue;
    const selected = selection?.kind === 'spawn' && selection.id === spawn.id;
    const radius = (selected ? 12 : 9) / scale;
    context.save();
    context.translate(spawn.x, spawn.y);
    context.rotate(spawn.angle);
    context.strokeStyle = selected ? '#fff' : colors[spawn.kind];
    context.fillStyle = colors[spawn.kind];
    context.lineWidth = (selected ? 4 : 2) / scale;
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(-radius * 0.7, -radius * 0.7);
    context.lineTo(-radius * 0.7, radius * 0.7);
    context.closePath();
    context.globalAlpha = 0.75;
    context.fill();
    context.globalAlpha = 1;
    context.stroke();
    context.restore();
    if (scale >= 0.15) drawLabel(context, spawn.label, {x: spawn.x, y: spawn.y - 18 / scale}, scale, colors[spawn.kind]);
  }
}

function drawRoadblocks(context: CanvasRenderingContext2D, document: LevelEditorDocument, scale: number, selection: EditorSelection): void {
  for (const roadblock of document.lanes.roadblocks ?? []) {
    const selected = selection?.kind === 'roadblock' && selection.id === roadblock.id;
    context.save();
    context.translate(roadblock.x, roadblock.y);
    context.rotate(roadblock.angle);
    context.strokeStyle = selected ? '#fff' : '#ff6f61';
    context.fillStyle = 'rgba(255,111,97,0.28)';
    context.lineWidth = (selected ? 4 : 2) / scale;
    context.fillRect(-30 / scale, -12 / scale, 60 / scale, 24 / scale);
    context.strokeRect(-30 / scale, -12 / scale, 60 / scale, 24 / scale);
    context.restore();
    context.save();
    context.strokeStyle = '#ff9b91';
    context.setLineDash([5 / scale, 4 / scale]);
    context.lineWidth = 1.5 / scale;
    context.beginPath();
    context.moveTo(roadblock.x, roadblock.y);
    context.lineTo(roadblock.stinger.x, roadblock.stinger.y);
    context.lineTo(roadblock.stinger.officerPose.x, roadblock.stinger.officerPose.y);
    context.stroke();
    context.restore();
    if (scale >= 0.15) drawLabel(context, roadblock.id, {x: roadblock.x, y: roadblock.y - 18 / scale}, scale, '#ffaaa1');
  }
}

function drawDraftCorridor(context: CanvasRenderingContext2D, points: Point2D[], cursor: Point2D, scale: number): void {
  if (points.length === 0) return;
  context.save();
  context.strokeStyle = '#ffd44d';
  context.fillStyle = '#ffd44d';
  context.lineWidth = 2 / scale;
  context.setLineDash([8 / scale, 5 / scale]);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.lineTo(cursor.x, cursor.y);
  context.stroke();
  for (const point of points) {
    context.beginPath();
    context.arc(point.x, point.y, 5 / scale, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawLabel(context: CanvasRenderingContext2D, label: string, point: Point2D, scale: number, color: string): void {
  context.save();
  context.font = `700 ${11 / scale}px ui-monospace, monospace`;
  context.textBaseline = 'bottom';
  context.lineWidth = 3 / scale;
  context.strokeStyle = 'rgba(0,0,0,0.9)';
  context.strokeText(label, point.x, point.y);
  context.fillStyle = color;
  context.fillText(label, point.x, point.y);
  context.restore();
}

function hitTest(
  document: LevelEditorDocument,
  world: Point2D,
  scale: number,
  preferences: EditorPreferences
): EditorSelection {
  const threshold = ENTITY_HIT_RADIUS_PX / scale;
  if (preferences.layers.spawns) {
    const spawn = nearest(document.spawns, world, threshold);
    if (spawn) return {kind: 'spawn', id: spawn.id};
  }
  if (preferences.layers.junctions) {
    const junction = nearest(document.lanes.junctions, world, threshold);
    if (junction) return {kind: 'junction', id: junction.id};
  }
  if (preferences.layers.roadblocks) {
    const roadblock = nearest(document.lanes.roadblocks ?? [], world, threshold);
    if (roadblock) return {kind: 'roadblock', id: roadblock.id};
  }
  if (preferences.layers.corridors) {
    let best: {id: string; pointIndex?: number; distance: number} | undefined;
    for (const corridor of document.lanes.corridors) {
      corridor.points.forEach((point, pointIndex) => {
        const candidate = distance(point, world);
        if (candidate <= threshold && (!best || candidate < best.distance)) best = {id: corridor.id, pointIndex, distance: candidate};
      });
      const lineDistance = distanceToPolyline(world, corridor.points);
      if (lineDistance <= threshold && (!best || lineDistance < best.distance)) best = {id: corridor.id, distance: lineDistance};
    }
    if (best) return {kind: 'corridor', id: best.id, pointIndex: best.pointIndex};
  }
  if (preferences.layers.collision || preferences.layers.roads) {
    const tile = worldToTile(document, world);
    const index = tileIndex(document, tile.x, tile.y);
    if (index >= 0) {
      const layer = preferences.layers.collision ? 'collision' : 'roads';
      return {kind: 'cell', layer, index, tileX: tile.x, tileY: tile.y};
    }
  }
  return undefined;
}

function moveSelection(
  document: LevelEditorDocument,
  selection: Exclude<EditorSelection, undefined>,
  dx: number,
  dy: number,
  snapSize: number
): LevelEditorDocument {
  if (selection.kind === 'cell') return document;
  if (selection.kind === 'spawn') {
    const spawns = document.spawns.map((spawn) => spawn.id === selection.id
      ? {...spawn, ...snapPoint({x: spawn.x + dx, y: spawn.y + dy}, snapSize)}
      : spawn);
    return {...document, spawns};
  }
  if (selection.kind === 'junction') {
    const junctions = document.lanes.junctions.map((junction) => junction.id === selection.id
      ? {...junction, ...snapPoint({x: junction.x + dx, y: junction.y + dy}, snapSize)}
      : junction);
    return {...document, lanes: {...document.lanes, junctions}};
  }
  if (selection.kind === 'roadblock') {
    const roadblocks = (document.lanes.roadblocks ?? []).map((roadblock) => {
      if (roadblock.id !== selection.id) return roadblock;
      const target = snapPoint({x: roadblock.x + dx, y: roadblock.y + dy}, snapSize);
      const moveX = target.x - roadblock.x;
      const moveY = target.y - roadblock.y;
      return {
        ...roadblock,
        ...target,
        vehiclePoses: roadblock.vehiclePoses.map((pose) => ({...pose, x: pose.x + moveX, y: pose.y + moveY})),
        stinger: {
          ...roadblock.stinger,
          x: roadblock.stinger.x + moveX,
          y: roadblock.stinger.y + moveY,
          officerPose: {
            ...roadblock.stinger.officerPose,
            x: roadblock.stinger.officerPose.x + moveX,
            y: roadblock.stinger.officerPose.y + moveY
          }
        }
      };
    });
    return {...document, lanes: {...document.lanes, roadblocks}};
  }
  const corridors = document.lanes.corridors.map((corridor) => {
    if (corridor.id !== selection.id) return corridor;
    if (selection.pointIndex !== undefined) {
      const points = corridor.points.map((point, index) => index === selection.pointIndex
        ? snapPoint({x: point.x + dx, y: point.y + dy}, snapSize)
        : point);
      return {...corridor, points};
    }
    const points = corridor.points.map((point) => snapPoint({x: point.x + dx, y: point.y + dy}, snapSize));
    return {...corridor, points};
  });
  return {...document, lanes: {...document.lanes, corridors}};
}

function paintMode(tool: EditorTool): {layer: 'collision' | 'roads'; value: number} | undefined {
  if (tool === 'collision-paint') return {layer: 'collision', value: 1};
  if (tool === 'collision-erase') return {layer: 'collision', value: 0};
  if (tool === 'road-paint') return {layer: 'roads', value: 1};
  if (tool === 'road-erase') return {layer: 'roads', value: 0};
  return undefined;
}

function nearest<T extends Point2D>(entities: T[], point: Point2D, threshold: number): T | undefined {
  let result: T | undefined;
  let best = threshold;
  for (const entity of entities) {
    const candidate = distance(entity, point);
    if (candidate <= best) {
      result = entity;
      best = candidate;
    }
  }
  return result;
}

function distanceToPolyline(point: Point2D, points: Point2D[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return distance(point, points[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index++) best = Math.min(best, distanceToSegment(point, points[index - 1], points[index]));
  return best;
}

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(point, start);
  const progress = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, {x: start.x + dx * progress, y: start.y + dy * progress});
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function snapPoint(point: Point2D, snapSize: number): Point2D {
  if (snapSize <= 1) return {x: Math.round(point.x), y: Math.round(point.y)};
  return {x: Math.round(point.x / snapSize) * snapSize, y: Math.round(point.y / snapSize) * snapSize};
}

function uniqueId(prefix: string, ids: string[]): string {
  const existing = new Set(ids);
  let index = 1;
  while (existing.has(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

function titleCase(value: string): string {
  return value.split('-').map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ');
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function fitView(canvas: HTMLCanvasElement, document: LevelEditorDocument, viewport: Viewport): void {
  const size = documentWorldSize(document);
  const padding = 28;
  viewport.scale = clamp(Math.min((canvas.clientWidth - padding * 2) / size.width, (canvas.clientHeight - padding * 2) / size.height), MIN_SCALE, MAX_SCALE);
  viewport.offsetX = (canvas.clientWidth - size.width * viewport.scale) / 2 - document.map.origin.x * viewport.scale;
  viewport.offsetY = (canvas.clientHeight - size.height * viewport.scale) / 2 - document.map.origin.y * viewport.scale;
}

function setScaleAround(canvas: HTMLCanvasElement, viewport: Viewport, requested: number, screenPoint: Point2D): void {
  const before = screenToWorld(screenPoint, viewport);
  viewport.scale = clamp(requested, MIN_SCALE, MAX_SCALE);
  viewport.offsetX = screenPoint.x - before.x * viewport.scale;
  viewport.offsetY = screenPoint.y - before.y * viewport.scale;
  if (!Number.isFinite(viewport.offsetX) || !Number.isFinite(viewport.offsetY)) {
    viewport.scale = 1;
    viewport.offsetX = canvas.clientWidth / 2;
    viewport.offsetY = canvas.clientHeight / 2;
  }
}

function centerOfCanvas(canvas: HTMLCanvasElement): Point2D {
  return {x: canvas.clientWidth / 2, y: canvas.clientHeight / 2};
}

function eventPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point2D {
  const bounds = canvas.getBoundingClientRect();
  return {x: clientX - bounds.left, y: clientY - bounds.top};
}

function screenToWorld(point: Point2D, viewport: Viewport): Point2D {
  return {x: (point.x - viewport.offsetX) / viewport.scale, y: (point.y - viewport.offsetY) / viewport.scale};
}

function visibleWorld(canvas: HTMLCanvasElement, viewport: Viewport): {minX: number; minY: number; maxX: number; maxY: number} {
  const topLeft = screenToWorld({x: 0, y: 0}, viewport);
  const bottomRight = screenToWorld({x: canvas.clientWidth, y: canvas.clientHeight}, viewport);
  return {minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y};
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
