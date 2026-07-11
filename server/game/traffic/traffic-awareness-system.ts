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
}

export interface TrafficAwarenessInput {
  vehicleId: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  radius: number;
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
      if (forwardDistance <= 0 || forwardDistance > scanDistance + obstacle.radius) continue;
      const lateralDistance = Math.abs(-deltaX * forwardY + deltaY * forwardX);
      if (lateralDistance > input.radius + obstacle.radius + 7) continue;

      const gap = Math.max(0, forwardDistance - input.radius - obstacle.radius);
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
        scanDistance
      };
    }
    return result;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
