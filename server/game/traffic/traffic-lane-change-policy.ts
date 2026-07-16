import type {CollisionMap} from '../../world-map.ts';
import type {TrafficObstacle} from './traffic-awareness-system.ts';
import type {
  TrafficAdjacentLaneSegment,
  TrafficLaneSegment
} from './traffic-route-system.ts';

const MIN_LEAD_DISTANCE = 18;
const MAX_LEAD_DISTANCE = 180;
const MIN_ENTRY_ADVANCE = 28;
const ENTRY_ADVANCE = 68;
const PASS_CLEARANCE = 82;
const RETURN_ADVANCE = 88;
const JUNCTION_MARGIN = 52;
const PATH_SAMPLE_SPACING = 24;
const TARGET_LANE_MARGIN = 10;

export type TrafficLaneChangeRejectReason =
  | 'none'
  | 'not-multilane'
  | 'lead-missing'
  | 'lead-behind'
  | 'lead-clearance'
  | 'junction-near'
  | 'world-blocked'
  | 'target-front-gap'
  | 'target-rear-gap'
  | 'target-pedestrian'
  | 'target-signal'
  | 'reservation'
  | 'timeout';

export interface TrafficLaneChangeVehicle {
  id: string;
  x: number;
  y: number;
  speed: number;
  halfLength: number;
  halfWidth: number;
}

export interface TrafficLaneChangePlan {
  reservationKey: string;
  leadId: string;
  fromLaneIndex: number;
  toLaneIndex: number;
  entryX: number;
  entryY: number;
  passX: number;
  passY: number;
  returnX: number;
  returnY: number;
  segmentAngle: number;
  clearanceScore: number;
}

export interface TrafficLaneChangePlanResult {
  plan?: TrafficLaneChangePlan;
  rejectReason: TrafficLaneChangeRejectReason;
}

interface TrafficLaneChangePlanInput {
  vehicle: TrafficLaneChangeVehicle;
  segment?: TrafficLaneSegment;
  lead?: TrafficObstacle;
  obstacles: readonly TrafficObstacle[];
  world: Pick<CollisionMap, 'canOccupy' | 'isRoadAt'>;
}

export function planTrafficLaneChange(
  input: TrafficLaneChangePlanInput
): TrafficLaneChangePlanResult {
  const segment = input.segment;
  if (!segment || segment.laneCount <= 1 || segment.adjacent.length === 0) {
    return {rejectReason: 'not-multilane'};
  }
  const lead = input.lead;
  if (!lead || lead.kind !== 'vehicle') return {rejectReason: 'lead-missing'};

  const current = segmentGeometry(segment);
  const egoDistance = distanceAlong(current, input.vehicle.x, input.vehicle.y);
  const leadDistance = distanceAlong(current, lead.x, lead.y);
  const leadGap = leadDistance - egoDistance;
  if (leadGap < MIN_LEAD_DISTANCE || leadGap > MAX_LEAD_DISTANCE) {
    return {rejectReason: 'lead-behind'};
  }
  const leadHalfLength = lead.halfLength ?? lead.radius;
  const leadClearance = input.vehicle.halfLength + leadHalfLength + 12;
  if (leadGap < leadClearance + MIN_ENTRY_ADVANCE) {
    return {rejectReason: 'lead-clearance'};
  }

  const candidates = segment.adjacent
    .map((adjacent) => planOnAdjacentLane(
      input,
      current,
      adjacent,
      egoDistance,
      leadDistance,
      leadClearance
    ))
    .sort((left, right) => (
      Number(Boolean(right.plan)) - Number(Boolean(left.plan)) ||
      (right.plan?.clearanceScore ?? -1) - (left.plan?.clearanceScore ?? -1) ||
      (left.plan?.toLaneIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.plan?.toLaneIndex ?? Number.MAX_SAFE_INTEGER)
    ));
  return candidates[0] ?? {rejectReason: 'not-multilane'};
}

