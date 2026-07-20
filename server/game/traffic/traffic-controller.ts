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
import {
  TrafficLaneChangeSystem,
  type TrafficLaneChangePhase,
  type TrafficLaneChangeRuntime
} from './traffic-lane-change-system.ts';
import type {TrafficLaneChangeRejectReason} from './traffic-lane-change-policy.ts';
import type {RoadClosureRegistry} from './road-closure-registry.ts';

const JUNCTION_APPROACH_DISTANCE = 112;
const JUNCTION_COMMIT_DISTANCE = 60;
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
  laneChange: TrafficLaneChangeRuntime;
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
  laneChangePhase: TrafficLaneChangePhase;
  laneChangeLeadId: string;
  laneChangeFromLane: number;
  laneChangeToLane: number;
  laneChangeAttempts: number;
  laneChangeCompletions: number;
  laneChangeRejectReason: TrafficLaneChangeRejectReason;
  laneChangeReservationKey: string;
  laneChangeTargets: Array<{x: number; y: number}>;
  emergencyYieldPhase: EmergencyYieldPhase;
  emergencyVehicleId: string;
  junctionId: string;
  junctionPhase: TrafficJunctionPhase;
  junctionQueuePosition: number;
  junctionLeaseExpiresAt: number;
  junctionMovementId: string;
  junctionMovementTurn: 'left' | 'right' | 'straight' | 'uturn';
  junctionMovementPath: Array<{x: number; y: number}>;
  junctionActiveOwnerCount: number;
  junctionConflictingOwnerCount: number;
  routeSource: TrafficRouteRuntime['source'];
  currentLaneNodeId: string;
  destinationLaneNodeId: string;
  routeRemaining: number;
  routeRevision: number;
  closureRevision?: number;
  routeComplete: boolean;
  routeVisited: number;
  routeWaypoints: Array<{x: number; y: number}>;
}

interface TrafficControllerOptions {
  world: CollisionMap;
  random: DeterministicRandom;
  laneGraph?: LaneGraph;
  closures?: RoadClosureRegistry;
}

export class TrafficController {
  private readonly runtime = new Map<string, TrafficRuntime>();
  private readonly driver: RoadDrivingSystem;
  private readonly routes: TrafficRouteSystem;
  private readonly maneuvers: TrafficManeuverSystem;
  private readonly junctions = new TrafficJunctionSystem();
  private readonly emergencyYield: EmergencyYieldSystem;
  private readonly deadlocks = new TrafficDeadlockSystem();
  private readonly laneChanges: TrafficLaneChangeSystem;

