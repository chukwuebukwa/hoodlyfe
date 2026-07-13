export interface VehicleHumanoidVehicleBody {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly speed: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly mass: number;
}

export interface VehicleHumanoidBody {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly radius: number;
  readonly mass: number;
}

export interface VehicleHumanoidContactResult {
  readonly valid: boolean;
  readonly collided: boolean;
  readonly normalX: number;
  readonly normalY: number;
  readonly penetration: number;
  readonly closingSpeed: number;
  readonly vehicleImpactSpeed: number;
  readonly impulse: number;
  readonly vehicleX: number;
  readonly vehicleY: number;
  readonly vehicleSpeed: number;
  readonly humanoidX: number;
  readonly humanoidY: number;
  readonly humanoidVelocityX: number;
  readonly humanoidVelocityY: number;
}

const CONTACT_SLOP = 0.1;
const CONTACT_RESTITUTION = 0.08;
const MINIMUM_MASS = 0.01;
const MAXIMUM_HUMANOID_SPEED = 460;
const CONTACT_EPSILON = 1e-6;

export function resolveVehicleHumanoidContact(
  vehicle: VehicleHumanoidVehicleBody,
  humanoid: VehicleHumanoidBody
): VehicleHumanoidContactResult {
  if (!validVehicle(vehicle) || !validHumanoid(humanoid)) {
    return noContact(vehicle, humanoid, false);
  }
  const contact = boxCircleContact(vehicle, humanoid);
  if (!contact) return noContact(vehicle, humanoid, true);

  const vehicleVelocityX = Math.cos(vehicle.angle) * vehicle.speed;
  const vehicleVelocityY = Math.sin(vehicle.angle) * vehicle.speed;
  const closingSpeed = Math.max(0,
    (vehicleVelocityX - humanoid.velocityX) * contact.normalX +
    (vehicleVelocityY - humanoid.velocityY) * contact.normalY
  );
  const vehicleImpactSpeed = Math.max(0,
    vehicleVelocityX * contact.normalX + vehicleVelocityY * contact.normalY
  );
  const inverseVehicleMass = 1 / Math.max(MINIMUM_MASS, vehicle.mass);
  const inverseHumanoidMass = 1 / Math.max(MINIMUM_MASS, humanoid.mass);
  const inverseMassTotal = inverseVehicleMass + inverseHumanoidMass;
  const separation = contact.penetration + CONTACT_SLOP;
  const vehicleCorrection = separation * inverseVehicleMass / inverseMassTotal;
  const humanoidCorrection = separation * inverseHumanoidMass / inverseMassTotal;
  const impulse = closingSpeed > 0
    ? (1 + CONTACT_RESTITUTION) * closingSpeed / inverseMassTotal
    : 0;
  const nextVehicleVelocityX = vehicleVelocityX -
    impulse * inverseVehicleMass * contact.normalX;
  const nextVehicleVelocityY = vehicleVelocityY -
    impulse * inverseVehicleMass * contact.normalY;
  const nextHumanoidVelocity = limitVector(
    humanoid.velocityX + impulse * inverseHumanoidMass * contact.normalX,
    humanoid.velocityY + impulse * inverseHumanoidMass * contact.normalY,
    MAXIMUM_HUMANOID_SPEED
  );

  return Object.freeze({
    valid: true,
    collided: true,
    normalX: contact.normalX,
    normalY: contact.normalY,
    penetration: separation,
    closingSpeed,
    vehicleImpactSpeed,
    impulse,
    vehicleX: vehicle.x - contact.normalX * vehicleCorrection,
    vehicleY: vehicle.y - contact.normalY * vehicleCorrection,
    vehicleSpeed: projectSpeed(nextVehicleVelocityX, nextVehicleVelocityY, vehicle.angle),
    humanoidX: humanoid.x + contact.normalX * humanoidCorrection,
    humanoidY: humanoid.y + contact.normalY * humanoidCorrection,
    humanoidVelocityX: nextHumanoidVelocity.x,
    humanoidVelocityY: nextHumanoidVelocity.y
  });
}

