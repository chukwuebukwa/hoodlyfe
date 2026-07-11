import type {CollisionMap} from '../../world-map.ts';

export interface PedestrianPathPoint {
  x: number;
  y: number;
}

export interface PedestrianPathResult {
  points: PedestrianPathPoint[];
  expandedNodes: number;
  complete: boolean;
}

interface SearchNode {
  key: number;
  column: number;
  row: number;
  cost: number;
  estimate: number;
}

const NEIGHBORS = [
  {column: 1, row: 0, cost: 10},
  {column: 0, row: 1, cost: 10},
  {column: -1, row: 0, cost: 10},
  {column: 0, row: -1, cost: 10},
  {column: 1, row: 1, cost: 14},
  {column: -1, row: 1, cost: 14},
  {column: -1, row: -1, cost: 14},
  {column: 1, row: -1, cost: 14}
] as const;

export class PedestrianPathPlanner {
  constructor(
    private readonly world: CollisionMap,
    private readonly maxExpandedNodes = 384,
    private readonly maxWaypoints = 28
  ) {
    if (!Number.isInteger(maxExpandedNodes) || maxExpandedNodes <= 0) {
      throw new RangeError('Pedestrian path expansion budget must be a positive integer.');
    }
    if (!Number.isInteger(maxWaypoints) || maxWaypoints <= 0) {
      throw new RangeError('Pedestrian waypoint limit must be a positive integer.');
    }
  }

