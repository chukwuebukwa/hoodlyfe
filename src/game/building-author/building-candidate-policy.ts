export type BuilderTemplate = 'store' | 'garage';
export type BuildingFacadeSide = 'north' | 'east' | 'south' | 'west';

export interface BuildingAuthorGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly collisions: readonly number[];
  readonly surfaces: readonly number[];
}

export interface BuildingCandidateCell {
  readonly column: number;
  readonly row: number;
  readonly surface: number;
}

export interface BuildingFacadeEdge {
  readonly side: BuildingFacadeSide;
  readonly start: number;
  readonly end: number;
  readonly fixed: number;
  readonly length: number;
}

export interface BuildingCandidate {
  readonly id: string;
  readonly cells: readonly BuildingCandidateCell[];
  readonly bounds: Readonly<{minX: number; minY: number; maxX: number; maxY: number}>;
  readonly sourceBounds: Readonly<{minX: number; minY: number; maxX: number; maxY: number}>;
  readonly footprints: readonly Readonly<{minX: number; minY: number; maxX: number; maxY: number}>[];
  readonly facades: readonly BuildingFacadeEdge[];
  readonly floorZ: number;
  readonly roofZ: number;
  readonly valid: boolean;
  readonly reason?: string;
}

export interface AuthoredBuildingReference {
  readonly id: string;
  readonly label: string;
  readonly footprints: readonly Readonly<{minX: number; minY: number; maxX: number; maxY: number}>[];
}

export interface BuildingAuthorDraft {
  readonly version: 1;
  readonly generatedBy: 'nock0-builder-gun';
  readonly status: 'needs-export';
  readonly candidateId: string;
  readonly building: {
    readonly id: string;
    readonly label: string;
    readonly mode: 'seamless-cutaway';
    readonly kind: BuilderTemplate;
    readonly floorZ: number;
    readonly roofHeight: number;
    readonly shell: {
      readonly cutawayMode: 'complete-above-floor';
      readonly bounds: Readonly<{
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        minZ: number;
        maxZ: number;
      }>;
      readonly expectedTriangleCount: null;
    };
    readonly bounds: BuildingCandidate['sourceBounds'];
    readonly footprints: BuildingCandidate['footprints'];
    readonly floorConnectors: readonly Readonly<{minX: number; minY: number; maxX: number; maxY: number}>[];
    readonly revealAreas: readonly Readonly<{minX: number; minY: number; maxX: number; maxY: number}>[];
    readonly entrance: Readonly<{side: BuildingFacadeSide; x: number; y: number; width: number}>;
    readonly garageDoor?: Readonly<{
      height: number;
      thickness: number;
      openRadius: number;
      animationMs: number;
      holdOpenMs: number;
    }>;
    readonly signage: Readonly<{exterior: string; service: string}>;
    readonly serviceBindings: readonly Readonly<{
      id: string;
      type: 'shop' | 'repair';
      label: string;
      x: number;
      y: number;
    }>[];
    readonly obstacles: readonly Readonly<{
      id: string;
      kind: 'wall' | 'counter' | 'shelf';
      bounds: Readonly<{minX: number; minY: number; maxX: number; maxY: number}>;
      height: number;
      color: string;
    }>[];
  };
}

const MAX_CANDIDATE_CELLS = 512;
const MIN_CANDIDATE_CELLS = 4;

