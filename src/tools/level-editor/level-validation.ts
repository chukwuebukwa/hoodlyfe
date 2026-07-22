import {
  corridorSupportsDirection,
  documentWorldSize,
  tileIndex,
  worldToTile,
  type LevelEditorDocument,
  type Point2D
} from './level-document.ts';
import {
  compiledLaneEdgeDiagnostic,
  compiledLaneEdgeIdFromMessage,
  compiledLaneEdgeLabel,
  type CompiledLaneEdgeDiagnostic
} from './compiled-lane-diagnostic.ts';
import {compileLaneNetwork} from '../../../shared/traffic/lane-network-compiler.ts';

export type ValidationSeverity = 'error' | 'warning' | 'info';
export type ValidationEntityKind = 'map' | 'spawn' | 'corridor' | 'junction' | 'roadblock';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
  entityKind: ValidationEntityKind;
  entityId?: string;
  point?: Point2D;
  compiledLaneEdge?: CompiledLaneEdgeDiagnostic;
}

export function withRuntimeLaneIssues(
  report: ValidationReport,
  document: LevelEditorDocument,
  messages: readonly string[]
): ValidationReport {
  const runtimeIssues = messages.map((message, index): ValidationIssue => {
    const edgeId = compiledLaneEdgeIdFromMessage(message);
    const diagnostic = edgeId ? compiledLaneEdgeDiagnostic(document.lanes, edgeId) : undefined;
    return {
      id: `runtime-lane-${index}-${edgeId ?? 'unknown'}`,
      severity: 'error',
      code: diagnostic ? 'compiled-lane-blocked' : 'compiled-lane-invalid',
      message: diagnostic
        ? `${diagnostic.corridorId}, ${compiledLaneEdgeLabel(diagnostic)} crosses blocked or non-road space.`
        : message,
      entityKind: diagnostic ? 'corridor' : 'map',
      entityId: diagnostic?.corridorId,
      point: diagnostic?.midpoint,
      compiledLaneEdge: diagnostic
    };
  });
  const issues = [...report.issues, ...runtimeIssues];
  return {
    issues,
    counts: {
      error: issues.filter((issue) => issue.severity === 'error').length,
      warning: issues.filter((issue) => issue.severity === 'warning').length,
      info: issues.filter((issue) => issue.severity === 'info').length
    }
  };
}

export interface ValidationReport {
  issues: ValidationIssue[];
  counts: Record<ValidationSeverity, number>;
}

const LANE_POINT_EPSILON = 0.001;

export function validateLevelDocument(document: LevelEditorDocument): ValidationReport {
  const issues: ValidationIssue[] = [];
  const expectedCells = document.map.width * document.map.height;
  if (document.layers.collision.length !== expectedCells) {
    add(issues, 'error', 'collision-size', `Collision layer has ${document.layers.collision.length} cells; expected ${expectedCells}.`, 'map');
  }
  if (document.layers.roads.length !== expectedCells) {
    add(issues, 'error', 'roads-size', `Road layer has ${document.layers.roads.length} cells; expected ${expectedCells}.`, 'map');
  }

  validateSpawns(document, issues);
  validateCorridors(document, issues);
  validateJunctions(document, issues);
  validateCompiledIntersections(document, issues);
  validateCorridorConnectivity(document, issues);
  validateRoadblocks(document, issues);

  return {
    issues,
    counts: {
      error: issues.filter((issue) => issue.severity === 'error').length,
      warning: issues.filter((issue) => issue.severity === 'warning').length,
      info: issues.filter((issue) => issue.severity === 'info').length
    }
  };
}

function validateCompiledIntersections(document: LevelEditorDocument, issues: ValidationIssue[]): void {
  const corridorIds = new Set(document.lanes.corridors.map((corridor) => corridor.id));
  const junctionById = new Map(document.lanes.junctions.map((junction) => [junction.id, junction]));
  for (const diagnostic of compileLaneNetwork(document.lanes).diagnostics) {
    if (!diagnostic.junctionId) continue;
    const junction = junctionById.get(diagnostic.junctionId);
    if (!junction || junction.corridors.length < 2 || junction.corridors.some((id) => !corridorIds.has(id))) {
      continue;
    }
    add(
      issues,
      diagnostic.severity,
      `compiled-${diagnostic.code}`,
      diagnostic.message,
      'junction',
      diagnostic.junctionId,
      junction
    );
  }
}

