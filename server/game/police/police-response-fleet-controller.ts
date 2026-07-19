import {VehicleState, type DistrictState} from '../../state.ts';
import type {CollisionMap, TrafficSpawn} from '../../world-map.ts';
import {RoadRoutePlanner} from '../traffic/road-route-planner.ts';
import {vehicleConfig, VEHICLE_RADIUS} from '../vehicles/vehicle-config.ts';
import {
  responseLimitsForWanted,
  type PoliceResponseFleetPlan,
  type PoliceResponseFleetTarget
} from './police-response-allocation-system.ts';

const SPAWN_ATTEMPTS = 48;
const SPAWN_CLEARANCE = 96;
const MIN_PLAYER_SPAWN_DISTANCE = 360;
const MIN_TARGET_SPAWN_DISTANCE = 420;
const MAX_TARGET_SPAWN_DISTANCE = 1_360;
const STAND_DOWN_DELAY_MS = 7_500;
const SAFE_REMOVAL_DISTANCE = 520;

interface PoliceFleetRuntime {
  spawnedAt: number;
  standDownAt: number;
}

interface PoliceResponseFleetControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  responsePlan: () => PoliceResponseFleetPlan;
  police: {
    register(vehicleId: string): void;
    release(vehicleId: string): void;
    has(vehicleId: string): boolean;
  };
  onVehicleSpawned?: (vehicle: VehicleState) => void;
  onVehicleRemoved?: (vehicleId: string) => void;
}

export interface PoliceResponseFleetDiagnostic {
  desiredUnits: number;
  availableUnits: number;
  managedUnits: number;
  nextSpawnAt: number;
  targetSuspectId: string;
  demandedSuspects: number;
}

/** Owns wanted-level response population, not pursuit strategy or vehicle driving. */
export class PoliceResponseFleetController {
  private readonly managed = new Map<string, PoliceFleetRuntime>();
  private readonly planner: RoadRoutePlanner;
  private spawnSequence = 0;
  private desiredUnits = 0;
  private nextSpawnAt = 0;
  private targetSuspectId = '';
  private demandedSuspects = 0;

  constructor(private readonly options: PoliceResponseFleetControllerOptions) {
    this.planner = new RoadRoutePlanner(options.world);
  }

  update(nowMs: number): void {
    this.releaseUnavailableManagedVehicles();
    const plan = this.options.responsePlan();
    const target = plan.targets[0];
    this.desiredUnits = plan.desiredUnits;
    this.targetSuspectId = target?.suspectId ?? '';
    this.demandedSuspects = plan.targets.length;
    this.markSurplusForStandDown(nowMs);
    this.removeSafeSurplus(nowMs);

    const available = this.availablePoliceVehicles().length;
    if (!target || available >= this.desiredUnits || nowMs < this.nextSpawnAt) return;
    const spawn = this.findResponseSpawn(target, nowMs);
    this.nextSpawnAt = nowMs + responseSpawnInterval(target.wantedLevel);
    if (!spawn) return;
    this.spawn(spawn, nowMs);
  }

  diagnostics(): PoliceResponseFleetDiagnostic {
    return {
      desiredUnits: this.desiredUnits,
      availableUnits: this.availablePoliceVehicles().length,
      managedUnits: this.managed.size,
      nextSpawnAt: this.nextSpawnAt,
      targetSuspectId: this.targetSuspectId,
      demandedSuspects: this.demandedSuspects
    };
  }

  managedVehicleIds(): string[] {
    return [...this.managed.keys()].sort();
  }

  private availablePoliceVehicles(): VehicleState[] {
    return [...this.options.state.vehicles.values()].filter((vehicle) => (
      vehicle.kind === 'police' &&
      !vehicle.destroyed &&
      !vehicle.hijackBy &&
      !vehicle.driverId &&
      this.options.police.has(vehicle.id)
    ));
  }

  private releaseUnavailableManagedVehicles(): void {
    for (const vehicleId of this.managed.keys()) {
      const vehicle = this.options.state.vehicles.get(vehicleId);
      if (vehicle && !vehicle.destroyed && !vehicle.hijackBy && !vehicle.driverId) continue;
      this.options.police.release(vehicleId);
      this.managed.delete(vehicleId);
    }
  }