export function resolveBuildingCandidateAt(
  grid: BuildingAuthorGrid,
  worldX: number,
  worldY: number
): BuildingCandidate | undefined {
  validateGrid(grid);
  const column = Math.floor(worldX / grid.tileSize);
  const row = Math.floor(worldY / grid.tileSize);
  if (!inside(grid, column, row) || !blocked(grid, column, row)) return undefined;

  const pending = [{column, row}];
  const visited = new Set<number>([indexOf(grid, column, row)]);
  for (let offset = 0; offset < pending.length; offset++) {
    const current = pending[offset];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextColumn = current.column + dx;
      const nextRow = current.row + dy;
      if (!inside(grid, nextColumn, nextRow) || !blocked(grid, nextColumn, nextRow)) continue;
      const nextIndex = indexOf(grid, nextColumn, nextRow);
      if (visited.has(nextIndex)) continue;
      visited.add(nextIndex);
      pending.push({column: nextColumn, row: nextRow});
      if (pending.length > MAX_CANDIDATE_CELLS) break;
    }
    if (pending.length > MAX_CANDIDATE_CELLS) break;
  }

  const cells = pending.map(({column: cellColumn, row: cellRow}) => Object.freeze({
    column: cellColumn,
    row: cellRow,
    surface: grid.surfaces[indexOf(grid, cellColumn, cellRow)] ?? 0
  }));
  const minColumn = Math.min(...cells.map((cell) => cell.column));
  const maxColumn = Math.max(...cells.map((cell) => cell.column));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const floorZ = estimateFloorZ(grid, cells);
  const roofZ = Math.max(...cells.map((cell) => cell.surface));
  const elevatedCells = cells.filter((cell) => cell.surface > floorZ).length;
  const validSize = cells.length >= MIN_CANDIDATE_CELLS && cells.length <= MAX_CANDIDATE_CELLS;
  const elevated = elevatedCells / cells.length >= 0.75 && roofZ > floorZ;
  const reason = !validSize
    ? cells.length > MAX_CANDIDATE_CELLS ? 'Connected structure is too large.' : 'Structure is too small.'
    : !elevated ? 'Selection does not resolve to an elevated building roof.' : undefined;
  const sourceBounds = Object.freeze({
    minX: minColumn,
    minY: minRow,
    maxX: maxColumn + 1,
    maxY: maxRow + 1
  });

  return Object.freeze({
    id: candidateId(cells),
    cells: Object.freeze(cells),
    bounds: Object.freeze({
      minX: sourceBounds.minX * grid.tileSize,
      minY: sourceBounds.minY * grid.tileSize,
      maxX: sourceBounds.maxX * grid.tileSize,
      maxY: sourceBounds.maxY * grid.tileSize
    }),
    sourceBounds,
    footprints: Object.freeze(collapseCells(cells)),
    facades: Object.freeze(facadeEdges(grid, cells)),
    floorZ,
    roofZ,
    valid: validSize && elevated,
    reason
  });
}

export function nearestBuildingFacade(
  candidate: BuildingCandidate,
  worldX: number,
  worldY: number,
  minimumWidth: number
): BuildingFacadeEdge | undefined {
  return candidate.facades
    .filter((edge) => edge.length >= minimumWidth)
    .map((edge) => ({edge, distance: distanceToEdge(edge, worldX, worldY)}))
    .sort((left, right) => left.distance - right.distance || facadeKey(left.edge).localeCompare(facadeKey(right.edge)))[0]
    ?.edge;
}

export function authoredBuildingOverlapping(
  candidate: BuildingCandidate,
  buildings: readonly AuthoredBuildingReference[]
): AuthoredBuildingReference | undefined {
  const tileSize = (candidate.bounds.maxX - candidate.bounds.minX) /
    (candidate.sourceBounds.maxX - candidate.sourceBounds.minX);
  return buildings.find((building) => building.footprints.some((authored) => (
    candidate.cells.some((cell) => {
      const centerX = (cell.column + 0.5) * tileSize;
      const centerY = (cell.row + 0.5) * tileSize;
      return centerX > authored.minX && centerX < authored.maxX && centerY > authored.minY && centerY < authored.maxY;
    })
  )));
}

