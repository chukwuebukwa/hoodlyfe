import {VehicleState, type DistrictState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {GameEventStream} from '../events/game-events.ts';
import type {LaneGraph, LaneRoadblockDefinition} from '../traffic/lane-graph.ts';
import type {RoadClosureRegistry} from '../traffic/road-closure-registry.ts';
import {VEHICLE_COLLISION_BOUNDING_RADIUS, vehicleConfig} from '../vehicles/vehicle-config.ts';
import type {PoliceResponseFleetPlan} from './police-response-allocation-system.ts';
import {
  POLICE_ROADBLOCK,
  roadblockCooldownMs,
  selectRoadblockOpportunity,
  type PoliceRoadblockSuspect
} from './police-roadblock-policy.ts';

export type PoliceRoadblockPhase = 'clearing' | 'deployed' | 'retiring';
type PoliceRoadblockClearReason = 'wanted-cleared' | 'breached' | 'deployment-timeout';

interface PoliceRoadblockRuntime {
  id: string;
  suspectId: string;
  opportunity: LaneRoadblockDefinition;
  phase: PoliceRoadblockPhase;
  reservedAt: number;
  deployedAt: number;
  vehicleIds: Set<string>;
  clearReason: PoliceRoadblockClearReason | '';
}

interface PoliceRoadblockControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  laneGraph: LaneGraph;
  closures: RoadClosureRegistry;
  responsePlan: () => PoliceResponseFleetPlan;
  traffic: {activeVehicleIdsOnEdges(edgeIds: readonly string[]): string[]};
  events: GameEventStream;
  clock: () => {tick: number};
  onVehicleSpawned?: (vehicle: VehicleState) => void;
  onVehicleRemoved?: (vehicleId: string) => void;
}

export interface PoliceRoadblockDiagnostic {
  roadblockId: string;
  slotId: string;
  suspectId: string;
  phase: PoliceRoadblockPhase;
  x: number;
  y: number;
  angle: number;
  reservedAt: number;
  deployedAt: number;
  vehicleIds: string[];
  blockedEdgeIds: string[];
  clearReason: string;
}

export interface PoliceRoadblockDeployment {
  roadblockId: string;
  slotId: string;
  suspectId: string;
  phase: PoliceRoadblockPhase;
  blockedEdgeIds: readonly string[];
  stinger: LaneRoadblockDefinition['stinger'];
}

const DEPLOYMENT_TIMEOUT_MS = 9_000;
const DEPLOYMENT_VISIBILITY_RADIUS = 640;
const DEPLOYMENT_VEHICLE_CLEARANCE = 72;
const DISPLACEMENT_TOLERANCE = 110;
const SAFE_REMOVAL_DISTANCE = 680;
const FAILED_DEPLOYMENT_RETRY_MS = 6_000;

/** Owns roadblock actor and lane-closure lifecycle, not pursuit allocation or driving AI. */
export class PoliceRoadblockController {
  private readonly runtimes = new Map<string, PoliceRoadblockRuntime>();
  private readonly slotOwners = new Map<string, string>();
  private readonly cooldownUntilBySuspect = new Map<string, number>();
  private sequence = 0;

  constructor(private readonly options: PoliceRoadblockControllerOptions) {}

  update(nowMs: number): void {
    for (const runtime of [...this.runtimes.values()].sort(compareRuntime)) {
      this.updateRuntime(runtime, nowMs);
    }
    this.deployForResponse(nowMs);
  }

  ownsVehicle(vehicleId: string): boolean {
    for (const runtime of this.runtimes.values()) {
      if (runtime.vehicleIds.has(vehicleId)) return true;
    }
    return false;
  }

  activeDeployments(): readonly PoliceRoadblockDeployment[] {
    return Object.freeze([...this.runtimes.values()].sort(compareRuntime).map((runtime) => (
      Object.freeze({
        roadblockId: runtime.id,
        slotId: runtime.opportunity.id,
        suspectId: runtime.suspectId,
        phase: runtime.phase,
        blockedEdgeIds: Object.freeze([...runtime.opportunity.blockedEdgeIds]),
        stinger: runtime.opportunity.stinger
      })
    )));
  }

  diagnostics(): PoliceRoadblockDiagnostic[] {
    return [...this.runtimes.values()].sort(compareRuntime).map((runtime) => ({
      roadblockId: runtime.id,
      slotId: runtime.opportunity.id,
      suspectId: runtime.suspectId,
      phase: runtime.phase,
      x: runtime.opportunity.x,
      y: runtime.opportunity.y,
      angle: runtime.opportunity.angle,
      reservedAt: runtime.reservedAt,
      deployedAt: runtime.deployedAt,
      vehicleIds: [...runtime.vehicleIds].sort(),
      blockedEdgeIds: [...runtime.opportunity.blockedEdgeIds],
      clearReason: runtime.clearReason
    }));
  }

