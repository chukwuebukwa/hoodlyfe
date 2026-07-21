import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {TrafficSpawn} from '../../world-map.ts';
import {STREET_GROUND_SURFACE_ID} from '../../../shared/world/surface-map.ts';
import {
  compileLaneNetwork,
  type CompiledJunctionApproach,
  type CompiledJunctionMovement,
  type CompiledJunctionSignalGroup,
  type CompiledLaneNetwork,
  type LaneCompilerDiagnostic
} from '../../../shared/traffic/lane-network-compiler.ts';

export type LaneDirection = 'forward' | 'reverse';
export type LaneCorridorDirection = 'both' | LaneDirection;
export type LaneEdgeKind = 'lane' | 'connector' | 'turnaround';
export type LaneTurn = 'none' | 'left' | 'right' | 'straight' | 'uturn';
export type LaneVehicleClass = 'civilian' | 'service' | 'emergency';

export interface LanePointDefinition {
  x: number;
  y: number;
}

export interface LaneCorridorDefinition {
  id: string;
  speedLimit: number;
  points: LanePointDefinition[];
  direction?: LaneCorridorDirection;
  vehicleClasses?: LaneVehicleClass[];
  lanesPerDirection?: number;
  surfaceId?: string;
}

export interface LaneJunctionDefinition extends LanePointDefinition {
  id: string;
  corridors: string[];
  allowedTurns?: Array<Exclude<LaneTurn, 'none' | 'uturn'>>;
  terminalTransfer?: boolean;
}

export interface LaneRoadblockVehiclePose extends LanePointDefinition {
  angle: number;
}

export interface LaneRoadblockStingerDefinition extends LanePointDefinition {
  angle: number;
  officerPose: LaneRoadblockVehiclePose;
}

export interface LaneRoadblockDefinition extends LanePointDefinition {
  id: string;
  angle: number;
  blockedEdgeIds: string[];
  vehiclePoses: LaneRoadblockVehiclePose[];
  stinger: LaneRoadblockStingerDefinition;
}

export interface LaneGraphJunction extends LanePointDefinition {
  readonly id: string;
  readonly corridors: readonly string[];
  readonly allowedTurns: ReadonlyArray<Exclude<LaneTurn, 'none' | 'uturn'>>;
  readonly conflictRadius: number;
  readonly conflictHalfExtentX: number;
  readonly conflictHalfExtentY: number;
}

export interface LaneGraphDocument {
  schemaVersion: number;
  districtId: string;
  driveSide: 'right';
  laneOffset: number;
  laneSpacing: number;
  allowTerminalTurnarounds?: boolean;
  corridors: LaneCorridorDefinition[];
  junctions: LaneJunctionDefinition[];
  roadblocks?: LaneRoadblockDefinition[];
}

export interface LaneGraphNode {
  id: string;
  laneId: string;
  corridorId: string;
  direction: LaneDirection;
  laneIndex: number;
  laneCount: number;
  index: number;
  x: number;
  y: number;
  speedLimit: number;
  junctionId: string;
  vehicleClasses: LaneVehicleClass[];
  surfaceId: string;
}

export interface LaneGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: LaneEdgeKind;
  turn: LaneTurn;
  junctionId: string;
  speedLimit: number;
  length: number;
  vehicleClasses: LaneVehicleClass[];
  fromSurfaceId: string;
  toSurfaceId: string;
}

export interface LaneProjection {
  edge: LaneGraphEdge;
  x: number;
  y: number;
  progress: number;
  distance: number;
  angle: number;
}

export type LaneGraphJunctionApproach = CompiledJunctionApproach;
export type LaneGraphJunctionMovement = CompiledJunctionMovement;
export type LaneGraphJunctionSignalGroup = CompiledJunctionSignalGroup;
export type LaneGraphCompilerDiagnostic = LaneCompilerDiagnostic;

interface LaneGraphWorld {
  tileWidth: number;
  tileHeight: number;
  surfaces?: {
    surfaceIdsAt(x: number, y: number, actorKind: 'vehicle'): readonly string[];
    manifest?: {defaultSurfaceId: string};
    neighbors?(surfaceId: string, actorKind: 'vehicle'): readonly string[];
  };
  isRoadAt(x: number, y: number): boolean;
  canOccupy(
    x: number,
    y: number,
    radius: number,
    surfaceId?: string,
    actorKind?: 'vehicle'
  ): boolean;
}