  constructor(private readonly options: TrafficControllerOptions) {
    this.driver = new RoadDrivingSystem(options.world);
    this.routes = new TrafficRouteSystem(options);
    this.maneuvers = new TrafficManeuverSystem(options.world);
    this.emergencyYield = new EmergencyYieldSystem(options.world);
    this.laneChanges = new TrafficLaneChangeSystem(options.world);
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
      laneChange: this.laneChanges.createRuntime(),
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

  captureVirtual(
    vehicle: Pick<VehicleState, 'x' | 'y' | 'angle'> & {surfaceId?: string}
  ): TrafficSpawn {
    return this.routes.captureVirtual(vehicle);
  }

  allowsSpawn(spawn: TrafficSpawn): boolean {
    return this.routes.allowsSpawn(spawn);
  }

  activeVehicleIdsOnEdges(edgeIds: readonly string[]): string[] {
    const accepted = new Set(edgeIds);
    return [...this.runtime.entries()]
      .filter(([, runtime]) => {
        const segment = this.routes.laneSegment(runtime.route);
        return Boolean(segment && accepted.has(segment.edgeId));
      })
      .map(([vehicleId]) => vehicleId)
      .sort();
  }

  laneGraph(): LaneGraph | undefined {
    return this.options.laneGraph;
  }

  release(vehicleId: string): void {
    const runtime = this.runtime.get(vehicleId);
    this.laneChanges.release(vehicleId, runtime?.laneChange);
    this.runtime.delete(vehicleId);
    this.junctions.release(vehicleId);
    this.deadlocks.release(vehicleId);
  }

  has(vehicleId: string): boolean {
    return this.runtime.has(vehicleId);
  }

  beginTick(nowMs: number): void {
    this.deadlocks.beginTick(nowMs);
    this.laneChanges.beginTick(nowMs);
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
      const laneChange = this.laneChanges.diagnostic(runtime.laneChange);
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
        laneChangePhase: laneChange.phase,
        laneChangeLeadId: laneChange.leadId,
        laneChangeFromLane: laneChange.fromLaneIndex,
        laneChangeToLane: laneChange.toLaneIndex,
        laneChangeAttempts: laneChange.attempts,
        laneChangeCompletions: laneChange.completions,
        laneChangeRejectReason: laneChange.rejectReason,
        laneChangeReservationKey: laneChange.reservationKey,
        laneChangeTargets: laneChange.targets,
        emergencyYieldPhase: runtime.emergencyYield.phase,
        emergencyVehicleId: runtime.emergencyYield.emergencyId,
        junctionId: junction.junctionId,
        junctionPhase: junction.phase,
        junctionQueuePosition: junction.queuePosition,
        junctionLeaseExpiresAt: junction.leaseExpiresAt,
        junctionMovementId: junction.movementId,
        junctionMovementTurn: junction.movementTurn,
        junctionMovementPath: junction.movementPath.map((point) => ({...point})),
        junctionActiveOwnerCount: junction.activeOwnerCount,
        junctionConflictingOwnerCount: junction.conflictingOwnerCount,
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
    runtime.route.surfaceId = vehicle.surfaceId;
    const heightAt = this.options.world.heightAt;
    if (
      typeof heightAt === 'function' &&
      heightAt.call(this.options.world, vehicle.surfaceId, vehicle.x, vehicle.y) === undefined
    ) {
      const surfaceId = this.options.world.surfaces?.surfaceIdsAt(
        vehicle.x,
        vehicle.y,
        'vehicle'
      ).find((candidate) => this.options.world.canOccupy(
        vehicle.x,
        vehicle.y,
        20,
        candidate,
        'vehicle'
      ));
      if (surfaceId) vehicle.surfaceId = surfaceId;
    }
    const collision = vehicleConfig(vehicle.kind).collision;
    const collisionHalfLength = collision.length / 2;
    const collisionHalfWidth = collision.width / 2;
    const ownedJunction = this.junctions.diagnostic(vehicle.id);
    const clearanceDistance = collisionHalfLength + JUNCTION_CLEARANCE_MARGIN +
      (ownedJunction.junctionId
        ? this.routes.junctionConflictExtent(ownedJunction.junctionId, vehicle.angle)
        : 0);
    this.junctions.maintain(vehicle.id, vehicle.x, vehicle.y, clearanceDistance, nowMs);
    if (vehicle.hijackBy) {
      this.junctions.release(vehicle.id);
      this.maneuvers.reset(runtime.maneuver);
      this.laneChanges.cancel(vehicle.id, runtime.laneChange, nowMs, false);
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
      this.laneChanges.cancel(vehicle.id, runtime.laneChange, nowMs, false);
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

    this.routes.synchronizeClosures(vehicle.id, runtime.route, nowMs);
    const routeTarget = this.routes.target(runtime.route);
    const targetX = routeTarget.x;
    const targetY = routeTarget.y;
    const laneSegment = this.routes.laneSegment(runtime.route);
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
        this.laneChanges.cancel(vehicle.id, runtime.laneChange, nowMs, false);
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
    const routeAngle = laneSegment
      ? Math.atan2(laneSegment.toY - laneSegment.fromY, laneSegment.toX - laneSegment.fromX)
      : Math.atan2(targetY - vehicle.y, targetX - vehicle.x);
    const junctionTravelExtent = junctionTarget
      ? Math.abs(Math.cos(routeAngle)) * junctionTarget.conflictHalfExtentX +
        Math.abs(Math.sin(routeAngle)) * junctionTarget.conflictHalfExtentY
      : 34;
    const junctionStopOffset = junctionTravelExtent + collisionHalfLength +
      JUNCTION_CLEARANCE_MARGIN;
    const brakeDeceleration = vehicleConfig(vehicle.kind).traffic.brakeDeceleration;
    const stoppingDistance = Math.max(0, vehicle.speed) ** 2 /
      (2 * Math.max(1, brakeDeceleration));
    const junctionApproachDistance = Math.max(
      JUNCTION_APPROACH_DISTANCE,
      junctionStopOffset + stoppingDistance + 48
    );
    const junctionBlocked = Boolean(junctionTarget) && (
      obstacles.some((obstacle) => obstacle.kind === 'signal') ||
      (runtime.route.source === 'lane-graph' && obstacles.some((obstacle) => (
          obstacle.kind !== 'signal' &&
          !this.junctions.isQueued(obstacle.id, junctionTarget!.id) &&
          Math.abs(obstacle.x - junctionTarget!.x) <=
            junctionTarget!.conflictHalfExtentX + obstacle.radius &&
          Math.abs(obstacle.y - junctionTarget!.y) <=
            junctionTarget!.conflictHalfExtentY + obstacle.radius
        )))
    );
    const existingJunction = this.junctions.diagnostic(vehicle.id);
    const committedApproach = existingJunction.phase === 'approach' &&
      existingJunction.junctionId === junctionKey &&
      junctionDistance <= JUNCTION_COMMIT_DISTANCE;
    const junctionMovement = junctionTarget
      ? this.routes.junctionMovement(runtime.route, collisionHalfWidth)
      : undefined;
    const junctionGranted = !junctionKey || junctionDistance > junctionApproachDistance ||
      this.junctions.request(
        vehicle.id,
        junctionKey,
        nowMs,
        junctionBlocked && !committedApproach,
        junctionMovement
      );
    const stopPoint = junctionStopPoint(
      vehicle,
      targetX,
      targetY,
      junctionStopOffset,
      laneSegment
    );
    if (
      junctionKey &&
      !junctionGranted &&
      reachedJunctionStopLine(vehicle, stopPoint, targetX, targetY)
    ) {
      this.maneuvers.reset(runtime.maneuver);
      this.laneChanges.cancel(vehicle.id, runtime.laneChange, nowMs, false);
      this.driver.brake(vehicle, deltaSeconds, brakeDeceleration);
      runtime.desiredSpeed = 0;
      runtime.speedReason = 'signal';
      runtime.obstacleId = `junction:${junctionKey}`;
      runtime.obstacleDistance = 0;
      runtime.timeToContactSeconds = -1;
      return false;
    }
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
    const protectedJunctionApproach = Boolean(junctionTarget) &&
      junctionDistance <= junctionApproachDistance + 80;
    const compatibleOwnerIds = currentJunction.phase !== 'none' &&
      currentJunction.phase !== 'waiting'
      ? this.junctions.compatibleOwnerIds(vehicle.id, currentJunction.junctionId)
      : undefined;
    const laneChangePhaseBefore = runtime.laneChange.phase;
    const laneChange = this.laneChanges.command({
      vehicle,
      runtime: runtime.laneChange,
      segment: laneSegment,
      obstacles: routedObstacles,
      speedReason: runtime.speedReason,
      obstacleId: runtime.obstacleId,
      desiredSpeed: runtime.desiredSpeed,
      cruiseSpeed: routeCruiseSpeed,
      protectedJunction: junctionTraversal || protectedJunctionApproach,
      nowMs
    });
    const activeLaneChange = laneChange.phase !== 'none' && laneChange.phase !== 'requesting';
    if (activeLaneChange) {
      this.junctions.release(vehicle.id);
      this.maneuvers.reset(runtime.maneuver);
      const result = this.driver.update(vehicle, {
        targetX: laneChange.targetX!,
        targetY: laneChange.targetY!,
        cruiseSpeed: Math.min(routeCruiseSpeed, 96),
        deltaSeconds,
        obstacles: routedObstacles,
        ignoredObstacleIds: laneChange.ignoredObstacleIds,
        minimumGapScale: 0.8
      });
      runtime.desiredSpeed = result.desiredSpeed;
      runtime.speedReason = result.blocked ? 'blocked' : result.speedReason;
      runtime.obstacleId = result.obstacleId;
      runtime.obstacleDistance = result.obstacleDistance;
      runtime.timeToContactSeconds = result.timeToContactSeconds;
      return result.moved;
    }

    let maneuver: TrafficManeuverCommand;
    const authoredLaneQueue = laneSegment && laneSegment.laneCount > 1 &&
      runtime.speedReason === 'vehicle';
    if (
      junctionTraversal ||
      protectedJunctionApproach ||
      laneChange.phase === 'requesting' ||
      laneChangePhaseBefore !== 'none' ||
      authoredLaneQueue
    ) {
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
      ignoredObstacleIds: combineIds(maneuver.ignoredObstacleIds, compatibleOwnerIds),
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
  targetY: number,
  stopLineOffset = JUNCTION_STOP_LINE_OFFSET,
  laneSegment?: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  }
): {x: number; y: number} {
  const originX = laneSegment?.fromX ?? vehicle.x;
  const originY = laneSegment?.fromY ?? vehicle.y;
  const deltaX = targetX - originX;
  const deltaY = targetY - originY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= 0.001) return {x: targetX, y: targetY};
  return {
    x: targetX - deltaX / distance * stopLineOffset,
    y: targetY - deltaY / distance * stopLineOffset
  };
}

function reachedJunctionStopLine(
  vehicle: Pick<VehicleState, 'x' | 'y'>,
  stopPoint: {x: number; y: number},
  targetX: number,
  targetY: number
): boolean {
  const deltaX = targetX - stopPoint.x;
  const deltaY = targetY - stopPoint.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= 0.001) return Math.hypot(vehicle.x - stopPoint.x, vehicle.y - stopPoint.y) <= 8;
  return (
    (vehicle.x - stopPoint.x) * deltaX / distance +
    (vehicle.y - stopPoint.y) * deltaY / distance
  ) >= -2;
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
