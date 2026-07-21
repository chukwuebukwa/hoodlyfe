export type CompiledLaneDirection = 'forward' | 'reverse';
export type CompiledLaneCorridorDirection = 'both' | CompiledLaneDirection;
export type CompiledLaneEdgeKind = 'lane' | 'connector' | 'turnaround';
export type CompiledLaneTurn = 'none' | 'left' | 'right' | 'straight' | 'uturn';
export type CompiledLaneVehicleClass = 'civilian' | 'service' | 'emergency';

export interface LaneCompilerPoint {
  x: number;
  y: number;
}

export interface LaneCompilerCorridor {
  id: string;
  speedLimit: number;
  points: LaneCompilerPoint[];
  direction?: CompiledLaneCorridorDirection;
  vehicleClasses?: CompiledLaneVehicleClass[];
  lanesPerDirection?: number;
  surfaceId?: string;
}

export interface LaneCompilerJunction extends LaneCompilerPoint {
  id: string;
  corridors: string[];
  allowedTurns?: Array<Exclude<CompiledLaneTurn, 'none' | 'uturn'>>;
  terminalTransfer?: boolean;
}

export interface LaneCompilerDocument {
  laneOffset: number;
  laneSpacing: number;
  allowTerminalTurnarounds?: boolean;
  corridors: LaneCompilerCorridor[];
  junctions: LaneCompilerJunction[];
}

export interface CompiledLaneNode extends LaneCompilerPoint {
  id: string;
  laneId: string;
  corridorId: string;
  direction: CompiledLaneDirection;
  laneIndex: number;
  laneCount: number;
  index: number;
  speedLimit: number;
  junctionId: string;
  vehicleClasses: CompiledLaneVehicleClass[];
  surfaceId: string;
}

export interface CompiledLaneEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: CompiledLaneEdgeKind;
  turn: CompiledLaneTurn;
  junctionId: string;
  speedLimit: number;
  length: number;
  vehicleClasses: CompiledLaneVehicleClass[];
  fromSurfaceId: string;
  toSurfaceId: string;
}

export interface CompiledJunctionApproach {
  id: string;
  junctionId: string;
  role: 'incoming' | 'outgoing';
  corridorId: string;
  direction: CompiledLaneDirection;
  laneIndex: number;
  laneId: string;
  nodeId: string;
  adjacentNodeId: string;
  heading: LaneCompilerPoint;
  point: LaneCompilerPoint;
}

export interface CompiledJunctionMovement {
  id: string;
  junctionId: string;
  traversalEdgeId: string;
  connectorEdgeId?: string;
  entryApproachId: string;
  exitApproachId: string;
  entryLaneId: string;
  exitLaneId: string;
  fromNodeId: string;
  toNodeId: string;
  turn: Exclude<CompiledLaneTurn, 'none' | 'uturn'>;
  path: readonly LaneCompilerPoint[];
  signalGroupId: string;
}

export interface CompiledJunctionSignalGroup {
  id: string;
  junctionId: string;
  movementIds: readonly string[];
}

export interface LaneCompilerDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  junctionId?: string;
  approachId?: string;
}

export interface CompiledLaneNetwork {
  nodes: CompiledLaneNode[];
  edges: CompiledLaneEdge[];
  approaches: CompiledJunctionApproach[];
  movements: CompiledJunctionMovement[];
  signalGroups: CompiledJunctionSignalGroup[];
  diagnostics: LaneCompilerDiagnostic[];
}

interface CenterlineSample extends LaneCompilerPoint {
  junctionId: string;
}

interface CompiledLane {
  id: string;
  corridorId: string;
  direction: CompiledLaneDirection;
  laneIndex: number;
  laneCount: number;
  nodes: CompiledLaneNode[];
}

interface PendingMovement extends Omit<CompiledJunctionMovement, 'signalGroupId'> {}

const DEFAULT_VEHICLE_CLASSES: CompiledLaneVehicleClass[] = ['civilian', 'service', 'emergency'];
const DEFAULT_MOVEMENT_HALF_WIDTH = 18.5;
const POINT_EPSILON = 0.001;

