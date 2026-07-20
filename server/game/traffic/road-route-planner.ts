import type {CollisionMap, RoadNode} from '../../world-map.ts';

export interface RoadRoutePlan {
  nodes: RoadNode[];
  complete: boolean;
  visited: number;
}

interface FrontierEntry extends RoadNode {
  cost: number;
  estimate: number;
}

export class RoadRoutePlanner {
  constructor(
    private readonly world: Pick<CollisionMap, 'roadNeighbors'>,
    private readonly visitLimit = 2200
  ) {}

  plan(start: RoadNode, goal: RoadNode): RoadRoutePlan {
    const startKey = nodeKey(start);
    const goalKey = nodeKey(goal);
    if (startKey === goalKey) return {nodes: [{...start}], complete: true, visited: 1};

    const frontier = new MinFrontier();
    const costs = new Map<string, number>([[startKey, 0]]);
    const parents = new Map<string, string>();
    const nodes = new Map<string, RoadNode>([[startKey, {...start}]]);
    frontier.push({...start, cost: 0, estimate: manhattan(start, goal)});
    let closestKey = startKey;
    let closestDistance = manhattan(start, goal);
    let visited = 0;

    while (frontier.size > 0 && visited < this.visitLimit) {
      const current = frontier.pop();
      if (!current) break;
      const currentKey = nodeKey(current);
      if (current.cost !== costs.get(currentKey)) continue;
      visited++;
      const distance = manhattan(current, goal);
      if (distance < closestDistance || (distance === closestDistance && currentKey < closestKey)) {
        closestKey = currentKey;
        closestDistance = distance;
      }
      if (currentKey === goalKey) {
        return {nodes: reconstruct(goalKey, parents, nodes), complete: true, visited};
      }

      const neighbors = this.world.roadNeighbors(current.column, current.row, current.surfaceId)
        .sort(compareNodes);
      for (const neighbor of neighbors) {
        const key = nodeKey(neighbor);
        const cost = current.cost + 1;
        if (cost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue;
        costs.set(key, cost);
        parents.set(key, currentKey);
        nodes.set(key, {...neighbor});
        frontier.push({
          ...neighbor,
          cost,
          estimate: cost + manhattan(neighbor, goal)
        });
      }
    }

    return {
      nodes: reconstruct(closestKey, parents, nodes),
      complete: false,
      visited
    };
  }
}

class MinFrontier {
  private readonly entries: FrontierEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(entry: FrontierEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareEntries(this.entries[parent], entry) <= 0) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): FrontierEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      const child = right < this.entries.length &&
        compareEntries(this.entries[right], this.entries[left]) < 0 ? right : left;
      if (compareEntries(last, this.entries[child]) <= 0) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

function reconstruct(
  destinationKey: string,
  parents: ReadonlyMap<string, string>,
  nodes: ReadonlyMap<string, RoadNode>
): RoadNode[] {
  const path: RoadNode[] = [];
  let key: string | undefined = destinationKey;
  while (key) {
    const node = nodes.get(key);
    if (!node) break;
    path.push({...node});
    key = parents.get(key);
  }
  return path.reverse();
}

function nodeKey(node: RoadNode): string {
  return `${node.surfaceId ?? ''}:${node.column},${node.row}`;
}

function manhattan(left: RoadNode, right: RoadNode): number {
  return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}

function compareNodes(left: RoadNode, right: RoadNode): number {
  return left.row - right.row || left.column - right.column ||
    (left.surfaceId ?? '').localeCompare(right.surfaceId ?? '');
}

function compareEntries(left: FrontierEntry, right: FrontierEntry): number {
  return left.estimate - right.estimate || left.cost - right.cost || compareNodes(left, right);
}