  private markSurplusForStandDown(nowMs: number): void {
    const surplus = Math.max(0, this.availablePoliceVehicles().length - this.desiredUnits);
    const candidates = [...this.managed.entries()]
      .filter(([vehicleId]) => this.options.state.vehicles.has(vehicleId))
      .sort((left, right) => right[1].spawnedAt - left[1].spawnedAt);
    for (let index = 0; index < candidates.length; index++) {
      const runtime = candidates[index][1];
      if (index < surplus) {
        if (runtime.standDownAt === 0) runtime.standDownAt = nowMs + STAND_DOWN_DELAY_MS;
      } else {
        runtime.standDownAt = 0;
      }
    }
  }

  private removeSafeSurplus(nowMs: number): void {
    const streetPlayers = [...this.options.state.players.values()]
      .filter((player) => player.spaceId === 'street');
    for (const [vehicleId, runtime] of this.managed) {
      if (runtime.standDownAt === 0 || nowMs < runtime.standDownAt) continue;
      const vehicle = this.options.state.vehicles.get(vehicleId);
      if (!vehicle || vehicle.destroyed || vehicle.hijackBy || vehicle.driverId) continue;
      if (streetPlayers.some((player) => (
        Math.hypot(player.x - vehicle.x, player.y - vehicle.y) < SAFE_REMOVAL_DISTANCE
      ))) continue;
      this.options.police.release(vehicleId);
      this.options.state.vehicles.delete(vehicleId);
      this.options.onVehicleRemoved?.(vehicleId);
      this.managed.delete(vehicleId);
    }
  }

  private findResponseSpawn(target: PoliceResponseFleetTarget, nowMs: number): TrafficSpawn | undefined {
    const targetNode = this.options.world.nearestRoadNode(target.x, target.y, VEHICLE_RADIUS);
    if (!targetNode) return undefined;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const seed = 40_000 + this.spawnSequence * 977 + Math.floor(nowMs / 1_000) * 17 + attempt * 53;
      const spawn = this.options.world.trafficSpawn(seed, VEHICLE_RADIUS);
      const targetDistance = Math.hypot(spawn.x - target.x, spawn.y - target.y);
      if (targetDistance < MIN_TARGET_SPAWN_DISTANCE || targetDistance > MAX_TARGET_SPAWN_DISTANCE) {
        continue;
      }
      if (!this.isClear(spawn.x, spawn.y)) continue;
      const spawnNode = this.options.world.nearestRoadNode(spawn.x, spawn.y, VEHICLE_RADIUS);
      if (!spawnNode || !this.planner.plan(spawnNode, targetNode).complete) continue;
      return spawn;
    }
    return undefined;
  }

  private isClear(x: number, y: number): boolean {
    if (!this.options.world.canOccupy(x, y, VEHICLE_RADIUS)) return false;
    for (const vehicle of this.options.state.vehicles.values()) {
      if (Math.hypot(vehicle.x - x, vehicle.y - y) < SPAWN_CLEARANCE) return false;
    }
    for (const player of this.options.state.players.values()) {
      if (
        player.spaceId === 'street' &&
        Math.hypot(player.x - x, player.y - y) < MIN_PLAYER_SPAWN_DISTANCE
      ) return false;
    }
    return true;
  }

  private spawn(spawn: TrafficSpawn, nowMs: number): void {
    this.spawnSequence++;
    const vehicle = new VehicleState();
    vehicle.id = `police-response-${this.spawnSequence}`;
    vehicle.kind = 'police';
    vehicle.x = spawn.x;
    vehicle.y = spawn.y;
    if (spawn.surfaceId) vehicle.surfaceId = spawn.surfaceId;
    vehicle.angle = spawn.angle;
    vehicle.maxHealth = vehicleConfig(vehicle.kind).maxHealth;
    vehicle.health = vehicle.maxHealth;
    vehicle.speed = 70;
    // Marks an active AI driver so vehicle entry uses the hijack lifecycle.
    vehicle.traffic = true;
    this.options.state.vehicles.set(vehicle.id, vehicle);
    this.options.police.register(vehicle.id);
    this.managed.set(vehicle.id, {spawnedAt: nowMs, standDownAt: 0});
    this.options.onVehicleSpawned?.(vehicle);
  }
}

export function responseVehicleLimit(wantedLevel: number): number {
  return responseLimitsForWanted(wantedLevel).vehicle;
}

export function responseSpawnInterval(wantedLevel: number): number {
  if (wantedLevel >= 3) return 1_800;
  if (wantedLevel >= 2) return 3_000;
  return 5_000;
}