export function compileLaneNetwork(document: LaneCompilerDocument): CompiledLaneNetwork {
  const nodes: CompiledLaneNode[] = [];
  const edges: CompiledLaneEdge[] = [];
  const lanes: CompiledLane[] = [];
  for (const corridor of [...document.corridors].sort((left, right) => left.id.localeCompare(right.id))) {
    const samples = centerlineSamples(corridor, document.junctions);
    const laneCount = corridor.lanesPerDirection ?? 1;
    const forward = corridorSupportsDirection(corridor, 'forward')
      ? createDirectionalLanes(document, corridor, 'forward', samples, laneCount)
      : [];
    const reverse = corridorSupportsDirection(corridor, 'reverse')
      ? createDirectionalLanes(document, corridor, 'reverse', [...samples].reverse(), laneCount)
      : [];
    const supportsTurnarounds = Boolean(document.allowTerminalTurnarounds && forward.length && reverse.length);
    const terminalStart = supportsTurnarounds && !forward[0].nodes[0].junctionId;
    const terminalEnd = supportsTurnarounds && !forward[0].nodes.at(-1)!.junctionId;
    if (terminalStart || terminalEnd) markTerminalJunctions(corridor.id, forward, reverse, terminalStart, terminalEnd);
    lanes.push(...forward, ...reverse);
    nodes.push(...forward.flatMap((lane) => lane.nodes), ...reverse.flatMap((lane) => lane.nodes));
    edges.push(...forward.flatMap(laneEdges), ...reverse.flatMap(laneEdges));
    if (terminalStart || terminalEnd) {
      const startJunctionId = terminalJunctionId(corridor.id, 'start');
      const endJunctionId = terminalJunctionId(corridor.id, 'end');
      for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
        if (terminalEnd) edges.push(connectorEdge(
            forward[laneIndex].nodes.at(-1)!, reverse[laneIndex].nodes[0],
            'turnaround', 'uturn', endJunctionId
        ));
        if (terminalStart) edges.push(connectorEdge(
            reverse[laneIndex].nodes.at(-1)!, forward[laneIndex].nodes[0],
            'turnaround', 'uturn', startJunctionId
        ));
      }
    }
  }

  const approaches: CompiledJunctionApproach[] = [];
  const pendingMovements: PendingMovement[] = [];
  const diagnostics: LaneCompilerDiagnostic[] = [];
  for (const junction of [...document.junctions].sort((left, right) => left.id.localeCompare(right.id))) {
    const entries = lanes.flatMap((lane) => lane.nodes
      .filter((node) => node.junctionId === junction.id)
      .map((node) => ({lane, node}))
    );
    const incoming = entries
      .filter(({node}) => node.index > 0)
      .map(({lane, node}) => approachFor(junction.id, lane, node, 'incoming'));
    const outgoing = entries
      .filter(({lane, node}) => node.index < lane.nodes.length - 1)
      .map(({lane, node}) => approachFor(junction.id, lane, node, 'outgoing'));
    approaches.push(...incoming, ...outgoing);

    if (incoming.length === 0) diagnostics.push(diagnostic(
      'error', 'junction-no-incoming', `${junction.id} has no legal incoming approach.`, junction.id
    ));
    if (outgoing.length === 0) diagnostics.push(diagnostic(
      'error', 'junction-no-outgoing', `${junction.id} has no legal outgoing approach.`, junction.id
    ));

    for (const inbound of incoming) {
      const inboundLane = lanes.find((lane) => lane.id === inbound.laneId)!;
      const inboundNode = inboundLane.nodes.find((node) => node.id === inbound.nodeId)!;
      const previous = inboundLane.nodes[inboundNode.index - 1];
      let movementCount = 0;
      for (const outbound of outgoing) {
        const outboundLane = lanes.find((lane) => lane.id === outbound.laneId)!;
        const outboundNode = outboundLane.nodes.find((node) => node.id === outbound.nodeId)!;
        const next = outboundLane.nodes[outboundNode.index + 1];
        const sameLane = outbound.laneId === inbound.laneId;
        const turn = sameLane ? 'straight' : classifyTurn(inbound.heading, outbound.heading);
        if (turn === 'uturn') continue;
        if (!(junction.allowedTurns ?? ['straight', 'left', 'right']).includes(turn)) continue;
        if (!sameLane && !legalLaneConnection(
          inboundNode,
          outboundNode,
          turn,
          Boolean(
            junction.terminalTransfer &&
            inboundNode.index === inboundLane.nodes.length - 1 &&
            outboundNode.index === 0
          )
        )) continue;
        const connector = sameLane
          ? undefined
          : connectorEdge(inboundNode, outboundNode, 'connector', turn, junction.id);
        if (connector) edges.push(connector);
        const traversalEdgeId = connector?.id ?? laneEdgeId(outboundLane, outboundNode.index);
        pendingMovements.push({
          id: `${junction.id}:${inbound.laneId}->${outbound.laneId}:${turn}`,
          junctionId: junction.id,
          traversalEdgeId,
          connectorEdgeId: connector?.id,
          entryApproachId: inbound.id,
          exitApproachId: outbound.id,
          entryLaneId: laneEdgeId(inboundLane, inboundNode.index - 1),
          exitLaneId: laneEdgeId(outboundLane, outboundNode.index),
          fromNodeId: inboundNode.id,
          toNodeId: outboundNode.id,
          turn,
          path: movementCurve(previous, inboundNode, outboundNode, next)
        });
        movementCount++;
      }
      if (movementCount === 0) diagnostics.push(diagnostic(
        'error',
        'approach-no-movement',
        `${inbound.id} cannot reach any legal outgoing lane.`,
        junction.id,
        inbound.id
      ));
    }
  }

  const {movements, signalGroups} = assignSignalGroups(pendingMovements);
  diagnostics.push(...networkDiagnostics(nodes, edges));
  return {nodes, edges, approaches, movements, signalGroups, diagnostics};
}

