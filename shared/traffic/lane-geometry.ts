export interface LaneGeometryPoint {
  x: number;
  y: number;
}

export interface LaneGeometryCorridor {
  laneOffset?: number;
  laneSpacing?: number;
}

export interface LaneGeometryDefaults {
  laneOffset: number;
  laneSpacing: number;
}

const EPSILON = 1e-6;
const MAXIMUM_MITER_SCALE = 1.75;

export function corridorLaneOffset(
  defaults: LaneGeometryDefaults,
  corridor: LaneGeometryCorridor,
  laneIndex = 0
): number {
  return (corridor.laneOffset ?? defaults.laneOffset) +
    (corridor.laneSpacing ?? defaults.laneSpacing) * laneIndex;
}

/**
 * Offsets a centerline with bounded miter joins. Averaging adjacent headings directly
 * makes sharp bends narrow one lane and widen the other; intersecting the adjacent
 * offset segments preserves the requested lane distance through the corner.
 */
export function offsetPolyline<T extends LaneGeometryPoint>(
  points: readonly T[],
  offset: number
): LaneGeometryPoint[] {
  if (points.length < 2 || Math.abs(offset) <= EPSILON) {
    return points.map(({x, y}) => ({x, y}));
  }
  const segments = points.slice(0, -1).map((point, index) => unitVector(point, points[index + 1]));
  return points.map((point, index) => {
    const previous = segments[Math.max(0, index - 1)];
    const next = segments[Math.min(segments.length - 1, index)];
    if (index === 0) return translate(point, leftNormal(next), offset);
    if (index === points.length - 1) return translate(point, leftNormal(previous), offset);

    const previousNormal = leftNormal(previous);
    const nextNormal = leftNormal(next);
    const miter = normalize({x: previousNormal.x + nextNormal.x, y: previousNormal.y + nextNormal.y});
    const denominator = dot(miter, nextNormal);
    if (Math.abs(denominator) <= EPSILON) return translate(point, nextNormal, offset);
    const miterLength = clamp(
      offset / denominator,
      -Math.abs(offset) * MAXIMUM_MITER_SCALE,
      Math.abs(offset) * MAXIMUM_MITER_SCALE
    );
    return {x: point.x + miter.x * miterLength, y: point.y + miter.y * miterLength};
  });
}

function unitVector(from: LaneGeometryPoint, to: LaneGeometryPoint): LaneGeometryPoint {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const magnitude = Math.hypot(deltaX, deltaY);
  return magnitude > EPSILON ? {x: deltaX / magnitude, y: deltaY / magnitude} : {x: 0, y: 0};
}

function leftNormal(vector: LaneGeometryPoint): LaneGeometryPoint {
  return {x: -vector.y, y: vector.x};
}

function normalize(vector: LaneGeometryPoint): LaneGeometryPoint {
  const magnitude = Math.hypot(vector.x, vector.y);
  return magnitude > EPSILON ? {x: vector.x / magnitude, y: vector.y / magnitude} : {x: 0, y: 0};
}

function translate(point: LaneGeometryPoint, direction: LaneGeometryPoint, distance: number): LaneGeometryPoint {
  return {x: point.x + direction.x * distance, y: point.y + direction.y * distance};
}

function dot(left: LaneGeometryPoint, right: LaneGeometryPoint): number {
  return left.x * right.x + left.y * right.y;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
