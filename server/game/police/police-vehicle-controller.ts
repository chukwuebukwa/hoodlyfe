import type {VehicleState} from '../../state.ts';
import type {CollisionMap, RoadNode} from '../../world-map.ts';
import type {TrafficObstacle, TrafficSpeedReason} from '../traffic/traffic-awareness-system.ts';
import {RoadDrivingSystem} from '../traffic/road-driving-system.ts';
import {RoadRoutePlanner} from '../traffic/road-route-planner.ts';
import type {PoliceVehicleTargetSnapshot} from './crime-response-controller.ts';
import {
  DIRECT_PURSUIT_DISTANCE,
  policeVehicleSpeed,
  policeVehicleStrategy,
  predictPoliceDestination,
  type PoliceVehicleStrategy
} from './police-vehicle-policy.ts';
import {PursuitMemory} from './pursuit-memory.ts';

interface PoliceVehicleRuntime {
  suspectId: string;
  reportAt: number;
  strategy: PoliceVehicleStrategy;
  canSeeTarget: boolean;
  route: RoadNode[];
  waypointIndex: number;
  routeComplete: boolean;
  routeVisited: number;
  nextReplanAt: number;
  plannedX: number;
  plannedY: number;
  blockedSince: number;
  desiredSpeed: number;
  speedReason: TrafficSpeedReason | 'blocked' | 'idle' | 'hijack';
  obstacleId: string;
}

export interface PoliceVehicleDiagnostic {
  vehicleId: string;
  suspectId: string;
  strategy: PoliceVehicleStrategy;
  canSeeTarget: boolean;
  lastKnownX: number;
  lastKnownY: number;
  desiredSpeed: number;
  speedReason: PoliceVehicleRuntime['speedReason'];
  obstacleId: string;
  routeComplete: boolean;
  routeVisited: number;
  waypointIndex: number;
  waypoints: Array<{x: number; y: number}>;
}

interface PoliceVehicleControllerOptions {
  world: CollisionMap;
  targetFor: (vehicleId: string) => PoliceVehicleTargetSnapshot | undefined;
  forgetTarget: (
    vehicleId: string,
    suspectId: string,
    reportedAt: number,
    nowMs: number
  ) => void;
}

const VEHICLE_RADIUS = 20;
const REPLAN_INTERVAL_MS = 650;
const SEARCH_ARRIVAL_RADIUS = 42;

export class PoliceVehicleController {
  private readonly runtimes = new Map<string, PoliceVehicleRuntime>();
  private readonly memory = new PursuitMemory(9000);
  private readonly planner: RoadRoutePlanner;
  private readonly driver: RoadDrivingSystem;

  constructor(private readonly options: PoliceVehicleControllerOptions) {
    this.planner = new RoadRoutePlanner(options.world);
    this.driver = new RoadDrivingSystem(options.world);
  }

  register(vehicleId: string): void {
    if (this.runtimes.has(vehicleId)) return;
    this.runtimes.set(vehicleId, createRuntime());
  }

  release(vehicleId: string): void {
    this.runtimes.delete(vehicleId);
    this.memory.clearOfficer(vehicleId);
  }

  has(vehicleId: string): boolean {
    return this.runtimes.has(vehicleId);
  }

