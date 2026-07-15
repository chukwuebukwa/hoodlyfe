import type {VehicleState} from '../../state.ts';
import type {CollisionMap, TrafficSpawn} from '../../world-map.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {LaneGraph} from './lane-graph.ts';
import type {TrafficObstacle, TrafficSpeedReason} from './traffic-awareness-system.ts';
import {RoadDrivingSystem} from './road-driving-system.ts';
import {TrafficJunctionSystem} from './traffic-junction-system.ts';
import {
  TRAFFIC_LANE_OFFSET,
  TrafficRouteSystem,
  type TrafficRouteRuntime
} from './traffic-route-system.ts';
import {
  TrafficManeuverSystem,
  type TrafficManeuverPhase,
  type TrafficManeuverRuntime
} from './traffic-maneuver-system.ts';
import {
  EmergencyYieldSystem,
  type EmergencyVehicleSnapshot,
  type EmergencyYieldPhase,
  type EmergencyYieldRuntime
} from './emergency-yield-system.ts';

interface TrafficRuntime {
  mission: 'cruise-route';
  drivingStyle: 'lawful';
  route: TrafficRouteRuntime;
  cruiseSpeed: number;
  desiredSpeed: number;
  speedReason: TrafficSpeedReason | 'blocked' | 'hijack';
  obstacleId: string;
  obstacleDistance: number;
  blockedSince: number;
  reversingUntil: number;
  recoveryCount: number;
  maneuver: TrafficManeuverRuntime;
  emergencyYield: EmergencyYieldRuntime;
}

export interface TrafficUpdateContext {
  obstacles?: readonly TrafficObstacle[];
  emergencyVehicles?: readonly EmergencyVehicleSnapshot[];
}

export interface TrafficDiagnostic {
  vehicleId: string;
  mission: TrafficRuntime['mission'];
  drivingStyle: TrafficRuntime['drivingStyle'];
  cruiseSpeed: number;
  desiredSpeed: number;
  speedReason: TrafficRuntime['speedReason'];
  obstacleId: string;
  obstacleDistance: number;
  blockedSince: number;
  recoveryCount: number;
  maneuverPhase: TrafficManeuverPhase;
  maneuverAttempts: number;
  emergencyYieldPhase: EmergencyYieldPhase;
  emergencyVehicleId: string;
  routeSource: TrafficRouteRuntime['source'];
  currentLaneNodeId: string;
  destinationLaneNodeId: string;
  routeRemaining: number;
  routeRevision: number;
  routeComplete: boolean;
  routeVisited: number;
  routeWaypoints: Array<{x: number; y: number}>;
}

interface TrafficControllerOptions {
  world: CollisionMap;
  random: DeterministicRandom;
  laneGraph?: LaneGraph;
}

export class TrafficController {
  private readonly runtime = new Map<string, TrafficRuntime>();
  private readonly driver: RoadDrivingSystem;
  private readonly routes: TrafficRouteSystem;
  private readonly maneuvers: TrafficManeuverSystem;
  private readonly junctions = new TrafficJunctionSystem();
  private readonly emergencyYield: EmergencyYieldSystem;

  constructor(private readonly options: TrafficControllerOptions) {
    this.driver = new RoadDrivingSystem(options.world);
    this.routes = new TrafficRouteSystem(options);
    this.maneuvers = new TrafficManeuverSystem(options.world);
    this.emergencyYield = new EmergencyYieldSystem(options.world);
  }

  register(vehicleId: string, spawn: TrafficSpawn, cruiseSpeed: number): void {
    const runtime: TrafficRuntime = {
      mission: 'cruise-route',
      drivingStyle: 'lawful',
      route: this.routes.create(vehicleId, spawn),
      cruiseSpeed,
      desiredSpeed: cruiseSpeed,
      speedReason: 'cruise',
      obstacleId: '',
      obstacleDistance: -1,
      blockedSince: 0,
      reversingUntil: 0,
      recoveryCount: 0,
      maneuver: this.maneuvers.createRuntime(),
      emergencyYield: this.emergencyYield.createRuntime()
    };
    this.runtime.set(vehicleId, runtime);
  }

  spawn(index: number, radius: number): TrafficSpawn {
    return this.routes.spawn(index, radius);
  }

  advanceVirtual(spawn: TrafficSpawn, seed: number): TrafficSpawn {
    return this.routes.advanceVirtual(spawn, seed);
  }

  captureVirtual(vehicle: Pick<VehicleState, 'x' | 'y' | 'angle'>): TrafficSpawn {
    return this.routes.captureVirtual(vehicle);
  }

