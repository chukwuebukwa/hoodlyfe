import type {VehicleState} from '../../state.ts';
import type {CollisionMap, RoadNode, TrafficSpawn} from '../../world-map.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {LaneGraph, LaneGraphEdge} from './lane-graph.ts';
import {TrafficRoutePlanner} from './traffic-route-planner.ts';

export const TRAFFIC_LANE_OFFSET = 24;

export interface TrafficRouteRuntime {
  previousColumn: number;
  previousRow: number;
  targetColumn: number;
  targetRow: number;
  source: 'lane-graph' | 'road-cell-fallback';
  currentLaneNodeId: string;
  destinationLaneNodeId: string;
  nodeIds: string[];
  nodeIndex: number;
  revision: number;
  complete: boolean;
  visited: number;
}

export interface TrafficRouteDiagnostic {
  routeSource: TrafficRouteRuntime['source'];
  currentLaneNodeId: string;
  destinationLaneNodeId: string;
  routeRemaining: number;
  routeRevision: number;
  routeComplete: boolean;
  routeVisited: number;
  routeWaypoints: Array<{x: number; y: number}>;
}

export interface TrafficJunctionTarget {
  id: string;
  x: number;
  y: number;
}

interface TrafficRouteSystemOptions {
  world: CollisionMap;
  random: DeterministicRandom;
  laneGraph?: LaneGraph;
}

export class TrafficRouteSystem {
  private readonly planner?: TrafficRoutePlanner;

  constructor(private readonly options: TrafficRouteSystemOptions) {
    this.planner = options.laneGraph ? new TrafficRoutePlanner(options.laneGraph) : undefined;
  }

  create(vehicleId: string, spawn: TrafficSpawn): TrafficRouteRuntime {
    const runtime: TrafficRouteRuntime = {
      previousColumn: spawn.column,
      previousRow: spawn.row,
      targetColumn: spawn.targetColumn,
      targetRow: spawn.targetRow,
      source: 'road-cell-fallback',
      currentLaneNodeId: '',
      destinationLaneNodeId: '',
      nodeIds: [],
      nodeIndex: 0,
      revision: 0,
      complete: false,
      visited: 0
    };
    const graph = this.options.laneGraph;
    if (!graph || !this.planner) return runtime;
    const edge = (spawn.laneEdgeId ? graph.edge(spawn.laneEdgeId) : undefined) ??
      graph.project(spawn.x, spawn.y, spawn.angle)?.edge;
    if (!edge) return runtime;
    runtime.source = 'lane-graph';
    runtime.currentLaneNodeId = edge.fromNodeId;
    this.plan(vehicleId, runtime, edge.toNodeId, 0, true);
    return runtime;
  }

  spawn(index: number, radius: number): TrafficSpawn {
    return this.options.laneGraph?.spawn(index, radius) ?? this.options.world.trafficSpawn(index, radius);
  }

  advanceVirtual(spawn: TrafficSpawn, seed: number): TrafficSpawn {
    return this.options.laneGraph?.advance(spawn, seed) ?? this.advanceLegacySpawn(spawn, seed);
  }

  captureVirtual(vehicle: Pick<VehicleState, 'x' | 'y' | 'angle'>): TrafficSpawn {
    return this.options.laneGraph?.capture(vehicle.x, vehicle.y, vehicle.angle) ??
      this.captureLegacySpawn(vehicle);
  }

  target(runtime: TrafficRouteRuntime): {x: number; y: number} {
    if (runtime.source === 'lane-graph') {
      const nodeId = runtime.nodeIds[runtime.nodeIndex];
      const node = nodeId ? this.options.laneGraph?.node(nodeId) : undefined;
      if (node) return {x: node.x, y: node.y};
    }
    const centerX = (runtime.targetColumn + 0.5) * this.options.world.tileWidth;
    const centerY = (runtime.targetRow + 0.5) * this.options.world.tileHeight;
    const deltaColumn = runtime.targetColumn - runtime.previousColumn;
    const deltaRow = runtime.targetRow - runtime.previousRow;
    const magnitude = Math.hypot(deltaColumn, deltaRow);
    if (magnitude === 0) return {x: centerX, y: centerY};
    const laneX = centerX - deltaRow / magnitude * TRAFFIC_LANE_OFFSET;
    const laneY = centerY + deltaColumn / magnitude * TRAFFIC_LANE_OFFSET;
    return this.options.world.canOccupy(laneX, laneY, 20) && this.options.world.isRoadAt(laneX, laneY)
      ? {x: laneX, y: laneY}
      : {x: centerX, y: centerY};
  }

