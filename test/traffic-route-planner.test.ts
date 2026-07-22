import assert from 'node:assert/strict';
import test from 'node:test';
import type {LaneGraph, LaneGraphEdge, LaneGraphNode} from '../server/game/traffic/lane-graph.ts';
import {TrafficRoutePlanner} from '../server/game/traffic/traffic-route-planner.ts';

test('route planning prefers high-priority roads and reroutes around congestion', () => {
  const graph = diamondGraph();
  const baseline = new TrafficRoutePlanner(graph).plan('start', 'goal');
  assert.deepEqual(baseline.edgeIds, ['arterial-in', 'arterial-out']);

  const congested = new TrafficRoutePlanner(
    graph,
    undefined,
    () => true,
    (edge) => edge.id.startsWith('arterial') ? 4 : 1
  ).plan('start', 'goal');
  assert.deepEqual(congested.edgeIds, ['street-in', 'street-out']);
});

function diamondGraph(): LaneGraph {
  const nodes = [
    node('start', 0, 0),
    node('arterial', 100, -50),
    node('street', 100, 50),
    node('goal', 200, 0)
  ];
  const edges = [
    edge('arterial-in', 'start', 'arterial', 1.5),
    edge('arterial-out', 'arterial', 'goal', 1.5),
    edge('street-in', 'start', 'street', 1),
    edge('street-out', 'street', 'goal', 1)
  ];
  const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  return {
    nodes: () => nodes,
    edges: () => edges,
    node: (id: string) => nodeById.get(id),
    outgoing: (id: string) => edges.filter((candidate) => candidate.fromNodeId === id)
  } as unknown as LaneGraph;
}

function node(id: string, x: number, y: number): LaneGraphNode {
  return {
    id,
    laneId: id,
    corridorId: id,
    direction: 'forward',
    laneIndex: 0,
    laneCount: 1,
    index: 0,
    x,
    y,
    speedLimit: 100,
    junctionId: '',
    vehicleClasses: ['civilian'],
    surfaceId: 'ground',
    roadClass: 'street',
    routePriority: 1,
    trafficDensity: 1
  };
}

function edge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  routePriority: number
): LaneGraphEdge {
  return {
    id,
    fromNodeId,
    toNodeId,
    kind: 'lane',
    turn: 'none',
    junctionId: '',
    speedLimit: 100,
    length: 112,
    vehicleClasses: ['civilian'],
    fromSurfaceId: 'ground',
    toSurfaceId: 'ground',
    roadClass: routePriority > 1 ? 'arterial' : 'street',
    routePriority,
    trafficDensity: 1
  };
}
