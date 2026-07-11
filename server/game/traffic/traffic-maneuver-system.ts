import type {VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {TrafficObstacle} from './traffic-awareness-system.ts';

const VEHICLE_RADIUS = 20;
const STUCK_DELAY_MS = 2_000;
const REVERSE_DURATION_MS = 650;
const PASS_TIMEOUT_MS = 3_200;
const MERGE_TIMEOUT_MS = 2_400;
const RETRY_COOLDOWN_MS = 2_000;
const PEDESTRIAN_STUCK_DELAY_MS = 1_400;

export type TrafficManeuverPhase = 'none' | 'reverse' | 'pass-left' | 'pass-right' | 'merge';

export interface TrafficManeuverRuntime {
  phase: TrafficManeuverPhase;
  blockedById: string;
  stationarySince: number;
  phaseUntil: number;
  cooldownUntil: number;
  targetX: number;
  targetY: number;
  mergeX: number;
  mergeY: number;
  passSide: -1 | 1;
  attempts: number;
}

export interface TrafficManeuverCommand {
  phase: TrafficManeuverPhase;
  targetX?: number;
  targetY?: number;
  ignoredObstacleIds?: ReadonlySet<string>;
  reverse?: boolean;
}

interface TrafficManeuverInput {
  vehicle: VehicleState;
  runtime: TrafficManeuverRuntime;
  routeTargetX: number;
  routeTargetY: number;
  obstacles: readonly TrafficObstacle[];
  speedReason: string;
  obstacleId: string;
  desiredSpeed: number;
  nowMs: number;
}

export class TrafficManeuverSystem {
  constructor(private readonly world: CollisionMap) {}

  createRuntime(): TrafficManeuverRuntime {
    return {
      phase: 'none',
      blockedById: '',
      stationarySince: 0,
      phaseUntil: 0,
      cooldownUntil: 0,
      targetX: 0,
      targetY: 0,
      mergeX: 0,
      mergeY: 0,
      passSide: 1,
      attempts: 0
    };
  }

  command(input: TrafficManeuverInput): TrafficManeuverCommand {
    const {runtime, vehicle, nowMs} = input;
    if (runtime.phase === 'reverse') {
      if (nowMs < runtime.phaseUntil) return {phase: runtime.phase, reverse: true};
      runtime.phase = runtime.passSide < 0 ? 'pass-left' : 'pass-right';
      runtime.phaseUntil = nowMs + PASS_TIMEOUT_MS;
    }
    if (runtime.phase === 'pass-left' || runtime.phase === 'pass-right') {
      if (distance(vehicle.x, vehicle.y, runtime.targetX, runtime.targetY) <= 18) {
        runtime.phase = 'merge';
        runtime.phaseUntil = nowMs + MERGE_TIMEOUT_MS;
      } else if (nowMs >= runtime.phaseUntil) {
        this.finish(runtime, nowMs);
      }
    }
    if (runtime.phase === 'merge') {
      if (
        distance(vehicle.x, vehicle.y, runtime.mergeX, runtime.mergeY) <= 20 ||
        nowMs >= runtime.phaseUntil
      ) {
        this.finish(runtime, nowMs);
      }
    }

    if (runtime.phase !== 'none') {
      return {
        phase: runtime.phase,
        targetX: runtime.phase === 'merge' ? runtime.mergeX : runtime.targetX,
        targetY: runtime.phase === 'merge' ? runtime.mergeY : runtime.targetY,
        ignoredObstacleIds: new Set([runtime.blockedById])
      };
    }

    this.observeStoppedTraffic(input);
    const observedPhase = runtime.phase as TrafficManeuverPhase;
    if (observedPhase === 'reverse') return {phase: observedPhase, reverse: true};
    if (observedPhase !== 'none') {
      return {
        phase: observedPhase,
        targetX: runtime.targetX,
        targetY: runtime.targetY,
        ignoredObstacleIds: new Set([runtime.blockedById])
      };
    }
    return {phase: 'none'};
  }

  reset(runtime: TrafficManeuverRuntime): void {
    Object.assign(runtime, this.createRuntime());
  }

  private observeStoppedTraffic(input: TrafficManeuverInput): void {
    const {runtime, vehicle, nowMs, obstacles} = input;
    const legitimateStop = input.speedReason === 'signal';
    const recoverableObstacle = input.speedReason === 'vehicle' || input.speedReason === 'pedestrian';
    if (legitimateStop || !recoverableObstacle || input.desiredSpeed > 4) {
      runtime.stationarySince = 0;
      runtime.blockedById = '';
      return;
    }
    const lead = obstacles.find((obstacle) => obstacle.id === input.obstacleId);
    if (!lead || Math.abs(lead.speed ?? 0) > 8 || this.nearProtectedStop(vehicle, lead.id, obstacles)) {
      runtime.stationarySince = 0;
      runtime.blockedById = '';
      return;
    }
    if (runtime.blockedById !== lead.id) {
      runtime.blockedById = lead.id;
      runtime.stationarySince = nowMs;
      return;
    }
    const stuckDelay = lead.kind === 'pedestrian' ? PEDESTRIAN_STUCK_DELAY_MS : STUCK_DELAY_MS;
    if (nowMs < runtime.cooldownUntil || nowMs - runtime.stationarySince < stuckDelay) return;

    const routeAngle = Math.atan2(input.routeTargetY - vehicle.y, input.routeTargetX - vehicle.x);
    const preferredSide: -1 | 1 = hash(vehicle.id, runtime.attempts) % 2 === 0 ? -1 : 1;
    const alternateSide: -1 | 1 = preferredSide === -1 ? 1 : -1;
    const plan = lead.kind === 'pedestrian'
      ? this.planAroundPedestrian(vehicle, lead, routeAngle, preferredSide, obstacles) ??
        this.planAroundPedestrian(vehicle, lead, routeAngle, alternateSide, obstacles)
      : this.planForSide(vehicle, lead, routeAngle, preferredSide, obstacles) ??
        this.planForSide(vehicle, lead, routeAngle, alternateSide, obstacles);
    runtime.attempts++;
    if (!plan) {
      runtime.stationarySince = nowMs;
      runtime.cooldownUntil = nowMs + RETRY_COOLDOWN_MS;
      return;
    }
    runtime.phase = lead.kind === 'pedestrian'
      ? (plan.side < 0 ? 'pass-left' : 'pass-right')
      : 'reverse';
    runtime.phaseUntil = nowMs + (lead.kind === 'pedestrian' ? PASS_TIMEOUT_MS : REVERSE_DURATION_MS);
    runtime.targetX = plan.passX;
    runtime.targetY = plan.passY;
    runtime.mergeX = plan.mergeX;
    runtime.mergeY = plan.mergeY;
    runtime.passSide = plan.side;
  }

  private planAroundPedestrian(
    vehicle: VehicleState,
    lead: TrafficObstacle,
    angle: number,
    side: -1 | 1,
    obstacles: readonly TrafficObstacle[]
  ): {side: -1 | 1; passX: number; passY: number; mergeX: number; mergeY: number} | undefined {
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const normalX = -forwardY * side;
    const normalY = forwardX * side;
    const passX = lead.x + forwardX * 54 + normalX * 34;
    const passY = lead.y + forwardY * 54 + normalY * 34;
    const mergeX = lead.x + forwardX * 96;
    const mergeY = lead.y + forwardY * 96;
    const points = [[(vehicle.x + passX) / 2, (vehicle.y + passY) / 2], [passX, passY], [mergeX, mergeY]];
    if (points.some(([x, y]) => !this.world.canOccupy(x, y, VEHICLE_RADIUS) || !this.world.isRoadAt(x, y))) {
      return undefined;
    }
    for (const obstacle of obstacles) {
      if (obstacle.id === vehicle.id || obstacle.id === lead.id || obstacle.kind === 'signal') continue;
      if (points.some(([x, y]) => distance(x, y, obstacle.x, obstacle.y) < VEHICLE_RADIUS + obstacle.radius + 8)) {
        return undefined;
      }
    }
    return {side, passX, passY, mergeX, mergeY};
  }

  private planForSide(
    vehicle: VehicleState,
    lead: TrafficObstacle,
    angle: number,
    side: -1 | 1,
    obstacles: readonly TrafficObstacle[]
  ): {side: -1 | 1; passX: number; passY: number; mergeX: number; mergeY: number} | undefined {
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const normalX = -forwardY * side;
    const normalY = forwardX * side;
    const passX = lead.x + forwardX * 72 + normalX * 50;
    const passY = lead.y + forwardY * 72 + normalY * 50;
    const midpointX = (vehicle.x + passX) / 2;
    const midpointY = (vehicle.y + passY) / 2;
    const mergeX = lead.x + forwardX * 130;
    const mergeY = lead.y + forwardY * 130;
    const points = [[midpointX, midpointY], [passX, passY], [mergeX, mergeY]];
    if (points.some(([x, y]) => !this.world.canOccupy(x, y, VEHICLE_RADIUS) || !this.world.isRoadAt(x, y))) {
      return undefined;
    }
    for (const obstacle of obstacles) {
      if (obstacle.id === vehicle.id || obstacle.id === lead.id || obstacle.kind === 'signal') continue;
      if (points.some(([x, y]) => distance(x, y, obstacle.x, obstacle.y) < VEHICLE_RADIUS + obstacle.radius + 12)) {
        return undefined;
      }
    }
    return {side, passX, passY, mergeX, mergeY};
  }

  private nearProtectedStop(
    vehicle: VehicleState,
    leadId: string,
    obstacles: readonly TrafficObstacle[]
  ): boolean {
    return obstacles.some((obstacle) => (
      obstacle.id !== leadId &&
      (obstacle.kind === 'signal' || obstacle.kind === 'pedestrian') &&
      distance(vehicle.x, vehicle.y, obstacle.x, obstacle.y) < 150
    ));
  }

  private finish(runtime: TrafficManeuverRuntime, nowMs: number): void {
    runtime.phase = 'none';
    runtime.blockedById = '';
    runtime.stationarySince = 0;
    runtime.phaseUntil = 0;
    runtime.cooldownUntil = nowMs + RETRY_COOLDOWN_MS;
  }
}

function distance(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.hypot(rightX - leftX, rightY - leftY);
}

function hash(id: string, attempt: number): number {
  let value = attempt;
  for (let index = 0; index < id.length; index++) value = (value * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(value);
}