export function createBuildingAuthorDraft(
  candidate: BuildingCandidate,
  template: BuilderTemplate,
  facade: BuildingFacadeEdge,
  worldX: number,
  worldY: number,
  tileSize = 64
): BuildingAuthorDraft {
  if (!candidate.valid) throw new Error(candidate.reason ?? 'Invalid building candidate.');
  const entranceWidth = template === 'garage' ? 2.5 : 0.875;
  if (facade.length < entranceWidth * tileSize) {
    throw new Error(`Selected facade is too short for a ${template} entrance.`);
  }
  const entrance = entranceOnFacade(facade, worldX, worldY, entranceWidth, tileSize);
  const id = `${template}-${candidate.id}`;
  const label = template === 'garage' ? 'New Garage' : 'New Convenience Store';
  const bounds = candidate.sourceBounds;
  const layoutBounds = largestRect(candidate.footprints);
  const servicePoint = interiorServicePoint(layoutBounds, entrance.side);
  const floorConnectors = footprintConnectors(candidate.footprints);
  const obstacles = [
    ...perimeterWalls(candidate.facades, entrance, tileSize),
    ...templateObstacles(template, layoutBounds, entrance.side)
  ];
  return Object.freeze({
    version: 1,
    generatedBy: 'nock0-builder-gun',
    status: 'needs-export',
    candidateId: candidate.id,
    building: Object.freeze({
      id,
      label,
      mode: 'seamless-cutaway',
      kind: template,
      floorZ: candidate.floorZ,
      roofHeight: Math.max(1, candidate.roofZ - candidate.floorZ),
      shell: Object.freeze({
        cutawayMode: 'complete-above-floor',
        bounds: Object.freeze({
          minX: bounds.minX - 0.5,
          minY: bounds.minY - 0.5,
          maxX: bounds.maxX + 0.5,
          maxY: bounds.maxY + 0.5,
          minZ: candidate.floorZ + 0.9,
          maxZ: candidate.roofZ + 1.1
        }),
        expectedTriangleCount: null
      }),
      bounds,
      footprints: candidate.footprints,
      floorConnectors: Object.freeze(floorConnectors),
      revealAreas: Object.freeze(candidate.footprints.map((rect) => insetRect(rect, 0.21875))),
      entrance,
      garageDoor: template === 'garage' ? Object.freeze({
        height: 2.25,
        thickness: 0.1875,
        openRadius: 2.75,
        animationMs: 700,
        holdOpenMs: 1200
      }) : undefined,
      signage: Object.freeze({
        exterior: template === 'garage' ? 'NEW AUTO' : 'QUICK MART',
        service: template === 'garage' ? 'REPAIR BAYS' : 'CHECKOUT'
      }),
      serviceBindings: Object.freeze([Object.freeze({
        id: template === 'garage' ? `${id}-repair` : `${id}-checkout`,
        type: template === 'garage' ? 'repair' : 'shop',
        label: template === 'garage' ? 'Repair Garage' : 'Store Checkout',
        x: servicePoint.x,
        y: servicePoint.y
      })]),
      obstacles: Object.freeze(obstacles)
    })
  });
}

function facadeEdges(grid: BuildingAuthorGrid, cells: readonly BuildingCandidateCell[]): BuildingFacadeEdge[] {
  const occupied = new Set(cells.map((cell) => indexOf(grid, cell.column, cell.row)));
  const units: Array<{side: BuildingFacadeSide; start: number; end: number; fixed: number}> = [];
  for (const cell of cells) {
    if (!occupied.has(indexOf(grid, cell.column, cell.row - 1))) {
      units.push({side: 'north', start: cell.column, end: cell.column + 1, fixed: cell.row});
    }
    if (!occupied.has(indexOf(grid, cell.column + 1, cell.row))) {
      units.push({side: 'east', start: cell.row, end: cell.row + 1, fixed: cell.column + 1});
    }
    if (!occupied.has(indexOf(grid, cell.column, cell.row + 1))) {
      units.push({side: 'south', start: cell.column, end: cell.column + 1, fixed: cell.row + 1});
    }
    if (!occupied.has(indexOf(grid, cell.column - 1, cell.row))) {
      units.push({side: 'west', start: cell.row, end: cell.row + 1, fixed: cell.column});
    }
  }
  const grouped = new Map<string, typeof units>();
  for (const unit of units) {
    const key = `${unit.side}:${unit.fixed}`;
    const group = grouped.get(key) ?? [];
    group.push(unit);
    grouped.set(key, group);
  }
  const edges: BuildingFacadeEdge[] = [];
  for (const group of grouped.values()) {
    group.sort((left, right) => left.start - right.start);
    let current = {...group[0]};
    for (const unit of group.slice(1)) {
      if (unit.start === current.end) {
        current.end = unit.end;
      } else {
        edges.push(scaleEdge(current, grid.tileSize));
        current = {...unit};
      }
    }
    edges.push(scaleEdge(current, grid.tileSize));
  }
  return edges.sort((left, right) => facadeKey(left).localeCompare(facadeKey(right)));
}