function createDirectionalLanes(
  document: LaneCompilerDocument,
  corridor: LaneCompilerCorridor,
  direction: CompiledLaneDirection,
  samples: CenterlineSample[],
  laneCount: number
): CompiledLane[] {
  return Array.from({length: laneCount}, (_, laneIndex) => compileLane(
    corridor,
    direction,
    samples,
    document.laneOffset + document.laneSpacing * laneIndex,
    laneIndex,
    laneCount,
    corridor.surfaceId ?? ''
  ));
}

function centerlineSamples(
  corridor: LaneCompilerCorridor,
  junctions: readonly LaneCompilerJunction[]
): CenterlineSample[] {
  const result: CenterlineSample[] = [];
  for (let segmentIndex = 0; segmentIndex < corridor.points.length - 1; segmentIndex++) {
    const from = corridor.points[segmentIndex];
    const to = corridor.points[segmentIndex + 1];
    const candidates: CenterlineSample[] = [
      {...from, junctionId: junctionAt(from, corridor.id, junctions)?.id ?? ''},
      ...junctions
        .filter((junction) => junction.corridors.includes(corridor.id) && pointOnSegment(junction, from, to))
        .map((junction) => ({x: junction.x, y: junction.y, junctionId: junction.id})),
      {...to, junctionId: junctionAt(to, corridor.id, junctions)?.id ?? ''}
    ].sort((left, right) => segmentProgress(left, from, to) - segmentProgress(right, from, to));
    for (const candidate of candidates) {
      const existing = result.at(-1);
      if (existing && samePoint(existing, candidate)) {
        if (!existing.junctionId) existing.junctionId = candidate.junctionId;
        continue;
      }
      result.push(candidate);
    }
  }
  return result;
}