  update(
    vehicle: VehicleState,
    deltaSeconds: number,
    nowMs: number,
    obstacles: readonly TrafficObstacle[] = []
  ): boolean {
    const runtime = this.runtimes.get(vehicle.id);
    if (!runtime) return false;
    if (vehicle.hijackBy) {
      vehicle.siren = false;
      this.driver.brake(vehicle, deltaSeconds);
      runtime.strategy = 'hijack';
      runtime.speedReason = 'hijack';
      runtime.desiredSpeed = 0;
      runtime.obstacleId = '';
      return false;
    }

    const target = this.options.targetFor(vehicle.id);
    if (!target) {
      this.clearAssignment(vehicle.id, runtime);
      this.idle(vehicle, runtime, deltaSeconds);
      return false;
    }
    if (runtime.suspectId !== target.suspectId || runtime.reportAt !== target.reportedAt) {
      this.assign(vehicle.id, runtime, target, nowMs);
    }

    const distance = Math.hypot(target.currentX - vehicle.x, target.currentY - vehicle.y);
    const canSeeTarget = distance <= 760 && this.options.world.hasLineOfSight(
      vehicle.x,
      vehicle.y,
      target.currentX,
      target.currentY
    );
    const pursuit = canSeeTarget
      ? this.memory.observe(
        vehicle.id,
        target.suspectId,
        target.currentX,
        target.currentY,
        nowMs
      )
      : this.memory.search(vehicle.id, target.suspectId, nowMs);
    if (!pursuit) {
      this.options.forgetTarget(vehicle.id, target.suspectId, target.reportedAt, nowMs);
      this.clearAssignment(vehicle.id, runtime);
      this.idle(vehicle, runtime, deltaSeconds);
      return false;
    }

    runtime.canSeeTarget = canSeeTarget;
    runtime.strategy = policeVehicleStrategy(target, pursuit.mode, distance);
    vehicle.siren = true;
    const predicted = predictPoliceDestination(
      target,
      pursuit.lastKnownX,
      pursuit.lastKnownY,
      canSeeTarget
    );
    const direct = canSeeTarget && distance <= DIRECT_PURSUIT_DISTANCE &&
      this.options.world.isRoadAt(predicted.x, predicted.y);
    if (!direct && this.shouldReplan(runtime, predicted.x, predicted.y, nowMs)) {
      this.planRoute(vehicle, runtime, predicted.x, predicted.y, nowMs);
    }

    const waypoint = direct
      ? predicted
      : this.currentWaypoint(runtime) ?? predicted;
    const ignoredObstacleIds = runtime.strategy === 'ram' && target.targetVehicleId
      ? new Set([target.targetVehicleId])
      : undefined;
    const result = this.driver.update(vehicle, {
      targetX: waypoint.x,
      targetY: waypoint.y,
      cruiseSpeed: policeVehicleSpeed(
        target.wantedLevel,
        distance,
        target.targetVehicleId !== ''
      ),
      deltaSeconds,
      obstacles,
      ignoredObstacleIds,
      minimumGapScale: runtime.strategy === 'ram' ? 0.5 : 0.82,
      allowRoadRejoin: true
    });
    runtime.desiredSpeed = result.desiredSpeed;
    runtime.speedReason = result.speedReason;
    runtime.obstacleId = result.obstacleId;
    if (result.reached && !direct) {
      vehicle.x = waypoint.x;
      vehicle.y = waypoint.y;
      runtime.waypointIndex = Math.min(runtime.route.length, runtime.waypointIndex + 1);
    }
    if (result.blocked) {
      if (runtime.blockedSince === 0) runtime.blockedSince = nowMs;
      if (nowMs - runtime.blockedSince >= 900) runtime.nextReplanAt = 0;
    } else {
      runtime.blockedSince = 0;
    }
    if (
      pursuit.mode === 'search' &&
      Math.hypot(vehicle.x - pursuit.lastKnownX, vehicle.y - pursuit.lastKnownY) <= SEARCH_ARRIVAL_RADIUS
    ) {
      this.driver.brake(vehicle, deltaSeconds, 420);
    }
    return result.moved;
  }

  diagnostics(): PoliceVehicleDiagnostic[] {
    return [...this.runtimes.entries()].map(([vehicleId, runtime]) => {
      const pursuit = this.memory.get(vehicleId);
      return {
        vehicleId,
        suspectId: runtime.suspectId,
        strategy: runtime.strategy,
        canSeeTarget: runtime.canSeeTarget,
        lastKnownX: pursuit?.lastKnownX ?? 0,
        lastKnownY: pursuit?.lastKnownY ?? 0,
        desiredSpeed: runtime.desiredSpeed,
        speedReason: runtime.speedReason,
        obstacleId: runtime.obstacleId,
        routeComplete: runtime.routeComplete,
        routeVisited: runtime.routeVisited,
        waypointIndex: runtime.waypointIndex,
        waypoints: runtime.route.slice(runtime.waypointIndex, runtime.waypointIndex + 24)
          .map((node) => this.options.world.roadPoint(node))
      };
    }).sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
  }