function scaleEdge(
  edge: {side: BuildingFacadeSide; start: number; end: number; fixed: number},
  tileSize: number
): BuildingFacadeEdge {
  return Object.freeze({
    side: edge.side,
    start: edge.start * tileSize,
    end: edge.end * tileSize,
    fixed: edge.fixed * tileSize,
    length: (edge.end - edge.start) * tileSize
  });
}

function collapseCells(cells: readonly BuildingCandidateCell[]): Array<Readonly<{
  minX: number; minY: number; maxX: number; maxY: number;
}>> {
  const rows = new Map<number, Array<{start: number; end: number}>>();
  for (const cell of cells) {
    const entries = rows.get(cell.row) ?? [];
    entries.push({start: cell.column, end: cell.column + 1});
    rows.set(cell.row, entries);
  }
  const runs: Array<{minX: number; maxX: number; minY: number; maxY: number}> = [];
  for (const [row, entries] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    entries.sort((left, right) => left.start - right.start);
    const merged: Array<{start: number; end: number}> = [];
    for (const entry of entries) {
      const previous = merged.at(-1);
      if (previous && previous.end === entry.start) previous.end = entry.end;
      else merged.push({...entry});
    }
    for (const entry of merged) {
      const extending = runs.find((run) => (
        run.minX === entry.start && run.maxX === entry.end && run.maxY === row
      ));
      if (extending) extending.maxY = row + 1;
      else runs.push({minX: entry.start, maxX: entry.end, minY: row, maxY: row + 1});
    }
  }
  return runs.map((run) => Object.freeze(run));
}

function estimateFloorZ(grid: BuildingAuthorGrid, cells: readonly BuildingCandidateCell[]): number {
  const occupied = new Set(cells.map((cell) => indexOf(grid, cell.column, cell.row)));
  const exterior: number[] = [];
  for (const cell of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const column = cell.column + dx;
      const row = cell.row + dy;
      if (!inside(grid, column, row)) continue;
      const index = indexOf(grid, column, row);
      if (!occupied.has(index) && !grid.collisions[index]) exterior.push(grid.surfaces[index] ?? 0);
    }
  }
  if (exterior.length === 0) return Math.max(0, Math.min(...cells.map((cell) => cell.surface)) - 1);
  exterior.sort((left, right) => left - right);
  return exterior[Math.floor(exterior.length / 2)];
}

function entranceOnFacade(
  facade: BuildingFacadeEdge,
  worldX: number,
  worldY: number,
  width: number,
  tileSize: number
): Readonly<{side: BuildingFacadeSide; x: number; y: number; width: number}> {
  const halfWorldWidth = width * tileSize / 2;
  const cursor = facade.side === 'north' || facade.side === 'south' ? worldX : worldY;
  const center = clamp(cursor, facade.start + halfWorldWidth, facade.end - halfWorldWidth);
  return Object.freeze({
    side: facade.side,
    x: (facade.side === 'east' || facade.side === 'west' ? facade.fixed : center) / tileSize,
    y: (facade.side === 'north' || facade.side === 'south' ? facade.fixed : center) / tileSize,
    width
  });
}

function interiorServicePoint(
  bounds: BuildingCandidate['sourceBounds'],
  entranceSide: BuildingFacadeSide
): {x: number; y: number} {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  if (entranceSide === 'south') return {x: centerX, y: bounds.minY + 0.75};
  if (entranceSide === 'north') return {x: centerX, y: bounds.maxY - 0.75};
  if (entranceSide === 'east') return {x: bounds.minX + 0.75, y: centerY};
  return {x: bounds.maxX - 0.75, y: centerY};
}