function compileLane(
  corridor: LaneCompilerCorridor,
  direction: CompiledLaneDirection,
  samples: CenterlineSample[],
  laneOffset: number,
  laneIndex: number,
  laneCount: number,
  surfaceId: string
): CompiledLane {
  const id = laneIndex === 0
    ? `${corridor.id}:${direction}`
    : `${corridor.id}:${direction}:lane-${laneIndex}`;
  const vehicleClasses = [...(corridor.vehicleClasses ?? DEFAULT_VEHICLE_CLASSES)].sort();
  const nodes = samples.map((sample, index): CompiledLaneNode => {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const heading = index < samples.length - 1 ? unitVector(sample, next) : unitVector(previous, sample);
    return {
      id: `${id}:${index}`,
      laneId: id,
      corridorId: corridor.id,
      direction,
      laneIndex,
      laneCount,
      index,
      x: sample.x - heading.y * laneOffset,
      y: sample.y + heading.x * laneOffset,
      speedLimit: corridor.speedLimit,
      junctionId: sample.junctionId,
      vehicleClasses,
      surfaceId
    };
  });
  return {id, corridorId: corridor.id, direction, laneIndex, laneCount, nodes};
}

function laneEdges(lane: CompiledLane): CompiledLaneEdge[] {
  return lane.nodes.slice(0, -1).map((from, index) => {
    const to = lane.nodes[index + 1];
    return {
      id: laneEdgeId(lane, index),
      fromNodeId: from.id,
      toNodeId: to.id,
      kind: 'lane',
      turn: 'none',
      junctionId: '',
      speedLimit: Math.min(from.speedLimit, to.speedLimit),
      length: distance(from, to),
      vehicleClasses: intersectClasses(from.vehicleClasses, to.vehicleClasses),
      fromSurfaceId: from.surfaceId,
      toSurfaceId: to.surfaceId
    };
  });
}

function laneEdgeId(lane: Pick<CompiledLane, 'id'>, index: number): string {
  return `${lane.id}:edge:${index}`;
}

function connectorEdge(
  from: CompiledLaneNode,
  to: CompiledLaneNode,
  kind: 'connector' | 'turnaround',
  turn: CompiledLaneTurn,
  junctionId: string
): CompiledLaneEdge {
  return {
    id: `${kind}:${junctionId || from.corridorId}:${from.id}->${to.id}`,
    fromNodeId: from.id,
    toNodeId: to.id,
    kind,
    turn,
    junctionId,
    speedLimit: Math.min(from.speedLimit, to.speedLimit, kind === 'turnaround' ? 52 : 76),
    length: Math.max(12, distance(from, to)),
    vehicleClasses: intersectClasses(from.vehicleClasses, to.vehicleClasses),
    fromSurfaceId: from.surfaceId,
    toSurfaceId: to.surfaceId
  };
}

function approachFor(
  junctionId: string,
  lane: CompiledLane,
  node: CompiledLaneNode,
  role: CompiledJunctionApproach['role']
): CompiledJunctionApproach {
  const adjacent = role === 'incoming' ? lane.nodes[node.index - 1] : lane.nodes[node.index + 1];
  const heading = role === 'incoming' ? unitVector(adjacent, node) : unitVector(node, adjacent);
  return {
    id: `${junctionId}:${lane.id}:${role}`,
    junctionId,
    role,
    corridorId: lane.corridorId,
    direction: lane.direction,
    laneIndex: lane.laneIndex,
    laneId: lane.id,
    nodeId: node.id,
    adjacentNodeId: adjacent.id,
    heading,
    point: {x: node.x, y: node.y}
  };
}

function legalLaneConnection(
  inbound: CompiledLaneNode,
  outbound: CompiledLaneNode,
  turn: Exclude<CompiledLaneTurn, 'none' | 'uturn'>,
  terminalTransfer: boolean
): boolean {
  if (terminalTransfer) return true;
  if (turn === 'left' && inbound.laneIndex !== 0) return false;
  if (turn === 'right' && inbound.laneIndex !== inbound.laneCount - 1) return false;
  const targetLane = turn === 'left'
    ? 0
    : turn === 'right'
      ? outbound.laneCount - 1
      : Math.min(inbound.laneIndex, outbound.laneCount - 1);
  return outbound.laneIndex === targetLane;
}