export function playtestBlockingValidationIssues(report: ValidationReport): ValidationIssue[] {
  return report.issues.filter((issue) => (
    issue.severity === 'error' && issue.code !== 'junction-off-corridor'
  ));
}

function validateSpawns(document: LevelEditorDocument, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  if (!document.spawns.some((spawn) => spawn.kind === 'player' && spawn.enabled)) {
    add(issues, 'error', 'player-spawn-missing', 'At least one enabled player spawn is required.', 'map');
  }
  for (const spawn of document.spawns) {
    if (spawn.id.trim().length === 0) add(issues, 'error', 'spawn-id-empty', 'Spawn ids cannot be empty.', 'spawn', spawn.id, spawn);
    if (ids.has(spawn.id)) add(issues, 'error', 'spawn-id-duplicate', `Duplicate spawn id: ${spawn.id}.`, 'spawn', spawn.id, spawn);
    ids.add(spawn.id);
    if (!insideWorld(document, spawn)) {
      add(issues, 'error', 'spawn-outside-map', `${spawn.label} is outside the map.`, 'spawn', spawn.id, spawn);
      continue;
    }
    const tile = worldToTile(document, spawn);
    const index = tileIndex(document, tile.x, tile.y);
    if (index >= 0 && document.layers.collision[index] !== 0) {
      add(issues, 'error', 'spawn-blocked', `${spawn.label} is placed on a blocked collision cell.`, 'spawn', spawn.id, spawn);
    }
  }
}

function validateCorridors(document: LevelEditorDocument, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  for (const corridor of document.lanes.corridors) {
    if (corridor.id.trim().length === 0) add(issues, 'error', 'corridor-id-empty', 'Corridor ids cannot be empty.', 'corridor', corridor.id, corridor.points[0]);
    if (ids.has(corridor.id)) add(issues, 'error', 'corridor-id-duplicate', `Duplicate corridor id: ${corridor.id}.`, 'corridor', corridor.id, corridor.points[0]);
    ids.add(corridor.id);
    if (corridor.points.length < 2) {
      add(issues, 'error', 'corridor-short', `${corridor.id} requires at least two points.`, 'corridor', corridor.id, corridor.points[0]);
    }
    if (!Number.isFinite(corridor.speedLimit) || corridor.speedLimit <= 0) {
      add(issues, 'error', 'corridor-speed', `${corridor.id} has an invalid speed limit.`, 'corridor', corridor.id, corridor.points[0]);
    }
    if (corridor.lanesPerDirection !== undefined && (!Number.isInteger(corridor.lanesPerDirection) || corridor.lanesPerDirection < 1 || corridor.lanesPerDirection > 4)) {
      add(issues, 'error', 'corridor-lanes', `${corridor.id} lanes per direction must be between 1 and 4.`, 'corridor', corridor.id, corridor.points[0]);
    }
    if (!['both', 'forward', 'reverse'].includes(corridor.direction ?? 'both')) {
      add(issues, 'error', 'corridor-direction', `${corridor.id} has an invalid traffic direction.`, 'corridor', corridor.id, corridor.points[0]);
    }
    if (corridor.roadClass !== undefined && !['arterial', 'boulevard', 'street', 'service', 'alley'].includes(corridor.roadClass)) {
      add(issues, 'error', 'corridor-road-class', `${corridor.id} has an invalid road class.`, 'corridor', corridor.id, corridor.points[0]);
    }
    if (corridor.laneOffset !== undefined && (!Number.isFinite(corridor.laneOffset) || corridor.laneOffset <= 0)) {
      add(issues, 'error', 'corridor-lane-offset', `${corridor.id} lane offset must be positive.`, 'corridor', corridor.id, corridor.points[0]);
    }
    if (corridor.measuredHalfWidth !== undefined && corridor.laneOffset !== undefined) {
      const requiredHalfWidth = corridor.laneOffset + 20;
      if (corridor.measuredHalfWidth + 1 < requiredHalfWidth) {
        add(
          issues,
          'warning',
          'corridor-clearance',
          `${corridor.id} has ${corridor.measuredHalfWidth.toFixed(1)}px half-width but needs about ${requiredHalfWidth.toFixed(1)}px for its vehicle envelope.`,
          'corridor',
          corridor.id,
          corridor.points[Math.floor(corridor.points.length / 2)]
        );
      }
    }
    if (corridor.clearanceConstrained) {
      add(
        issues,
        'warning',
        'corridor-clearance-constrained',
        `${corridor.id} needed a reduced lane offset so a full 40px vehicle envelope remains on the road at a bend.`,
        'corridor',
        corridor.id,
        corridor.points[Math.floor(corridor.points.length / 2)]
      );
    }
    corridor.points.forEach((point, pointIndex) => {
      if (!insideWorld(document, point)) {
        add(issues, 'error', 'corridor-point-outside', `${corridor.id} point ${pointIndex + 1} is outside the map.`, 'corridor', corridor.id, point);
        return;
      }
      const tile = worldToTile(document, point);
      const index = tileIndex(document, tile.x, tile.y);
      if (index >= 0 && document.layers.roads[index] === 0) {
        add(issues, 'warning', 'corridor-off-road', `${corridor.id} point ${pointIndex + 1} is not on a road cell.`, 'corridor', corridor.id, point);
      }
      if (pointIndex > 0 && distance(point, corridor.points[pointIndex - 1]) < 1) {
        add(issues, 'error', 'corridor-zero-segment', `${corridor.id} contains a zero-length segment.`, 'corridor', corridor.id, point);
      }
    });
  }
}

