import type {
  LaneCorridor,
  LaneGraphDocument,
  LaneJunction,
  Point2D
} from './level-document.ts';
import {corridorSupportsDirection} from './level-document.ts';
import {corridorLaneOffset, offsetPolyline} from '../../../shared/traffic/lane-geometry.ts';

export type CompiledLaneDirection = 'forward' | 'reverse';

export interface CompiledLaneEdgeDiagnostic {
  edgeId: string;
  corridorId: string;
  direction: CompiledLaneDirection;
  laneIndex: number;
  edgeIndex: number;
  from: Point2D;
  to: Point2D;
  midpoint: Point2D;
}

interface CenterlineSample extends Point2D {
  junctionId: string;
}

const POINT_EPSILON = 0.001;
const EDGE_ID_PATTERN = /^(.+):(forward|reverse)(?::lane-(\d+))?:edge:(\d+)$/;

export function compiledLaneEdgeDiagnostic(
  document: LaneGraphDocument,
  edgeId: string
): CompiledLaneEdgeDiagnostic | undefined {
  const match = EDGE_ID_PATTERN.exec(edgeId);
  if (!match) return undefined;
  const [, corridorId, directionValue, laneIndexValue, edgeIndexValue] = match;
  const corridor = document.corridors.find((candidate) => candidate.id === corridorId);
  if (!corridor) return undefined;
  const direction = directionValue as CompiledLaneDirection;
  if (!corridorSupportsDirection(corridor, direction)) return undefined;
  const laneIndex = laneIndexValue === undefined ? 0 : Number(laneIndexValue);
  const edgeIndex = Number(edgeIndexValue);
  if (!Number.isInteger(laneIndex) || laneIndex < 0 || laneIndex >= (corridor.lanesPerDirection ?? 1)) return undefined;

  const samples = centerlineSamples(corridor, document.junctions);
  if (direction === 'reverse') samples.reverse();
  const nodes = offsetPolyline(samples, corridorLaneOffset(document, corridor, laneIndex));
  const from = nodes[edgeIndex];
  const to = nodes[edgeIndex + 1];
  if (!from || !to) return undefined;
  return {
    edgeId,
    corridorId,
    direction,
    laneIndex,
    edgeIndex,
    from,
    to,
    midpoint: {x: (from.x + to.x) / 2, y: (from.y + to.y) / 2}
  };
}

export function compiledLaneEdgeIdFromMessage(message: string): string | undefined {
  const match = /\bEdge\s+(\S+)\s+(?:crosses|references)\b/.exec(message);
  return match?.[1];
}

export function compiledLaneEdgeLabel(diagnostic: CompiledLaneEdgeDiagnostic): string {
  return `${diagnostic.direction} lane ${diagnostic.laneIndex + 1}, segment ${diagnostic.edgeIndex + 1}`;
}

function centerlineSamples(
  corridor: LaneCorridor,
  junctions: readonly LaneJunction[]
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
      const existing = result[result.length - 1];
      if (existing && samePoint(existing, candidate)) {
        if (!existing.junctionId) existing.junctionId = candidate.junctionId;
        continue;
      }
      result.push(candidate);
    }
  }
  return result;
}

function junctionAt(
  point: Point2D,
  corridorId: string,
  junctions: readonly LaneJunction[]
): LaneJunction | undefined {
  return junctions.find((junction) => junction.corridors.includes(corridorId) && samePoint(junction, point));
}

function pointOnSegment(point: Point2D, from: Point2D, to: Point2D): boolean {
  const cross = (point.x - from.x) * (to.y - from.y) - (point.y - from.y) * (to.x - from.x);
  if (Math.abs(cross) > POINT_EPSILON) return false;
  const dot = (point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y);
  const lengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  return dot >= -POINT_EPSILON && dot <= lengthSquared + POINT_EPSILON;
}

function segmentProgress(point: Point2D, from: Point2D, to: Point2D): number {
  const lengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  if (lengthSquared === 0) return 0;
  return ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / lengthSquared;
}

function samePoint(left: Point2D, right: Point2D): boolean {
  return Math.abs(left.x - right.x) <= POINT_EPSILON && Math.abs(left.y - right.y) <= POINT_EPSILON;
}
