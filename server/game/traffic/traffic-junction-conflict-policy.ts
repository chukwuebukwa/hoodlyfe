import type {LaneTurn} from './lane-graph.ts';

export interface TrafficJunctionMovementPoint {
  x: number;
  y: number;
}

export interface TrafficJunctionMovement {
  id: string;
  junctionId: string;
  turn: Exclude<LaneTurn, 'none'>;
  entryLaneId: string;
  exitLaneId: string;
  path: readonly TrafficJunctionMovementPoint[];
  sweptHalfWidth: number;
  exclusive: boolean;
}

export function exclusiveJunctionMovement(
  junctionId: string,
  id = `exclusive:${junctionId}`
): TrafficJunctionMovement {
  return {
    id,
    junctionId,
    turn: 'uturn',
    entryLaneId: '',
    exitLaneId: '',
    path: [],
    sweptHalfWidth: 0,
    exclusive: true
  };
}

export function junctionMovementsConflict(
  left: TrafficJunctionMovement,
  right: TrafficJunctionMovement
): boolean {
  if (left.junctionId !== right.junctionId) return false;
  if (left.exclusive || right.exclusive) return true;
  if (!validMovement(left) || !validMovement(right)) return true;
  if (left.id === right.id) return true;
  if (left.entryLaneId === right.entryLaneId) return true;
  if (left.exitLaneId === right.exitLaneId) return true;
  const minimumSeparation = left.sweptHalfWidth + right.sweptHalfWidth;
  for (let leftIndex = 0; leftIndex < left.path.length - 1; leftIndex++) {
    for (let rightIndex = 0; rightIndex < right.path.length - 1; rightIndex++) {
      if (segmentDistanceSquared(
        left.path[leftIndex],
        left.path[leftIndex + 1],
        right.path[rightIndex],
        right.path[rightIndex + 1]
      ) <= minimumSeparation ** 2) {
        return true;
      }
    }
  }
  return false;
}

function validMovement(movement: TrafficJunctionMovement): boolean {
  return movement.path.length >= 2 &&
    movement.path.every(finitePoint) &&
    Number.isFinite(movement.sweptHalfWidth) &&
    movement.sweptHalfWidth > 0 &&
    Boolean(movement.entryLaneId) &&
    Boolean(movement.exitLaneId);
}

function finitePoint(point: TrafficJunctionMovementPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function segmentDistanceSquared(
  leftFrom: TrafficJunctionMovementPoint,
  leftTo: TrafficJunctionMovementPoint,
  rightFrom: TrafficJunctionMovementPoint,
  rightTo: TrafficJunctionMovementPoint
): number {
  if (segmentsIntersect(leftFrom, leftTo, rightFrom, rightTo)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(leftFrom, rightFrom, rightTo),
    pointSegmentDistanceSquared(leftTo, rightFrom, rightTo),
    pointSegmentDistanceSquared(rightFrom, leftFrom, leftTo),
    pointSegmentDistanceSquared(rightTo, leftFrom, leftTo)
  );
}

function segmentsIntersect(
  leftFrom: TrafficJunctionMovementPoint,
  leftTo: TrafficJunctionMovementPoint,
  rightFrom: TrafficJunctionMovementPoint,
  rightTo: TrafficJunctionMovementPoint
): boolean {
  const leftRightFrom = orientation(leftFrom, leftTo, rightFrom);
  const leftRightTo = orientation(leftFrom, leftTo, rightTo);
  const rightLeftFrom = orientation(rightFrom, rightTo, leftFrom);
  const rightLeftTo = orientation(rightFrom, rightTo, leftTo);
  if (
    oppositeSigns(leftRightFrom, leftRightTo) &&
    oppositeSigns(rightLeftFrom, rightLeftTo)
  ) {
    return true;
  }
  return (
    leftRightFrom === 0 && onSegment(rightFrom, leftFrom, leftTo) ||
    leftRightTo === 0 && onSegment(rightTo, leftFrom, leftTo) ||
    rightLeftFrom === 0 && onSegment(leftFrom, rightFrom, rightTo) ||
    rightLeftTo === 0 && onSegment(leftTo, rightFrom, rightTo)
  );
}

function orientation(
  from: TrafficJunctionMovementPoint,
  to: TrafficJunctionMovementPoint,
  point: TrafficJunctionMovementPoint
): number {
  const cross = (to.x - from.x) * (point.y - from.y) -
    (to.y - from.y) * (point.x - from.x);
  return Math.abs(cross) <= 0.000001 ? 0 : cross;
}

function oppositeSigns(left: number, right: number): boolean {
  return left < 0 && right > 0 || left > 0 && right < 0;
}

function onSegment(
  point: TrafficJunctionMovementPoint,
  from: TrafficJunctionMovementPoint,
  to: TrafficJunctionMovementPoint
): boolean {
  return point.x >= Math.min(from.x, to.x) - 0.000001 &&
    point.x <= Math.max(from.x, to.x) + 0.000001 &&
    point.y >= Math.min(from.y, to.y) - 0.000001 &&
    point.y <= Math.max(from.y, to.y) + 0.000001;
}

function pointSegmentDistanceSquared(
  point: TrafficJunctionMovementPoint,
  from: TrafficJunctionMovementPoint,
  to: TrafficJunctionMovementPoint
): number {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared <= 0.000001) return distanceSquared(point, from);
  const progress = Math.max(0, Math.min(1, (
    (point.x - from.x) * deltaX + (point.y - from.y) * deltaY
  ) / lengthSquared));
  return distanceSquared(point, {
    x: from.x + deltaX * progress,
    y: from.y + deltaY * progress
  });
}

function distanceSquared(
  left: TrafficJunctionMovementPoint,
  right: TrafficJunctionMovementPoint
): number {
  return (right.x - left.x) ** 2 + (right.y - left.y) ** 2;
}