function boxCircleContact(
  vehicle: VehicleHumanoidVehicleBody,
  humanoid: VehicleHumanoidBody
): {normalX: number; normalY: number; penetration: number} | undefined {
  const cosine = Math.cos(vehicle.angle);
  const sine = Math.sin(vehicle.angle);
  const differenceX = humanoid.x - vehicle.x;
  const differenceY = humanoid.y - vehicle.y;
  const localForward = differenceX * cosine + differenceY * sine;
  const localSide = -differenceX * sine + differenceY * cosine;
  const nearestForward = clamp(localForward, -vehicle.halfLength, vehicle.halfLength);
  const nearestSide = clamp(localSide, -vehicle.halfWidth, vehicle.halfWidth);
  const offsetForward = localForward - nearestForward;
  const offsetSide = localSide - nearestSide;
  const distanceSquared = offsetForward * offsetForward + offsetSide * offsetSide;
  const radiusSquared = humanoid.radius * humanoid.radius;
  if (distanceSquared > radiusSquared) return undefined;

  let localNormalForward: number;
  let localNormalSide: number;
  let penetration: number;
  if (distanceSquared > CONTACT_EPSILON * CONTACT_EPSILON) {
    const distance = Math.sqrt(distanceSquared);
    localNormalForward = offsetForward / distance;
    localNormalSide = offsetSide / distance;
    penetration = humanoid.radius - distance;
  } else {
    const forwardFaceDistance = vehicle.halfLength - Math.abs(localForward);
    const sideFaceDistance = vehicle.halfWidth - Math.abs(localSide);
    const humanoidForwardVelocity = humanoid.velocityX * cosine + humanoid.velocityY * sine;
    const humanoidSideVelocity = -humanoid.velocityX * sine + humanoid.velocityY * cosine;
    if (forwardFaceDistance <= sideFaceDistance) {
      localNormalForward = stableSign(
        localForward,
        vehicle.speed - humanoidForwardVelocity
      );
      localNormalSide = 0;
      penetration = humanoid.radius + forwardFaceDistance;
    } else {
      localNormalForward = 0;
      localNormalSide = stableSign(
        localSide,
        -humanoidSideVelocity
      );
      penetration = humanoid.radius + sideFaceDistance;
    }
  }

  return {
    normalX: localNormalForward * cosine - localNormalSide * sine,
    normalY: localNormalForward * sine + localNormalSide * cosine,
    penetration: Math.max(0, penetration)
  };
}

function noContact(
  vehicle: VehicleHumanoidVehicleBody,
  humanoid: VehicleHumanoidBody,
  valid: boolean
): VehicleHumanoidContactResult {
  return Object.freeze({
    valid,
    collided: false,
    normalX: 0,
    normalY: 0,
    penetration: 0,
    closingSpeed: 0,
    vehicleImpactSpeed: 0,
    impulse: 0,
    vehicleX: finite(vehicle.x),
    vehicleY: finite(vehicle.y),
    vehicleSpeed: finite(vehicle.speed),
    humanoidX: finite(humanoid.x),
    humanoidY: finite(humanoid.y),
    humanoidVelocityX: finite(humanoid.velocityX),
    humanoidVelocityY: finite(humanoid.velocityY)
  });
}

function validVehicle(body: VehicleHumanoidVehicleBody): boolean {
  return Boolean(body.id) && [
    body.x,
    body.y,
    body.angle,
    body.speed,
    body.halfLength,
    body.halfWidth,
    body.mass
  ].every(Number.isFinite) && body.halfLength > 0 && body.halfWidth > 0 && body.mass > 0;
}

function validHumanoid(body: VehicleHumanoidBody): boolean {
  return Boolean(body.id) && [
    body.x,
    body.y,
    body.velocityX,
    body.velocityY,
    body.radius,
    body.mass
  ].every(Number.isFinite) && body.radius > 0 && body.mass > 0;
}

function stableSign(value: number, fallback: number): number {
  if (Math.abs(value) > CONTACT_EPSILON) return value < 0 ? -1 : 1;
  if (Math.abs(fallback) > CONTACT_EPSILON) return fallback < 0 ? -1 : 1;
  return 1;
}

function limitVector(x: number, y: number, maximum: number): {x: number; y: number} {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maximum || magnitude <= CONTACT_EPSILON) return {x, y};
  const scale = maximum / magnitude;
  return {x: x * scale, y: y * scale};
}

function projectSpeed(velocityX: number, velocityY: number, angle: number): number {
  return velocityX * Math.cos(angle) + velocityY * Math.sin(angle);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