function movementCurve(
  previous: CompiledLaneNode,
  entry: CompiledLaneNode,
  exit: CompiledLaneNode,
  next: CompiledLaneNode
): LaneCompilerPoint[] {
  const incoming = unitVector(previous, entry);
  const outgoing = unitVector(exit, next);
  const chord = distance(entry, exit);
  const controlReach = Math.max(8, Math.min(64, chord * 0.65));
  const controlA = {x: entry.x + incoming.x * controlReach, y: entry.y + incoming.y * controlReach};
  const controlB = {x: exit.x - outgoing.x * controlReach, y: exit.y - outgoing.y * controlReach};
  const approachReach = Math.min(64, distance(previous, entry));
  const exitReach = Math.min(64, distance(exit, next));
  const result: LaneCompilerPoint[] = [{
    x: entry.x - incoming.x * approachReach,
    y: entry.y - incoming.y * approachReach
  }];
  for (let index = 0; index <= 8; index++) {
    const progress = index / 8;
    result.push(cubicBezier(entry, controlA, controlB, exit, progress));
  }
  result.push({x: exit.x + outgoing.x * exitReach, y: exit.y + outgoing.y * exitReach});
  return deduplicatePoints(result);
}

function assignSignalGroups(pending: PendingMovement[]): {
  movements: CompiledJunctionMovement[];
  signalGroups: CompiledJunctionSignalGroup[];
} {
  const movements: CompiledJunctionMovement[] = [];
  const signalGroups: CompiledJunctionSignalGroup[] = [];
  const byJunction = new Map<string, PendingMovement[]>();
  for (const movement of pending) {
    const entries = byJunction.get(movement.junctionId) ?? [];
    entries.push(movement);
    byJunction.set(movement.junctionId, entries);
  }
  for (const [junctionId, entries] of [...byJunction].sort(([left], [right]) => left.localeCompare(right))) {
    const groups: PendingMovement[][] = [];
    for (const movement of entries.sort((left, right) => left.id.localeCompare(right.id))) {
      let group = groups.find((candidate) => candidate.every((other) => !signalMovementsConflict(movement, other)));
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(movement);
    }
    groups.forEach((group, index) => {
      const id = `${junctionId}:phase-${index + 1}`;
      const movementIds = group.map((movement) => movement.id);
      signalGroups.push({id, junctionId, movementIds});
      movements.push(...group.map((movement) => ({...movement, signalGroupId: id})));
    });
  }
  return {movements, signalGroups};
}

function signalMovementsConflict(left: PendingMovement, right: PendingMovement): boolean {
  // A phase may permit alternate turns from one approach. Runtime reservations
  // still serialize cars sharing that entry lane when they actually traverse it.
  if (left.entryApproachId === right.entryApproachId) return false;
  return movementsConflict(left, right);
}

function movementsConflict(left: PendingMovement, right: PendingMovement): boolean {
  if (left.entryLaneId === right.entryLaneId || left.exitLaneId === right.exitLaneId) return true;
  const minimumSeparationSquared = (DEFAULT_MOVEMENT_HALF_WIDTH * 2) ** 2;
  for (let leftIndex = 0; leftIndex < left.path.length - 1; leftIndex++) {
    for (let rightIndex = 0; rightIndex < right.path.length - 1; rightIndex++) {
      if (segmentDistanceSquared(
        left.path[leftIndex], left.path[leftIndex + 1],
        right.path[rightIndex], right.path[rightIndex + 1]
      ) <= minimumSeparationSquared) return true;
    }
  }
  return false;
}

