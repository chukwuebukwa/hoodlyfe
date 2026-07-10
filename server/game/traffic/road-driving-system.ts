import type {VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {vehicleConfig} from '../vehicles/vehicle-config.ts';
import {
  TrafficAwarenessSystem,
  type TrafficObstacle,
  type TrafficSpeedReason
} from './traffic-awareness-system.ts';

const VEHICLE_RADIUS = 20;

export interface RoadDrivingInput {
  targetX: number;
  targetY: number;
  cruiseSpeed: number;
  deltaSeconds: number;
  obstacles?: readonly TrafficObstacle[];
  ignoredObstacleIds?: ReadonlySet<string>;
  minimumGapScale?: number;
  allowRoadRejoin?: boolean;
}

export interface RoadDrivingResult {
  moved: boolean;
  reached: boolean;
  blocked: boolean;
  desiredSpeed: number;
  speedReason: TrafficSpeedReason | 'blocked';
  obstacleId: string;
  obstacleDistance: number;
}

export class RoadDrivingSystem {
  private readonly awareness = new TrafficAwarenessSystem();

  constructor(private readonly world: CollisionMap) {}

  update(vehicle: VehicleState, input: RoadDrivingInput): RoadDrivingResult {
    const configuration = vehicleConfig(vehicle.kind).traffic;
    const deltaX = input.targetX - vehicle.x;
    const deltaY = input.targetY - vehicle.y;
    const distance = Math.hypot(deltaX, deltaY);
    const routeAngle = Math.atan2(deltaY, deltaX);
    const ignored = input.ignoredObstacleIds ?? new Set<string>();
    const awareness = this.awareness.evaluate({
      vehicleId: vehicle.id,
      x: vehicle.x,
      y: vehicle.y,
      angle: routeAngle,
      speed: vehicle.speed,
      radius: VEHICLE_RADIUS,
      cruiseSpeed: input.cruiseSpeed,
      brakeDeceleration: configuration.brakeDeceleration,
      minimumGap: configuration.minimumGap * (input.minimumGapScale ?? 1),
      followingTime: configuration.followingTime,
      pedestrianGap: configuration.pedestrianGap,
      lookAhead: configuration.lookAhead,
      obstacles: (input.obstacles ?? []).filter((obstacle) => !ignored.has(obstacle.id))
    });
    const base = {
      desiredSpeed: awareness.desiredSpeed,
      speedReason: awareness.reason,
      obstacleId: awareness.obstacleId,
      obstacleDistance: Number.isFinite(awareness.obstacleDistance)
        ? awareness.obstacleDistance
        : -1
    };
    if (awareness.desiredSpeed > 0 && distance <= Math.max(8, vehicle.speed * input.deltaSeconds)) {
      return {...base, moved: false, reached: true, blocked: false};
    }

    vehicle.angle = rotateToward(vehicle.angle, routeAngle, 4.2 * input.deltaSeconds);
    vehicle.speed = approach(
      vehicle.speed,
      awareness.desiredSpeed,
      (awareness.desiredSpeed < vehicle.speed
        ? configuration.brakeDeceleration
        : configuration.acceleration) * input.deltaSeconds
    );
    const movement = Math.min(distance, vehicle.speed * input.deltaSeconds);
    const nextX = vehicle.x + Math.cos(routeAngle) * movement;
    const nextY = vehicle.y + Math.sin(routeAngle) * movement;
    const canRejoinRoad = input.allowRoadRejoin && !this.world.isRoadAt(vehicle.x, vehicle.y);
    if (
      this.world.canOccupy(nextX, nextY, VEHICLE_RADIUS) &&
      (this.world.isRoadAt(nextX, nextY) || canRejoinRoad)
    ) {
      vehicle.x = nextX;
      vehicle.y = nextY;
      return {...base, moved: movement > 0, reached: false, blocked: false};
    }

    vehicle.speed = approach(
      vehicle.speed,
      0,
      configuration.brakeDeceleration * input.deltaSeconds
    );
    return {
      moved: false,
      reached: false,
      blocked: true,
      desiredSpeed: 0,
      speedReason: 'blocked',
      obstacleId: '',
      obstacleDistance: 0
    };
  }

  brake(vehicle: VehicleState, deltaSeconds: number, deceleration = 520): void {
    vehicle.speed = approach(vehicle.speed, 0, deceleration * deltaSeconds);
  }

  reverse(vehicle: VehicleState, deltaSeconds: number, speed = 48): boolean {
    vehicle.speed = approach(vehicle.speed, -speed, 260 * deltaSeconds);
    const nextX = vehicle.x + Math.cos(vehicle.angle) * vehicle.speed * deltaSeconds;
    const nextY = vehicle.y + Math.sin(vehicle.angle) * vehicle.speed * deltaSeconds;
    if (!this.world.canOccupy(nextX, nextY, VEHICLE_RADIUS) || !this.world.isRoadAt(nextX, nextY)) {
      vehicle.speed = 0;
      return false;
    }
    vehicle.x = nextX;
    vehicle.y = nextY;
    return true;
  }
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  if (value > target) return Math.max(target, value - amount);
  return value;
}

function rotateToward(current: number, target: number, amount: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return normalizeAngle(current + clamp(difference, -amount, amount));
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
