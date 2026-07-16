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
  type TrafficManeuverCommand,
  type TrafficManeuverPhase,
  type TrafficManeuverRuntime
} from './traffic-maneuver-system.ts';
import {
  EmergencyYieldSystem,
  type EmergencyVehicleSnapshot,
  type EmergencyYieldPhase,
  type EmergencyYieldRuntime
} from './emergency-yield-system.ts';
import {vehicleConfig} from '../vehicles/vehicle-config.ts';
import type {TrafficJunctionPhase} from './traffic-junction-system.ts';
import {TrafficDeadlockSystem} from './traffic-deadlock-system.ts';

const JUNCTION_APPROACH_DISTANCE = 112;
const JUNCTION_COMMIT_DISTANCE = 60;
const JUNCTION_CONFLICT_RADIUS = 34;
const JUNCTION_CLEARANCE_MARGIN = 12;
const JUNCTION_STOP_LINE_OFFSET = 34;

interface TrafficRuntime {
  mission: 'cruise-route';
  drivingStyle: 'lawful';
  route: TrafficRouteRuntime;
  cruiseSpeed: number;
  desiredSpeed: number;
  speedReason: TrafficSpeedReason | 'blocked' | 'hijack';
  obstacleId: string;
  obstacleDistance: number;
  timeToContactSeconds: number;
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
  timeToContactSeconds: number;
  blockedSince: number;
  recoveryCount: number;
  deadlockCycleId: string;
  deadlockCycleSize: number;
  deadlockRecovering: boolean;
  deadlockRecoveryCount: number;
  maneuverPhase: TrafficManeuverPhase;
  maneuverAttempts: number;
  emergencyYieldPhase: EmergencyYieldPhase;
  emergencyVehicleId: string;
  junctionId: string;
  junctionPhase: TrafficJunctionPhase;
  junctionQueuePosition: number;
  junctionLeaseExpiresAt: number;
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
  private readonly deadlocks = new TrafficDeadlockSystem();

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
      timeToContactSeconds: -1,
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
    this.deadlocks.release(vehicleId);
  }

  has(vehicleId: string): boolean {
    return this.runtime.has(vehicleId);
  }

  beginTick(nowMs: number): void {
    this.deadlocks.beginTick(nowMs);
  }

  observe(vehicle: VehicleState, nowMs: number, obstacles: readonly TrafficObstacle[]): void {
    const runtime = this.runtime.get(vehicle.id);
    if (!runtime) return;
    this.deadlocks.observe({
      vehicleId: vehicle.id,
      obstacleId: runtime.obstacleId,
      speedReason: runtime.speedReason,
      speed: vehicle.speed,
      junctionPhase: this.junctions.diagnostic(vehicle.id).phase,
      canReverse: this.hasReverseClearance(vehicle, obstacles),
      observedAt: nowMs
    });
  }

  diagnostics(): TrafficDiagnostic[] {
    return [...this.runtime.entries()].map(([vehicleId, runtime]) => {
      const junction = this.junctions.diagnostic(vehicleId);
      const deadlock = this.deadlocks.diagnostic(vehicleId);
      return {
        vehicleId,
        mission: runtime.mission,
        drivingStyle: runtime.drivingStyle,
        cruiseSpeed: runtime.cruiseSpeed,
        desiredSpeed: runtime.desiredSpeed,
        speedReason: runtime.speedReason,
        obstacleId: runtime.obstacleId,
        obstacleDistance: runtime.obstacleDistance,
        timeToContactSeconds: runtime.timeToContactSeconds,
        blockedSince: runtime.blockedSince,
        recoveryCount: runtime.recoveryCount,
        deadlockCycleId: deadlock.cycleId,
        deadlockCycleSize: deadlock.cycleSize,
        deadlockRecovering: deadlock.recovering,
        deadlockRecoveryCount: deadlock.recoveryCount,
        maneuverPhase: runtime.maneuver.phase,
        maneuverAttempts: runtime.maneuver.attempts,
        emergencyYieldPhase: runtime.emergencyYield.phase,
        emergencyVehicleId: runtime.emergencyYield.emergencyId,
        junctionId: junction.junctionId,
        junctionPhase: junction.phase,
        junctionQueuePosition: junction.queuePosition,
        junctionLeaseExpiresAt: junction.leaseExpiresAt,
        ...this.routes.diagnostic(runtime.route)
      };
    }).sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
  }

  update(
    vehicle: VehicleState,
    deltaSeconds: number,
    nowMs: number,
    context: TrafficUpdateContext = {}
  ): boolean {
    const runtime = this.runtime.get(vehicle.id);
    if (!runtime) return false;
    const clearanceDistance = vehicleConfig(vehicle.kind).collision.length / 2 + JUNCTION_CLEARANCE_MARGIN;
    this.junctions.maintain(vehicle.id, vehicle.x, vehicle.y, clearanceDistance, nowMs);
    if (vehicle.hijackBy) {
      this.junctions.release(vehicle.id);
      this.maneuvers.reset(runtime.maneuver);
      this.emergencyYield.reset(runtime.emergencyYield);
      this.driver.brake(vehicle, deltaSeconds);
      runtime.desiredSpeed = 0;
      runtime.speedReason = 'hijack';
      runtime.obstacleId = '';
      runtime.obstacleDistance = -1;
      runtime.timeToContactSeconds = -1;
      return false;
    }

    const deadlockRecovery = this.deadlocks.command(vehicle.id, nowMs);
    if (deadlockRecovery) {
      this.junctions.release(vehicle.id);
      this.maneuvers.reset(runtime.maneuver);
      this.emergencyYield.reset(runtime.emergencyYield);
      const moved = this.driver.reverse(vehicle, deltaSeconds);
      runtime.desiredSpeed = -42;
      runtime.speedReason = 'blocked';
      runtime.obstacleId = deadlockRecovery.blockerId;
      runtime.obstacleDistance = 0;
      runtime.timeToContactSeconds = -1;
      runtime.blockedSince = runtime.blockedSince || nowMs;
      return moved;
    }

    const routeTarget = this.routes.target(runtime.route);
    const targetX = routeTarget.x;
    const targetY = routeTarget.y;
    const routeCruiseSpeed = this.routes.cruiseSpeed(runtime.route, runtime.cruiseSpeed);
    const obstacles = context.obstacles ?? [];
    const activeJunction = this.junctions.diagnostic(vehicle.id);
    const protectedJunction = isProtectedJunctionPhase(activeJunction.phase);
    if (protectedJunction) {
      this.emergencyYield.reset(runtime.emergencyYield);
    } else {
      const yieldCommand = this.emergencyYield.command(
        vehicle,
        runtime.emergencyYield,
        context.emergencyVehicles ?? [],
        nowMs
      );
      if (yieldCommand.phase !== 'none') {
        this.junctions.release(vehicle.id);
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
          runtime.timeToContactSeconds = -1;
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
        runtime.timeToContactSeconds = -1;
        return result.moved;
      }
    }
    const junctionTarget = this.routes.junctionTarget(runtime.route);
    const junctionKey = junctionTarget?.id ?? '';
    const junctionDistance = Math.hypot(targetX - vehicle.x, targetY - vehicle.y);
    const junctionBlocked = Boolean(junctionTarget) && (
      obstacles.some((obstacle) => obstacle.kind === 'signal') ||
      (runtime.route.source === 'lane-graph' && obstacles.some((obstacle) => (
          obstacle.kind !== 'signal' &&
          !this.junctions.isQueued(obstacle.id, junctionTarget!.id) &&
          Math.hypot(obstacle.x - junctionTarget!.x, obstacle.y - junctionTarget!.y) <=
            JUNCTION_CONFLICT_RADIUS + obstacle.radius
        )))
    );
    const existingJunction = this.junctions.diagnostic(vehicle.id);
    const committedApproach = existingJunction.phase === 'approach' &&
      existingJunction.junctionId === junctionKey &&
      junctionDistance <= JUNCTION_COMMIT_DISTANCE;
    const junctionGranted = !junctionKey || junctionDistance > JUNCTION_APPROACH_DISTANCE ||
      this.junctions.request(vehicle.id, junctionKey, nowMs, junctionBlocked && !committedApproach);
    const stopPoint = junctionStopPoint(vehicle, targetX, targetY);
    const routedObstacles = junctionGranted ? obstacles : [...obstacles, {
      id: `junction:${junctionKey}`,
      kind: 'signal' as const,
      x: stopPoint.x,
      y: stopPoint.y,
      radius: 8,
      speed: 0
    }];
    const currentJunction = this.junctions.diagnostic(vehicle.id);
    const junctionTraversal = isProtectedJunctionPhase(currentJunction.phase);
    const admittedQueueIds = currentJunction.phase !== 'none' && currentJunction.phase !== 'waiting'
      ? new Set(obstacles.filter((obstacle) => (
        obstacle.kind === 'vehicle' && this.junctions.isQueued(obstacle.id, currentJunction.junctionId)
      )).map((obstacle) => obstacle.id))
      : undefined;
    let maneuver: TrafficManeuverCommand;
    if (junctionTraversal) {
      this.maneuvers.reset(runtime.maneuver);
      maneuver = {phase: 'none'};
    } else {
      maneuver = this.maneuvers.command({
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
    }
    if (maneuver.reverse) {
      const moved = this.driver.reverse(vehicle, deltaSeconds);
      runtime.desiredSpeed = -48;
      runtime.speedReason = 'blocked';
      runtime.timeToContactSeconds = -1;
      return moved;
    }
    const result = this.driver.update(vehicle, {
      targetX: maneuver.targetX ?? targetX,
      targetY: maneuver.targetY ?? targetY,
      cruiseSpeed: routeCruiseSpeed,
      deltaSeconds,
      obstacles: routedObstacles,
      ignoredObstacleIds: combineIds(maneuver.ignoredObstacleIds, admittedQueueIds),
      minimumGapScale: maneuver.phase === 'none' ? 1 : 0.75
    });
    runtime.desiredSpeed = result.desiredSpeed;
    runtime.speedReason = result.speedReason;
    runtime.obstacleId = result.obstacleId;
    runtime.obstacleDistance = result.obstacleDistance;
    runtime.timeToContactSeconds = result.timeToContactSeconds;

    if (maneuver.phase !== 'none') {
      if (result.blocked) runtime.speedReason = 'blocked';
      return result.moved;
    }

    if (result.reached && maneuver.phase === 'none') {
      vehicle.x = targetX;
      vehicle.y = targetY;
      this.routes.advance(vehicle.id, runtime.route, nowMs);
      const nextJunctionKey = this.routes.junctionKey(runtime.route);
      if (junctionKey && junctionKey === nextJunctionKey) {
        this.junctions.markCrossing(vehicle.id, junctionKey, nowMs);
      } else if (junctionKey) {
        this.junctions.markClearing(vehicle.id, junctionKey, targetX, targetY, nowMs);
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
    runtime.timeToContactSeconds = -1;
    if (isProtectedJunctionPhase(this.junctions.diagnostic(vehicle.id).phase)) {
      return false;
    }
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
        this.junctions.release(vehicle.id);
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

  private hasReverseClearance(
    vehicle: VehicleState,
    obstacles: readonly TrafficObstacle[]
  ): boolean {
    const collision = vehicleConfig(vehicle.kind).collision;
    const reverseX = -Math.cos(vehicle.angle);
    const reverseY = -Math.sin(vehicle.angle);
    const reverseDistance = 48;
    const occupancyRadius = Math.max(12, collision.width / 2);
    for (const distance of [16, 32, reverseDistance]) {
      const x = vehicle.x + reverseX * distance;
      const y = vehicle.y + reverseY * distance;
      if (!this.options.world.canOccupy(x, y, occupancyRadius) || !this.options.world.isRoadAt(x, y)) {
        return false;
      }
    }
    for (const obstacle of obstacles) {
      if (obstacle.kind === 'signal') continue;
      const deltaX = obstacle.x - vehicle.x;
      const deltaY = obstacle.y - vehicle.y;
      const longitudinal = deltaX * reverseX + deltaY * reverseY;
      const lateral = Math.abs(deltaX * -reverseY + deltaY * reverseX);
      const obstacleHalfLength = obstacle.halfLength ?? obstacle.radius;
      const obstacleHalfWidth = obstacle.halfWidth ?? obstacle.radius;
      if (longitudinal < -obstacleHalfLength) continue;
      if (longitudinal > collision.length / 2 + reverseDistance + obstacleHalfLength) continue;
      if (lateral < collision.width / 2 + obstacleHalfWidth + 6) return false;
    }
    return true;
  }

}

function isProtectedJunctionPhase(phase: TrafficJunctionPhase): boolean {
  return phase === 'crossing' || phase === 'clearing';
}

function junctionStopPoint(
  vehicle: Pick<VehicleState, 'x' | 'y'>,
  targetX: number,
  targetY: number
): {x: number; y: number} {
  const deltaX = targetX - vehicle.x;
  const deltaY = targetY - vehicle.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= JUNCTION_STOP_LINE_OFFSET) return {x: targetX, y: targetY};
  return {
    x: targetX - deltaX / distance * JUNCTION_STOP_LINE_OFFSET,
    y: targetY - deltaY / distance * JUNCTION_STOP_LINE_OFFSET
  };
}

function combineIds(
  first: ReadonlySet<string> | undefined,
  second: ReadonlySet<string> | undefined
): ReadonlySet<string> | undefined {
  if (!first?.size) return second;
  if (!second?.size) return first;
  return new Set([...first, ...second]);
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