function networkDiagnostics(
  nodes: readonly CompiledLaneNode[],
  edges: readonly CompiledLaneEdge[]
): LaneCompilerDiagnostic[] {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const outgoingNodes = outgoing.get(edge.fromNodeId) ?? [];
    outgoingNodes.push(edge.toNodeId);
    outgoing.set(edge.fromNodeId, outgoingNodes);
    const incomingNodes = incoming.get(edge.toNodeId) ?? [];
    incomingNodes.push(edge.fromNodeId);
    incoming.set(edge.toNodeId, incomingNodes);
  }
  const diagnostics: LaneCompilerDiagnostic[] = [];
  for (const node of nodes) {
    if ((outgoing.get(node.id) ?? []).length === 0) diagnostics.push(diagnostic(
      'error', 'lane-node-sink', `Lane node ${node.id} is a sink.`
    ));
  }
  if (nodes.length > 0) {
    const origin = nodes[0].id;
    const forward = reachable(origin, outgoing);
    const reverse = reachable(origin, incoming);
    if (forward.size !== nodes.length || reverse.size !== nodes.length) diagnostics.push(diagnostic(
      'error',
      'directed-network-disconnected',
      `Directed graph is not strongly connected at ${origin}: ${forward.size}/${nodes.length} reachable, ${reverse.size}/${nodes.length} can return.`
    ));
  }
  return diagnostics;
}

function reachable(origin: string, adjacency: ReadonlyMap<string, readonly string[]>): Set<string> {
  const visited = new Set<string>();
  const pending = [origin];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return visited;
}

function diagnostic(
  severity: LaneCompilerDiagnostic['severity'],
  code: string,
  message: string,
  junctionId?: string,
  approachId?: string
): LaneCompilerDiagnostic {
  return {severity, code, message, junctionId, approachId};
}

function markTerminalJunctions(
  corridorId: string,
  forward: readonly CompiledLane[],
  reverse: readonly CompiledLane[],
  markStart: boolean,
  markEnd: boolean
): void {
  const start = terminalJunctionId(corridorId, 'start');
  const end = terminalJunctionId(corridorId, 'end');
  for (const lane of forward) {
    if (markStart) lane.nodes[0].junctionId = start;
    if (markEnd) lane.nodes.at(-1)!.junctionId = end;
  }
  for (const lane of reverse) {
    if (markEnd) lane.nodes[0].junctionId = end;
    if (markStart) lane.nodes.at(-1)!.junctionId = start;
  }
}

function terminalJunctionId(corridorId: string, terminal: 'start' | 'end'): string {
  return `terminal:${corridorId}:${terminal}`;
}

function corridorSupportsDirection(
  corridor: Pick<LaneCompilerCorridor, 'direction'>,
  direction: CompiledLaneDirection
): boolean {
  const configured = corridor.direction ?? 'both';
  return configured === 'both' || configured === direction;
}

function classifyTurn(
  incoming: LaneCompilerPoint,
  outgoing: LaneCompilerPoint
): Exclude<CompiledLaneTurn, 'none'> {
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  if (dot < -0.75) return 'uturn';
  if (dot > 0.75) return 'straight';
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  return cross > 0 ? 'right' : 'left';
}

function junctionAt(
  point: LaneCompilerPoint,
  corridorId: string,
  junctions: readonly LaneCompilerJunction[]
): LaneCompilerJunction | undefined {
  return junctions.find((junction) => junction.corridors.includes(corridorId) && samePoint(junction, point));
}

function pointOnSegment(point: LaneCompilerPoint, from: LaneCompilerPoint, to: LaneCompilerPoint): boolean {
  const cross = (point.x - from.x) * (to.y - from.y) - (point.y - from.y) * (to.x - from.x);
  if (Math.abs(cross) > POINT_EPSILON) return false;
  const dot = (point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y);
  const lengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  return dot >= -POINT_EPSILON && dot <= lengthSquared + POINT_EPSILON;
}

function segmentProgress(point: LaneCompilerPoint, from: LaneCompilerPoint, to: LaneCompilerPoint): number {
  const lengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  if (lengthSquared === 0) return 0;
  return ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / lengthSquared;
}

function unitVector(from: LaneCompilerPoint, to: LaneCompilerPoint): LaneCompilerPoint {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const magnitude = Math.hypot(deltaX, deltaY);
  return magnitude > 0 ? {x: deltaX / magnitude, y: deltaY / magnitude} : {x: 0, y: 0};
}