function templateObstacles(
  template: BuilderTemplate,
  bounds: BuildingCandidate['sourceBounds'],
  entranceSide: BuildingFacadeSide
): BuildingAuthorDraft['building']['obstacles'] {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const horizontalEntrance = entranceSide === 'north' || entranceSide === 'south';
  if (template === 'garage') {
    const farY = entranceSide === 'south' ? bounds.minY + 0.45 : bounds.maxY - 0.45;
    const farX = entranceSide === 'east' ? bounds.minX + 0.45 : bounds.maxX - 0.45;
    return Object.freeze(horizontalEntrance ? [
      obstacle('workbench-west', 'counter', bounds.minX + 0.45, farY - 0.25, bounds.minX + width * 0.38, farY + 0.25, 0.5, '#315d65'),
      obstacle('workbench-east', 'counter', bounds.maxX - width * 0.38, farY - 0.25, bounds.maxX - 0.45, farY + 0.25, 0.5, '#315d65')
    ] : [
      obstacle('workbench-north', 'counter', farX - 0.25, bounds.minY + 0.45, farX + 0.25, bounds.minY + height * 0.38, 0.5, '#315d65'),
      obstacle('workbench-south', 'counter', farX - 0.25, bounds.maxY - height * 0.38, farX + 0.25, bounds.maxY - 0.45, 0.5, '#315d65')
    ]);
  }
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return Object.freeze([
    obstacle('service-counter', 'counter', bounds.maxX - 1.35, bounds.minY + 0.5, bounds.maxX - 0.45, bounds.minY + 1.5, 0.47, '#31575b'),
    obstacle('center-shelf', 'shelf', centerX - 0.35, centerY - 0.75, centerX + 0.35, centerY + 0.75, 0.34, '#725a3a')
  ]);
}

function perimeterWalls(
  facades: readonly BuildingFacadeEdge[],
  entrance: BuildingAuthorDraft['building']['entrance'],
  tileSize: number
): BuildingAuthorDraft['building']['obstacles'] {
  const thickness = 0.21875;
  const entranceHalfWidth = entrance.width / 2;
  const entranceStart = (entrance.side === 'north' || entrance.side === 'south' ? entrance.x : entrance.y) - entranceHalfWidth;
  const entranceEnd = entranceStart + entrance.width;
  const walls: BuildingAuthorDraft['building']['obstacles'][number][] = [];
  let index = 0;

  for (const facade of facades) {
    const start = facade.start / tileSize;
    const end = facade.end / tileSize;
    const fixed = facade.fixed / tileSize;
    const spans = facade.side === entrance.side
      ? subtractSpan(start, end, entranceStart, entranceEnd)
      : [{start, end}];
    for (const span of spans) {
      if (span.end - span.start <= 0.001) continue;
      const bounds = facade.side === 'north'
        ? {minX: span.start, minY: fixed, maxX: span.end, maxY: fixed + thickness}
        : facade.side === 'south'
          ? {minX: span.start, minY: fixed - thickness, maxX: span.end, maxY: fixed}
          : facade.side === 'west'
            ? {minX: fixed, minY: span.start, maxX: fixed + thickness, maxY: span.end}
            : {minX: fixed - thickness, minY: span.start, maxX: fixed, maxY: span.end};
      walls.push(Object.freeze({
        id: `perimeter-${facade.side}-${index++}`,
        kind: 'wall',
        bounds: Object.freeze(bounds),
        height: 2,
        color: '#263033'
      }));
    }
  }
  return Object.freeze(walls);
}

function footprintConnectors(
  footprints: BuildingCandidate['footprints']
): BuildingAuthorDraft['building']['floorConnectors'] {
  const inset = 0.21875;
  const connectors: Array<Readonly<{minX: number; minY: number; maxX: number; maxY: number}>> = [];
  for (let leftIndex = 0; leftIndex < footprints.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < footprints.length; rightIndex++) {
      const left = footprints[leftIndex];
      const right = footprints[rightIndex];
      if (left.maxX === right.minX || right.maxX === left.minX) {
        const x = left.maxX === right.minX ? left.maxX : right.maxX;
        const minY = Math.max(left.minY, right.minY) + inset;
        const maxY = Math.min(left.maxY, right.maxY) - inset;
        if (maxY > minY) connectors.push(Object.freeze({minX: x - inset, minY, maxX: x + inset, maxY}));
      }
      if (left.maxY === right.minY || right.maxY === left.minY) {
        const y = left.maxY === right.minY ? left.maxY : right.maxY;
        const minX = Math.max(left.minX, right.minX) + inset;
        const maxX = Math.min(left.maxX, right.maxX) - inset;
        if (maxX > minX) connectors.push(Object.freeze({minX, minY: y - inset, maxX, maxY: y + inset}));
      }
    }
  }
  return Object.freeze(connectors);
}

