export interface VehicleCollisionBody {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  radius: number;
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
  otherX: number;
  otherY: number;
  otherSpeed: number;
  otherDamage: number;
}

export class VehicleCollisionSystem {
  resolve(primary: VehicleCollisionBody, other: VehicleCollisionBody): VehicleCollisionResult {
    const differenceX = other.x - primary.x;
    const differenceY = other.y - primary.y;
    const minimumDistance = primary.radius + other.radius;
    const distance = Math.hypot(differenceX, differenceY);
    if (distance >= minimumDistance) return noCollision(primary, other);

    const normalX = distance > 0.001 ? differenceX / distance : Math.cos(primary.angle);
    const normalY = distance > 0.001 ? differenceY / distance : Math.sin(primary.angle);
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
    const overlap = minimumDistance - distance + 0.1;
    const primaryCorrection = overlap * inversePrimaryMass / inverseMassTotal;
    const otherCorrection = overlap * inverseOtherMass / inverseMassTotal;

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

    const baseDamage = Math.max(0, (closingSpeed - 55) * 0.18);
    return {
      collided: true,
      closingSpeed,
      primaryX: primary.x - normalX * primaryCorrection,
      primaryY: primary.y - normalY * primaryCorrection,
      primarySpeed: projectSpeed(nextPrimaryVelocityX, nextPrimaryVelocityY, primary.angle),
      primaryDamage: Math.round(baseDamage * other.mass * primary.damageScale),
      otherX: other.x + normalX * otherCorrection,
      otherY: other.y + normalY * otherCorrection,
      otherSpeed: projectSpeed(nextOtherVelocityX, nextOtherVelocityY, other.angle),
      otherDamage: Math.round(baseDamage * primary.mass * other.damageScale)
    };
  }
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
    otherX: other.x,
    otherY: other.y,
    otherSpeed: other.speed,
    otherDamage: 0
  };
}