function validateJunctions(document: LevelEditorDocument, issues: ValidationIssue[]): void {
  const corridorsById = new Map(document.lanes.corridors.map((corridor) => [corridor.id, corridor]));
  const ids = new Set<string>();
  for (const junction of document.lanes.junctions) {
    if (junction.id.trim().length === 0) add(issues, 'error', 'junction-id-empty', 'Junction ids cannot be empty.', 'junction', junction.id, junction);
    if (ids.has(junction.id)) add(issues, 'error', 'junction-id-duplicate', `Duplicate junction id: ${junction.id}.`, 'junction', junction.id, junction);
    ids.add(junction.id);
    if (!insideWorld(document, junction)) add(issues, 'error', 'junction-outside-map', `${junction.id} is outside the map.`, 'junction', junction.id, junction);
    if (junction.terminalTransfer !== undefined && typeof junction.terminalTransfer !== 'boolean') {
      add(issues, 'error', 'junction-terminal-transfer', `${junction.id} terminal lane transfer must be enabled or disabled.`, 'junction', junction.id, junction);
    }
    if (junction.corridors.length < 2) add(issues, 'warning', 'junction-connections', `${junction.id} connects fewer than two corridors.`, 'junction', junction.id, junction);
    for (const corridorId of junction.corridors) {
      const corridor = corridorsById.get(corridorId);
      if (!corridor) {
        add(issues, 'error', 'junction-corridor-missing', `${junction.id} references missing corridor ${corridorId}.`, 'junction', junction.id, junction);
        continue;
      }
      if (!pointOnPolyline(junction, corridor.points)) {
        const offset = distanceToPolyline(junction, corridor.points);
        add(
          issues,
          'error',
          'junction-off-corridor',
          `${junction.id} must lie on corridor ${corridorId} (currently ${formatDistance(offset)} away).`,
          'junction',
          junction.id,
          junction
        );
      }
    }
  }
}

function validateCorridorConnectivity(document: LevelEditorDocument, issues: ValidationIssue[]): void {
  const corridors = document.lanes.corridors;
  if (corridors.length <= 1) return;
  const corridorsById = new Map(corridors.map((corridor) => [corridor.id, corridor]));
  const adjacency = new Map(corridors.map((corridor) => [corridor.id, new Set<string>()]));

  for (const junction of document.lanes.junctions) {
    const connected = [...new Set(junction.corridors)].filter((corridorId) => {
      const corridor = corridorsById.get(corridorId);
      return corridor && pointOnPolyline(junction, corridor.points);
    });
    if (connected.length < 2) continue;
    for (const corridorId of connected) {
      for (const neighborId of connected) {
        if (neighborId !== corridorId) adjacency.get(corridorId)?.add(neighborId);
      }
    }
  }

  const components: string[][] = [];
  const unvisited = new Set(corridors.map((corridor) => corridor.id));
  while (unvisited.size > 0) {
    const seed = [...unvisited].sort()[0];
    const component: string[] = [];
    const pending = [seed];
    unvisited.delete(seed);
    while (pending.length > 0) {
      const corridorId = pending.pop()!;
      component.push(corridorId);
      for (const neighborId of adjacency.get(corridorId) ?? []) {
        if (!unvisited.delete(neighborId)) continue;
        pending.push(neighborId);
      }
    }
    components.push(component.sort());
  }
  if (components.length <= 1) return;

  const primaryCorridorId = corridors[0].id;
  components.sort((left, right) => (
    right.length - left.length ||
    Number(right.includes(primaryCorridorId)) - Number(left.includes(primaryCorridorId)) ||
    left[0].localeCompare(right[0])
  ));
  for (const component of components.slice(1)) {
    for (const corridorId of component) {
      const corridor = corridorsById.get(corridorId)!;
      add(
        issues,
        'error',
        'corridor-disconnected',
        `${corridorId} is disconnected from the main traffic network. Add a junction that connects it to another corridor.`,
        'corridor',
        corridorId,
        corridor.points[0]
      );
    }
  }
}