function planOnAdjacentLane(
  input: TrafficLaneChangePlanInput,
  current: SegmentGeometry,
  adjacent: TrafficAdjacentLaneSegment,
  egoDistance: number,
  leadDistance: number,
  leadClearance: number
): TrafficLaneChangePlanResult {
  const target = segmentGeometry(adjacent);
  const entryDistance = Math.min(leadDistance - leadClearance, egoDistance + ENTRY_ADVANCE);
  const passDistance = leadDistance + PASS_CLEARANCE;
  const returnDistance = passDistance + RETURN_ADVANCE;
  if (
    entryDistance - egoDistance < MIN_ENTRY_ADVANCE ||
    returnDistance > current.length - JUNCTION_MARGIN
  ) {
    return {rejectReason: 'junction-near'};
  }

  const entry = pointAtDistance(target, entryDistance);
  const pass = pointAtDistance(target, passDistance);
  const merge = pointAtDistance(current, returnDistance);
  const path = [
    {x: input.vehicle.x, y: input.vehicle.y},
    entry,
    pass,
    merge
  ];
  const occupancyRadius = Math.max(12, input.vehicle.halfWidth + 4);
  if (!pathIsDriveable(path, occupancyRadius, input.world)) {
    return {rejectReason: 'world-blocked'};
  }

  const targetLaneTolerance = input.vehicle.halfWidth + TARGET_LANE_MARGIN;
  let nearestFront = Number.POSITIVE_INFINITY;
  let nearestRear = Number.POSITIVE_INFINITY;
  for (const obstacle of [...input.obstacles].sort((left, right) => left.id.localeCompare(right.id))) {
    if (obstacle.id === input.vehicle.id || obstacle.id === input.lead?.id) continue;
    if (obstacle.kind === 'signal' && distanceToPolyline(obstacle.x, obstacle.y, path) <= 34) {
      return {rejectReason: 'target-signal'};
    }
    if (
      obstacle.kind === 'pedestrian' &&
      distanceToPolyline(obstacle.x, obstacle.y, path) <=
        input.vehicle.halfWidth + obstacle.radius + 10
    ) {
      return {rejectReason: 'target-pedestrian'};
    }
    if (obstacle.kind !== 'vehicle') continue;

    const lateralDistance = distanceFromSegmentLine(target, obstacle.x, obstacle.y);
    const obstacleHalfWidth = obstacle.halfWidth ?? obstacle.radius;
    if (lateralDistance > targetLaneTolerance + obstacleHalfWidth) continue;
    const obstacleDistance = distanceAlong(target, obstacle.x, obstacle.y);
    const obstacleHalfLength = obstacle.halfLength ?? obstacle.radius;
    const combinedLength = input.vehicle.halfLength + obstacleHalfLength;
    const obstacleSpeed = Math.max(0, obstacle.speed ?? 0);
    if (obstacleDistance >= egoDistance) {
      const gap = obstacleDistance - egoDistance - combinedLength;
      nearestFront = Math.min(nearestFront, gap);
      const safeFront = 54 + Math.max(0, input.vehicle.speed - obstacleSpeed) * 1.1;
      if (obstacleDistance <= returnDistance + 44 && gap < safeFront) {
        return {rejectReason: 'target-front-gap'};
      }
    } else {
      const gap = egoDistance - obstacleDistance - combinedLength;
      nearestRear = Math.min(nearestRear, gap);
      const safeRear = 48 + Math.max(0, obstacleSpeed - input.vehicle.speed) * 1.35;
      if (gap < safeRear) return {rejectReason: 'target-rear-gap'};
    }
  }

  const clearanceScore = Math.min(
    Number.isFinite(nearestFront) ? nearestFront : 400,
    Number.isFinite(nearestRear) ? nearestRear : 400
  );
  return {
    rejectReason: 'none',
    plan: {
      reservationKey: `${adjacent.edgeId}:${Math.floor(entryDistance / 240)}`,
      leadId: input.lead!.id,
      fromLaneIndex: input.segment!.laneIndex,
      toLaneIndex: adjacent.laneIndex,
      entryX: entry.x,
      entryY: entry.y,
      passX: pass.x,
      passY: pass.y,
      returnX: merge.x,
      returnY: merge.y,
      segmentAngle: current.angle,
      clearanceScore
    }
  };
}

interface SegmentGeometry {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  forwardX: number;
  forwardY: number;
  length: number;
  angle: number;
}

function segmentGeometry(segment: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}): SegmentGeometry {
  const deltaX = segment.toX - segment.fromX;
  const deltaY = segment.toY - segment.fromY;
  const length = Math.max(0.001, Math.hypot(deltaX, deltaY));
  return {
    ...segment,
    forwardX: deltaX / length,
    forwardY: deltaY / length,
    length,
    angle: Math.atan2(deltaY, deltaX)
  };
}

function distanceAlong(segment: SegmentGeometry, x: number, y: number): number {
  return clamp(
    (x - segment.fromX) * segment.forwardX + (y - segment.fromY) * segment.forwardY,
    0,
    segment.length
  );
}

function distanceFromSegmentLine(segment: SegmentGeometry, x: number, y: number): number {
  return Math.abs(
    -(x - segment.fromX) * segment.forwardY +
    (y - segment.fromY) * segment.forwardX
  );
}

function pointAtDistance(segment: SegmentGeometry, distance: number): {x: number; y: number} {
  const clamped = clamp(distance, 0, segment.length);
  return {
    x: segment.fromX + segment.forwardX * clamped,
    y: segment.fromY + segment.forwardY * clamped
  };
}

function pathIsDriveable(
  points: readonly {x: number; y: number}[],
  radius: number,
  world: Pick<CollisionMap, 'canOccupy' | 'isRoadAt'>
): boolean {
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index];
    const to = points[index + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const samples = Math.max(1, Math.ceil(length / PATH_SAMPLE_SPACING));
    for (let sample = 0; sample <= samples; sample++) {
      const progress = sample / samples;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      if (!world.isRoadAt(x, y) || !world.canOccupy(x, y, radius)) return false;
    }
  }
  return true;
}

function distanceToPolyline(
  x: number,
  y: number,
  points: readonly {x: number; y: number}[]
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index++) {
    nearest = Math.min(nearest, distanceToSegment(x, y, points[index], points[index + 1]));
  }
  return nearest;
}

function distanceToSegment(
  x: number,
  y: number,
  from: {x: number; y: number},
  to: {x: number; y: number}
): number {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= 0.0001) return Math.hypot(x - from.x, y - from.y);
  const progress = clamp(
    ((x - from.x) * deltaX + (y - from.y) * deltaY) / lengthSquared,
    0,
    1
  );
  return Math.hypot(x - (from.x + deltaX * progress), y - (from.y + deltaY * progress));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export const TRAFFIC_LANE_CHANGE_POLICY = Object.freeze({
  minimumLeadDistance: MIN_LEAD_DISTANCE,
  maximumLeadDistance: MAX_LEAD_DISTANCE,
  junctionMargin: JUNCTION_MARGIN
});
