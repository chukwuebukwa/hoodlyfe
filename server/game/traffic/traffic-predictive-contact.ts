const AXIS_EPSILON = 1e-7;

export interface TrafficMotionBox {
  x: number;
  y: number;
  angle: number;
  velocityX: number;
  velocityY: number;
  halfLength: number;
  halfWidth: number;
}

/**
 * Finds the first overlap time for two oriented boxes translating at constant velocity.
 * Rotation is held fixed over the short traffic-awareness horizon.
 */
export function sweptOrientedBoxTimeToContact(
  left: TrafficMotionBox,
  right: TrafficMotionBox,
  horizonSeconds: number,
  margin = 0
): number | undefined {
  if (horizonSeconds < 0) return undefined;
  const leftForward = axis(left.angle);
  const leftSide = {x: -leftForward.y, y: leftForward.x};
  const rightForward = axis(right.angle);
  const rightSide = {x: -rightForward.y, y: rightForward.x};
  const relativePosition = {x: right.x - left.x, y: right.y - left.y};
  const relativeVelocity = {
    x: right.velocityX - left.velocityX,
    y: right.velocityY - left.velocityY
  };
  let entrySeconds = 0;
  let exitSeconds = horizonSeconds;

  for (const testAxis of [leftForward, leftSide, rightForward, rightSide]) {
    const distance = dot(relativePosition, testAxis);
    const velocity = dot(relativeVelocity, testAxis);
    const reach = projectionRadius(left, leftForward, leftSide, testAxis) +
      projectionRadius(right, rightForward, rightSide, testAxis) + Math.max(0, margin);
    if (Math.abs(velocity) <= AXIS_EPSILON) {
      if (Math.abs(distance) > reach) return undefined;
      continue;
    }

    const first = (-reach - distance) / velocity;
    const second = (reach - distance) / velocity;
    entrySeconds = Math.max(entrySeconds, Math.min(first, second));
    exitSeconds = Math.min(exitSeconds, Math.max(first, second));
    if (entrySeconds > exitSeconds) return undefined;
  }

  return entrySeconds <= horizonSeconds && exitSeconds >= 0
    ? Math.max(0, entrySeconds)
    : undefined;
}

function projectionRadius(
  box: TrafficMotionBox,
  forward: {x: number; y: number},
  side: {x: number; y: number},
  testAxis: {x: number; y: number}
): number {
  return box.halfLength * Math.abs(dot(forward, testAxis)) +
    box.halfWidth * Math.abs(dot(side, testAxis));
}

function axis(angle: number): {x: number; y: number} {
  return {x: Math.cos(angle), y: Math.sin(angle)};
}

function dot(left: {x: number; y: number}, right: {x: number; y: number}): number {
  return left.x * right.x + left.y * right.y;
}
