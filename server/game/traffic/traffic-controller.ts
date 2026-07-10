import type {VehicleState} from '../../state.ts';
import type {CollisionMap, RoadNode, TrafficSpawn} from '../../world-map.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import {vehicleConfig} from '../vehicles/vehicle-config.ts';
import {
  TrafficAwarenessSystem,
  type TrafficObstacle,
  type TrafficSpeedReason
} from './traffic-awareness-system.ts';

const VEHICLE_RADIUS = 20;

interface TrafficRuntime {
  previousColumn: number;
  previousRow: number;
  targetColumn: number;
  targetRow: number;
  cruiseSpeed: number;
  desiredSpeed: number;
  speedReason: TrafficSpeedReason | 'blocked' | 'hijack';
  obstacleId: string;
  obstacleDistance: number;
  blockedSince: number;
  recoveryCount: number;
}

export interface TrafficUpdateContext {
  obstacles?: readonly TrafficObstacle[];
}

export interface TrafficDiagnostic {
  vehicleId: string;
  cruiseSpeed: number;
  desiredSpeed: number;
  speedReason: TrafficRuntime['speedReason'];
  obstacleId: string;
  obstacleDistance: number;
  blockedSince: number;
  recoveryCount: number;
}

interface TrafficControllerOptions {
  world: CollisionMap;
  random: DeterministicRandom;
}

export class TrafficController {
  private readonly runtime = new Map<string, TrafficRuntime>();
  private readonly awareness = new TrafficAwarenessSystem();

  constructor(private readonly options: TrafficControllerOptions) {}

  register(vehicleId: string, spawn: TrafficSpawn, cruiseSpeed: number): void {
    this.runtime.set(vehicleId, {
      previousColumn: spawn.column,
      previousRow: spawn.row,
      targetColumn: spawn.targetColumn,
      targetRow: spawn.targetRow,
      cruiseSpeed,
      desiredSpeed: cruiseSpeed,
      speedReason: 'cruise',
      obstacleId: '',
      obstacleDistance: -1,
      blockedSince: 0,
      recoveryCount: 0
    });
  }

  release(vehicleId: string): void {
    this.runtime.delete(vehicleId);
  }

  has(vehicleId: string): boolean {
    return this.runtime.has(vehicleId);
  }

  diagnostics(): TrafficDiagnostic[] {
    return [...this.runtime.entries()].map(([vehicleId, runtime]) => ({
      vehicleId,
      cruiseSpeed: runtime.cruiseSpeed,
      desiredSpeed: runtime.desiredSpeed,
      speedReason: runtime.speedReason,
      obstacleId: runtime.obstacleId,
      obstacleDistance: runtime.obstacleDistance,
      blockedSince: runtime.blockedSince,
      recoveryCount: runtime.recoveryCount
    })).sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
  }

