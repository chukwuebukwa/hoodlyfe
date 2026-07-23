import {
  INTERIOR_GAME_DRAFT_STORAGE_KEY,
  INTERIORS,
  type InteriorDefinition,
  type InteriorObstacle
} from '../../shared/content/interior-catalog.ts';

import './interior-author.css';

type AuthorTool = 'door' | 'bounds' | 'exit' | 'obstacle' | 'service' | 'entry';
type InteriorKind = InteriorDefinition['kind'] | 'vehicle-store';
type DoorSide = InteriorDefinition['exteriorDoor']['side'];

interface AuthorInterior {
  id: string;
  label: string;
  kind: InteriorKind;
  roofTriangleCount: number;
  floorZ: number;
  exteriorDoor: {
    x: number;
    y: number;
    radius: number;
    exitX: number;
    exitY: number;
    side: DoorSide;
  };
  bounds: InteriorObstacle;
  entry: {x: number; y: number; angle: number};
  exitDoor: InteriorObstacle;
  obstacles: InteriorObstacle[];
  serviceAnchors: Array<{id: string; x: number; y: number}>;
}

interface GeometryPayload {
  blockSize: number;
  size: {width: number; height: number};
  occluders: Array<{
    id: string;
    bounds: {minX: number; minY: number; maxX: number; maxY: number};
    exteriorDoor: {x: number; y: number};
    floorZ: number;
    triangleCount: number;
  }>;
}

const STORAGE_KEY = 'nock0-interior-author-draft-v1';
let mapSize = 4096;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const PAN_THRESHOLD_PX = 5;
const DEFAULT_INTERIOR_SIZE = {width: 448, height: 256};
const CATALOG_INTERIOR_IDS = new Set(INTERIORS.map((interior) => interior.id));
const TOOL_HELP: Record<AuthorTool, {title: string; description: string}> = {
  door: {
    title: 'Door',
    description: 'Click the outside doorway on the building facade. This is what players walk into from the street.'
  },
  bounds: {
    title: 'Room Bounds',
    description: 'Click the center of the interior room. This creates the walkable room rectangle.'
  },
  exit: {
    title: 'Exit Trigger',
    description: 'Click inside the room near the door. Walking into this rectangle returns players to the street.'
  },
  obstacle: {
    title: 'Fixture',
    description: 'Click to add a blocking rectangle for counters, display pads, shelves, or interior dividers.'
  },
  service: {
    title: 'Service Anchor',
    description: 'Click where the interaction counter should be, like a salesperson or checkout spot.'
  },
  entry: {
    title: 'Player Spawn',
    description: 'Click where the player should appear after entering this interior.'
  }
};

const canvas = mustElement<HTMLCanvasElement>('author-canvas');
const context = canvasContext(canvas);

const controls = {
  select: mustElement<HTMLSelectElement>('interior-select'),
  id: mustElement<HTMLInputElement>('interior-id'),
  label: mustElement<HTMLInputElement>('interior-label'),
  kind: mustElement<HTMLSelectElement>('interior-kind'),
  doorSide: mustElement<HTMLSelectElement>('door-side'),
  toolButtons: mustElement<HTMLElement>('tool-buttons'),
  activeToolTitle: mustElement<HTMLElement>('active-tool-title'),
  activeToolDescription: mustElement<HTMLElement>('active-tool-description'),
  buildFlow: mustElement<HTMLElement>('build-flow'),
  pointerWorld: mustElement<HTMLElement>('pointer-world'),
  pointerTile: mustElement<HTMLElement>('pointer-tile'),
  zoom: mustElement<HTMLElement>('zoom-readout'),
  showExisting: mustElement<HTMLInputElement>('show-existing'),
  showRoofs: mustElement<HTMLInputElement>('show-roofs'),
  snapGrid: mustElement<HTMLInputElement>('snap-grid'),
  json: mustElement<HTMLTextAreaElement>('json-output'),
  copy: mustElement<HTMLButtonElement>('copy-json'),
  download: mustElement<HTMLButtonElement>('download-json'),
  vehicleStore: mustElement<HTMLButtonElement>('new-vehicle-store'),
  duplicate: mustElement<HTMLButtonElement>('duplicate-interior'),
  deleteInterior: mustElement<HTMLButtonElement>('delete-interior'),
  pushGameDraft: mustElement<HTMLButtonElement>('push-game-draft'),
  publishStatus: mustElement<HTMLElement>('publish-status'),
  undo: mustElement<HTMLButtonElement>('undo-change'),
  redo: mustElement<HTMLButtonElement>('redo-change'),
  revert: mustElement<HTMLButtonElement>('revert-interior')
};