function cubicBezier(
  from: LaneCompilerPoint,
  controlA: LaneCompilerPoint,
  controlB: LaneCompilerPoint,
  to: LaneCompilerPoint,
  progress: number
): LaneCompilerPoint {
  const inverse = 1 - progress;
  return {
    x: inverse ** 3 * from.x + 3 * inverse ** 2 * progress * controlA.x +
      3 * inverse * progress ** 2 * controlB.x + progress ** 3 * to.x,
    y: inverse ** 3 * from.y + 3 * inverse ** 2 * progress * controlA.y +
      3 * inverse * progress ** 2 * controlB.y + progress ** 3 * to.y
  };
}

function deduplicatePoints(points: readonly LaneCompilerPoint[]): LaneCompilerPoint[] {
  const result: LaneCompilerPoint[] = [];
  for (const point of points) {
    if (!result.some((candidate) => samePoint(candidate, point))) result.push(point);
  }
  return result;
}

function intersectClasses(
  left: readonly CompiledLaneVehicleClass[],
  right: readonly CompiledLaneVehicleClass[]
): CompiledLaneVehicleClass[] {
  return left.filter((vehicleClass) => right.includes(vehicleClass)).sort();
}

function segmentDistanceSquared(
  leftFrom: LaneCompilerPoint,
  leftTo: LaneCompilerPoint,
  rightFrom: LaneCompilerPoint,
  rightTo: LaneCompilerPoint
): number {
  if (segmentsIntersect(leftFrom, leftTo, rightFrom, rightTo)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(leftFrom, rightFrom, rightTo),
    pointSegmentDistanceSquared(leftTo, rightFrom, rightTo),
    pointSegmentDistanceSquared(rightFrom, leftFrom, leftTo),
    pointSegmentDistanceSquared(rightTo, leftFrom, leftTo)
  );
}

function segmentsIntersect(a: LaneCompilerPoint, b: LaneCompilerPoint, c: LaneCompilerPoint, d: LaneCompilerPoint): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (abC === 0 && onSegment(c, a, b)) || (abD === 0 && onSegment(d, a, b)) ||
    (cdA === 0 && onSegment(a, c, d)) || (cdB === 0 && onSegment(b, c, d)) ||
    (oppositeSigns(abC, abD) && oppositeSigns(cdA, cdB));
}

function orientation(from: LaneCompilerPoint, to: LaneCompilerPoint, point: LaneCompilerPoint): number {
  const cross = (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  return Math.abs(cross) <= 0.000001 ? 0 : cross;
}

function oppositeSigns(left: number, right: number): boolean {
  return left < 0 && right > 0 || left > 0 && right < 0;
}

function onSegment(point: LaneCompilerPoint, from: LaneCompilerPoint, to: LaneCompilerPoint): boolean {
  return point.x >= Math.min(from.x, to.x) - 0.000001 && point.x <= Math.max(from.x, to.x) + 0.000001 &&
    point.y >= Math.min(from.y, to.y) - 0.000001 && point.y <= Math.max(from.y, to.y) + 0.000001;
}

function pointSegmentDistanceSquared(point: LaneCompilerPoint, from: LaneCompilerPoint, to: LaneCompilerPoint): number {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared <= 0.000001) return distance(point, from) ** 2;
  const progress = Math.max(0, Math.min(1, (
    (point.x - from.x) * deltaX + (point.y - from.y) * deltaY
  ) / lengthSquared));
  return distance(point, {x: from.x + deltaX * progress, y: from.y + deltaY * progress}) ** 2;
}

function distance(left: LaneCompilerPoint, right: LaneCompilerPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function samePoint(left: LaneCompilerPoint, right: LaneCompilerPoint): boolean {
  return Math.abs(left.x - right.x) <= POINT_EPSILON && Math.abs(left.y - right.y) <= POINT_EPSILON;
}