  private updateRuntime(runtime: PoliceRoadblockRuntime, nowMs: number): void {
    if (runtime.phase === 'clearing') {
      if (!this.suspect(runtime.suspectId)) {
        this.beginRetirement(runtime, 'wanted-cleared', nowMs);
        return;
      }
      if (nowMs - runtime.reservedAt >= DEPLOYMENT_TIMEOUT_MS) {
        this.beginRetirement(runtime, 'deployment-timeout', nowMs);
        return;
      }
      if (this.playersNear(runtime.opportunity.x, runtime.opportunity.y, DEPLOYMENT_VISIBILITY_RADIUS)) {
        return;
      }
      if (this.options.traffic.activeVehicleIdsOnEdges(runtime.opportunity.blockedEdgeIds).length > 0) {
        return;
      }
      if (!this.vehiclePosesAreClear(runtime.opportunity)) return;
      this.spawnVehicles(runtime, nowMs);
      return;
    }

    if (runtime.phase === 'deployed') {
      if (!this.suspect(runtime.suspectId)) {
        this.beginRetirement(runtime, 'wanted-cleared', nowMs);
        return;
      }
      if (this.roadblockWasBreached(runtime)) {
        this.beginRetirement(runtime, 'breached', nowMs);
      }
      return;
    }

    this.releaseOccupiedVehicles(runtime);
    if (runtime.vehicleIds.size === 0 || this.safeToRemove(runtime)) {
      for (const vehicleId of runtime.vehicleIds) {
        this.options.state.vehicles.delete(vehicleId);
        this.options.onVehicleRemoved?.(vehicleId);
      }
      runtime.vehicleIds.clear();
      this.finalize(runtime, nowMs);
    }
  }

  private deployForResponse(nowMs: number): void {
    if (this.runtimes.size >= POLICE_ROADBLOCK.maximumActive) return;
    const targets = this.options.responsePlan().targets;
    for (const target of targets) {
      if (this.runtimes.size >= POLICE_ROADBLOCK.maximumActive) break;
      if ([...this.runtimes.values()].some((runtime) => runtime.suspectId === target.suspectId)) {
        continue;
      }
      if ((this.cooldownUntilBySuspect.get(target.suspectId) ?? 0) > nowMs) continue;
      const suspect = this.suspect(target.suspectId);
      if (!suspect) continue;
      const opportunities = this.options.laneGraph.roadblocks().filter((opportunity) => (
        !this.slotOwners.has(opportunity.id) &&
        !this.playersNear(opportunity.x, opportunity.y, DEPLOYMENT_VISIBILITY_RADIUS)
      ));
      const opportunity = selectRoadblockOpportunity(suspect, opportunities);
      if (!opportunity) continue;
      this.reserve(target.suspectId, opportunity, nowMs);
    }
  }

  private suspect(suspectId: string): PoliceRoadblockSuspect | undefined {
    const player = this.options.state.players.get(suspectId);
    const vehicle = player?.vehicleId ? this.options.state.vehicles.get(player.vehicleId) : undefined;
    if (!player?.alive || player.spaceId !== 'street' || player.wanted < 3 || !vehicle) return undefined;
    return {
      id: player.id,
      wantedLevel: player.wanted,
      x: vehicle.x,
      y: vehicle.y,
      angle: vehicle.angle,
      speed: vehicle.speed,
      inVehicle: true
    };
  }

  private reserve(suspectId: string, opportunity: LaneRoadblockDefinition, nowMs: number): void {
    this.sequence++;
    const id = `police-roadblock-${this.sequence}`;
    const runtime: PoliceRoadblockRuntime = {
      id,
      suspectId,
      opportunity,
      phase: 'clearing',
      reservedAt: nowMs,
      deployedAt: 0,
      vehicleIds: new Set(),
      clearReason: ''
    };
    this.runtimes.set(id, runtime);
    this.slotOwners.set(opportunity.id, id);
    this.options.closures.acquire(id, opportunity.blockedEdgeIds);
  }