const mapImage = new Image();
mapImage.src = '/assets/maps/district-preview.png';

let geometry: GeometryPayload = {blockSize: 64, size: {width: 64, height: 64}, occluders: []};
let interiors = loadDraft();
let selectedId = interiors[0]?.id ?? '';
let history = [snapshot()];
let historyIndex = 0;
let tool: AuthorTool = 'door';
let zoom = 0.42;
let offsetX = 120;
let offsetY = 64;
let pointerDrag:
  | {id: number; x: number; y: number; offsetX: number; offsetY: number; panning: boolean}
  | undefined;
let pointerWorld = {x: 0, y: 0};

void fetch('/assets/maps/geometry/world.json')
  .then((response) => response.json())
  .then((payload: GeometryPayload) => {
    geometry = payload;
    mapSize = payload.size.width * payload.blockSize;
    draw();
  })
  .catch(() => draw());

mapImage.addEventListener('load', draw);
window.addEventListener('resize', resize);
window.addEventListener('keydown', onKeyDown);
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerCancel);
canvas.addEventListener('wheel', onWheel, {passive: false});

controls.select.addEventListener('change', () => {
  selectedId = controls.select.value;
  syncForm();
  draw();
});

for (const input of [controls.id, controls.label, controls.kind, controls.doorSide]) {
  input.addEventListener('input', () => applyForm(false));
  input.addEventListener('change', () => applyForm(true));
}

for (const input of [controls.showExisting, controls.showRoofs, controls.snapGrid]) {
  input.addEventListener('change', draw);
}

controls.toolButtons.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
  if (!button) return;
  tool = button.dataset.tool as AuthorTool;
  updateToolButtons();
  draw();
});

controls.vehicleStore.addEventListener('click', () => {
  const id = uniqueId('new-interior');
  const created = vehicleStoreDraft(id, pointerWorld.x || 1152, pointerWorld.y || 2304);
  interiors.push(created);
  selectedId = created.id;
  tool = 'door';
  persist();
  commitHistory();
  syncUi();
});

controls.duplicate.addEventListener('click', () => {
  const current = selected();
  if (!current) return;
  const copy = structuredClone(current);
  copy.id = uniqueId(`${current.id}-copy`);
  copy.label = `${current.label} Copy`;
  copy.exteriorDoor.x += 64;
  copy.exteriorDoor.y += 64;
  copy.exteriorDoor.exitX += 64;
  copy.exteriorDoor.exitY += 64;
  interiors.push(copy);
  selectedId = copy.id;
  persist();
  commitHistory();
  syncUi();
});

controls.undo.addEventListener('click', undo);
controls.redo.addEventListener('click', redo);
controls.revert.addEventListener('click', revertSelectedInterior);
controls.deleteInterior.addEventListener('click', deleteSelectedInterior);
controls.pushGameDraft.addEventListener('click', pushGameDraft);

controls.copy.addEventListener('click', async () => {
  controls.json.select();
  await navigator.clipboard?.writeText(controls.json.value);
});

