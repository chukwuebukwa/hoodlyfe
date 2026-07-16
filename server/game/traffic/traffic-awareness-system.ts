import {sweptOrientedBoxTimeToContact} from './traffic-predictive-contact.ts';

export type TrafficObstacleKind = 'vehicle' | 'pedestrian' | 'signal';
export type TrafficSpeedReason = 'cruise' | 'vehicle' | 'pedestrian' | 'signal' | 'siren';

export interface TrafficObstacle {
  id: string;
  kind: TrafficObstacleKind;
  x: number;
  y: number;
  radius: number;
  speed?: number;
  angle?: number;
  halfLength?: number;
  halfWidth?: number;
}

export interface TrafficAwarenessInput {
  vehicleId: string;
  x: number;
  y: number;
  angle: number;
  bodyAngle: number;
  speed: number;
  radius: number;
  halfLength: number;
  halfWidth: number;
  cruiseSpeed: number;
  brakeDeceleration: number;
  minimumGap: number;
  followingTime: number;
  pedestrianGap: number;
  lookAhead: number;
  obstacles: readonly TrafficObstacle[];
}

export interface TrafficAwarenessResult {
  desiredSpeed: number;
  reason: TrafficSpeedReason;
  obstacleId: string;
  obstacleDistance: number;
  timeToContactSeconds: number;
  scanDistance: number;
}

export class TrafficAwarenessSystem {
  evaluate(input: TrafficAwarenessInput): TrafficAwarenessResult {
    const speed = Math.max(0, input.speed);
    const brakingDistance = speed * speed / (2 * Math.max(1, input.brakeDeceleration));
    const scanDistance = Math.min(
      input.lookAhead,
      Math.max(96, input.minimumGap + speed * input.followingTime + brakingDistance + 48)
    );
    let result: TrafficAwarenessResult = {
      desiredSpeed: input.cruiseSpeed,
      reason: 'cruise',
      obstacleId: '',
      obstacleDistance: Number.POSITIVE_INFINITY,
      timeToContactSeconds: -1,
      scanDistance
    };
    const forwardX = Math.cos(input.angle);
    const forwardY = Math.sin(input.angle);
    const candidates = [...input.obstacles].sort((left, right) => left.id.localeCompare(right.id));
    for (const obstacle of candidates) {
      if (obstacle.id === input.vehicleId) continue;
      const deltaX = obstacle.x - input.x;
      const deltaY = obstacle.y - input.y;
      const forwardDistance = deltaX * forwardX + deltaY * forwardY;
      if (
        obstacle.kind === 'vehicle' &&
        obstacle.halfLength !== undefined &&
        obstacle.halfWidth !== undefined &&
        forwardDistance >= -input.halfLength
      ) {
        const timeToContactSeconds = this.vehicleTimeToContact(input, obstacle, scanDistance);
        if (timeToContactSeconds !== undefined) {
          const responseHorizon = responseHorizonSeconds(input);
          const progress = clamp((timeToContactSeconds / responseHorizon - 0.15) / 0.85, 0, 1);
          const desiredSpeed = input.cruiseSpeed * progress;
          if (isMoreRestrictive(result, desiredSpeed, timeToContactSeconds, forwardDistance)) {
            result = {
              desiredSpeed,
              reason: 'vehicle',
              obstacleId: obstacle.id,
              obstacleDistance: Math.max(0, forwardDistance),
              timeToContactSeconds,
              scanDistance
            };
          }
        }
      }
      if (forwardDistance <= 0 || forwardDistance > scanDistance + obstacle.radius) continue;
      const lateralDistance = Math.abs(-deltaX * forwardY + deltaY * forwardX);
      const hasVehicleBox = obstacle.kind === 'vehicle' &&
        obstacle.halfLength !== undefined && obstacle.halfWidth !== undefined;
      const egoLateralExtent = hasVehicleBox
        ? orientedProjection(input.halfLength, input.halfWidth, input.bodyAngle, input.angle + Math.PI / 2)
        : input.radius;
      const obstacleLateralExtent = hasVehicleBox
        ? orientedProjection(
          obstacle.halfLength!,
          obstacle.halfWidth!,
          obstacle.angle ?? input.angle,
          input.angle + Math.PI / 2
        )
        : obstacle.radius;
      if (lateralDistance > egoLateralExtent + obstacleLateralExtent + (hasVehicleBox ? 4 : 7)) continue;

      const egoForwardExtent = hasVehicleBox
        ? orientedProjection(input.halfLength, input.halfWidth, input.bodyAngle, input.angle)
        : input.radius;
      const obstacleForwardExtent = hasVehicleBox
        ? orientedProjection(
          obstacle.halfLength!,
          obstacle.halfWidth!,
          obstacle.angle ?? input.angle,
          input.angle
        )
        : obstacle.radius;
      const gap = Math.max(0, forwardDistance - egoForwardExtent - obstacleForwardExtent);
      const minimumGap = obstacle.kind === 'pedestrian'
        ? Math.max(input.minimumGap, input.pedestrianGap)
        : (obstacle.kind === 'signal' ? 10 : input.minimumGap);
      const leadSpeed = obstacle.kind === 'vehicle'
        ? Math.max(0, (obstacle.speed ?? 0) * Math.cos((obstacle.angle ?? input.angle) - input.angle))
        : 0;
      const closingSpeed = Math.max(0, speed - leadSpeed);
      const safeGap = minimumGap + closingSpeed * input.followingTime +
        closingSpeed * closingSpeed / (2 * Math.max(1, input.brakeDeceleration));
      if (gap >= safeGap) continue;

      const usableGap = Math.max(0, gap - minimumGap);
      const stoppingSpeed = Math.sqrt(2 * input.brakeDeceleration * usableGap);
      const progress = safeGap <= minimumGap
        ? 0
        : clamp(usableGap / (safeGap - minimumGap), 0, 1);
      const followingSpeed = leadSpeed + (input.cruiseSpeed - leadSpeed) * progress;
      const desiredSpeed = Math.max(0, Math.min(input.cruiseSpeed, stoppingSpeed, followingSpeed));
      if (
        desiredSpeed > result.desiredSpeed ||
        (desiredSpeed === result.desiredSpeed && gap >= result.obstacleDistance)
      ) continue;
      result = {
        desiredSpeed,
        reason: obstacle.kind,
        obstacleId: obstacle.id,
        obstacleDistance: gap,
        timeToContactSeconds: result.obstacleId === obstacle.id
          ? result.timeToContactSeconds
          : -1,
        scanDistance
      };
    }
    return result;
  }

