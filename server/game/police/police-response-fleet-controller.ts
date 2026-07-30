import {VehicleState, type DistrictState, type NpcState} from '../../state.ts';
import type {CollisionMap, TrafficSpawn} from '../../world-map.ts';
import {PEDESTRIAN_RADIUS} from '../pedestrians/pedestrian-config.ts';
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
const CREW_EXIT_OFFSET = 44;
const CREW_RETURN_DISTANCE = 38;
const CREW_RETURN_SPEED = 122;

interface PoliceFleetRuntime {
  spawnedAt: number;
  standDownAt: number;
}

type PoliceCruiserCrewPhase = 'pursuing' | 'returning';

interface PoliceCruiserCrewRuntime {
  vehicleId: string;
  suspectId: string;
  officerIds: string[];
  phase: PoliceCruiserCrewPhase;
  deployedAt: number;
  returningAt: number;
}

interface PoliceCrewPedestrianPort {
  spawnAmbientAt(
    id: string,
    kind: 'civilian' | 'police',
    x: number,
    y: number,
    angle: number,
    surfaceId?: string
  ): NpcState;
  commandMoveTo(
    npcId: string,
    x: number,
    y: number,
    stopDistance?: number,
    speed?: number,
    action?: string
  ): boolean;
  clearMoveCommand(npcId: string): void;
  removeManaged(npcId: string): boolean;
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
  pedestrians?: () => PoliceCrewPedestrianPort;
  onCrewDeployed?: (
    vehicleId: string,
    suspectId: string,
    officers: readonly NpcState[],
    nowMs: number
  ) => void;
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
  dismountedCrews: number;
}