  pathIsClear(from: PedestrianPathPoint, to: PedestrianPathPoint, radius: number): boolean {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const sampleDistance = Math.max(6, Math.min(18, radius));
    const steps = Math.max(1, Math.ceil(distance / sampleDistance));
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      if (!this.world.canOccupy(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        radius
      )) return false;
    }
    return true;
  }

  plan(
    start: PedestrianPathPoint,
    goal: PedestrianPathPoint,
    radius: number
  ): PedestrianPathResult | undefined {
    const startCell = this.nearestOpenCell(start, radius);
    const goalCell = this.nearestOpenCell(goal, radius);
    if (!startCell || !goalCell) return undefined;
    if (startCell.key === goalCell.key && this.pathIsClear(start, goal, radius)) {
      return {points: [{...goal}], expandedNodes: 0, complete: true};
    }

    const open = new MinHeap();
    const closed = new Set<number>();
    const costs = new Map<number, number>([[startCell.key, 0]]);
    const previous = new Map<number, number>();
    open.push({
      ...startCell,
      cost: 0,
      estimate: heuristic(startCell.column, startCell.row, goalCell.column, goalCell.row)
    });
    let expandedNodes = 0;
    while (open.size > 0 && expandedNodes < this.maxExpandedNodes) {
      const current = open.pop();
      if (!current || closed.has(current.key)) continue;
      if (current.cost !== costs.get(current.key)) continue;
      expandedNodes++;
      if (current.key === goalCell.key) {
        const raw = this.reconstruct(previous, startCell.key, goalCell.key).map((key) => (
          this.pointForKey(key)
        ));
        if (this.world.canOccupy(goal.x, goal.y, radius)) raw.push({...goal});
        const smoothed = this.smooth(start, raw, radius);
        const complete = smoothed.length <= this.maxWaypoints;
        return {
          points: smoothed.slice(0, this.maxWaypoints),
          expandedNodes,
          complete
        };
      }
      closed.add(current.key);
      for (const neighbor of NEIGHBORS) {
        const column = current.column + neighbor.column;
        const row = current.row + neighbor.row;
        if (!this.cellIsOpen(column, row, radius)) continue;
        if (
          neighbor.column !== 0 && neighbor.row !== 0 &&
          (!this.cellIsOpen(current.column + neighbor.column, current.row, radius) ||
            !this.cellIsOpen(current.column, current.row + neighbor.row, radius))
        ) continue;
        const key = this.key(column, row);
        if (closed.has(key)) continue;
        const cost = current.cost + neighbor.cost;
        if (cost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue;
        costs.set(key, cost);
        previous.set(key, current.key);
        open.push({
          key,
          column,
          row,
          cost,
          estimate: cost + heuristic(column, row, goalCell.column, goalCell.row)
        });
      }
    }
    return undefined;
  }

  private nearestOpenCell(
    point: PedestrianPathPoint,
    radius: number
  ): {key: number; column: number; row: number} | undefined {
    const originColumn = Math.floor(point.x / this.world.tileWidth);
    const originRow = Math.floor(point.y / this.world.tileHeight);
    for (let ring = 0; ring <= 5; ring++) {
      for (let rowOffset = -ring; rowOffset <= ring; rowOffset++) {
        for (let columnOffset = -ring; columnOffset <= ring; columnOffset++) {
          if (Math.max(Math.abs(columnOffset), Math.abs(rowOffset)) !== ring) continue;
          const column = originColumn + columnOffset;
          const row = originRow + rowOffset;
          if (!this.cellIsOpen(column, row, radius)) continue;
          return {key: this.key(column, row), column, row};
        }
      }
    }
    return undefined;
  }

  private cellIsOpen(column: number, row: number, radius: number): boolean {
    if (column < 0 || row < 0 || column >= this.world.width || row >= this.world.height) {
      return false;
    }
    const point = this.point(column, row);
    return this.world.canOccupy(point.x, point.y, radius);
  }

  private reconstruct(previous: Map<number, number>, startKey: number, goalKey: number): number[] {
    const keys: number[] = [];
    let key = goalKey;
    while (key !== startKey) {
      keys.push(key);
      const parent = previous.get(key);
      if (parent === undefined) return [];
      key = parent;
    }
    keys.reverse();
    return keys;
  }

  private smooth(
    start: PedestrianPathPoint,
    points: PedestrianPathPoint[],
    radius: number
  ): PedestrianPathPoint[] {
    const smoothed: PedestrianPathPoint[] = [];
    let anchor = start;
    let index = 0;
    while (index < points.length) {
      let furthest = index;
      for (let candidate = index; candidate < points.length; candidate++) {
        if (!this.pathIsClear(anchor, points[candidate], radius)) break;
        furthest = candidate;
      }
      const point = points[furthest];
      smoothed.push(point);
      anchor = point;
      index = furthest + 1;
    }
    return smoothed;
  }

  private pointForKey(key: number): PedestrianPathPoint {
    return this.point(key % this.world.width, Math.floor(key / this.world.width));
  }

  private point(column: number, row: number): PedestrianPathPoint {
    return {
      x: (column + 0.5) * this.world.tileWidth,
      y: (row + 0.5) * this.world.tileHeight
    };
  }

  private key(column: number, row: number): number {
    return row * this.world.width + column;
  }
}

class MinHeap {
  private readonly entries: SearchNode[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(node: SearchNode): void {
    this.entries.push(node);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareNodes(this.entries[parent], this.entries[index]) <= 0) break;
      [this.entries[parent], this.entries[index]] = [this.entries[index], this.entries[parent]];
      index = parent;
    }
  }

  pop(): SearchNode | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    this.entries[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.entries.length && compareNodes(this.entries[left], this.entries[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.entries.length && compareNodes(this.entries[right], this.entries[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.entries[index], this.entries[smallest]] = [this.entries[smallest], this.entries[index]];
      index = smallest;
    }
    return first;
  }
}

function compareNodes(left: SearchNode, right: SearchNode): number {
  return left.estimate - right.estimate || left.cost - right.cost || left.key - right.key;
}

function heuristic(column: number, row: number, goalColumn: number, goalRow: number): number {
  const deltaColumn = Math.abs(goalColumn - column);
  const deltaRow = Math.abs(goalRow - row);
  return Math.min(deltaColumn, deltaRow) * 14 + Math.abs(deltaColumn - deltaRow) * 10;
}