  update(
    vehicle: VehicleState,
    deltaSeconds: number,
    nowMs: number,
    context: TrafficUpdateContext = {}
  ): boolean {
    const runtime = this.runtime.get(vehicle.id);
    if (!runtime) return false;
    const configuration = vehicleConfig(vehicle.kind).traffic;
    if (vehicle.hijackBy) {
      vehicle.speed = approach(vehicle.speed, 0, 520 * deltaSeconds);
      runtime.desiredSpeed = 0;
      runtime.speedReason = 'hijack';
      runtime.obstacleId = '';
      runtime.obstacleDistance = -1;
      return false;
    }

    const {world} = this.options;
    const targetX = (runtime.targetColumn + 0.5) * world.tileWidth;
    const targetY = (runtime.targetRow + 0.5) * world.tileHeight;
    const distance = Math.hypot(targetX - vehicle.x, targetY - vehicle.y);
    const routeAngle = Math.atan2(targetY - vehicle.y, targetX - vehicle.x);
    const awareness = this.awareness.evaluate({
      vehicleId: vehicle.id,
      x: vehicle.x,
      y: vehicle.y,
      angle: routeAngle,
      speed: vehicle.speed,
      radius: VEHICLE_RADIUS,
      cruiseSpeed: runtime.cruiseSpeed,
      brakeDeceleration: configuration.brakeDeceleration,
      minimumGap: configuration.minimumGap,
      followingTime: configuration.followingTime,
      pedestrianGap: configuration.pedestrianGap,
      lookAhead: configuration.lookAhead,
      obstacles: context.obstacles ?? []
    });
    runtime.desiredSpeed = awareness.desiredSpeed;
    runtime.speedReason = awareness.reason;
    runtime.obstacleId = awareness.obstacleId;
    runtime.obstacleDistance = Number.isFinite(awareness.obstacleDistance)
      ? awareness.obstacleDistance
      : -1;

    if (
      runtime.desiredSpeed > 0 &&
      distance <= Math.max(8, vehicle.speed * deltaSeconds)
    ) {
      vehicle.x = targetX;
      vehicle.y = targetY;
      const current = {column: runtime.targetColumn, row: runtime.targetRow};
      const next = this.chooseNextRoadNode(current, runtime, nowMs + vehicle.id.length * 37);
      runtime.previousColumn = current.column;
      runtime.previousRow = current.row;
      runtime.targetColumn = next.column;
      runtime.targetRow = next.row;
      return false;
    }

    vehicle.angle = rotateToward(vehicle.angle, routeAngle, 4.2 * deltaSeconds);
    vehicle.speed = approach(
      vehicle.speed,
      runtime.desiredSpeed,
      (runtime.desiredSpeed < vehicle.speed
        ? configuration.brakeDeceleration
        : configuration.acceleration) * deltaSeconds
    );
    const movement = Math.min(distance, vehicle.speed * deltaSeconds);
    const nextX = vehicle.x + Math.cos(routeAngle) * movement;
    const nextY = vehicle.y + Math.sin(routeAngle) * movement;
    if (world.canOccupy(nextX, nextY, VEHICLE_RADIUS) && world.isRoadAt(nextX, nextY)) {
      vehicle.x = nextX;
      vehicle.y = nextY;
      runtime.blockedSince = 0;
      return true;
    }

    if (runtime.blockedSince === 0) runtime.blockedSince = nowMs;
    runtime.desiredSpeed = 0;
    runtime.speedReason = 'blocked';
    runtime.obstacleId = '';
    runtime.obstacleDistance = 0;
    vehicle.speed = approach(vehicle.speed, 0, configuration.brakeDeceleration * deltaSeconds);
    const currentColumn = Math.floor(vehicle.x / world.tileWidth);
    const currentRow = Math.floor(vehicle.y / world.tileHeight);
    if (nowMs - runtime.blockedSince >= 1200) {
      const next = this.chooseRecoveryRoadNode(
        {column: currentColumn, row: currentRow},
        runtime,
        nowMs + 911 + runtime.recoveryCount * 97
      );
      runtime.previousColumn = currentColumn;
      runtime.previousRow = currentRow;
      runtime.targetColumn = next.column;
      runtime.targetRow = next.row;
      runtime.blockedSince = nowMs;
      runtime.recoveryCount++;
    }
    return false;
  }

  private chooseRecoveryRoadNode(
    current: RoadNode,
    runtime: TrafficRuntime,
    seed: number
  ): RoadNode {
    const neighbors = this.options.world.roadNeighbors(current.column, current.row);
    const alternatives = neighbors.filter((node) => (
      node.column !== runtime.targetColumn || node.row !== runtime.targetRow
    ));
    const choices = alternatives.length > 0 ? alternatives : neighbors;
    if (choices.length === 0) return current;
    return choices[this.options.random.integer('traffic-recovery', seed, 0, choices.length)];
  }

  private chooseNextRoadNode(
    current: RoadNode,
    runtime: TrafficRuntime,
    seed: number
  ): RoadNode {
    const neighbors = this.options.world.roadNeighbors(current.column, current.row);
    if (neighbors.length === 0) return current;
    const forwardColumn = current.column + (current.column - runtime.previousColumn);
    const forwardRow = current.row + (current.row - runtime.previousRow);
    const forward = neighbors.find((node) => node.column === forwardColumn && node.row === forwardRow);
    if (forward && (neighbors.length <= 2 || this.options.random.unit('traffic-forward', seed) < 0.88)) {
      return forward;
    }
    const alternatives = neighbors.filter((node) => (
      node.column !== runtime.previousColumn || node.row !== runtime.previousRow
    ));
    const choices = alternatives.length > 0 ? alternatives : neighbors;
    return choices[this.options.random.integer('traffic-turn', seed + 17, 0, choices.length)];
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
