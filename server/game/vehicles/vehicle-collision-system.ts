export interface VehicleCollisionBody {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  halfLength: number;
  halfWidth: number;
  mass: number;
  damageScale: number;
}

export interface VehicleCollisionResult {
  collided: boolean;
  closingSpeed: number;
  primaryX: number;
  primaryY: number;
  primarySpeed: number;
  primaryDamage: number;
  primaryZone: VehicleDamageZone;
  otherX: number;
  otherY: number;
  otherSpeed: number;
  otherDamage: number;
  otherZone: VehicleDamageZone;
}

export type VehicleDamageZone = 'front' | 'rear' | 'left' | 'right';

export class VehicleCollisionSystem {
  resolve(primary: VehicleCollisionBody, other: VehicleCollisionBody): VehicleCollisionResult {
    const differenceX = other.x - primary.x;
    const differenceY = other.y - primary.y;
    const contact = orientedBoxContact(primary, other, differenceX, differenceY);
    if (!contact) return noCollision(primary, other);
    const {normalX, normalY, overlap} = contact;
    const primaryVelocityX = Math.cos(primary.angle) * primary.speed;
    const primaryVelocityY = Math.sin(primary.angle) * primary.speed;
    const otherVelocityX = Math.cos(other.angle) * other.speed;
    const otherVelocityY = Math.sin(other.angle) * other.speed;
    const closingSpeed = Math.max(0, (
      (primaryVelocityX - otherVelocityX) * normalX +
      (primaryVelocityY - otherVelocityY) * normalY
    ));

    const inversePrimaryMass = 1 / Math.max(0.1, primary.mass);
    const inverseOtherMass = 1 / Math.max(0.1, other.mass);
    const inverseMassTotal = inversePrimaryMass + inverseOtherMass;
    const separation = overlap + 0.1;
    const primaryCorrection = separation * inversePrimaryMass / inverseMassTotal;
    const otherCorrection = separation * inverseOtherMass / inverseMassTotal;

    let nextPrimaryVelocityX = primaryVelocityX;
    let nextPrimaryVelocityY = primaryVelocityY;
    let nextOtherVelocityX = otherVelocityX;
    let nextOtherVelocityY = otherVelocityY;
    if (closingSpeed > 0) {
      const impulse = (1 + 0.24) * closingSpeed / inverseMassTotal;
      nextPrimaryVelocityX -= impulse * inversePrimaryMass * normalX;
      nextPrimaryVelocityY -= impulse * inversePrimaryMass * normalY;
      nextOtherVelocityX += impulse * inverseOtherMass * normalX;
      nextOtherVelocityY += impulse * inverseOtherMass * normalY;
    }

    const baseDamage = Math.max(0, (closingSpeed - 55) * 0.65);
    return {
      collided: true,
      closingSpeed,
      primaryX: primary.x - normalX * primaryCorrection,
      primaryY: primary.y - normalY * primaryCorrection,
      primarySpeed: projectSpeed(nextPrimaryVelocityX, nextPrimaryVelocityY, primary.angle),
      primaryDamage: Math.round(baseDamage * other.mass * primary.damageScale),
      primaryZone: classifyImpactZone(primary.angle, normalX, normalY),
      otherX: other.x + normalX * otherCorrection,
      otherY: other.y + normalY * otherCorrection,
      otherSpeed: projectSpeed(nextOtherVelocityX, nextOtherVelocityY, other.angle),
      otherDamage: Math.round(baseDamage * primary.mass * other.damageScale),
      otherZone: classifyImpactZone(other.angle, -normalX, -normalY)
    };
  }
}

interface ContactAxis {
  x: number;
  y: number;
}

function orientedBoxContact(
  primary: VehicleCollisionBody,
  other: VehicleCollisionBody,
  differenceX: number,
  differenceY: number
): {normalX: number; normalY: number; overlap: number} | undefined {
  const primaryForward = axis(primary.angle);
  const primarySide = axis(primary.angle + Math.PI / 2);
  const otherForward = axis(other.angle);
  const otherSide = axis(other.angle + Math.PI / 2);
  const axes = [primaryForward, primarySide, otherForward, otherSide];
  let minimumOverlap = Number.POSITIVE_INFINITY;
  let minimumAxis = axes[0];

  for (const candidate of axes) {
    const centerDistance = Math.abs(differenceX * candidate.x + differenceY * candidate.y);
    const primaryRadius = projectionRadius(primary, primaryForward, primarySide, candidate);
    const otherRadius = projectionRadius(other, otherForward, otherSide, candidate);
    const overlap = primaryRadius + otherRadius - centerDistance;
    if (overlap <= 0) return undefined;
    if (overlap < minimumOverlap) {
      minimumOverlap = overlap;
      minimumAxis = candidate;
    }
  }

  const direction = differenceX * minimumAxis.x + differenceY * minimumAxis.y < 0 ? -1 : 1;
  return {
    normalX: minimumAxis.x * direction,
    normalY: minimumAxis.y * direction,
    overlap: minimumOverlap
  };
}

function axis(angle: number): ContactAxis {
  return {x: Math.cos(angle), y: Math.sin(angle)};
}

function projectionRadius(
  body: VehicleCollisionBody,
  forward: ContactAxis,
  side: ContactAxis,
  candidate: ContactAxis
): number {
  return body.halfLength * Math.abs(forward.x * candidate.x + forward.y * candidate.y) +
    body.halfWidth * Math.abs(side.x * candidate.x + side.y * candidate.y);
}

function projectSpeed(velocityX: number, velocityY: number, angle: number): number {
  return velocityX * Math.cos(angle) + velocityY * Math.sin(angle);
}

function noCollision(
  primary: VehicleCollisionBody,
  other: VehicleCollisionBody
): VehicleCollisionResult {
  return {
    collided: false,
    closingSpeed: 0,
    primaryX: primary.x,
    primaryY: primary.y,
    primarySpeed: primary.speed,
    primaryDamage: 0,
    primaryZone: 'front',
    otherX: other.x,
    otherY: other.y,
    otherSpeed: other.speed,
    otherDamage: 0,
    otherZone: 'front'
  };
}

export function classifyImpactZone(
  vehicleAngle: number,
  impactDirectionX: number,
  impactDirectionY: number
): VehicleDamageZone {
  const impactAngle = Math.atan2(impactDirectionY, impactDirectionX);
  const relative = Math.atan2(
    Math.sin(impactAngle - vehicleAngle),
    Math.cos(impactAngle - vehicleAngle)
  );
  if (Math.abs(relative) <= Math.PI / 4) return 'front';
  if (Math.abs(relative) >= Math.PI * 3 / 4) return 'rear';
  return relative > 0 ? 'left' : 'right';
}