function validateRoadblocks(document: LevelEditorDocument, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  const corridorsById = new Map(document.lanes.corridors.map((corridor) => [corridor.id, corridor]));
  for (const roadblock of document.lanes.roadblocks ?? []) {
    if (roadblock.id.trim().length === 0) add(issues, 'error', 'roadblock-id-empty', 'Roadblock ids cannot be empty.', 'roadblock', roadblock.id, roadblock);
    if (ids.has(roadblock.id)) add(issues, 'error', 'roadblock-id-duplicate', `Duplicate roadblock id: ${roadblock.id}.`, 'roadblock', roadblock.id, roadblock);
    ids.add(roadblock.id);
    if (!insideWorld(document, roadblock)) add(issues, 'error', 'roadblock-outside-map', `${roadblock.id} is outside the map.`, 'roadblock', roadblock.id, roadblock);
    if (roadblock.vehiclePoses.length === 0) add(issues, 'warning', 'roadblock-vehicles', `${roadblock.id} has no vehicle poses.`, 'roadblock', roadblock.id, roadblock);
    if (roadblock.blockedEdgeIds.length === 0) add(issues, 'warning', 'roadblock-edges', `${roadblock.id} does not block any compiled lane edges.`, 'roadblock', roadblock.id, roadblock);
    for (const edgeId of roadblock.blockedEdgeIds) {
      const match = /^(.+):(forward|reverse)(?::lane-\d+)?:edge:\d+$/.exec(edgeId);
      if (!match) continue;
      const corridor = corridorsById.get(match[1]);
      const direction = match[2] as 'forward' | 'reverse';
      if (corridor && !corridorSupportsDirection(corridor, direction)) {
        add(
          issues,
          'error',
          'roadblock-direction-omitted',
          `${roadblock.id} references omitted ${direction} traffic on ${corridor.id}.`,
          'roadblock',
          roadblock.id,
          roadblock
        );
      }
    }
    for (const [index, pose] of roadblock.vehiclePoses.entries()) {
      if (!insideWorld(document, pose)) add(issues, 'error', 'roadblock-pose-outside', `${roadblock.id} vehicle pose ${index + 1} is outside the map.`, 'roadblock', roadblock.id, pose);
    }
  }
}

function insideWorld(document: LevelEditorDocument, point: Point2D): boolean {
  const size = documentWorldSize(document);
  return point.x >= document.map.origin.x && point.y >= document.map.origin.y &&
    point.x < document.map.origin.x + size.width && point.y < document.map.origin.y + size.height;
}

function distanceToPolyline(point: Point2D, points: Point2D[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return distance(point, points[0]);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index++) {
    minimum = Math.min(minimum, distanceToSegment(point, points[index - 1], points[index]));
  }
  return minimum;
}

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(point, start);
  const progress = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, {x: start.x + dx * progress, y: start.y + dy * progress});
}

function pointOnPolyline(point: Point2D, points: Point2D[]): boolean {
  for (let index = 1; index < points.length; index++) {
    if (pointOnSegment(point, points[index - 1], points[index])) return true;
  }
  return false;
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  if (Math.abs(cross) > LANE_POINT_EPSILON) return false;
  const dot = (point.x - start.x) * dx + (point.y - start.y) * dy;
  const lengthSquared = dx * dx + dy * dy;
  return dot >= -LANE_POINT_EPSILON && dot <= lengthSquared + LANE_POINT_EPSILON;
}

function formatDistance(distanceInPixels: number): string {
  if (!Number.isFinite(distanceInPixels)) return 'an unknown distance';
  if (distanceInPixels < 0.01) return `${distanceInPixels.toFixed(4)}px`;
  return `${distanceInPixels.toFixed(1)}px`;
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function add(
  issues: ValidationIssue[],
  severity: ValidationSeverity,
  code: string,
  message: string,
  entityKind: ValidationEntityKind,
  entityId?: string,
  point?: Point2D
): void {
  issues.push({id: `${code}:${entityId ?? issues.length}`, severity, code, message, entityKind, entityId, point});
}