const SUPPORTED_SCHEMA_VERSION = 2;
const DEFAULT_VEHICLE_CLASSES: LaneVehicleClass[] = ['civilian', 'service', 'emergency'];
const VALIDATION_RADIUS = 20;
const POINT_EPSILON = 0.001;

export class LaneGraphValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Lane graph validation failed:\n- ${issues.join('\n- ')}`);
    this.name = 'LaneGraphValidationError';
  }
}

export class LaneGraph {
  readonly schemaVersion: number;
  readonly districtId: string;
  private readonly nodeById = new Map<string, LaneGraphNode>();
  private readonly edgeById = new Map<string, LaneGraphEdge>();
  private readonly junctionById = new Map<string, LaneGraphJunction>();
  private readonly outgoingByNode = new Map<string, LaneGraphEdge[]>();
  private readonly approachesByJunction = new Map<string, LaneGraphJunctionApproach[]>();
  private readonly movementsByJunction = new Map<string, LaneGraphJunctionMovement[]>();
  private readonly signalGroupsByJunction = new Map<string, LaneGraphJunctionSignalGroup[]>();
  private readonly movementByTraversalEdge = new Map<string, LaneGraphJunctionMovement>();
  private readonly laneEdges: LaneGraphEdge[];
  private readonly roadblockDefinitions: LaneRoadblockDefinition[];
  private readonly compiledDiagnostics: readonly LaneGraphCompilerDiagnostic[];

  private constructor(
    document: LaneGraphDocument,
    private readonly world: LaneGraphWorld,
    compiled: CompiledLaneNetwork
  ) {
    const nodes = compiled.nodes as LaneGraphNode[];
    const edges = compiled.edges as LaneGraphEdge[];
    this.schemaVersion = document.schemaVersion;
    this.districtId = document.districtId;
    this.compiledDiagnostics = Object.freeze(compiled.diagnostics.map((diagnostic) => Object.freeze({...diagnostic})));
    this.roadblockDefinitions = (document.roadblocks ?? []).map(freezeRoadblockDefinition);
    for (const junction of allJunctionDefinitions(document, nodes)) {
      const laneNodes = nodes.filter((node) => node.junctionId === junction.id);
      const halfExtentX = laneNodes.reduce(
        (maximum, node) => Math.max(maximum, Math.abs(node.x - junction.x)),
        0
      );
      const halfExtentY = laneNodes.reduce(
        (maximum, node) => Math.max(maximum, Math.abs(node.y - junction.y)),
        0
      );
      this.junctionById.set(junction.id, Object.freeze({
        id: junction.id,
        x: junction.x,
        y: junction.y,
        corridors: Object.freeze([...junction.corridors]),
        allowedTurns: Object.freeze([...(junction.allowedTurns ?? ['straight', 'left', 'right'])]),
        conflictRadius: Math.max(34, Math.hypot(halfExtentX, halfExtentY)),
        conflictHalfExtentX: Math.max(24, halfExtentX),
        conflictHalfExtentY: Math.max(24, halfExtentY)
      }));
    }
    for (const node of nodes) this.nodeById.set(node.id, freezeNode(node));
    for (const edge of edges) {
      const frozen = freezeEdge(edge);
      this.edgeById.set(edge.id, frozen);
      const outgoing = this.outgoingByNode.get(edge.fromNodeId) ?? [];
      outgoing.push(frozen);
      this.outgoingByNode.set(edge.fromNodeId, outgoing);
    }
    for (const outgoing of this.outgoingByNode.values()) {
      outgoing.sort(compareEdges);
    }
    for (const approach of compiled.approaches) {
      const approaches = this.approachesByJunction.get(approach.junctionId) ?? [];
      approaches.push(Object.freeze({...approach, heading: Object.freeze({...approach.heading}), point: Object.freeze({...approach.point})}));
      this.approachesByJunction.set(approach.junctionId, approaches);
    }
    for (const movement of compiled.movements) {
      const frozen = Object.freeze({...movement, path: Object.freeze(movement.path.map((point) => Object.freeze({...point})))});
      const movements = this.movementsByJunction.get(movement.junctionId) ?? [];
      movements.push(frozen);
      this.movementsByJunction.set(movement.junctionId, movements);
      this.movementByTraversalEdge.set(movement.traversalEdgeId, frozen);
    }
    for (const signalGroup of compiled.signalGroups) {
      const groups = this.signalGroupsByJunction.get(signalGroup.junctionId) ?? [];
      groups.push(Object.freeze({...signalGroup, movementIds: Object.freeze([...signalGroup.movementIds])}));
      this.signalGroupsByJunction.set(signalGroup.junctionId, groups);
    }
    this.laneEdges = [...this.edgeById.values()]
      .filter((edge) => edge.kind === 'lane')
      .sort(compareEdges);
  }

  static load(world: LaneGraphWorld, projectRoot = process.cwd()): LaneGraph {
    const path = resolve(projectRoot, 'public', 'assets', 'maps', 'district-lanes.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as LaneGraphDocument;
    return LaneGraph.fromDocument(document, world);
  }

  static fromDocument(document: LaneGraphDocument, world: LaneGraphWorld): LaneGraph {
    const issues = validateDocument(document);
    if (issues.length > 0) throw new LaneGraphValidationError(issues);
    const compiled = compileDocument(document);
    issues.push(...bindNodeSurfaces(compiled.nodes, compiled.edges, world));
    issues.push(...validateCompiledGraph(compiled.nodes, compiled.edges, world));
    issues.push(...validateRoadblockDefinitions(document.roadblocks ?? [], compiled.edges, world));
    if (issues.length > 0) throw new LaneGraphValidationError(issues);
    return new LaneGraph(document, world, compiled);
  }

  nodes(): readonly LaneGraphNode[] {
    return [...this.nodeById.values()].sort(compareNodes);
  }

  edges(): readonly LaneGraphEdge[] {
    return [...this.edgeById.values()].sort(compareEdges);
  }

  adjacentLaneEdges(edgeId: string): readonly LaneGraphEdge[] {
    const edge = this.edge(edgeId);
    if (!edge || edge.kind !== 'lane') return [];
    const from = this.node(edge.fromNodeId);
    const to = this.node(edge.toNodeId);
    if (!from || !to || from.laneCount <= 1) return [];
    return this.laneEdges.filter((candidate) => {
      const candidateFrom = this.node(candidate.fromNodeId);
      const candidateTo = this.node(candidate.toNodeId);
      return Boolean(
        candidateFrom &&
        candidateTo &&
        candidateFrom.corridorId === from.corridorId &&
        candidateFrom.direction === from.direction &&
        candidateFrom.index === from.index &&
        candidateTo.index === to.index &&
        Math.abs(candidateFrom.laneIndex - from.laneIndex) === 1
      );
    }).sort((left, right) => {
      const leftNode = this.node(left.fromNodeId)!;
      const rightNode = this.node(right.fromNodeId)!;
      return leftNode.laneIndex - rightNode.laneIndex || left.id.localeCompare(right.id);
    });
  }

  node(nodeId: string): LaneGraphNode | undefined {
    return this.nodeById.get(nodeId);
  }

  edge(edgeId: string): LaneGraphEdge | undefined {
    return this.edgeById.get(edgeId);
  }

  junction(junctionId: string): LaneGraphJunction | undefined {
    return this.junctionById.get(junctionId);
  }

  junctions(): readonly LaneGraphJunction[] {
    return [...this.junctionById.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  junctionApproaches(junctionId: string): readonly LaneGraphJunctionApproach[] {
    return this.approachesByJunction.get(junctionId) ?? [];
  }

  junctionMovements(junctionId: string): readonly LaneGraphJunctionMovement[] {
    return this.movementsByJunction.get(junctionId) ?? [];
  }

  junctionSignalGroups(junctionId: string): readonly LaneGraphJunctionSignalGroup[] {
    return this.signalGroupsByJunction.get(junctionId) ?? [];
  }

  movementForTraversalEdge(edgeId: string): LaneGraphJunctionMovement | undefined {
    return this.movementByTraversalEdge.get(edgeId);
  }

  compilerDiagnostics(): readonly LaneGraphCompilerDiagnostic[] {
    return this.compiledDiagnostics;
  }

  roadblocks(): readonly LaneRoadblockDefinition[] {
    return this.roadblockDefinitions;
  }

  outgoing(nodeId: string, vehicleClass: LaneVehicleClass = 'civilian'): readonly LaneGraphEdge[] {
    return (this.outgoingByNode.get(nodeId) ?? [])
      .filter((edge) => edge.vehicleClasses.includes(vehicleClass));
  }

  destinationNodeIds(vehicleClass: LaneVehicleClass = 'civilian'): readonly string[] {
    return this.nodes()
      .filter((node) => this.outgoing(node.id, vehicleClass).length > 0)
      .map((node) => node.id);
  }

  spawn(
    index: number,
    radius: number,
    edgeAllowed: (edge: LaneGraphEdge) => boolean = () => true
  ): TrafficSpawn | undefined {
    if (this.laneEdges.length === 0) return undefined;
    const normalized = Math.abs(Number.isFinite(index) ? Math.trunc(index) : 0);
    const progressOptions = [0.22, 0.38, 0.55, 0.72];
    for (let attempt = 0; attempt < this.laneEdges.length * progressOptions.length; attempt++) {
      const edge = this.laneEdges[(normalized * 131 + attempt * 53) % this.laneEdges.length];
      if (!edgeAllowed(edge)) continue;
      const progress = progressOptions[(normalized + attempt) % progressOptions.length];
      const spawn = this.spawnOnEdge(edge, progress);
      if (
        !this.world.isRoadAt(spawn.x, spawn.y) ||
        !this.world.canOccupy(spawn.x, spawn.y, radius, spawn.surfaceId, 'vehicle')
      ) {
        continue;
      }
      return spawn;
    }
    return undefined;
  }

  advance(
    spawn: TrafficSpawn,
    seed: number,
    edgeAllowed: (edge: LaneGraphEdge) => boolean = () => true
  ): TrafficSpawn | undefined {
    const current = spawn.laneEdgeId ? this.edge(spawn.laneEdgeId) : undefined;
    const projected = current ? undefined : this.project(spawn.x, spawn.y, spawn.angle);
    const edge = current ?? projected?.edge;
    if (!edge) return undefined;
    const choices = this.outgoing(edge.toNodeId).filter(edgeAllowed);
    if (choices.length === 0) return undefined;
    const normalized = Math.abs(Number.isFinite(seed) ? Math.trunc(seed) : 0);
    const preferred = choices.filter((candidate) => candidate.kind !== 'turnaround');
    const candidates = preferred.length > 0 ? preferred : choices;
    const next = candidates[normalized % candidates.length];
    return this.spawnOnEdge(next, next.kind === 'lane' ? 0.5 : 0.8);
  }

  capture(x: number, y: number, angle: number, surfaceId?: string): TrafficSpawn | undefined {
    const projection = this.project(x, y, angle, 320, surfaceId);
    return projection ? this.spawnOnEdge(projection.edge, projection.progress) : undefined;
  }

  project(
    x: number,
    y: number,
    angle?: number,
    maximumDistance = 320,
    surfaceId?: string
  ): LaneProjection | undefined {
    let best: LaneProjection | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const edge of this.laneEdges) {
      if (surfaceId && edge.fromSurfaceId !== surfaceId) continue;
      const from = this.node(edge.fromNodeId)!;
      const to = this.node(edge.toNodeId)!;
      const projection = projectPointToSegment(x, y, from, to);
      if (projection.distance > maximumDistance) continue;
      const edgeAngle = Math.atan2(to.y - from.y, to.x - from.x);
      const headingPenalty = Number.isFinite(angle)
        ? Math.abs(normalizeAngle((angle as number) - edgeAngle)) * 44
        : 0;
      const score = projection.distance + headingPenalty;
      if (score > bestScore || (score === bestScore && best && edge.id >= best.edge.id)) continue;
      bestScore = score;
      best = {...projection, edge, angle: edgeAngle};
    }
    return best;
  }

  private spawnOnEdge(edge: LaneGraphEdge, progress: number): TrafficSpawn {
    const from = this.node(edge.fromNodeId)!;
    const to = this.node(edge.toNodeId)!;
    const clamped = Math.max(0.02, Math.min(0.98, progress));
    const x = from.x + (to.x - from.x) * clamped;
    const y = from.y + (to.y - from.y) * clamped;
    return {
      x,
      y,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      column: Math.floor(x / this.world.tileWidth),
      row: Math.floor(y / this.world.tileHeight),
      targetColumn: Math.floor(to.x / this.world.tileWidth),
      targetRow: Math.floor(to.y / this.world.tileHeight),
      laneEdgeId: edge.id,
      laneFromNodeId: edge.fromNodeId,
      laneToNodeId: edge.toNodeId,
      surfaceId: from.surfaceId
    };
  }

}

function validateDocument(document: LaneGraphDocument): string[] {
  const issues: string[] = [];
  if (document.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    issues.push(`Unsupported schemaVersion ${document.schemaVersion}; expected ${SUPPORTED_SCHEMA_VERSION}.`);
  }
  if (!document.districtId?.trim()) issues.push('districtId must be non-empty.');
  if (document.driveSide !== 'right') issues.push('Only right-hand traffic is currently supported.');
  if (!Number.isFinite(document.laneOffset) || document.laneOffset <= 0) {
    issues.push('laneOffset must be a positive finite number.');
  }
  if (!Number.isFinite(document.laneSpacing) || document.laneSpacing <= 0) {
    issues.push('laneSpacing must be a positive finite number.');
  }
  if (!Array.isArray(document.corridors) || document.corridors.length === 0) {
    issues.push('At least one corridor is required.');
  }
  if (!Array.isArray(document.junctions)) issues.push('junctions must be an array.');

  const corridorIds = new Set<string>();
  for (const corridor of document.corridors ?? []) {
    if (!corridor.id?.trim()) issues.push('Every corridor requires a non-empty id.');
    if (corridorIds.has(corridor.id)) issues.push(`Duplicate corridor id ${corridor.id}.`);
    corridorIds.add(corridor.id);
    if (!Number.isFinite(corridor.speedLimit) || corridor.speedLimit <= 0) {
      issues.push(`Corridor ${corridor.id} has an invalid speedLimit.`);
    }
    const laneCount = corridor.lanesPerDirection ?? 1;
    if (!Number.isInteger(laneCount) || laneCount < 1 || laneCount > 3) {
      issues.push(`Corridor ${corridor.id} lanesPerDirection must be an integer from 1 to 3.`);
    }
    if (!['both', 'forward', 'reverse'].includes(corridor.direction ?? 'both')) {
      issues.push(`Corridor ${corridor.id} has invalid direction ${corridor.direction}.`);
    }
    if (!Array.isArray(corridor.points) || corridor.points.length < 2) {
      issues.push(`Corridor ${corridor.id} requires at least two points.`);
      continue;
    }
    for (let index = 0; index < corridor.points.length; index++) {
      if (!finitePoint(corridor.points[index])) {
        issues.push(`Corridor ${corridor.id} point ${index} is not finite.`);
      }
      if (index > 0 && samePoint(corridor.points[index - 1], corridor.points[index])) {
        issues.push(`Corridor ${corridor.id} contains a zero-length segment at ${index}.`);
      }
    }
    for (const vehicleClass of corridor.vehicleClasses ?? []) {
      if (!DEFAULT_VEHICLE_CLASSES.includes(vehicleClass)) {
        issues.push(`Corridor ${corridor.id} has unknown vehicle class ${vehicleClass}.`);
      }
    }
  }

  const junctionIds = new Set<string>();
  for (const junction of document.junctions ?? []) {
    if (!junction.id?.trim()) issues.push('Every junction requires a non-empty id.');
    if (junctionIds.has(junction.id)) issues.push(`Duplicate junction id ${junction.id}.`);
    junctionIds.add(junction.id);
    if (!finitePoint(junction)) issues.push(`Junction ${junction.id} is not finite.`);
    if (junction.terminalTransfer !== undefined && typeof junction.terminalTransfer !== 'boolean') {
      issues.push(`Junction ${junction.id} terminalTransfer must be a boolean.`);
    }
    if (!Array.isArray(junction.corridors) || junction.corridors.length < 2) {
      issues.push(`Junction ${junction.id} must own at least two corridors.`);
    }
    for (const corridorId of junction.corridors ?? []) {
      if (!corridorIds.has(corridorId)) {
        issues.push(`Junction ${junction.id} references unknown corridor ${corridorId}.`);
        continue;
      }
      const corridor = document.corridors.find(({id}) => id === corridorId)!;
      if (!pointOnPolyline(junction, corridor.points)) {
        issues.push(`Junction ${junction.id} does not lie on corridor ${corridorId}.`);
      }
    }
  }
  const roadblockIds = new Set<string>();
  for (const roadblock of document.roadblocks ?? []) {
    if (!roadblock.id?.trim()) issues.push('Every roadblock requires a non-empty id.');
    if (roadblockIds.has(roadblock.id)) issues.push(`Duplicate roadblock id ${roadblock.id}.`);
    roadblockIds.add(roadblock.id);
    if (!finitePoint(roadblock) || !Number.isFinite(roadblock.angle)) {
      issues.push(`Roadblock ${roadblock.id} has an invalid pose.`);
    }
    if (!Array.isArray(roadblock.blockedEdgeIds) || roadblock.blockedEdgeIds.length === 0) {
      issues.push(`Roadblock ${roadblock.id} requires blockedEdgeIds.`);
    }
    for (const edgeId of roadblock.blockedEdgeIds ?? []) {
      if (!edgeId?.trim()) issues.push(`Roadblock ${roadblock.id} contains an empty edge id.`);
    }
    if (!Array.isArray(roadblock.vehiclePoses) || roadblock.vehiclePoses.length === 0) {
      issues.push(`Roadblock ${roadblock.id} requires at least one vehicle pose.`);
    }
    for (const pose of roadblock.vehiclePoses ?? []) {
      if (!finitePoint(pose) || !Number.isFinite(pose.angle)) {
        issues.push(`Roadblock ${roadblock.id} contains an invalid vehicle pose.`);
      }
    }
    if (
      !finitePoint(roadblock.stinger) || !Number.isFinite(roadblock.stinger?.angle) ||
      !finitePoint(roadblock.stinger?.officerPose) ||
      !Number.isFinite(roadblock.stinger?.officerPose?.angle)
    ) {
      issues.push(`Roadblock ${roadblock.id} requires finite stinger and officer poses.`);
    }
  }
  return issues;
}

function compileDocument(document: LaneGraphDocument): CompiledLaneNetwork {
  return compileLaneNetwork(document);
}

function allJunctionDefinitions(
  document: LaneGraphDocument,
  nodes: readonly LaneGraphNode[]
): LaneJunctionDefinition[] {
  const authoredIds = new Set(document.junctions.map((junction) => junction.id));
  const synthetic = new Map<string, LaneGraphNode[]>();
  for (const node of nodes) {
    if (!node.junctionId || authoredIds.has(node.junctionId)) continue;
    const entries = synthetic.get(node.junctionId) ?? [];
    entries.push(node);
    synthetic.set(node.junctionId, entries);
  }
  return [
    ...document.junctions,
    ...[...synthetic.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, entries]) => ({
        id,
        x: entries.reduce((sum, node) => sum + node.x, 0) / entries.length,
        y: entries.reduce((sum, node) => sum + node.y, 0) / entries.length,
        corridors: [entries[0].corridorId],
        allowedTurns: []
      }))
  ];
}

function validateCompiledGraph(
  nodes: readonly LaneGraphNode[],
  edges: readonly LaneGraphEdge[],
  world: LaneGraphWorld
): string[] {
  const issues: string[] = [];
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) issues.push(`Duplicate compiled node ${node.id}.`);
    nodeIds.add(node.id);
    if (!world.isRoadAt(node.x, node.y)) issues.push(`Lane node ${node.id} is not on a road.`);
    if (!world.canOccupy(node.x, node.y, VALIDATION_RADIUS, node.surfaceId, 'vehicle')) {
      issues.push(`Lane node ${node.id} is blocked for a vehicle.`);
    }
  }
  const edgeIds = new Set<string>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, LaneGraphEdge[]>();
  const incoming = new Map<string, LaneGraphEdge[]>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) issues.push(`Duplicate compiled edge ${edge.id}.`);
    edgeIds.add(edge.id);
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!from || !to) {
      issues.push(`Edge ${edge.id} references a missing node.`);
      continue;
    }
    const list = outgoing.get(from.id) ?? [];
    list.push(edge);
    outgoing.set(from.id, list);
    const reverseList = incoming.get(to.id) ?? [];
    reverseList.push(edge);
    incoming.set(to.id, reverseList);
    const samples = Math.max(1, Math.ceil(edge.length / 32));
    for (let index = 0; index <= samples; index++) {
      const progress = index / samples;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      if (!world.isRoadAt(x, y) || !world.canOccupy(x, y, VALIDATION_RADIUS)) {
        issues.push(`Edge ${edge.id} crosses blocked or non-road space.`);
        break;
      }
    }
  }
  for (const node of nodes) {
    if ((outgoing.get(node.id) ?? []).length === 0) issues.push(`Lane node ${node.id} is a sink.`);
  }
  if (nodes.length > 0) {
    const origin = nodes[0].id;
    const forward = reachableNodeIds(origin, (nodeId) => (
      (outgoing.get(nodeId) ?? []).map((edge) => edge.toNodeId)
    ));
    const reverse = reachableNodeIds(origin, (nodeId) => (
      (incoming.get(nodeId) ?? []).map((edge) => edge.fromNodeId)
    ));
    if (forward.size !== nodes.length || reverse.size !== nodes.length) {
      issues.push(
        `Directed graph is not strongly connected at ${origin}: ` +
        `${forward.size}/${nodes.length} reachable, ${reverse.size}/${nodes.length} can return.`
      );
    }
  }
  return [...new Set(issues)].sort();
}

function bindNodeSurfaces(
  nodes: LaneGraphNode[],
  edges: LaneGraphEdge[],
  world: LaneGraphWorld
): string[] {
  const issues: string[] = [];
  const defaultSurfaceId = world.surfaces?.manifest?.defaultSurfaceId ?? STREET_GROUND_SURFACE_ID;
  const lanes = new Map<string, LaneGraphNode[]>();
  for (const node of nodes) {
    const lane = lanes.get(node.laneId) ?? [];
    lane.push(node);
    lanes.set(node.laneId, lane);
  }
  for (const lane of lanes.values()) {
    lane.sort((left, right) => left.index - right.index);
    let previousSurfaceId = '';
    for (const node of lane) {
      if (node.surfaceId) {
        previousSurfaceId = node.surfaceId;
        continue;
      }
      const candidates = world.surfaces?.surfaceIdsAt(node.x, node.y, 'vehicle') ?? [defaultSurfaceId];
      const connected = previousSurfaceId
        ? new Set([previousSurfaceId, ...(world.surfaces?.neighbors?.(previousSurfaceId, 'vehicle') ?? [])])
        : undefined;
      const surfaceId = candidates.find((candidate) => connected?.has(candidate)) ?? candidates[0];
      if (!surfaceId) {
        issues.push(`Lane node ${node.id} has no physical surface.`);
        continue;
      }
      node.surfaceId = surfaceId;
      previousSurfaceId = surfaceId;
    }
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    edge.fromSurfaceId = nodeById.get(edge.fromNodeId)?.surfaceId ?? '';
    edge.toSurfaceId = nodeById.get(edge.toNodeId)?.surfaceId ?? '';
  }
  return issues;
}

function validateRoadblockDefinitions(
  roadblocks: readonly LaneRoadblockDefinition[],
  edges: readonly LaneGraphEdge[],
  world: LaneGraphWorld
): string[] {
  const issues: string[] = [];
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const roadblock of roadblocks) {
    for (const edgeId of roadblock.blockedEdgeIds) {
      if (!edgeIds.has(edgeId)) {
        issues.push(`Roadblock ${roadblock.id} references unknown edge ${edgeId}.`);
      }
    }
    for (const pose of roadblock.vehiclePoses) {
      if (!world.isRoadAt(pose.x, pose.y) || !world.canOccupy(pose.x, pose.y, VALIDATION_RADIUS)) {
        issues.push(`Roadblock ${roadblock.id} vehicle pose crosses blocked or non-road space.`);
      }
    }
    if (
      !world.isRoadAt(roadblock.stinger.x, roadblock.stinger.y) ||
      !world.canOccupy(roadblock.stinger.x, roadblock.stinger.y, VALIDATION_RADIUS)
    ) {
      issues.push(`Roadblock ${roadblock.id} stinger pose crosses blocked or non-road space.`);
    }
    if (!world.canOccupy(
      roadblock.stinger.officerPose.x,
      roadblock.stinger.officerPose.y,
      VALIDATION_RADIUS
    )) {
      issues.push(`Roadblock ${roadblock.id} officer pose crosses blocked space.`);
    }
  }
  return [...new Set(issues)].sort();
}

function reachableNodeIds(
  origin: string,
  neighbors: (nodeId: string) => readonly string[]
): Set<string> {
  const visited = new Set<string>();
  const pending = [origin];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...neighbors(current));
  }
  return visited;
}

function pointOnPolyline(point: LanePointDefinition, polyline: readonly LanePointDefinition[]): boolean {
  for (let index = 0; index < polyline.length - 1; index++) {
    if (pointOnSegment(point, polyline[index], polyline[index + 1])) return true;
  }
  return false;
}

function pointOnSegment(
  point: LanePointDefinition,
  from: LanePointDefinition,
  to: LanePointDefinition
): boolean {
  const cross = (point.x - from.x) * (to.y - from.y) - (point.y - from.y) * (to.x - from.x);
  if (Math.abs(cross) > POINT_EPSILON) return false;
  const dot = (point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y);
  const lengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  return dot >= -POINT_EPSILON && dot <= lengthSquared + POINT_EPSILON;
}

function projectPointToSegment(
  x: number,
  y: number,
  from: LanePointDefinition,
  to: LanePointDefinition
): Omit<LaneProjection, 'edge' | 'angle'> {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const progress = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - from.x) * deltaX + (y - from.y) * deltaY) / lengthSquared
  ));
  const projectedX = from.x + deltaX * progress;
  const projectedY = from.y + deltaY * progress;
  return {
    x: projectedX,
    y: projectedY,
    progress,
    distance: Math.hypot(projectedX - x, projectedY - y)
  };
}

function finitePoint(point: LanePointDefinition | undefined): boolean {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function samePoint(left: LanePointDefinition, right: LanePointDefinition): boolean {
  return Math.abs(left.x - right.x) <= POINT_EPSILON && Math.abs(left.y - right.y) <= POINT_EPSILON;
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function freezeNode(node: LaneGraphNode): LaneGraphNode {
  return Object.freeze({...node, vehicleClasses: Object.freeze([...node.vehicleClasses])}) as LaneGraphNode;
}

function freezeEdge(edge: LaneGraphEdge): LaneGraphEdge {
  return Object.freeze({...edge, vehicleClasses: Object.freeze([...edge.vehicleClasses])}) as LaneGraphEdge;
}

function freezeRoadblockDefinition(definition: LaneRoadblockDefinition): LaneRoadblockDefinition {
  return Object.freeze({
    ...definition,
    blockedEdgeIds: Object.freeze([...definition.blockedEdgeIds]),
    vehiclePoses: Object.freeze(definition.vehiclePoses.map((pose) => Object.freeze({...pose}))),
    stinger: Object.freeze({
      ...definition.stinger,
      officerPose: Object.freeze({...definition.stinger.officerPose})
    })
  }) as LaneRoadblockDefinition;
}

function compareNodes(left: LaneGraphNode, right: LaneGraphNode): number {
  return left.id.localeCompare(right.id);
}

function compareEdges(left: LaneGraphEdge, right: LaneGraphEdge): number {
  return left.id.localeCompare(right.id);
}