controls.download.addEventListener('click', () => {
  const blob = new Blob([controls.json.value], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'interiors.draft.json';
  link.click();
  URL.revokeObjectURL(url);
});

resize();
syncUi();

function loadDraft(): AuthorInterior[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as AuthorInterior[];
      if (Array.isArray(parsed) && parsed.length > 0) return withCatalogInteriors(parsed);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return INTERIORS.map(fromCatalog);
}

function withCatalogInteriors(draft: AuthorInterior[]): AuthorInterior[] {
  const byId = new Map(draft.map((interior) => [interior.id, interior]));
  for (const catalog of INTERIORS) {
    if (!byId.has(catalog.id)) byId.set(catalog.id, fromCatalog(catalog));
  }
  return [...byId.values()];
}

function fromCatalog(interior: InteriorDefinition): AuthorInterior {
  return {
    id: interior.id,
    label: interior.label,
    kind: interior.kind,
    roofTriangleCount: interior.roofTriangleCount,
    floorZ: interior.floorZ,
    exteriorDoor: {...interior.exteriorDoor},
    bounds: {...interior.bounds},
    entry: {...interior.entry},
    exitDoor: {...interior.exitDoor},
    obstacles: interior.obstacles.map((obstacle) => ({...obstacle})),
    serviceAnchors: interior.serviceAnchors.map((anchor) => ({...anchor}))
  };
}

function vehicleStoreDraft(id: string, doorX: number, doorY: number): AuthorInterior {
  const bounds = {
    minX: doorX - DEFAULT_INTERIOR_SIZE.width / 2,
    minY: doorY - DEFAULT_INTERIOR_SIZE.height + 32,
    maxX: doorX + DEFAULT_INTERIOR_SIZE.width / 2,
    maxY: doorY + 32
  };
  return {
    id,
    label: 'Vehicle Store',
    kind: 'vehicle-store',
    roofTriangleCount: 0,
    floorZ: 132,
    exteriorDoor: {
      x: doorX,
      y: doorY,
      radius: 24,
      exitX: doorX,
      exitY: doorY + 28,
      side: 'south'
    },
    bounds,
    entry: {x: doorX, y: bounds.maxY - 48, angle: -Math.PI / 2},
    exitDoor: {minX: doorX - 34, minY: bounds.maxY - 44, maxX: doorX + 34, maxY: bounds.maxY - 12},
    obstacles: [
      {minX: bounds.minX + 36, minY: bounds.minY + 44, maxX: bounds.minX + 150, maxY: bounds.minY + 96},
      {minX: bounds.minX + 172, minY: bounds.minY + 44, maxX: bounds.minX + 286, maxY: bounds.minY + 96},
      {minX: bounds.maxX - 118, minY: bounds.minY + 58, maxX: bounds.maxX - 42, maxY: bounds.minY + 124}
    ],
    serviceAnchors: [{id: 'vehicle-store-counter', x: bounds.maxX - 78, y: bounds.minY + 148}]
  };
}

function selected(): AuthorInterior | undefined {
  return interiors.find((interior) => interior.id === selectedId) ?? interiors[0];
}

function syncUi(): void {
  controls.select.innerHTML = '';
  for (const interior of interiors) {
    const option = document.createElement('option');
    option.value = interior.id;
    option.textContent = `${interior.label} (${interior.id})`;
    controls.select.append(option);
  }
  controls.select.value = selectedId;
  syncForm();
  updateToolButtons();
  updateHistoryButtons();
  updateJson();
  draw();
}

function syncForm(): void {
  const current = selected();
  if (!current) return;
  selectedId = current.id;
  controls.id.value = current.id;
  controls.label.value = current.label;
  controls.kind.value = current.kind;
  controls.doorSide.value = current.exteriorDoor.side;
}

function applyForm(commit = true): void {
  const current = selected();
  if (!current) return;
  const previousId = current.id;
  current.id = slug(controls.id.value) || previousId;
  current.label = controls.label.value || current.label;
  current.kind = controls.kind.value as InteriorKind;
  current.exteriorDoor.side = controls.doorSide.value as DoorSide;
  selectedId = current.id;
  persist();
  if (commit) commitHistory();
  syncUi();
}

function updateToolButtons(): void {
  const help = TOOL_HELP[tool];
  controls.activeToolTitle.textContent = help.title;
  controls.activeToolDescription.textContent = help.description;
  for (const button of Array.from(controls.toolButtons.querySelectorAll<HTMLButtonElement>('[data-tool]'))) {
    button.classList.toggle('active', button.dataset.tool === tool);
  }
  for (const step of Array.from(controls.buildFlow.querySelectorAll<HTMLElement>('[data-step]'))) {
    step.classList.toggle('active', step.dataset.step === tool);
  }
}

function updateJson(): void {
  controls.json.value = JSON.stringify(exportPayload(), null, 2);
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(interiors));
  updateJson();
  updateHistoryButtons();
}

