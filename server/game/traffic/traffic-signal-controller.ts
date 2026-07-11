import {
  TRAFFIC_SIGNAL_APPROACH_DISTANCE,
  TRAFFIC_SIGNALS,
  phaseForAxis,
  trafficSignalPhasesAt,
  type TrafficAxis,
  type TrafficSignalApproachDefinition,
  type TrafficSignalDefinition
} from '../../../shared/content/traffic-signals.ts';
import {
  TrafficSignalState,
  type DistrictState,
  type VehicleState
} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {TrafficObstacle} from './traffic-awareness-system.ts';

interface TrafficSignalControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  nearbyVehicles: (x: number, y: number, radius: number) => VehicleState[];
}

export interface TrafficSignalDiagnostic {
  id: string;
  northSouth: string;
  eastWest: string;
  nextChangeAt: number;
  waitingVehicleIds: string[];
}

interface MatchedApproach {
  signal: TrafficSignalDefinition;
  approach: TrafficSignalApproachDefinition;
  distance: number;
}

export class TrafficSignalController {
  private readonly waiting = new Map<string, Set<string>>();

  constructor(private readonly options: TrafficSignalControllerOptions) {}

  initialize(nowMs = 0): void {
    for (const definition of TRAFFIC_SIGNALS) {
      this.validate(definition);
      if (this.options.state.trafficSignals.has(definition.id)) continue;
      const signal = new TrafficSignalState();
      signal.id = definition.id;
      signal.x = definition.x;
      signal.y = definition.y;
      this.options.state.trafficSignals.set(signal.id, signal);
    }
    this.update(nowMs);
  }

  beginTick(): void {
    this.waiting.clear();
  }

  update(nowMs: number): void {
    const phases = trafficSignalPhasesAt(nowMs);
    for (const signal of this.options.state.trafficSignals.values()) {
      signal.northSouth = phases.northSouth;
      signal.eastWest = phases.eastWest;
      signal.nextChangeAt = phases.nextChangeAt;
    }
  }

  obstaclesFor(
    vehicle: VehicleState,
    nowMs: number,
    emergencyResponse = false
  ): TrafficObstacle[] {
    if (vehicle.destroyed || emergencyResponse) return [];
    const match = this.matchApproach(vehicle);
    if (!match) return [];
    const phases = trafficSignalPhasesAt(nowMs);
    const phase = phaseForAxis(phases, match.approach.axis);
    const occupied = phase === 'green' && this.crossAxisOccupied(
      match.signal,
      match.approach.axis,
      vehicle.id
    );
    if (phase === 'green' && !occupied) return [];
    let vehicles = this.waiting.get(match.signal.id);
    if (!vehicles) {
      vehicles = new Set<string>();
      this.waiting.set(match.signal.id, vehicles);
    }
    vehicles.add(vehicle.id);
    return [{
      id: `signal:${match.signal.id}:${match.approach.id}`,
      kind: 'signal',
      x: match.approach.stopX,
      y: match.approach.stopY,
      radius: 0
    }];
  }

  diagnostics(): TrafficSignalDiagnostic[] {
    return [...this.options.state.trafficSignals.values()].map((signal) => ({
      id: signal.id,
      northSouth: signal.northSouth,
      eastWest: signal.eastWest,
      nextChangeAt: signal.nextChangeAt,
      waitingVehicleIds: [...(this.waiting.get(signal.id) ?? [])].sort()
    })).sort((left, right) => left.id.localeCompare(right.id));
  }

  private matchApproach(vehicle: VehicleState): MatchedApproach | undefined {
    const headingX = Math.cos(vehicle.angle);
    const headingY = Math.sin(vehicle.angle);
    const matches: MatchedApproach[] = [];
    for (const signal of TRAFFIC_SIGNALS) {
      for (const approach of signal.approaches) {
        const headingDot = headingX * approach.directionX + headingY * approach.directionY;
        if (headingDot < 0.72) continue;
        const deltaX = approach.stopX - vehicle.x;
        const deltaY = approach.stopY - vehicle.y;
        const distance = deltaX * approach.directionX + deltaY * approach.directionY;
        if (distance < -10 || distance > TRAFFIC_SIGNAL_APPROACH_DISTANCE) continue;
        const lateral = Math.abs(-deltaX * approach.directionY + deltaY * approach.directionX);
        if (lateral > approach.corridorHalfWidth) continue;
        matches.push({signal, approach, distance});
      }
    }
    return matches.sort((left, right) => (
      left.distance - right.distance ||
      left.signal.id.localeCompare(right.signal.id) ||
      left.approach.id.localeCompare(right.approach.id)
    ))[0];
  }

  private crossAxisOccupied(
    signal: TrafficSignalDefinition,
    approachAxis: TrafficAxis,
    vehicleId: string
  ): boolean {
    const radius = Math.hypot(signal.intersectionHalfWidth, signal.intersectionHalfHeight) + 24;
    return this.options.nearbyVehicles(signal.x, signal.y, radius).some((candidate) => {
      if (candidate.id === vehicleId || candidate.destroyed) return false;
      if (
        Math.abs(candidate.x - signal.x) > signal.intersectionHalfWidth ||
        Math.abs(candidate.y - signal.y) > signal.intersectionHalfHeight
      ) return false;
      return vehicleAxis(candidate.angle) !== approachAxis;
    });
  }

  private validate(signal: TrafficSignalDefinition): void {
    if (!this.options.world.isRoadAt(signal.x, signal.y)) {
      throw new Error(`Traffic signal ${signal.id} center is not on a road.`);
    }
    for (const approach of signal.approaches) {
      if (
        !this.options.world.isRoadAt(approach.stopX, approach.stopY) ||
        !this.options.world.canOccupy(approach.stopX, approach.stopY, 20)
      ) {
        throw new Error(`Traffic signal ${signal.id}:${approach.id} has an invalid stop point.`);
      }
    }
  }
}

function vehicleAxis(angle: number): TrafficAxis {
  return Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle))
    ? 'east-west'
    : 'north-south';
}