  private spawnVehicles(runtime: PoliceRoadblockRuntime, nowMs: number): void {
    for (let index = 0; index < runtime.opportunity.vehiclePoses.length; index++) {
      const pose = runtime.opportunity.vehiclePoses[index];
      const vehicle = new VehicleState();
      vehicle.id = `${runtime.id}:vehicle:${index + 1}`;
      vehicle.kind = 'police';
      vehicle.x = pose.x;
      vehicle.y = pose.y;
      vehicle.angle = pose.angle;
      vehicle.maxHealth = vehicleConfig(vehicle.kind).maxHealth;
      vehicle.health = vehicle.maxHealth;
      vehicle.speed = 0;
      vehicle.traffic = false;
      vehicle.siren = true;
      this.options.state.vehicles.set(vehicle.id, vehicle);
      runtime.vehicleIds.add(vehicle.id);
      this.options.onVehicleSpawned?.(vehicle);
    }
    runtime.phase = 'deployed';
    runtime.deployedAt = nowMs;
    this.options.events.publish({
      type: 'police.roadblock-deployed',
      tick: this.options.clock().tick,
      nowMs,
      roadblockId: runtime.id,
      slotId: runtime.opportunity.id,
      suspectId: runtime.suspectId,
      vehicleIds: [...runtime.vehicleIds].sort()
    });
  }

  private beginRetirement(
    runtime: PoliceRoadblockRuntime,
    reason: PoliceRoadblockClearReason,
    nowMs: number
  ): void {
    runtime.phase = 'retiring';
    runtime.clearReason = reason;
    this.releaseOccupiedVehicles(runtime);
    if (runtime.vehicleIds.size === 0) this.finalize(runtime, nowMs);
  }

  private finalize(runtime: PoliceRoadblockRuntime, nowMs: number): void {
    this.options.closures.release(runtime.id);
    this.slotOwners.delete(runtime.opportunity.id);
    this.runtimes.delete(runtime.id);
    const player = this.options.state.players.get(runtime.suspectId);
    this.cooldownUntilBySuspect.set(
      runtime.suspectId,
      nowMs + (runtime.clearReason === 'deployment-timeout'
        ? FAILED_DEPLOYMENT_RETRY_MS
        : roadblockCooldownMs(player?.wanted ?? 3))
    );
    this.options.events.publish({
      type: 'police.roadblock-cleared',
      tick: this.options.clock().tick,
      nowMs,
      roadblockId: runtime.id,
      slotId: runtime.opportunity.id,
      suspectId: runtime.suspectId,
      reason: runtime.clearReason || 'wanted-cleared'
    });
  }

  private roadblockWasBreached(runtime: PoliceRoadblockRuntime): boolean {
    for (let index = 0; index < runtime.opportunity.vehiclePoses.length; index++) {
      const vehicleId = `${runtime.id}:vehicle:${index + 1}`;
      if (!runtime.vehicleIds.has(vehicleId)) continue;
      const vehicle = this.options.state.vehicles.get(vehicleId);
      const pose = runtime.opportunity.vehiclePoses[index];
      if (
        !vehicle || vehicle.destroyed || vehicle.driverId || vehicle.hijackBy ||
        Math.hypot(vehicle.x - pose.x, vehicle.y - pose.y) > DISPLACEMENT_TOLERANCE
      ) return true;
    }
    return false;
  }

  private releaseOccupiedVehicles(runtime: PoliceRoadblockRuntime): void {
    for (const vehicleId of runtime.vehicleIds) {
      const vehicle = this.options.state.vehicles.get(vehicleId);
      if (vehicle?.driverId || vehicle?.hijackBy) runtime.vehicleIds.delete(vehicleId);
    }
  }

  private safeToRemove(runtime: PoliceRoadblockRuntime): boolean {
    for (const player of this.options.state.players.values()) {
      if (player.spaceId !== 'street') continue;
      for (const vehicleId of runtime.vehicleIds) {
        const vehicle = this.options.state.vehicles.get(vehicleId);
        if (vehicle && Math.hypot(player.x - vehicle.x, player.y - vehicle.y) < SAFE_REMOVAL_DISTANCE) {
          return false;
        }
      }
    }
    return true;
  }

  private vehiclePosesAreClear(opportunity: LaneRoadblockDefinition): boolean {
    for (const pose of opportunity.vehiclePoses) {
      if (!this.options.world.canOccupy(pose.x, pose.y, VEHICLE_COLLISION_BOUNDING_RADIUS)) {
        return false;
      }
      for (const vehicle of this.options.state.vehicles.values()) {
        if (Math.hypot(vehicle.x - pose.x, vehicle.y - pose.y) < DEPLOYMENT_VEHICLE_CLEARANCE) {
          return false;
        }
      }
    }
    return true;
  }

  private playersNear(x: number, y: number, radius: number): boolean {
    return [...this.options.state.players.values()].some((player) => (
      player.spaceId === 'street' && Math.hypot(player.x - x, player.y - y) < radius
    ));
  }
}

function compareRuntime(left: PoliceRoadblockRuntime, right: PoliceRoadblockRuntime): number {
  return left.reservedAt - right.reservedAt || left.id.localeCompare(right.id);
}