function exportPayload(): {version: number; generatedBy: string; interiors: AuthorInterior[]} {
  return {
    version: 1,
    generatedBy: 'nock0-interior-author',
    interiors
  };
}

function snapshot(): string {
  return JSON.stringify({interiors, selectedId});
}

function restore(value: string): void {
  const parsed = JSON.parse(value) as {interiors: AuthorInterior[]; selectedId: string};
  interiors = withCatalogInteriors(parsed.interiors);
  selectedId = interiors.some((interior) => interior.id === parsed.selectedId)
    ? parsed.selectedId
    : interiors[0]?.id ?? '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(interiors));
  syncUi();
}

function pushHistory(): void {
  const current = snapshot();
  if (history[historyIndex] === current) return;
  history = history.slice(0, historyIndex + 1);
  history.push(current);
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function commitHistory(): void {
  const current = snapshot();
  if (history[historyIndex] === current) return;
  history = history.slice(0, historyIndex + 1);
  history.push(current);
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function undo(): void {
  if (historyIndex <= 0) return;
  historyIndex--;
  restore(history[historyIndex]);
}

function redo(): void {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restore(history[historyIndex]);
}

function updateHistoryButtons(): void {
  controls.undo.disabled = historyIndex <= 0;
  controls.redo.disabled = historyIndex >= history.length - 1;
  controls.deleteInterior.disabled = !selected() || isCatalogInterior(selected()?.id ?? '');
}

function revertSelectedInterior(): void {
  const current = selected();
  if (!current) return;
  const original = INTERIORS.find((interior) => interior.id === current.id);
  if (!original) {
    interiors = interiors.filter((interior) => interior.id !== current.id);
    selectedId = interiors[0]?.id ?? '';
    persist();
    commitHistory();
    syncUi();
    return;
  }
  const index = interiors.findIndex((interior) => interior.id === current.id);
  interiors[index] = fromCatalog(original);
  selectedId = original.id;
  persist();
  commitHistory();
  syncUi();
}

function deleteSelectedInterior(): void {
  const current = selected();
  if (!current) return;
  if (isCatalogInterior(current.id)) {
    controls.publishStatus.textContent = `${current.label} is a stock interior. Use Revert Selected Interior to reset it; delete only removes custom interiors.`;
    updateHistoryButtons();
    return;
  }
  const confirmed = window.confirm(`Delete ${current.label} (${current.id}) from this draft?`);
  if (!confirmed) return;
  const index = interiors.findIndex((interior) => interior.id === current.id);
  interiors = interiors.filter((interior) => interior.id !== current.id);
  selectedId = interiors[Math.max(0, index - 1)]?.id ?? interiors[0]?.id ?? '';
  controls.publishStatus.textContent = `Deleted ${current.label} from the author draft.`;
  persist();
  commitHistory();
  syncUi();
}

function isCatalogInterior(id: string): boolean {
  return CATALOG_INTERIOR_IDS.has(id);
}

function pushGameDraft(): void {
  const payload = exportPayload();
  localStorage.setItem(INTERIOR_GAME_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  controls.publishStatus.textContent = `Pushed ${payload.interiors.length} interiors to local game draft storage. Reload the game tab to see draft doors/minimap/interior shells. Server enter/exit still needs wiring.`;
}

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
  draw();
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  pointerWorld = pointerForEvent(event);
  pointerDrag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    offsetX,
    offsetY,
    panning: false
  };
  updatePointerReadout();
  draw();
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const editingText = target?.matches('input, textarea, select');
  if (event.key === 'Escape') {
    cancelPointerDrag();
    return;
  }
  if (editingText) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
}

function onPointerMove(event: PointerEvent): void {
  if (pointerDrag?.id === event.pointerId) {
    const deltaX = event.clientX - pointerDrag.x;
    const deltaY = event.clientY - pointerDrag.y;
    if (
      pointerDrag.panning ||
      Math.hypot(deltaX, deltaY) >= PAN_THRESHOLD_PX
    ) {
      pointerDrag.panning = true;
      offsetX = pointerDrag.offsetX + deltaX;
      offsetY = pointerDrag.offsetY + deltaY;
      pointerWorld = pointerForEvent(event);
      updatePointerReadout();
      canvas.classList.add('panning');
      draw();
      return;
    }
  }
  pointerWorld = pointerForEvent(event);
  updatePointerReadout();
  draw();
}

function onPointerUp(event: PointerEvent): void {
  if (pointerDrag?.id === event.pointerId) {
    const wasPanning = pointerDrag.panning;
    pointerDrag = undefined;
    canvas.classList.remove('panning');
    canvas.releasePointerCapture(event.pointerId);
    if (!wasPanning) {
      pointerWorld = pointerForEvent(event);
      placeAt(pointerWorld);
      updatePointerReadout();
    }
    draw();
    return;
  }
  canvas.classList.remove('panning');
  canvas.releasePointerCapture(event.pointerId);
}

function onPointerCancel(event: PointerEvent): void {
  if (pointerDrag?.id === event.pointerId) cancelPointerDrag(event.pointerId);
}

function cancelPointerDrag(pointerId = pointerDrag?.id): void {
  pointerDrag = undefined;
  canvas.classList.remove('panning');
  if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }
  draw();
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const before = pointerForEvent(event);
  const factor = event.deltaY < 0 ? 1.12 : 0.88;
  zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const rect = canvas.getBoundingClientRect();
  offsetX = event.clientX - rect.left - before.x * zoom;
  offsetY = event.clientY - rect.top - before.y * zoom;
  controls.zoom.textContent = `${Math.round(zoom * 100)}%`;
  draw();
}

