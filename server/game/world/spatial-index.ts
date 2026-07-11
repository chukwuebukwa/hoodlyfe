export interface SpatialRecord<Kind extends string = string> {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  radius: number;
  layerId?: string;
}

export interface SpatialQueryOptions<Kind extends string> {
  kinds?: readonly Kind[];
  layerId?: string;
  includeRecordRadius?: boolean;
}

export class SpatialIndex<Kind extends string = string> {
  readonly cellSize: number;

  private readonly records = new Map<string, SpatialRecord<Kind>>();
  private readonly buckets = new Map<string, Set<string>>();
  private readonly memberships = new Map<string, string[]>();

  constructor(cellSize = 256) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('Spatial cell size must be a positive finite number.');
    }
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.buckets.clear();
    this.memberships.clear();
  }

  rebuild(records: Iterable<SpatialRecord<Kind>>): void {
    this.clear();
    for (const record of records) this.upsert(record);
  }

  upsert(record: SpatialRecord<Kind>): void {
    validateRecord(record);
    const key = entityKey(record.kind, record.id);
    this.removeByKey(key);

    const stored = {...record, layerId: record.layerId ?? 'ground'};
    const cells = this.coveredCells(stored.x, stored.y, stored.radius);
    this.records.set(key, stored);
    this.memberships.set(key, cells);
    for (const cell of cells) {
      let bucket = this.buckets.get(cell);
      if (!bucket) {
        bucket = new Set<string>();
        this.buckets.set(cell, bucket);
      }
      bucket.add(key);
    }
  }

  remove(kind: Kind, id: string): boolean {
    return this.removeByKey(entityKey(kind, id));
  }

  queryCircle(
    x: number,
    y: number,
    radius: number,
    options: SpatialQueryOptions<Kind> = {}
  ): SpatialRecord<Kind>[] {
    if (![x, y, radius].every(Number.isFinite) || radius < 0) {
      throw new RangeError('Circle query values must be finite and radius cannot be negative.');
    }
    const candidates = this.candidatesInBounds(x - radius, y - radius, x + radius, y + radius);
    return this.filterAndSort(candidates, options, (record) => {
      const limit = radius + (options.includeRecordRadius ? record.radius : 0);
      return Math.hypot(record.x - x, record.y - y) <= limit;
    });
  }

  queryAabb(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    options: SpatialQueryOptions<Kind> = {}
  ): SpatialRecord<Kind>[] {
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX < minX || maxY < minY) {
      throw new RangeError('AABB query bounds must be finite and ordered.');
    }
    const candidates = this.candidatesInBounds(minX, minY, maxX, maxY);
    return this.filterAndSort(candidates, options, (record) =>
      record.x + record.radius >= minX &&
      record.x - record.radius <= maxX &&
      record.y + record.radius >= minY &&
      record.y - record.radius <= maxY
    );
  }

  private candidatesInBounds(minX: number, minY: number, maxX: number, maxY: number): Set<string> {
    const candidates = new Set<string>();
    const minColumn = Math.floor(minX / this.cellSize);
    const maxColumn = Math.floor(maxX / this.cellSize);
    const minRow = Math.floor(minY / this.cellSize);
    const maxRow = Math.floor(maxY / this.cellSize);
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        const bucket = this.buckets.get(cellKey(column, row));
        if (!bucket) continue;
        for (const key of bucket) candidates.add(key);
      }
    }
    return candidates;
  }

  private filterAndSort(
    candidates: Set<string>,
    options: SpatialQueryOptions<Kind>,
    intersects: (record: SpatialRecord<Kind>) => boolean
  ): SpatialRecord<Kind>[] {
    const kindFilter = options.kinds ? new Set<Kind>(options.kinds) : undefined;
    const matches: SpatialRecord<Kind>[] = [];
    for (const key of candidates) {
      const record = this.records.get(key);
      if (!record) continue;
      if (kindFilter && !kindFilter.has(record.kind)) continue;
      if (options.layerId && record.layerId !== options.layerId) continue;
      if (intersects(record)) matches.push(record);
    }
    return matches.sort((left, right) => compareText(left.kind, right.kind) || compareText(left.id, right.id));
  }

  private coveredCells(x: number, y: number, radius: number): string[] {
    const cells: string[] = [];
    const minColumn = Math.floor((x - radius) / this.cellSize);
    const maxColumn = Math.floor((x + radius) / this.cellSize);
    const minRow = Math.floor((y - radius) / this.cellSize);
    const maxRow = Math.floor((y + radius) / this.cellSize);
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        cells.push(cellKey(column, row));
      }
    }
    return cells;
  }

  private removeByKey(key: string): boolean {
    if (!this.records.delete(key)) return false;
    const cells = this.memberships.get(key) ?? [];
    for (const cell of cells) {
      const bucket = this.buckets.get(cell);
      bucket?.delete(key);
      if (bucket?.size === 0) this.buckets.delete(cell);
    }
    this.memberships.delete(key);
    return true;
  }
}

function validateRecord(record: SpatialRecord<string>): void {
  if (!record.id || !record.kind) throw new Error('Spatial records require an id and kind.');
  if (![record.x, record.y, record.radius].every(Number.isFinite) || record.radius < 0) {
    throw new RangeError('Spatial record coordinates and radius must be finite and radius cannot be negative.');
  }
}

function entityKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`;
}

function cellKey(column: number, row: number): string {
  return `${column},${row}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