/** Owns wanted-level response population, not pursuit strategy or vehicle driving. */
export class PoliceResponseFleetController {
  private readonly managed = new Map<string, PoliceFleetRuntime>();
  private readonly crews = new Map<string, PoliceCruiserCrewRuntime>();
  private readonly crewGeneration = new Map<string, number>();
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
    this.updateCrews(nowMs);
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
      demandedSuspects: this.demandedSuspects,
      dismountedCrews: this.crews.size
    };
  }

  managedVehicleIds(): string[] {
    return [...this.managed.keys()].sort();
  }

  ownsDismountedVehicle(vehicleId: string): boolean {
    return this.crews.has(vehicleId);
  }

  dismount(vehicleId: string, suspectId: string, nowMs: number): boolean {
    const vehicle = this.options.state.vehicles.get(vehicleId);
    const pedestrians = this.options.pedestrians?.();
    if (
      !vehicle ||
      vehicle.kind !== 'police' ||
      vehicle.destroyed ||
      vehicle.hijackBy ||
      vehicle.driverId ||
      !this.options.police.has(vehicleId) ||
      !pedestrians ||
      this.crews.has(vehicleId) ||
      [...this.crews.values()].some((crew) => crew.suspectId === suspectId)
    ) return false;

    const generation = (this.crewGeneration.get(vehicleId) ?? 0) + 1;
    const officerIds = [
      `${vehicleId}:crew:${generation}:driver`,
      `${vehicleId}:crew:${generation}:passenger`
    ];
    const positions = [-1, 1].map((side, index) => (
      this.crewExitPosition(vehicle, side, nowMs + index * 37)
    ));
    const suspect = this.options.state.players.get(suspectId);
    const officers: NpcState[] = [];
    try {
      for (let index = 0; index < officerIds.length; index++) {
        const position = positions[index];
        const angle = suspect
          ? Math.atan2(suspect.y - position.y, suspect.x - position.x)
          : vehicle.angle;
        const officer = pedestrians.spawnAmbientAt(
          officerIds[index],
          'police',
          position.x,
          position.y,
          angle,
          position.surfaceId
        );
        officer.action = 'pursue';
        officers.push(officer);
      }
    } catch (error) {
      for (const officer of officers) pedestrians.removeManaged(officer.id);
      throw error;
    }

    this.crewGeneration.set(vehicleId, generation);
    this.crews.set(vehicleId, {
      vehicleId,
      suspectId,
      officerIds,
      phase: 'pursuing',
      deployedAt: nowMs,
      returningAt: 0
    });
    vehicle.speed = 0;
    vehicle.linvelX = 0;
    vehicle.linvelY = 0;
    vehicle.angvel = 0;
    vehicle.traffic = false;
    vehicle.siren = true;
    this.options.police.release(vehicleId);
    this.options.onCrewDeployed?.(vehicleId, suspectId, officers, nowMs);
    return true;
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
      if (this.crews.has(vehicleId) && vehicle && !vehicle.destroyed && !vehicle.hijackBy) continue;
      if (vehicle && !vehicle.destroyed && !vehicle.hijackBy && !vehicle.driverId) continue;
      this.abandonCrew(vehicleId);
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
      if (this.crews.has(vehicleId)) continue;
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

  private updateCrews(nowMs: number): void {
    const pedestrians = this.options.pedestrians?.();
    if (!pedestrians) return;
    for (const crew of [...this.crews.values()]) {
      const vehicle = this.options.state.vehicles.get(crew.vehicleId);
      if (!vehicle || vehicle.destroyed || vehicle.hijackBy || vehicle.driverId) {
        this.abandonCrew(crew.vehicleId);
        continue;
      }
      const suspect = this.options.state.players.get(crew.suspectId);
      if (
        crew.phase === 'pursuing' &&
        (!suspect?.alive || suspect.spaceId !== 'street' || suspect.wanted <= 0)
      ) {
        crew.phase = 'returning';
        crew.returningAt = nowMs;
      } else if (
        crew.phase === 'returning' &&
        suspect?.alive &&
        suspect.spaceId === 'street' &&
        suspect.wanted > 0
      ) {
        crew.phase = 'pursuing';
        crew.returningAt = 0;
        for (const officerId of crew.officerIds) pedestrians.clearMoveCommand(officerId);
      }
      if (crew.phase !== 'returning') continue;

      const livingOfficers = crew.officerIds
        .map((officerId) => this.options.state.npcs.get(officerId))
        .filter((officer): officer is NpcState => Boolean(officer?.alive));
      for (const officer of livingOfficers) {
        pedestrians.commandMoveTo(
          officer.id,
          vehicle.x,
          vehicle.y,
          CREW_RETURN_DISTANCE,
          CREW_RETURN_SPEED,
          'return-to-car'
        );
      }
      if (livingOfficers.some((officer) => (
        Math.hypot(officer.x - vehicle.x, officer.y - vehicle.y) > CREW_RETURN_DISTANCE
      ))) continue;

      for (const officerId of crew.officerIds) pedestrians.removeManaged(officerId);
      this.crews.delete(crew.vehicleId);
      vehicle.traffic = true;
      vehicle.siren = false;
      this.options.police.register(vehicle.id);
    }
  }

  private abandonCrew(vehicleId: string): void {
    const crew = this.crews.get(vehicleId);
    const pedestrians = this.options.pedestrians?.();
    if (!crew || !pedestrians) return;
    for (const officerId of crew.officerIds) pedestrians.clearMoveCommand(officerId);
    this.crews.delete(vehicleId);
  }

  private crewExitPosition(
    vehicle: VehicleState,
    side: number,
    seed: number
  ): {x: number; y: number; surfaceId?: string} {
    const angle = vehicle.angle + side * Math.PI / 2;
    const x = vehicle.x + Math.cos(angle) * CREW_EXIT_OFFSET;
    const y = vehicle.y + Math.sin(angle) * CREW_EXIT_OFFSET;
    if (
      this.options.world.canOccupy(
        x,
        y,
        PEDESTRIAN_RADIUS,
        vehicle.surfaceId,
        'pedestrian'
      )
    ) {
      return {x, y, surfaceId: vehicle.surfaceId};
    }
    return this.options.world.openPointNear(
      vehicle.x,
      vehicle.y,
      34,
      82,
      PEDESTRIAN_RADIUS,
      seed
    );
  }
}

export function responseVehicleLimit(wantedLevel: number): number {
  return responseLimitsForWanted(wantedLevel).vehicle;
}

export function responseSpawnInterval(wantedLevel: number): number {
  if (wantedLevel >= 4) return 1_800;
  if (wantedLevel >= 3) return 2_600;
  if (wantedLevel >= 2) return 4_000;
  return 5_000;
}