function pointerForEvent(event: MouseEvent): {x: number; y: number} {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left - offsetX) / zoom;
  const y = (event.clientY - rect.top - offsetY) / zoom;
  const snapped = controls.snapGrid.checked ? 8 : 1;
  return {
    x: clamp(Math.round(x / snapped) * snapped, 0, mapSize),
    y: clamp(Math.round(y / snapped) * snapped, 0, mapSize)
  };
}

function placeAt(point: {x: number; y: number}): void {
  const current = selected();
  if (!current) return;
  if (tool === 'door') {
    current.exteriorDoor.x = point.x;
    current.exteriorDoor.y = point.y;
    current.exteriorDoor.exitX = point.x;
    current.exteriorDoor.exitY = point.y + (current.exteriorDoor.side === 'south' ? 28 : 0);
    if (current.exteriorDoor.side === 'east') current.exteriorDoor.exitX = point.x + 28;
  } else if (tool === 'bounds') {
    current.bounds = centeredRect(point.x, point.y, DEFAULT_INTERIOR_SIZE.width, DEFAULT_INTERIOR_SIZE.height);
  } else if (tool === 'exit') {
    current.exitDoor = centeredRect(point.x, point.y, 68, 32);
  } else if (tool === 'obstacle') {
    current.obstacles.push(centeredRect(point.x, point.y, 96, 48));
  } else if (tool === 'service') {
    current.serviceAnchors.push({
      id: uniqueServiceId(current),
      x: point.x,
      y: point.y
    });
  } else {
    current.entry = {x: point.x, y: point.y, angle: -Math.PI / 2};
  }
  persist();
  commitHistory();
  draw();
}

