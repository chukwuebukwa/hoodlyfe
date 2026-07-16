import type {VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {vehicleConfig} from '../vehicles/vehicle-config.ts';
import type {TrafficObstacle} from './traffic-awareness-system.ts';
import {
  planTrafficLaneChange,
  type TrafficLaneChangePlan,
  type TrafficLaneChangeRejectReason
} from './traffic-lane-change-policy.ts';
import type {TrafficLaneSegment} from './traffic-route-system.ts';

const SLOW_CONFIRMATION_MS = 900;
const REQUEST_TIMEOUT_MS = 1_800;
const MANEUVER_TIMEOUT_MS = 5_200;
const RETRY_COOLDOWN_MS = 3_500;
const TARGET_REACHED_DISTANCE = 28;
const MAX_PASS_LEAD_SPEED = 42;

export type TrafficLaneChangePhase =
  | 'none'
  | 'requesting'
  | 'change-out'
  | 'passing'
  | 'returning';

export interface TrafficLaneChangeRuntime {
  phase: TrafficLaneChangePhase;
  slowSince: number;
  leadId: string;
  requestedAt: number;
  phaseUntil: number;
  cooldownUntil: number;
  reservationKey: string;
  fromLaneIndex: number;
  toLaneIndex: number;
  entryX: number;
  entryY: number;
  passX: number;
  passY: number;
  returnX: number;
  returnY: number;
  segmentAngle: number;
  attempts: number;
  completions: number;
  rejectReason: TrafficLaneChangeRejectReason;
}

export interface TrafficLaneChangeCommand {
  phase: TrafficLaneChangePhase;
  targetX?: number;
  targetY?: number;
  ignoredObstacleIds?: ReadonlySet<string>;
}

interface TrafficLaneChangeInput {
  vehicle: VehicleState;
  runtime: TrafficLaneChangeRuntime;
  segment?: TrafficLaneSegment;
  obstacles: readonly TrafficObstacle[];
  speedReason: string;
  obstacleId: string;
  desiredSpeed: number;
  cruiseSpeed: number;
  protectedJunction: boolean;
  nowMs: number;
}

interface PendingRequest {
  vehicleId: string;
  requestedAt: number;
  plan: TrafficLaneChangePlan;
}

interface Reservation {
  vehicleId: string;
  expiresAt: number;
}

export interface TrafficLaneChangeDiagnostic {
  phase: TrafficLaneChangePhase;
  leadId: string;
  fromLaneIndex: number;
  toLaneIndex: number;
  attempts: number;
  completions: number;
  rejectReason: TrafficLaneChangeRejectReason;
  reservationKey: string;
  targets: Array<{x: number; y: number}>;
}

export class TrafficLaneChangeSystem {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly grants = new Map<string, string>();
  private readonly reservations = new Map<string, Reservation>();

  constructor(private readonly world: CollisionMap) {}

  createRuntime(): TrafficLaneChangeRuntime {
    return {
      phase: 'none',
      slowSince: 0,
      leadId: '',
      requestedAt: 0,
      phaseUntil: 0,
      cooldownUntil: 0,
      reservationKey: '',
      fromLaneIndex: -1,
      toLaneIndex: -1,
      entryX: 0,
      entryY: 0,
      passX: 0,
      passY: 0,
      returnX: 0,
      returnY: 0,
      segmentAngle: 0,
      attempts: 0,
      completions: 0,
      rejectReason: 'none'
    };
  }

  beginTick(nowMs: number): void {
    this.grants.clear();
    for (const [key, reservation] of this.reservations) {
      if (nowMs >= reservation.expiresAt) this.reservations.delete(key);
    }
    const requestsByKey = new Map<string, PendingRequest[]>();
    for (const request of this.pending.values()) {
      const entries = requestsByKey.get(request.plan.reservationKey) ?? [];
      entries.push(request);
      requestsByKey.set(request.plan.reservationKey, entries);
    }
    this.pending.clear();
    for (const [key, requests] of [...requestsByKey.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    ))) {
      if (this.reservations.has(key)) continue;
      const winner = requests.sort((left, right) => (
        left.requestedAt - right.requestedAt ||
        left.vehicleId.localeCompare(right.vehicleId)
      ))[0];
      if (winner) this.grants.set(winner.vehicleId, key);
    }
  }

  command(input: TrafficLaneChangeInput): TrafficLaneChangeCommand {
    const {runtime, vehicle, nowMs} = input;
    if (input.protectedJunction || ['signal', 'pedestrian', 'siren', 'hijack'].includes(input.speedReason)) {
      this.cancel(vehicle.id, runtime, nowMs, false);
      return {phase: 'none'};
    }
    if (runtime.phase === 'change-out' || runtime.phase === 'passing' || runtime.phase === 'returning') {
      return this.advanceActive(vehicle, runtime, nowMs);
    }
    if (runtime.phase === 'requesting') {
      if (nowMs >= runtime.phaseUntil) {
        runtime.rejectReason = 'reservation';
        this.cancel(vehicle.id, runtime, nowMs, true);
        return {phase: 'none'};
      }
      const plan = this.plan(input);
      if (!plan.plan) {
        runtime.rejectReason = plan.rejectReason;
        this.cancel(vehicle.id, runtime, nowMs, true);
        return {phase: 'none'};
      }
      this.submit(vehicle.id, runtime.requestedAt, plan.plan);
      if (this.grants.get(vehicle.id) === plan.plan.reservationKey) {
        this.start(vehicle.id, runtime, plan.plan, nowMs);
        return this.activeCommand(runtime);
      }
      return {phase: 'requesting'};
    }

    if (!this.shouldRequest(input)) {
      runtime.slowSince = 0;
      runtime.leadId = '';
      if (runtime.rejectReason !== 'timeout') runtime.rejectReason = 'none';
      return {phase: 'none'};
    }
    if (runtime.leadId !== input.obstacleId) {
      runtime.leadId = input.obstacleId;
      runtime.slowSince = nowMs;
      return {phase: 'none'};
    }
    if (nowMs < runtime.cooldownUntil || nowMs - runtime.slowSince < SLOW_CONFIRMATION_MS) {
      return {phase: 'none'};
    }

    const plan = this.plan(input);
    runtime.attempts++;
    if (!plan.plan) {
      runtime.rejectReason = plan.rejectReason;
      runtime.cooldownUntil = nowMs + RETRY_COOLDOWN_MS;
      runtime.slowSince = nowMs;
      return {phase: 'none'};
    }
    runtime.phase = 'requesting';
    runtime.requestedAt = nowMs;
    runtime.phaseUntil = nowMs + REQUEST_TIMEOUT_MS;
    runtime.rejectReason = 'none';
    this.submit(vehicle.id, runtime.requestedAt, plan.plan);
    return {phase: 'requesting'};
  }

  cancel(
    vehicleId: string,
    runtime: TrafficLaneChangeRuntime,
    nowMs: number,
    cooldown: boolean
  ): void {
    this.pending.delete(vehicleId);
    this.grants.delete(vehicleId);
    this.releaseReservation(vehicleId, runtime.reservationKey);
    const attempts = runtime.attempts;
    const completions = runtime.completions;
    const rejectReason = runtime.rejectReason;
    Object.assign(runtime, this.createRuntime(), {
      attempts,
      completions,
      rejectReason,
      cooldownUntil: cooldown ? nowMs + RETRY_COOLDOWN_MS : runtime.cooldownUntil
    });
  }

  release(vehicleId: string, runtime?: TrafficLaneChangeRuntime): void {
    this.pending.delete(vehicleId);
    this.grants.delete(vehicleId);
    this.releaseReservation(vehicleId, runtime?.reservationKey ?? '');
  }

  diagnostic(runtime: TrafficLaneChangeRuntime): TrafficLaneChangeDiagnostic {
    const targets = runtime.phase === 'none'
      ? []
      : [
          {x: runtime.entryX, y: runtime.entryY},
          {x: runtime.passX, y: runtime.passY},
          {x: runtime.returnX, y: runtime.returnY}
        ];
    return {
      phase: runtime.phase,
      leadId: runtime.leadId,
      fromLaneIndex: runtime.fromLaneIndex,
      toLaneIndex: runtime.toLaneIndex,
      attempts: runtime.attempts,
      completions: runtime.completions,
      rejectReason: runtime.rejectReason,
      reservationKey: runtime.reservationKey,
      targets
    };
  }

  private plan(input: TrafficLaneChangeInput) {
    const configuration = vehicleConfig(input.vehicle.kind).collision;
    return planTrafficLaneChange({
      vehicle: {
        id: input.vehicle.id,
        x: input.vehicle.x,
        y: input.vehicle.y,
        speed: Math.max(0, input.vehicle.speed),
        halfLength: configuration.length / 2,
        halfWidth: configuration.width / 2
      },
      segment: input.segment,
      lead: input.obstacles.find((obstacle) => obstacle.id === input.obstacleId),
      obstacles: input.obstacles,
      world: this.world
    });
  }

  private shouldRequest(input: TrafficLaneChangeInput): boolean {
    if (input.speedReason !== 'vehicle' || !input.obstacleId) return false;
    if (!input.segment || input.segment.laneCount <= 1) return false;
    if (input.desiredSpeed > Math.max(12, input.cruiseSpeed * 0.52)) return false;
    const lead = input.obstacles.find((obstacle) => obstacle.id === input.obstacleId);
    return Boolean(lead && Math.max(0, lead.speed ?? 0) <= MAX_PASS_LEAD_SPEED);
  }

  private submit(vehicleId: string, requestedAt: number, plan: TrafficLaneChangePlan): void {
    this.pending.set(vehicleId, {vehicleId, requestedAt, plan});
  }

  private start(
    vehicleId: string,
    runtime: TrafficLaneChangeRuntime,
    plan: TrafficLaneChangePlan,
    nowMs: number
  ): void {
    runtime.phase = 'change-out';
    runtime.leadId = plan.leadId;
    runtime.reservationKey = plan.reservationKey;
    runtime.fromLaneIndex = plan.fromLaneIndex;
    runtime.toLaneIndex = plan.toLaneIndex;
    runtime.entryX = plan.entryX;
    runtime.entryY = plan.entryY;
    runtime.passX = plan.passX;
    runtime.passY = plan.passY;
    runtime.returnX = plan.returnX;
    runtime.returnY = plan.returnY;
    runtime.segmentAngle = plan.segmentAngle;
    runtime.phaseUntil = nowMs + MANEUVER_TIMEOUT_MS;
    runtime.rejectReason = 'none';
    this.reservations.set(plan.reservationKey, {
      vehicleId,
      expiresAt: runtime.phaseUntil + 250
    });
    this.pending.delete(vehicleId);
    this.grants.delete(vehicleId);
  }

  private advanceActive(
    vehicle: VehicleState,
    runtime: TrafficLaneChangeRuntime,
    nowMs: number
  ): TrafficLaneChangeCommand {
    if (nowMs >= runtime.phaseUntil) {
      runtime.rejectReason = 'timeout';
      this.cancel(vehicle.id, runtime, nowMs, true);
      return {phase: 'none'};
    }
    const reservation = this.reservations.get(runtime.reservationKey);
    if (!reservation || reservation.vehicleId !== vehicle.id) {
      runtime.rejectReason = 'reservation';
      this.cancel(vehicle.id, runtime, nowMs, true);
      return {phase: 'none'};
    }
    reservation.expiresAt = runtime.phaseUntil + 250;
    if (
      runtime.phase === 'change-out' &&
      distance(vehicle.x, vehicle.y, runtime.entryX, runtime.entryY) <= TARGET_REACHED_DISTANCE
    ) {
      runtime.phase = 'passing';
    }
    if (
      runtime.phase === 'passing' &&
      distance(vehicle.x, vehicle.y, runtime.passX, runtime.passY) <= TARGET_REACHED_DISTANCE
    ) {
      runtime.phase = 'returning';
    }
    if (
      runtime.phase === 'returning' &&
      distance(vehicle.x, vehicle.y, runtime.returnX, runtime.returnY) <= TARGET_REACHED_DISTANCE
    ) {
      runtime.completions++;
      runtime.rejectReason = 'none';
      this.cancel(vehicle.id, runtime, nowMs, true);
      return {phase: 'none'};
    }
    return this.activeCommand(runtime);
  }

  private activeCommand(runtime: TrafficLaneChangeRuntime): TrafficLaneChangeCommand {
    const target = runtime.phase === 'change-out'
      ? {x: runtime.entryX, y: runtime.entryY}
      : (runtime.phase === 'passing'
          ? {x: runtime.passX, y: runtime.passY}
          : {x: runtime.returnX, y: runtime.returnY});
    return {
      phase: runtime.phase,
      targetX: target.x,
      targetY: target.y,
      ignoredObstacleIds: new Set([runtime.leadId])
    };
  }

  private releaseReservation(vehicleId: string, key: string): void {
    if (!key) return;
    const reservation = this.reservations.get(key);
    if (reservation?.vehicleId === vehicleId) this.reservations.delete(key);
  }
}

function distance(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.hypot(rightX - leftX, rightY - leftY);
}

export const TRAFFIC_LANE_CHANGE_TIMING = Object.freeze({
  slowConfirmationMs: SLOW_CONFIRMATION_MS,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  maneuverTimeoutMs: MANEUVER_TIMEOUT_MS,
  retryCooldownMs: RETRY_COOLDOWN_MS
});
