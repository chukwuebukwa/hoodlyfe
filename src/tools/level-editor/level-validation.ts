import {
  documentWorldSize,
  tileIndex,
  worldToTile,
  type LevelEditorDocument,
  type Point2D
} from './level-document.ts';

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

function validateRoadblocks(document: LevelEditorDocument, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  for (const roadblock of document.lanes.roadblocks ?? []) {
    if (roadblock.id.trim().length === 0) add(issues, 'error', 'roadblock-id-empty', 'Roadblock ids cannot be empty.', 'roadblock', roadblock.id, roadblock);
    if (ids.has(roadblock.id)) add(issues, 'error', 'roadblock-id-duplicate', `Duplicate roadblock id: ${roadblock.id}.`, 'roadblock', roadblock.id, roadblock);
    ids.add(roadblock.id);
    if (!insideWorld(document, roadblock)) add(issues, 'error', 'roadblock-outside-map', `${roadblock.id} is outside the map.`, 'roadblock', roadblock.id, roadblock);
    if (roadblock.vehiclePoses.length === 0) add(issues, 'warning', 'roadblock-vehicles', `${roadblock.id} has no vehicle poses.`, 'roadblock', roadblock.id, roadblock);
    if (roadblock.blockedEdgeIds.length === 0) add(issues, 'warning', 'roadblock-edges', `${roadblock.id} does not block any compiled lane edges.`, 'roadblock', roadblock.id, roadblock);
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
