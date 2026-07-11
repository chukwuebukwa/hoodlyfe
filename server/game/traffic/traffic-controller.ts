import type {VehicleState} from '../../state.ts';
import type {CollisionMap, RoadNode, TrafficSpawn} from '../../world-map.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {TrafficObstacle, TrafficSpeedReason} from './traffic-awareness-system.ts';
import {RoadDrivingSystem} from './road-driving-system.ts';
import {TrafficJunctionSystem} from './traffic-junction-system.ts';
import {
  TrafficManeuverSystem,
  type TrafficManeuverPhase,
  type TrafficManeuverRuntime
} from './traffic-maneuver-system.ts';

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
  reversingUntil: number;
  recoveryCount: number;
  maneuver: TrafficManeuverRuntime;
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
  maneuverPhase: TrafficManeuverPhase;
  maneuverAttempts: number;
}

interface TrafficControllerOptions {
  world: CollisionMap;
  random: DeterministicRandom;
}

export class TrafficController {
  private readonly runtime = new Map<string, TrafficRuntime>();
  private readonly driver: RoadDrivingSystem;
  private readonly maneuvers: TrafficManeuverSystem;
  private readonly junctions = new TrafficJunctionSystem();

  constructor(private readonly options: TrafficControllerOptions) {
    this.driver = new RoadDrivingSystem(options.world);
    this.maneuvers = new TrafficManeuverSystem(options.world);
  }

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
      reversingUntil: 0,
      recoveryCount: 0,
      maneuver: this.maneuvers.createRuntime()
    });
  }

  release(vehicleId: string): void {
    this.runtime.delete(vehicleId);
    this.junctions.release(vehicleId);
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
      recoveryCount: runtime.recoveryCount,
      maneuverPhase: runtime.maneuver.phase,
      maneuverAttempts: runtime.maneuver.attempts
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
    if (vehicle.hijackBy) {
      this.maneuvers.reset(runtime.maneuver);
      this.driver.brake(vehicle, deltaSeconds);
      runtime.desiredSpeed = 0;
      runtime.speedReason = 'hijack';
      runtime.obstacleId = '';
      runtime.obstacleDistance = -1;
      return false;
    }

    const {world} = this.options;
    const routeTarget = this.routeTarget(runtime);
    const targetX = routeTarget.x;
    const targetY = routeTarget.y;
    const obstacles = context.obstacles ?? [];
    const junctionKey = this.junctionKey(runtime.targetColumn, runtime.targetRow);
    const junctionDistance = Math.hypot(targetX - vehicle.x, targetY - vehicle.y);
    const junctionGranted = !junctionKey || junctionDistance > 150 ||
      this.junctions.request(vehicle.id, junctionKey, nowMs);
    const routedObstacles = junctionGranted ? obstacles : [...obstacles, {
      id: `junction:${junctionKey}`,
      kind: 'signal' as const,
      x: targetX,
      y: targetY,
      radius: 8,
      speed: 0
    }];
    const maneuver = this.maneuvers.command({
      vehicle,
      runtime: runtime.maneuver,
      routeTargetX: targetX,
      routeTargetY: targetY,
      obstacles: routedObstacles,
      speedReason: runtime.speedReason,
      obstacleId: runtime.obstacleId,
      desiredSpeed: runtime.desiredSpeed,
      nowMs
    });
    if (maneuver.reverse) {
      const moved = this.driver.reverse(vehicle, deltaSeconds);
      runtime.desiredSpeed = -48;
      runtime.speedReason = 'blocked';
      return moved;
    }
    const result = this.driver.update(vehicle, {
      targetX: maneuver.targetX ?? targetX,
      targetY: maneuver.targetY ?? targetY,
      cruiseSpeed: runtime.cruiseSpeed,
      deltaSeconds,
      obstacles: routedObstacles,
      ignoredObstacleIds: maneuver.ignoredObstacleIds,
      minimumGapScale: maneuver.phase === 'none' ? 1 : 0.75
    });
    runtime.desiredSpeed = result.desiredSpeed;
    runtime.speedReason = result.speedReason;
    runtime.obstacleId = result.obstacleId;
    runtime.obstacleDistance = result.obstacleDistance;

    if (maneuver.phase !== 'none') {
      if (result.blocked) runtime.speedReason = 'blocked';
      return result.moved;
    }

    if (result.reached && maneuver.phase === 'none') {
      if (junctionKey) this.junctions.release(vehicle.id, junctionKey);
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

    if (!result.blocked) {
      runtime.blockedSince = 0;
      runtime.reversingUntil = 0;
      return result.moved;
    }

    if (runtime.blockedSince === 0) runtime.blockedSince = nowMs;
    runtime.desiredSpeed = 0;
    runtime.speedReason = 'blocked';
    runtime.obstacleId = '';
    runtime.obstacleDistance = 0;
    const currentColumn = Math.floor(vehicle.x / world.tileWidth);
    const currentRow = Math.floor(vehicle.y / world.tileHeight);
    if (nowMs - runtime.blockedSince >= 1200 && runtime.reversingUntil === 0) {
      runtime.reversingUntil = nowMs + 650;
    }
    if (nowMs < runtime.reversingUntil) {
      return this.driver.reverse(vehicle, deltaSeconds);
    }
    if (runtime.reversingUntil > 0) {
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
      runtime.reversingUntil = 0;
      runtime.recoveryCount++;
    }
    return false;
  }

  private routeTarget(runtime: TrafficRuntime): {x: number; y: number} {
    const centerX = (runtime.targetColumn + 0.5) * this.options.world.tileWidth;
    const centerY = (runtime.targetRow + 0.5) * this.options.world.tileHeight;
    const deltaColumn = runtime.targetColumn - runtime.previousColumn;
    const deltaRow = runtime.targetRow - runtime.previousRow;
    const magnitude = Math.hypot(deltaColumn, deltaRow);
    if (magnitude === 0) return {x: centerX, y: centerY};
    const laneX = centerX - deltaRow / magnitude * TRAFFIC_LANE_OFFSET;
    const laneY = centerY + deltaColumn / magnitude * TRAFFIC_LANE_OFFSET;
    return this.options.world.canOccupy(laneX, laneY, 20) && this.options.world.isRoadAt(laneX, laneY)
      ? {x: laneX, y: laneY}
      : {x: centerX, y: centerY};
  }

  private junctionKey(column: number, row: number): string {
    return this.options.world.roadNeighbors(column, row).length >= 3 ? `${column},${row}` : '';
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

export const TRAFFIC_LANE_OFFSET = 14;

export function trafficLanePoint(spawn: TrafficSpawn): {x: number; y: number} {
  const deltaColumn = spawn.targetColumn - spawn.column;
  const deltaRow = spawn.targetRow - spawn.row;
  const magnitude = Math.hypot(deltaColumn, deltaRow);
  if (magnitude === 0) return {x: spawn.x, y: spawn.y};
  return {
    x: spawn.x - deltaRow / magnitude * TRAFFIC_LANE_OFFSET,
    y: spawn.y + deltaColumn / magnitude * TRAFFIC_LANE_OFFSET
  };
}