  private vehicleTimeToContact(
    input: TrafficAwarenessInput,
    obstacle: TrafficObstacle,
    scanDistance: number
  ): number | undefined {
    const horizonSeconds = responseHorizonSeconds(input);
    const obstacleSpeed = obstacle.speed ?? 0;
    const obstacleAngle = obstacle.angle ?? input.angle;
    const maximumTravel = (Math.max(0, input.speed) + Math.abs(obstacleSpeed)) * horizonSeconds;
    const boundingReach = Math.hypot(input.halfLength, input.halfWidth) +
      Math.hypot(obstacle.halfLength!, obstacle.halfWidth!) + 4;
    if (Math.hypot(obstacle.x - input.x, obstacle.y - input.y) >
      Math.max(scanDistance, maximumTravel + boundingReach)) return undefined;

    return sweptOrientedBoxTimeToContact({
      x: input.x,
      y: input.y,
      angle: input.bodyAngle,
      velocityX: Math.cos(input.angle) * Math.max(0, input.speed),
      velocityY: Math.sin(input.angle) * Math.max(0, input.speed),
      halfLength: input.halfLength,
      halfWidth: input.halfWidth
    }, {
      x: obstacle.x,
      y: obstacle.y,
      angle: obstacleAngle,
      velocityX: Math.cos(obstacleAngle) * obstacleSpeed,
      velocityY: Math.sin(obstacleAngle) * obstacleSpeed,
      halfLength: obstacle.halfLength!,
      halfWidth: obstacle.halfWidth!
    }, horizonSeconds, 4);
  }
}

function responseHorizonSeconds(input: TrafficAwarenessInput): number {
  return clamp(
    input.followingTime + Math.max(0, input.speed) / Math.max(1, input.brakeDeceleration) + 0.8,
    1,
    3
  );
}

function isMoreRestrictive(
  result: TrafficAwarenessResult,
  desiredSpeed: number,
  timeToContactSeconds: number,
  obstacleDistance: number
): boolean {
  if (desiredSpeed < result.desiredSpeed) return true;
  if (desiredSpeed > result.desiredSpeed) return false;
  if (result.timeToContactSeconds < 0 || timeToContactSeconds < result.timeToContactSeconds) return true;
  if (timeToContactSeconds > result.timeToContactSeconds) return false;
  return obstacleDistance < result.obstacleDistance;
}

function orientedProjection(
  halfLength: number,
  halfWidth: number,
  boxAngle: number,
  axisAngle: number
): number {
  const difference = boxAngle - axisAngle;
  return halfLength * Math.abs(Math.cos(difference)) + halfWidth * Math.abs(Math.sin(difference));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
