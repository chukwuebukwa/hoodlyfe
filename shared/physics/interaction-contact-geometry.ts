export interface InteractionCircle {
  readonly shape: 'circle';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface InteractionOrientedBox {
  readonly shape: 'box';
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly halfLength: number;
  readonly halfWidth: number;
}

export type InteractionContactShape = InteractionCircle | InteractionOrientedBox;

export interface InteractionMotionCircle {
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly radius: number;
}

export function interactionShapesOverlap(
  left: InteractionContactShape,
  right: InteractionContactShape,
  slop = 0
): boolean {
  const safeSlop = Math.max(0, finiteOrZero(slop));
  if (left.shape === 'circle' && right.shape === 'circle') {
    const radius = left.radius + right.radius + safeSlop;
    return squaredDistance(left.x, left.y, right.x, right.y) <= radius * radius;
  }
  if (left.shape === 'box' && right.shape === 'box') {
    return boxesOverlap(left, right, safeSlop);
  }
  if (left.shape === 'box' && right.shape === 'circle') {
    return boxCircleOverlap(left, right, safeSlop);
  }
  if (left.shape === 'circle' && right.shape === 'box') {
    return boxCircleOverlap(right, left, safeSlop);
  }
  return false;
}

export function sweptCircleTimeToContact(
  left: InteractionMotionCircle,
  right: InteractionMotionCircle,
  horizonSeconds: number,
  margin = 0
): number | undefined {
  const horizon = Math.max(0, finiteOrZero(horizonSeconds));
  const combinedRadius = Math.max(0, left.radius) + Math.max(0, right.radius) +
    Math.max(0, finiteOrZero(margin));
  const relativeX = right.x - left.x;
  const relativeY = right.y - left.y;
  const relativeVelocityX = right.velocityX - left.velocityX;
  const relativeVelocityY = right.velocityY - left.velocityY;
  const c = relativeX * relativeX + relativeY * relativeY - combinedRadius * combinedRadius;
  if (c <= 0) return 0;
  const a = relativeVelocityX * relativeVelocityX + relativeVelocityY * relativeVelocityY;
  if (a <= Number.EPSILON) return undefined;
  const b = 2 * (relativeX * relativeVelocityX + relativeY * relativeVelocityY);
  if (b >= 0) return undefined;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const contactAt = (-b - Math.sqrt(discriminant)) / (2 * a);
  return contactAt >= 0 && contactAt <= horizon ? contactAt : undefined;
}

function boxesOverlap(
  left: InteractionOrientedBox,
  right: InteractionOrientedBox,
  slop: number
): boolean {
  const leftForward = axis(left.angle);
  const leftSide = axis(left.angle + Math.PI / 2);
  const rightForward = axis(right.angle);
  const rightSide = axis(right.angle + Math.PI / 2);
  const differenceX = right.x - left.x;
  const differenceY = right.y - left.y;
  for (const candidate of [leftForward, leftSide, rightForward, rightSide]) {
    const centerDistance = Math.abs(differenceX * candidate.x + differenceY * candidate.y);
    const reach = boxProjectionRadius(left, leftForward, leftSide, candidate) +
      boxProjectionRadius(right, rightForward, rightSide, candidate) + slop;
    if (centerDistance > reach) return false;
  }
  return true;
}

function boxCircleOverlap(
  box: InteractionOrientedBox,
  circle: InteractionCircle,
  slop: number
): boolean {
  const cosine = Math.cos(box.angle);
  const sine = Math.sin(box.angle);
  const differenceX = circle.x - box.x;
  const differenceY = circle.y - box.y;
  const localForward = differenceX * cosine + differenceY * sine;
  const localSide = -differenceX * sine + differenceY * cosine;
  const nearestForward = clamp(localForward, -box.halfLength, box.halfLength);
  const nearestSide = clamp(localSide, -box.halfWidth, box.halfWidth);
  const offsetForward = localForward - nearestForward;
  const offsetSide = localSide - nearestSide;
  const radius = circle.radius + slop;
  return offsetForward * offsetForward + offsetSide * offsetSide <= radius * radius;
}

function boxProjectionRadius(
  box: InteractionOrientedBox,
  forward: Axis,
  side: Axis,
  candidate: Axis
): number {
  return box.halfLength * Math.abs(dot(forward, candidate)) +
    box.halfWidth * Math.abs(dot(side, candidate));
}

interface Axis {
  x: number;
  y: number;
}

function axis(angle: number): Axis {
  return {x: Math.cos(angle), y: Math.sin(angle)};
}

function dot(left: Axis, right: Axis): number {
  return left.x * right.x + left.y * right.y;
}

function squaredDistance(leftX: number, leftY: number, rightX: number, rightY: number): number {
  const differenceX = rightX - leftX;
  const differenceY = rightY - leftY;
  return differenceX * differenceX + differenceY * differenceY;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