function draw(): void {
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  context.save();
  context.translate(offsetX, offsetY);
  context.scale(zoom, zoom);
  context.fillStyle = '#070909';
  context.fillRect(0, 0, mapSize, mapSize);
  if (mapImage.complete) context.drawImage(mapImage, 0, 0, mapSize, mapSize);
  drawGrid();
  if (controls.showRoofs.checked) drawRoofs();
  if (controls.showExisting.checked) {
    for (const interior of interiors) drawInterior(interior, interior.id === selectedId);
  } else {
    const current = selected();
    if (current) drawInterior(current, true);
  }
  drawToolPreview(pointerWorld.x, pointerWorld.y);
  drawCrosshair(pointerWorld.x, pointerWorld.y);
  context.restore();
}

function drawGrid(): void {
  context.strokeStyle = 'rgba(255,255,255,0.055)';
  context.lineWidth = 1 / zoom;
  for (let line = 0; line <= mapSize; line += 64) {
    context.beginPath();
    context.moveTo(line, 0);
    context.lineTo(line, mapSize);
    context.stroke();
    context.beginPath();
    context.moveTo(0, line);
    context.lineTo(mapSize, line);
    context.stroke();
  }
}

function drawRoofs(): void {
  context.lineWidth = 2 / zoom;
  for (const roof of geometry.occluders) {
    const bounds = {
      minX: roof.bounds.minX * geometry.blockSize,
      minY: roof.bounds.minY * geometry.blockSize,
      maxX: roof.bounds.maxX * geometry.blockSize,
      maxY: roof.bounds.maxY * geometry.blockSize
    };
    context.fillStyle = 'rgba(242, 201, 76, 0.12)';
    context.strokeStyle = 'rgba(242, 201, 76, 0.7)';
    rectPath(bounds);
    context.fill();
    context.stroke();
  }
}

function drawInterior(interior: AuthorInterior, active: boolean): void {
  context.lineWidth = (active ? 4 : 2) / zoom;
  context.fillStyle = active ? 'rgba(85, 214, 255, 0.13)' : 'rgba(255, 255, 255, 0.08)';
  context.strokeStyle = active ? '#55d6ff' : 'rgba(255,255,255,0.45)';
  rectPath(interior.bounds);
  context.fill();
  context.stroke();

  context.fillStyle = '#f2c94c';
  marker(interior.exteriorDoor.x, interior.exteriorDoor.y, 14);
  label(interior.label, interior.exteriorDoor.x + 16, interior.exteriorDoor.y - 12, '#f2c94c');

  context.fillStyle = 'rgba(255,127,182,0.35)';
  context.strokeStyle = '#ff7fb6';
  rectPath(interior.exitDoor);
  context.fill();
  context.stroke();

  context.fillStyle = '#63df8a';
  marker(interior.entry.x, interior.entry.y, 10);

  context.fillStyle = 'rgba(255,255,255,0.25)';
  context.strokeStyle = 'rgba(255,255,255,0.8)';
  for (const obstacle of interior.obstacles) {
    rectPath(obstacle);
    context.fill();
    context.stroke();
  }

  context.fillStyle = '#ff7fb6';
  for (const anchor of interior.serviceAnchors) {
    marker(anchor.x, anchor.y, 9);
    label(anchor.id, anchor.x + 10, anchor.y + 4, '#ff7fb6');
  }
}