function subtractSpan(
  start: number,
  end: number,
  cutStart: number,
  cutEnd: number
): Array<{start: number; end: number}> {
  if (cutEnd <= start || cutStart >= end) return [{start, end}];
  const spans: Array<{start: number; end: number}> = [];
  if (cutStart > start) spans.push({start, end: Math.min(cutStart, end)});
  if (cutEnd < end) spans.push({start: Math.max(cutEnd, start), end});
  return spans;
}

function obstacle(
  id: string,
  kind: 'counter' | 'shelf',
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  height: number,
  color: string
): BuildingAuthorDraft['building']['obstacles'][number] {
  return Object.freeze({id, kind, bounds: Object.freeze({minX, minY, maxX, maxY}), height, color});
}

function insetRect(
  rect: Readonly<{minX: number; minY: number; maxX: number; maxY: number}>,
  amount: number
): Readonly<{minX: number; minY: number; maxX: number; maxY: number}> {
  const maximumInset = Math.max(0, Math.min(rect.maxX - rect.minX, rect.maxY - rect.minY) / 2 - 0.01);
  const inset = Math.min(amount, maximumInset);
  return Object.freeze({
    minX: rect.minX + inset,
    minY: rect.minY + inset,
    maxX: rect.maxX - inset,
    maxY: rect.maxY - inset
  });
}

function largestRect(
  rectangles: BuildingCandidate['footprints']
): BuildingCandidate['footprints'][number] {
  const largest = rectangles
    .map((rect) => ({rect, area: (rect.maxX - rect.minX) * (rect.maxY - rect.minY)}))
    .sort((left, right) => right.area - left.area || left.rect.minY - right.rect.minY || left.rect.minX - right.rect.minX)[0]
    ?.rect;
  if (!largest) throw new Error('Building candidate has no playable footprint.');
  return largest;
}

function distanceToEdge(edge: BuildingFacadeEdge, x: number, y: number): number {
  if (edge.side === 'north' || edge.side === 'south') {
    return Math.hypot(x - clamp(x, edge.start, edge.end), y - edge.fixed);
  }
  return Math.hypot(x - edge.fixed, y - clamp(y, edge.start, edge.end));
}

function candidateId(cells: readonly BuildingCandidateCell[]): string {
  let hash = 2166136261;
  for (const cell of [...cells].sort((left, right) => left.row - right.row || left.column - right.column)) {
    hash ^= cell.row * 257 + cell.column;
    hash = Math.imul(hash, 16777619);
  }
  const minColumn = Math.min(...cells.map((cell) => cell.column));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  return `building-${minColumn}-${minRow}-${(hash >>> 0).toString(36)}`;
}

function facadeKey(edge: BuildingFacadeEdge): string {
  return `${edge.side}:${edge.fixed}:${edge.start}:${edge.end}`;
}

function validateGrid(grid: BuildingAuthorGrid): void {
  const expected = grid.width * grid.height;
  if (
    grid.width <= 0 || grid.height <= 0 || grid.tileSize <= 0 ||
    grid.collisions.length !== expected || grid.surfaces.length !== expected
  ) throw new Error('Builder grid is invalid.');
}

function indexOf(grid: BuildingAuthorGrid, column: number, row: number): number {
  return row * grid.width + column;
}

function inside(grid: BuildingAuthorGrid, column: number, row: number): boolean {
  return column >= 0 && row >= 0 && column < grid.width && row < grid.height;
}

function blocked(grid: BuildingAuthorGrid, column: number, row: number): boolean {
  return grid.collisions[indexOf(grid, column, row)] !== 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