  junctionKey(runtime: TrafficRouteRuntime): string {
    return this.junctionTarget(runtime)?.id ?? '';
  }

  junctionTarget(runtime: TrafficRouteRuntime): TrafficJunctionTarget | undefined {
    if (runtime.source === 'lane-graph') {
      const nodeId = runtime.nodeIds[runtime.nodeIndex];
      const junctionId = (nodeId ? this.options.laneGraph?.node(nodeId)?.junctionId : '') ?? '';
      const junction = junctionId ? this.options.laneGraph?.junction(junctionId) : undefined;
      return junction ? {id: junction.id, x: junction.x, y: junction.y} : undefined;
    }
    if (this.options.world.roadNeighbors(runtime.targetColumn, runtime.targetRow).length < 3) {
      return undefined;
    }
    return {
      id: `${runtime.targetColumn},${runtime.targetRow}`,
      x: (runtime.targetColumn + 0.5) * this.options.world.tileWidth,
      y: (runtime.targetRow + 0.5) * this.options.world.tileHeight
    };
  }

  cruiseSpeed(runtime: TrafficRouteRuntime, configuredCruiseSpeed: number): number {
    if (runtime.source !== 'lane-graph') return configuredCruiseSpeed;
    const edge = this.currentEdge(runtime);
    return edge ? Math.min(configuredCruiseSpeed, edge.speedLimit) : configuredCruiseSpeed;
  }

  advance(vehicleId: string, runtime: TrafficRouteRuntime, nowMs: number): void {
    if (runtime.source === 'lane-graph') {
      const reachedNodeId = runtime.nodeIds[runtime.nodeIndex];
      if (!reachedNodeId) return;
      runtime.currentLaneNodeId = reachedNodeId;
      runtime.nodeIndex++;
      if (runtime.nodeIndex >= runtime.nodeIds.length) {
        this.plan(vehicleId, runtime, reachedNodeId, nowMs, false);
      } else {
        this.updateLegacyTarget(runtime);
      }
      return;
    }
    const current = {column: runtime.targetColumn, row: runtime.targetRow};
    const next = this.chooseNextRoadNode(current, runtime, nowMs + vehicleId.length * 37);
    runtime.previousColumn = current.column;
    runtime.previousRow = current.row;
    runtime.targetColumn = next.column;
    runtime.targetRow = next.row;
  }

  recover(
    vehicle: Pick<VehicleState, 'id' | 'x' | 'y' | 'angle'>,
    runtime: TrafficRouteRuntime,
    seed: number
  ): boolean {
    if (runtime.source === 'lane-graph') {
      const projection = this.options.laneGraph?.project(vehicle.x, vehicle.y, vehicle.angle);
      if (!projection) return false;
      runtime.currentLaneNodeId = projection.edge.fromNodeId;
      this.plan(vehicle.id, runtime, projection.edge.toNodeId, seed, true);
      return runtime.nodeIds.length > 0;
    }
    const current = {
      column: Math.floor(vehicle.x / this.options.world.tileWidth),
      row: Math.floor(vehicle.y / this.options.world.tileHeight)
    };
    const next = this.chooseRecoveryRoadNode(current, runtime, seed);
    runtime.previousColumn = current.column;
    runtime.previousRow = current.row;
    runtime.targetColumn = next.column;
    runtime.targetRow = next.row;
    return true;
  }