function drawToolPreview(x: number, y: number): void {
  context.save();
  context.lineWidth = 3 / zoom;
  context.setLineDash([10 / zoom, 6 / zoom]);
  if (tool === 'bounds') {
    context.fillStyle = 'rgba(85, 214, 255, 0.12)';
    context.strokeStyle = '#55d6ff';
    rectPath(centeredRect(x, y, DEFAULT_INTERIOR_SIZE.width, DEFAULT_INTERIOR_SIZE.height));
    context.fill();
    context.stroke();
  } else if (tool === 'exit') {
    context.fillStyle = 'rgba(255, 127, 182, 0.18)';
    context.strokeStyle = '#ff7fb6';
    rectPath(centeredRect(x, y, 68, 32));
    context.fill();
    context.stroke();
  } else if (tool === 'obstacle') {
    context.fillStyle = 'rgba(255, 255, 255, 0.16)';
    context.strokeStyle = 'rgba(255,255,255,0.82)';
    rectPath(centeredRect(x, y, 96, 48));
    context.fill();
    context.stroke();
  } else if (tool === 'door') {
    context.fillStyle = 'rgba(242, 201, 76, 0.3)';
    context.strokeStyle = '#f2c94c';
    context.beginPath();
    context.arc(x, y, 18, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else if (tool === 'service') {
    context.fillStyle = 'rgba(255, 127, 182, 0.3)';
    context.strokeStyle = '#ff7fb6';
    context.beginPath();
    context.arc(x, y, 14, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else {
    context.fillStyle = 'rgba(99, 223, 138, 0.3)';
    context.strokeStyle = '#63df8a';
    context.beginPath();
    context.arc(x, y, 14, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawCrosshair(x: number, y: number): void {
  context.strokeStyle = 'rgba(255,255,255,0.55)';
  context.lineWidth = 1 / zoom;
  context.beginPath();
  context.moveTo(x - 18, y);
  context.lineTo(x + 18, y);
  context.moveTo(x, y - 18);
  context.lineTo(x, y + 18);
  context.stroke();
}

function rectPath(rect: InteriorObstacle): void {
  context.beginPath();
  context.rect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
}

function marker(x: number, y: number, radius: number): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function label(text: string, x: number, y: number, color: string): void {
  context.save();
  context.scale(1 / zoom, 1 / zoom);
  context.font = '800 12px Inter, Arial, sans-serif';
  context.lineWidth = 4;
  context.strokeStyle = '#050708';
  context.fillStyle = color;
  context.strokeText(text, x * zoom, y * zoom);
  context.fillText(text, x * zoom, y * zoom);
  context.restore();
}

function updatePointerReadout(): void {
  controls.pointerWorld.textContent = `${Math.round(pointerWorld.x)}, ${Math.round(pointerWorld.y)}`;
  controls.pointerTile.textContent = `${Math.floor(pointerWorld.x / 64)}, ${Math.floor(pointerWorld.y / 64)}`;
  controls.zoom.textContent = `${Math.round(zoom * 100)}%`;
}

function centeredRect(x: number, y: number, width: number, height: number): InteriorObstacle {
  return {
    minX: Math.round(x - width / 2),
    minY: Math.round(y - height / 2),
    maxX: Math.round(x + width / 2),
    maxY: Math.round(y + height / 2)
  };
}

function uniqueId(base: string): string {
  let id = slug(base);
  let index = 2;
  while (interiors.some((interior) => interior.id === id)) {
    id = `${slug(base)}-${index++}`;
  }
  return id;
}

function uniqueServiceId(interior: AuthorInterior): string {
  let id = `${interior.id}-service`;
  let index = 2;
  while (interior.serviceAnchors.some((anchor) => anchor.id === id)) {
    id = `${interior.id}-service-${index++}`;
  }
  return id;
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

function canvasContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const value = target.getContext('2d');
  if (!value) throw new Error('Interior author canvas unavailable.');
  return value;
}