  laneGraph(): LaneGraph | undefined {
    return this.options.laneGraph;
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
      mission: runtime.mission,
      drivingStyle: runtime.drivingStyle,
      cruiseSpeed: runtime.cruiseSpeed,
      desiredSpeed: runtime.desiredSpeed,
      speedReason: runtime.speedReason,
      obstacleId: runtime.obstacleId,
      obstacleDistance: runtime.obstacleDistance,
      blockedSince: runtime.blockedSince,
      recoveryCount: runtime.recoveryCount,
      maneuverPhase: runtime.maneuver.phase,
      maneuverAttempts: runtime.maneuver.attempts,
      emergencyYieldPhase: runtime.emergencyYield.phase,
      emergencyVehicleId: runtime.emergencyYield.emergencyId,
      ...this.routes.diagnostic(runtime.route)
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
      this.emergencyYield.reset(runtime.emergencyYield);
      this.driver.brake(vehicle, deltaSeconds);
      runtime.desiredSpeed = 0;
      runtime.speedReason = 'hijack';
      runtime.obstacleId = '';
      runtime.obstacleDistance = -1;
      return false;
    }

    const routeTarget = this.routes.target(runtime.route);
    const targetX = routeTarget.x;
    const targetY = routeTarget.y;
    const routeCruiseSpeed = this.routes.cruiseSpeed(runtime.route, runtime.cruiseSpeed);
    const obstacles = context.obstacles ?? [];
    const yieldCommand = this.emergencyYield.command(
      vehicle,
      runtime.emergencyYield,
      context.emergencyVehicles ?? [],
      nowMs
    );
    if (yieldCommand.phase !== 'none') {
      this.maneuvers.reset(runtime.maneuver);
      if (yieldCommand.phase === 'wait') {
        this.driver.brake(vehicle, deltaSeconds);
        runtime.desiredSpeed = 0;
        runtime.speedReason = 'siren';
        runtime.obstacleId = yieldCommand.emergencyId;
        const emergency = context.emergencyVehicles?.find(({id}) => id === yieldCommand.emergencyId);
        runtime.obstacleDistance = emergency
          ? Math.hypot(vehicle.x - emergency.x, vehicle.y - emergency.y)
          : -1;
        return false;
      }
      const result = this.driver.update(vehicle, {
        targetX: yieldCommand.targetX!,
        targetY: yieldCommand.targetY!,
        cruiseSpeed: Math.min(runtime.cruiseSpeed, yieldCommand.maximumSpeed ?? 72),
        deltaSeconds,
        obstacles,
        ignoredObstacleIds: new Set([yieldCommand.emergencyId]),
        minimumGapScale: 0.75
      });
      runtime.desiredSpeed = result.desiredSpeed;
      runtime.speedReason = 'siren';
      runtime.obstacleId = yieldCommand.emergencyId;
      runtime.obstacleDistance = result.obstacleDistance;
      return result.moved;
    }
    const junctionKey = this.routes.junctionKey(runtime.route);
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
      cruiseSpeed: routeCruiseSpeed,
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
      vehicle.x = targetX;
      vehicle.y = targetY;
      this.routes.advance(vehicle.id, runtime.route, nowMs);
      const nextJunctionKey = this.routes.junctionKey(runtime.route);
      if (junctionKey && junctionKey !== nextJunctionKey) {
        this.junctions.release(vehicle.id, junctionKey);
      }
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
    if (nowMs - runtime.blockedSince >= 1200 && runtime.reversingUntil === 0) {
      runtime.reversingUntil = nowMs + 650;
    }
    if (nowMs < runtime.reversingUntil) {
      return this.driver.reverse(vehicle, deltaSeconds);
    }
    if (runtime.reversingUntil > 0) {
      if (this.routes.recover(
        vehicle,
        runtime.route,
        nowMs + 911 + runtime.recoveryCount * 97
      )) {
        runtime.blockedSince = nowMs;
        runtime.reversingUntil = 0;
        runtime.recoveryCount++;
        return false;
      }
      runtime.blockedSince = nowMs;
      runtime.reversingUntil = 0;
      runtime.recoveryCount++;
    }
    return false;
  }

}

export {TRAFFIC_LANE_OFFSET};

export function trafficLanePoint(spawn: TrafficSpawn): {x: number; y: number} {
  if (spawn.laneEdgeId) return {x: spawn.x, y: spawn.y};
  const deltaColumn = spawn.targetColumn - spawn.column;
  const deltaRow = spawn.targetRow - spawn.row;
  const magnitude = Math.hypot(deltaColumn, deltaRow);
  if (magnitude === 0) return {x: spawn.x, y: spawn.y};
  return {
    x: spawn.x - deltaRow / magnitude * TRAFFIC_LANE_OFFSET,
    y: spawn.y + deltaColumn / magnitude * TRAFFIC_LANE_OFFSET
  };
}