  private assign(
    vehicleId: string,
    runtime: PoliceVehicleRuntime,
    target: PoliceVehicleTargetSnapshot,
    nowMs: number
  ): void {
    runtime.suspectId = target.suspectId;
    runtime.reportAt = target.reportedAt;
    runtime.strategy = 'search';
    runtime.nextReplanAt = 0;
    this.memory.assignSearch(
      vehicleId,
      target.suspectId,
      target.reportedX,
      target.reportedY,
      nowMs
    );
  }

  private planRoute(
    vehicle: VehicleState,
    runtime: PoliceVehicleRuntime,
    destinationX: number,
    destinationY: number,
    nowMs: number
  ): void {
    const start = this.options.world.nearestRoadNode(vehicle.x, vehicle.y, VEHICLE_RADIUS);
    const goal = this.options.world.nearestRoadNode(destinationX, destinationY, VEHICLE_RADIUS);
    runtime.plannedX = destinationX;
    runtime.plannedY = destinationY;
    runtime.nextReplanAt = nowMs + REPLAN_INTERVAL_MS;
    runtime.waypointIndex = 0;
    if (!start || !goal) {
      runtime.route = [];
      runtime.routeComplete = false;
      runtime.routeVisited = 0;
      runtime.strategy = 'route-failed';
      return;
    }
    const plan = this.planner.plan(start, goal);
    runtime.route = plan.nodes.slice(1);
    runtime.routeComplete = plan.complete;
    runtime.routeVisited = plan.visited;
    if (runtime.route.length === 0 && !plan.complete) runtime.strategy = 'route-failed';
  }

  private shouldReplan(
    runtime: PoliceVehicleRuntime,
    destinationX: number,
    destinationY: number,
    nowMs: number
  ): boolean {
    return runtime.route.length === 0 || runtime.waypointIndex >= runtime.route.length ||
      nowMs >= runtime.nextReplanAt ||
      Math.hypot(destinationX - runtime.plannedX, destinationY - runtime.plannedY) >= 96;
  }

  private currentWaypoint(runtime: PoliceVehicleRuntime): {x: number; y: number} | undefined {
    const node = runtime.route[runtime.waypointIndex];
    return node ? this.options.world.roadPoint(node) : undefined;
  }

  private clearAssignment(vehicleId: string, runtime: PoliceVehicleRuntime): void {
    runtime.suspectId = '';
    runtime.reportAt = 0;
    runtime.canSeeTarget = false;
    runtime.route = [];
    runtime.waypointIndex = 0;
    runtime.nextReplanAt = 0;
    this.memory.clearOfficer(vehicleId);
  }

  private idle(vehicle: VehicleState, runtime: PoliceVehicleRuntime, deltaSeconds: number): void {
    vehicle.siren = false;
    this.driver.brake(vehicle, deltaSeconds, 350);
    runtime.strategy = 'idle';
    runtime.canSeeTarget = false;
    runtime.desiredSpeed = 0;
    runtime.speedReason = 'idle';
    runtime.obstacleId = '';
  }
}

function createRuntime(): PoliceVehicleRuntime {
  return {
    suspectId: '',
    reportAt: 0,
    strategy: 'idle',
    canSeeTarget: false,
    route: [],
    waypointIndex: 0,
    routeComplete: false,
    routeVisited: 0,
    nextReplanAt: 0,
    plannedX: 0,
    plannedY: 0,
    blockedSince: 0,
    desiredSpeed: 0,
    speedReason: 'idle',
    obstacleId: ''
  };
}
