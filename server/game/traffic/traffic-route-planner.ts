import {
  type LaneGraph,
  type LaneGraphEdge,
  type LaneGraphNode,
  type LaneVehicleClass
} from './lane-graph.ts';

export interface TrafficRoutePlan {
  nodeIds: string[];
  edgeIds: string[];
  complete: boolean;
  visited: number;
  travelCost: number;
}

interface FrontierEntry {
  nodeId: string;
  cost: number;
  estimate: number;
}

export class TrafficRoutePlanner {
  private readonly maximumTraversalSpeed: number;

  constructor(
    private readonly graph: LaneGraph,
    private readonly visitLimit = 512,
    private readonly edgeAllowed: (edge: LaneGraphEdge) => boolean = () => true
  ) {
    this.maximumTraversalSpeed = Math.max(1, ...graph.edges().map((edge) => edge.speedLimit));
  }

  plan(
    startNodeId: string,
    goalNodeId: string,
    vehicleClass: LaneVehicleClass = 'civilian'
  ): TrafficRoutePlan {
    const start = this.graph.node(startNodeId);
    const goal = this.graph.node(goalNodeId);
    if (!start || !goal) return emptyPlan();
    if (start.id === goal.id) {
      return {
        nodeIds: [start.id],
        edgeIds: [],
        complete: true,
        visited: 1,
        travelCost: 0
      };
    }

    const frontier = new MinFrontier();
    const costs = new Map<string, number>([[start.id, 0]]);
    const parents = new Map<string, {nodeId: string; edgeId: string}>();
    frontier.push({
      nodeId: start.id,
      cost: 0,
      estimate: heuristic(start, goal, this.maximumTraversalSpeed)
    });
    let closest = start;
    let closestDistance = euclidean(start, goal);
    let visited = 0;

    while (frontier.size > 0 && visited < this.visitLimit) {
      const currentEntry = frontier.pop();
      if (!currentEntry) break;
      if (currentEntry.cost !== costs.get(currentEntry.nodeId)) continue;
      const current = this.graph.node(currentEntry.nodeId);
      if (!current) continue;
      visited++;
      const remainingDistance = euclidean(current, goal);
      if (
        remainingDistance < closestDistance ||
        (remainingDistance === closestDistance && current.id < closest.id)
      ) {
        closest = current;
        closestDistance = remainingDistance;
      }
      if (current.id === goal.id) {
        return reconstruct(goal.id, parents, costs, true, visited);
      }

      for (const edge of this.graph.outgoing(current.id, vehicleClass)) {
        if (!this.edgeAllowed(edge)) continue;
        const next = this.graph.node(edge.toNodeId);
        if (!next) continue;
        const nextCost = currentEntry.cost + edgeCost(edge);
        const previousCost = costs.get(next.id) ?? Number.POSITIVE_INFINITY;
        const previousParent = parents.get(next.id);
        if (
          nextCost > previousCost ||
          (nextCost === previousCost && previousParent && edge.id >= previousParent.edgeId)
        ) continue;
        costs.set(next.id, nextCost);
        parents.set(next.id, {nodeId: current.id, edgeId: edge.id});
        frontier.push({
          nodeId: next.id,
          cost: nextCost,
          estimate: nextCost + heuristic(next, goal, this.maximumTraversalSpeed)
        });
      }
    }

    return reconstruct(closest.id, parents, costs, false, visited);
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
  destinationNodeId: string,
  parents: ReadonlyMap<string, {nodeId: string; edgeId: string}>,
  costs: ReadonlyMap<string, number>,
  complete: boolean,
  visited: number
): TrafficRoutePlan {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  let nodeId: string | undefined = destinationNodeId;
  while (nodeId) {
    nodeIds.push(nodeId);
    const parent = parents.get(nodeId);
    if (!parent) break;
    edgeIds.push(parent.edgeId);
    nodeId = parent.nodeId;
  }
  nodeIds.reverse();
  edgeIds.reverse();
  return {
    nodeIds,
    edgeIds,
    complete,
    visited,
    travelCost: costs.get(destinationNodeId) ?? 0
  };
}

function edgeCost(edge: LaneGraphEdge): number {
  const traversal = edge.length / Math.max(1, edge.speedLimit);
  if (edge.kind === 'turnaround') return traversal + 2;
  if (edge.turn === 'left') return traversal + 0.35;
  if (edge.turn === 'right') return traversal + 0.2;
  return traversal;
}

function heuristic(node: LaneGraphNode, goal: LaneGraphNode, maximumSpeed: number): number {
  return euclidean(node, goal) / maximumSpeed;
}

function euclidean(left: LaneGraphNode, right: LaneGraphNode): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function emptyPlan(): TrafficRoutePlan {
  return {nodeIds: [], edgeIds: [], complete: false, visited: 0, travelCost: 0};
}

function compareEntries(left: FrontierEntry, right: FrontierEntry): number {
  return left.estimate - right.estimate ||
    left.cost - right.cost ||
    left.nodeId.localeCompare(right.nodeId);
}