  diagnostic(runtime: TrafficRouteRuntime): TrafficRouteDiagnostic {
    return {
      routeSource: runtime.source,
      currentLaneNodeId: runtime.currentLaneNodeId,
      destinationLaneNodeId: runtime.destinationLaneNodeId,
      routeRemaining: Math.max(0, runtime.nodeIds.length - runtime.nodeIndex),
      routeRevision: runtime.revision,
      routeComplete: runtime.complete,
      routeVisited: runtime.visited,
      routeWaypoints: this.waypoints(runtime)
    };
  }

  private plan(
    vehicleId: string,
    runtime: TrafficRouteRuntime,
    startNodeId: string,
    seed: number,
    includeStartAsTarget: boolean
  ): void {
    const graph = this.options.laneGraph;
    const planner = this.planner;
    if (!graph || !planner) return;
    const start = graph.node(startNodeId);
    if (!start) return;
    const allDestinations = graph.destinationNodeIds().filter((nodeId) => nodeId !== startNodeId);
    const distantDestinations = allDestinations.filter((nodeId) => {
      const node = graph.node(nodeId);
      return node && Math.hypot(node.x - start.x, node.y - start.y) >= 512;
    });
    const candidates = distantDestinations.length > 0 ? distantDestinations : allDestinations;
    let plan = planner.plan(startNodeId, startNodeId);
    if (candidates.length > 0) {
      const first = this.options.random.integer(
        'traffic-route-destination',
        `${vehicleId}:${runtime.revision}:${seed}`,
        0,
        candidates.length
      );
      for (let offset = 0; offset < candidates.length; offset++) {
        const candidate = planner.plan(startNodeId, candidates[(first + offset) % candidates.length]);
        if (!candidate.complete || candidate.nodeIds.length < 2) continue;
        plan = candidate;
        break;
      }
    }
    if (plan.nodeIds.length < 2) {
      const fallback = graph.outgoing(startNodeId)[0];
      if (fallback) {
        plan = {
          nodeIds: [startNodeId, fallback.toNodeId],
          edgeIds: [fallback.id],
          complete: false,
          visited: 1,
          travelCost: fallback.length / Math.max(1, fallback.speedLimit)
        };
      }
    }
    runtime.nodeIds = [...plan.nodeIds];
    runtime.nodeIndex = includeStartAsTarget ? 0 : Math.min(1, Math.max(0, plan.nodeIds.length - 1));
    runtime.destinationLaneNodeId = plan.nodeIds.at(-1) ?? startNodeId;
    runtime.complete = plan.complete;
    runtime.visited = plan.visited;
    runtime.revision++;
    this.updateLegacyTarget(runtime);
  }

  private currentEdge(runtime: TrafficRouteRuntime): LaneGraphEdge | undefined {
    const targetNodeId = runtime.nodeIds[runtime.nodeIndex];
    if (!targetNodeId || !runtime.currentLaneNodeId) return undefined;
    return this.options.laneGraph?.outgoing(runtime.currentLaneNodeId)
      .find((edge) => edge.toNodeId === targetNodeId);
  }

  private updateLegacyTarget(runtime: TrafficRouteRuntime): void {
    const graph = this.options.laneGraph;
    const current = runtime.currentLaneNodeId ? graph?.node(runtime.currentLaneNodeId) : undefined;
    const targetId = runtime.nodeIds[runtime.nodeIndex];
    const target = targetId ? graph?.node(targetId) : undefined;
    if (current) {
      runtime.previousColumn = Math.floor(current.x / this.options.world.tileWidth);
      runtime.previousRow = Math.floor(current.y / this.options.world.tileHeight);
    }
    if (target) {
      runtime.targetColumn = Math.floor(target.x / this.options.world.tileWidth);
      runtime.targetRow = Math.floor(target.y / this.options.world.tileHeight);
    }
  }

  private waypoints(runtime: TrafficRouteRuntime): Array<{x: number; y: number}> {
    if (runtime.source !== 'lane-graph') return [];
    return runtime.nodeIds.slice(runtime.nodeIndex).map((nodeId) => {
      const node = this.options.laneGraph?.node(nodeId);
      return node ? {x: node.x, y: node.y} : undefined;
    }).filter((point): point is {x: number; y: number} => Boolean(point));
  }

