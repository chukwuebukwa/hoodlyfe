import type {VehicleState} from '../../state.ts';
import type {CollisionMap, RoadNode, TrafficSpawn} from '../../world-map.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';

const VEHICLE_RADIUS = 20;

interface TrafficRuntime {
  previousColumn: number;
  previousRow: number;
  targetColumn: number;
  targetRow: number;
  cruiseSpeed: number;
}

interface TrafficControllerOptions {
  world: CollisionMap;
  random: DeterministicRandom;
}

export class TrafficController {
  private readonly runtime = new Map<string, TrafficRuntime>();

  constructor(private readonly options: TrafficControllerOptions) {}

  register(vehicleId: string, spawn: TrafficSpawn, cruiseSpeed: number): void {
    this.runtime.set(vehicleId, {
      previousColumn: spawn.column,
      previousRow: spawn.row,
      targetColumn: spawn.targetColumn,
      targetRow: spawn.targetRow,
      cruiseSpeed
    });
  }

  release(vehicleId: string): void {
    this.runtime.delete(vehicleId);
  }

  has(vehicleId: string): boolean {
    return this.runtime.has(vehicleId);
  }

  update(vehicle: VehicleState, deltaSeconds: number, nowMs: number): boolean {
    const runtime = this.runtime.get(vehicle.id);
    if (!runtime) return false;
    if (vehicle.hijackBy) {
      vehicle.speed = approach(vehicle.speed, 0, 520 * deltaSeconds);
      return false;
    }

    const {world} = this.options;
    const targetX = (runtime.targetColumn + 0.5) * world.tileWidth;
    const targetY = (runtime.targetRow + 0.5) * world.tileHeight;
    const distance = Math.hypot(targetX - vehicle.x, targetY - vehicle.y);
    if (distance <= Math.max(8, vehicle.speed * deltaSeconds)) {
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

    const desiredAngle = Math.atan2(targetY - vehicle.y, targetX - vehicle.x);
    vehicle.angle = rotateToward(vehicle.angle, desiredAngle, 4.2 * deltaSeconds);
    vehicle.speed = approach(vehicle.speed, runtime.cruiseSpeed, 85 * deltaSeconds);
    const movement = Math.min(distance, vehicle.speed * deltaSeconds);
    const nextX = vehicle.x + Math.cos(desiredAngle) * movement;
    const nextY = vehicle.y + Math.sin(desiredAngle) * movement;
    if (world.canOccupy(nextX, nextY, VEHICLE_RADIUS) && world.isRoadAt(nextX, nextY)) {
      vehicle.x = nextX;
      vehicle.y = nextY;
      return true;
    }

    const currentColumn = Math.floor(vehicle.x / world.tileWidth);
    const currentRow = Math.floor(vehicle.y / world.tileHeight);
    const next = this.chooseNextRoadNode(
      {column: currentColumn, row: currentRow},
      runtime,
      nowMs + 911
    );
    runtime.targetColumn = next.column;
    runtime.targetRow = next.row;
    vehicle.speed *= 0.35;
    return false;
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
