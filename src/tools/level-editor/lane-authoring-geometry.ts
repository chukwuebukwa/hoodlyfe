import type {LaneCorridor, LaneJunction, Point2D} from './level-document.ts';

const EPSILON = 0.001;

export interface CorridorIntersection {
  point: Point2D;
  corridorIds: string[];
  distance: number;
}

export interface JunctionRepairResult {
  junctions: LaneJunction[];
  repaired: number;
  removed: number;
  unresolved: number;
}

export interface JunctionSynchronizationResult extends JunctionRepairResult {
  added: number;
}

export function corridorIntersections(corridors: readonly LaneCorridor[]): CorridorIntersection[] {
  const candidates: Point2D[] = [];
  for (let leftIndex = 0; leftIndex < corridors.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < corridors.length; rightIndex++) {
      collectPolylineIntersections(corridors[leftIndex].points, corridors[rightIndex].points, candidates);
    }
  }
  return candidates.map((point) => ({
    point,
    corridorIds: corridors
      .filter((corridor) => pointOnPolyline(point, corridor.points))
      .map((corridor) => corridor.id),
    distance: 0
  })).filter((candidate) => candidate.corridorIds.length >= 2);
}

export function nearestCorridorIntersection(
  corridors: readonly LaneCorridor[],
  target: Point2D,
  maximumDistance = Number.POSITIVE_INFINITY
): CorridorIntersection | undefined {
  return findNearestCorridorIntersection(corridors, target, maximumDistance, false);
}

export function nearestSharedCorridorIntersection(
  corridors: readonly LaneCorridor[],
  target: Point2D,
  maximumDistance = Number.POSITIVE_INFINITY
): CorridorIntersection | undefined {
  return findNearestCorridorIntersection(corridors, target, maximumDistance, true);
}

export function repairJunctionIntersections(
  corridors: readonly LaneCorridor[],
  junctions: readonly LaneJunction[],
  changedCorridorId?: string
): JunctionRepairResult {
  const corridorsById = new Map(corridors.map((corridor) => [corridor.id, corridor]));
  let repaired = 0;
  let removed = 0;
  let unresolved = 0;
  const nextJunctions = junctions.flatMap((junction) => {
    if (changedCorridorId && !junction.corridors.includes(changedCorridorId)) return junction;
    const connected = junction.corridors
      .map((id) => corridorsById.get(id))
      .filter((corridor): corridor is LaneCorridor => Boolean(corridor));
    if (connected.length !== junction.corridors.length || connected.length < 2) {
      removed++;
      return [];
    }
    const intersection = nearestSharedCorridorIntersection(connected, junction);
    if (!intersection) {
      unresolved++;
      return junction;
    }
    if (samePoint(junction, intersection.point)) return junction;
    repaired++;
    return {...junction, ...intersection.point};
  });
  return {junctions: nextJunctions, repaired, removed, unresolved};
}

export function synchronizeJunctionIntersections(
  corridors: readonly LaneCorridor[],
  junctions: readonly LaneJunction[]
): JunctionSynchronizationResult {
  const repaired = repairJunctionIntersections(corridors, junctions);
  const nextJunctions = repaired.junctions.map((junction) => ({
    ...junction,
    corridors: [...junction.corridors]
  }));
  const ids = new Set(nextJunctions.map((junction) => junction.id));
  let added = 0;
  for (const intersection of corridorIntersections(corridors)) {
    const existing = nextJunctions.find((junction) => samePoint(junction, intersection.point));
    if (existing) {
      existing.corridors = [...intersection.corridorIds];
      continue;
    }
    const id = uniqueJunctionId(ids);
    ids.add(id);
    nextJunctions.push({id, ...intersection.point, corridors: [...intersection.corridorIds]});
    added++;
  }
  return {...repaired, junctions: nextJunctions, added};
}

function findNearestCorridorIntersection(
  corridors: readonly LaneCorridor[],
  target: Point2D,
  maximumDistance: number,
  requireAllCorridors: boolean
): CorridorIntersection | undefined {
  return corridorIntersections(corridors)
    .map((candidate) => ({
      ...candidate,
      distance: Math.hypot(candidate.point.x - target.x, candidate.point.y - target.y)
    }))
    .filter((candidate) => (
      candidate.corridorIds.length >= 2 &&
      (!requireAllCorridors || candidate.corridorIds.length === corridors.length) &&
      candidate.distance <= maximumDistance
    ))
    .sort((left, right) => left.distance - right.distance)[0];
}

function uniqueJunctionId(ids: ReadonlySet<string>): string {
  let index = 1;
  while (ids.has(`junction-${index}`)) index++;
  return `junction-${index}`;
}

function collectPolylineIntersections(left: readonly Point2D[], right: readonly Point2D[], output: Point2D[]): void {
  for (let leftIndex = 1; leftIndex < left.length; leftIndex++) {
    for (let rightIndex = 1; rightIndex < right.length; rightIndex++) {
      const intersection = segmentIntersection(
        left[leftIndex - 1],
        left[leftIndex],
        right[rightIndex - 1],
        right[rightIndex]
      );
      if (intersection && !output.some((point) => samePoint(point, intersection))) output.push(intersection);
    }
  }
}

function segmentIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | undefined {
  const r = {x: b.x - a.x, y: b.y - a.y};
  const s = {x: d.x - c.x, y: d.y - c.y};
  const denominator = cross(r, s);
  const offset = {x: c.x - a.x, y: c.y - a.y};
  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(offset, r)) > EPSILON) return undefined;
    return [a, b, c, d].find((point) => pointOnSegment(point, a, b) && pointOnSegment(point, c, d));
  }
  const leftProgress = cross(offset, s) / denominator;
  const rightProgress = cross(offset, r) / denominator;
  if (leftProgress < -EPSILON || leftProgress > 1 + EPSILON || rightProgress < -EPSILON || rightProgress > 1 + EPSILON) {
    return undefined;
  }
  return {x: a.x + leftProgress * r.x, y: a.y + leftProgress * r.y};
}

function pointOnPolyline(point: Point2D, points: readonly Point2D[]): boolean {
  for (let index = 1; index < points.length; index++) {
    if (pointOnSegment(point, points[index - 1], points[index])) return true;
  }
  return false;
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  const delta = {x: end.x - start.x, y: end.y - start.y};
  const relative = {x: point.x - start.x, y: point.y - start.y};
  if (Math.abs(cross(relative, delta)) > EPSILON) return false;
  const dot = relative.x * delta.x + relative.y * delta.y;
  const lengthSquared = delta.x * delta.x + delta.y * delta.y;
  return dot >= -EPSILON && dot <= lengthSquared + EPSILON;
}

function cross(left: Point2D, right: Point2D): number {
  return left.x * right.y - left.y * right.x;
}

function samePoint(left: Point2D, right: Point2D): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
}