  private chooseRecoveryRoadNode(
    current: RoadNode,
    runtime: TrafficRouteRuntime,
    seed: number
  ): RoadNode {
    const neighbors = this.options.world.roadNeighbors(current.column, current.row);
    const alternatives = neighbors.filter((node) => (
      node.column !== runtime.targetColumn || node.row !== runtime.targetRow
    ));
    const choices = alternatives.length > 0 ? alternatives : neighbors;
    if (choices.length === 0) return current;
    return choices[this.options.random.integer('traffic-recovery', seed, 0, choices.length)];
  }

  private chooseNextRoadNode(
    current: RoadNode,
    runtime: TrafficRouteRuntime,
    seed: number
  ): RoadNode {
    const neighbors = this.options.world.roadNeighbors(current.column, current.row);
    if (neighbors.length === 0) return current;
    const forwardColumn = current.column + (current.column - runtime.previousColumn);
    const forwardRow = current.row + (current.row - runtime.previousRow);
    const forward = neighbors.find((node) => node.column === forwardColumn && node.row === forwardRow);
    if (forward && (neighbors.length <= 2 || this.options.random.unit('traffic-forward', seed) < 0.88)) {
      return forward;
    }
    const alternatives = neighbors.filter((node) => (
      node.column !== runtime.previousColumn || node.row !== runtime.previousRow
    ));
    const choices = alternatives.length > 0 ? alternatives : neighbors;
    return choices[this.options.random.integer('traffic-turn', seed + 17, 0, choices.length)];
  }

  private advanceLegacySpawn(spawn: TrafficSpawn, seed: number): TrafficSpawn {
    const previous = {column: spawn.column, row: spawn.row};
    const current = {column: spawn.targetColumn, row: spawn.targetRow};
    const neighbors = this.options.world.roadNeighbors(current.column, current.row);
    const forward = neighbors.filter((candidate) => (
      candidate.column !== previous.column || candidate.row !== previous.row
    ));
    const choices = forward.length > 0 ? forward : neighbors;
    if (choices.length === 0) return {...spawn};
    const next = choices[this.options.random.integer(
      'traffic-virtual-fallback',
      seed,
      0,
      choices.length
    )];
    const point = this.options.world.roadPoint(current);
    return {
      x: point.x,
      y: point.y,
      column: current.column,
      row: current.row,
      targetColumn: next.column,
      targetRow: next.row,
      angle: Math.atan2(next.row - current.row, next.column - current.column)
    };
  }

  private captureLegacySpawn(vehicle: Pick<VehicleState, 'x' | 'y' | 'angle'>): TrafficSpawn {
    const current = this.options.world.nearestRoadNode(vehicle.x, vehicle.y, 20);
    if (!current) return this.options.world.trafficSpawn(Math.round(vehicle.x + vehicle.y), 20);
    const neighbors = this.options.world.roadNeighbors(current.column, current.row);
    const next = nearestHeadingRoadNode(current, neighbors, vehicle.angle) ?? current;
    const point = this.options.world.roadPoint(current);
    return {
      x: point.x,
      y: point.y,
      column: current.column,
      row: current.row,
      targetColumn: next.column,
      targetRow: next.row,
      angle: Math.atan2(next.row - current.row, next.column - current.column)
    };
  }
}

function nearestHeadingRoadNode(
  current: RoadNode,
  neighbors: readonly RoadNode[],
  angle: number
): RoadNode | undefined {
  let best: RoadNode | undefined;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (const neighbor of neighbors) {
    const candidateAngle = Math.atan2(neighbor.row - current.row, neighbor.column - current.column);
    let difference = candidateAngle - angle;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    const absolute = Math.abs(difference);
    if (
      absolute < bestDifference ||
      (absolute === bestDifference && best && (
        neighbor.row < best.row || neighbor.row === best.row && neighbor.column < best.column
      ))
    ) {
      best = neighbor;
      bestDifference = absolute;
    }
  }
  return best;
}
