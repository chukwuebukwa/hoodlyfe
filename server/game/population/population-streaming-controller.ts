import {VehicleState, type DistrictState} from '../../state.ts';
import type {CollisionMap, RoadNode, TrafficSpawn} from '../../world-map.ts';
import type {PedestrianController} from '../pedestrians/pedestrian-controller.ts';
import {PEDESTRIAN_RADIUS} from '../pedestrians/pedestrian-controller.ts';
import {trafficLanePoint, type TrafficController} from '../traffic/traffic-controller.ts';
import {vehicleConfig, VEHICLE_RADIUS} from '../vehicles/vehicle-config.ts';
import type {VehicleKind} from '../../../shared/content/vehicle-catalog.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';

export const STREAMED_CIVILIAN_RECORDS = 72;
export const STREAMED_POLICE_RECORDS = 8;
export const STREAMED_TRAFFIC_RECORDS = 64;
const STREAMED_TRAFFIC_KINDS: readonly VehicleKind[] = [
  'sedan',
  'taxi',
  'sedan',
  'sedan',
  'taxi',
  'sedan'
];

export const POPULATION_STREAMING = Object.freeze({
  materializeRadius: 1_536,
  dematerializeRadius: 1_920,
  maxMaterializationsPerTick: 10,
  maxDematerializationsPerTick: 10,
  dormantStepMs: 3_000,
  maxDormantStepsPerTick: 16,
  maxActivePedestrians: 40,
  maxActiveTraffic: 24
});

interface PopulationAnchor {
  x: number;
  y: number;
}

interface VirtualPedestrianRecord {
  id: string;
  kind: 'civilian' | 'police';
  x: number;
  y: number;
  angle: number;
  active: boolean;
  step: number;
  nextStepAt: number;
}

interface VirtualTrafficRecord {
  id: string;
  kind: VehicleKind;
  spawn: TrafficSpawn;
  cruiseSpeed: number;
  active: boolean;
  step: number;
  nextStepAt: number;
}

interface PopulationStreamingControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  random: DeterministicRandom;
  pedestrians: Pick<
    PedestrianController,
    'spawnAmbientAt' | 'canStreamOut' | 'streamOutAmbient'
  >;
  traffic: Pick<TrafficController, 'register' | 'release'>;
  onVehicleMaterialized?: (vehicle: VehicleState) => void;
  onVehicleDematerialized?: (vehicleId: string) => void;
}

export interface PopulationStreamingDiagnostic {
  potentialPedestrians: number;
  activePedestrians: number;
  potentialTraffic: number;
  activeTraffic: number;
  pinnedPedestrians: number;
  pinnedTraffic: number;
}

export class PopulationStreamingController {
  private readonly pedestrians = new Map<string, VirtualPedestrianRecord>();
  private readonly traffic = new Map<string, VirtualTrafficRecord>();
  private initialized = false;
  private dormantPedestrianCursor = 0;
  private dormantTrafficCursor = 0;

  constructor(private readonly options: PopulationStreamingControllerOptions) {}

  initialize(nowMs = 0): void {
    if (this.initialized) return;
    for (let index = 0; index < STREAMED_CIVILIAN_RECORDS + STREAMED_POLICE_RECORDS; index++) {
      const id = index < STREAMED_CIVILIAN_RECORDS
        ? `stream-civilian-${index + 1}`
        : `stream-police-${index - STREAMED_CIVILIAN_RECORDS + 1}`;
      const position = this.options.world.pedestrianSpawn(5_000 + index * 47, PEDESTRIAN_RADIUS);
      this.pedestrians.set(id, {
        id,
        kind: index < STREAMED_CIVILIAN_RECORDS ? 'civilian' : 'police',
        x: position.x,
        y: position.y,
        angle: this.options.random.unit('stream-ped-angle', id) * Math.PI * 2,
        active: false,
        step: 0,
        nextStepAt: nowMs + this.stepOffset(id)
      });
    }
    for (let index = 0; index < STREAMED_TRAFFIC_RECORDS; index++) {
      const id = `stream-traffic-${index + 1}`;
      this.traffic.set(id, {
        id,
        kind: STREAMED_TRAFFIC_KINDS[index % STREAMED_TRAFFIC_KINDS.length],
        spawn: this.options.world.trafficSpawn(10_000 + index * 193, VEHICLE_RADIUS),
        cruiseSpeed: 104 + index % 8 * 7,
        active: false,
        step: 0,
        nextStepAt: nowMs + this.stepOffset(id)
      });
    }
    this.initialized = true;
  }

  update(anchors: readonly PopulationAnchor[], nowMs: number): void {
    if (!this.initialized) this.initialize(nowMs);
    const normalized = anchors.filter((anchor) => Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
    this.materializeNearby(normalized, nowMs);
    this.dematerializeFar(normalized, nowMs);
    this.advanceDormant(nowMs);
  }

  diagnostics(): PopulationStreamingDiagnostic {
    const activePedestrians = [...this.pedestrians.values()].filter((record) => record.active);
    const activeTraffic = [...this.traffic.values()].filter((record) => record.active);
    return {
      potentialPedestrians: this.pedestrians.size,
      activePedestrians: activePedestrians.length,
      potentialTraffic: this.traffic.size,
      activeTraffic: activeTraffic.length,
      pinnedPedestrians: activePedestrians.filter((record) => !this.options.pedestrians.canStreamOut(record.id)).length,
      pinnedTraffic: activeTraffic.filter((record) => {
        const vehicle = this.options.state.vehicles.get(record.id);
        return Boolean(vehicle && !this.canStreamOutVehicle(vehicle));
      }).length
    };
  }

  private materializeNearby(anchors: readonly PopulationAnchor[], nowMs: number): void {
    if (anchors.length === 0) return;
    let pedestrianBudget = Math.ceil(POPULATION_STREAMING.maxMaterializationsPerTick / 2);
    let trafficBudget = Math.floor(POPULATION_STREAMING.maxMaterializationsPerTick / 2);
    const pedestrianCandidates = [...this.pedestrians.values()]
      .filter((record) => !record.active)
      .map((record) => ({record, distance: nearestDistance(record.x, record.y, anchors)}))
      .filter((candidate) => candidate.distance <= POPULATION_STREAMING.materializeRadius)
      .sort(compareCandidate);
    pedestrianBudget = Math.min(
      pedestrianBudget,
      Math.max(0, POPULATION_STREAMING.maxActivePedestrians - this.activePedestrianCount())
    );
    for (const {record} of pedestrianCandidates) {
      if (pedestrianBudget <= 0) break;
      this.options.pedestrians.spawnAmbientAt(
        record.id,
        record.kind,
        record.x,
        record.y,
        record.angle
      );
      record.active = true;
      record.nextStepAt = nowMs + POPULATION_STREAMING.dormantStepMs;
      pedestrianBudget--;
    }

    const trafficCandidates = [...this.traffic.values()]
      .filter((record) => !record.active)
      .map((record) => ({
        record,
        distance: nearestDistance(record.spawn.x, record.spawn.y, anchors)
      }))
      .filter((candidate) => candidate.distance <= POPULATION_STREAMING.materializeRadius)
      .sort(compareCandidate);
    trafficBudget = Math.min(
      trafficBudget,
      Math.max(0, POPULATION_STREAMING.maxActiveTraffic - this.activeTrafficCount())
    );
    for (const {record} of trafficCandidates) {
      if (trafficBudget <= 0) break;
      const position = this.trafficPosition(record.spawn);
      if (!this.vehicleSpawnIsClear(position.x, position.y)) continue;
      this.materializeVehicle(record);
      record.nextStepAt = nowMs + POPULATION_STREAMING.dormantStepMs;
      trafficBudget--;
    }
  }

  private dematerializeFar(anchors: readonly PopulationAnchor[], nowMs: number): void {
    let pedestrianBudget = Math.ceil(POPULATION_STREAMING.maxDematerializationsPerTick / 2);
    let trafficBudget = Math.floor(POPULATION_STREAMING.maxDematerializationsPerTick / 2);
    for (const record of this.pedestrians.values()) {
      if (!record.active || pedestrianBudget <= 0) continue;
      const npc = this.options.state.npcs.get(record.id);
      if (!npc) {
        record.active = false;
        continue;
      }
      if (nearestDistance(npc.x, npc.y, anchors) <= POPULATION_STREAMING.dematerializeRadius) {
        continue;
      }
      if (!this.options.pedestrians.canStreamOut(record.id)) continue;
      record.x = npc.x;
      record.y = npc.y;
      record.angle = npc.angle;
      if (!this.options.pedestrians.streamOutAmbient(record.id)) continue;
      record.active = false;
      record.nextStepAt = nowMs + this.stepOffset(record.id);
      pedestrianBudget--;
    }
    for (const record of this.traffic.values()) {
      if (!record.active || trafficBudget <= 0) continue;
      const vehicle = this.options.state.vehicles.get(record.id);
      if (!vehicle) {
        record.active = false;
        continue;
      }
      if (nearestDistance(vehicle.x, vehicle.y, anchors) <= POPULATION_STREAMING.dematerializeRadius) {
        continue;
      }
      if (!this.canStreamOutVehicle(vehicle)) continue;
      this.captureVehicleRoute(record, vehicle);
      this.options.traffic.release(vehicle.id);
      this.options.state.vehicles.delete(vehicle.id);
      this.options.onVehicleDematerialized?.(vehicle.id);
      record.active = false;
      record.nextStepAt = nowMs + this.stepOffset(record.id);
      trafficBudget--;
    }
  }

  private advanceDormant(nowMs: number): void {
    const pedestrianRecords = [...this.pedestrians.values()];
    const trafficRecords = [...this.traffic.values()];
    let remaining = POPULATION_STREAMING.maxDormantStepsPerTick;
    while (remaining > 0 && pedestrianRecords.length > 0) {
      const record = pedestrianRecords[this.dormantPedestrianCursor % pedestrianRecords.length];
      this.dormantPedestrianCursor = (this.dormantPedestrianCursor + 1) % pedestrianRecords.length;
      remaining--;
      if (record.active || nowMs < record.nextStepAt) continue;
      record.step++;
      const next = this.options.world.openPointNear(
        record.x,
        record.y,
        48,
        192,
        PEDESTRIAN_RADIUS,
        20_000 + record.step * 131 + record.id.length * 17,
        true
      );
      record.angle = Math.atan2(next.y - record.y, next.x - record.x);
      record.x = next.x;
      record.y = next.y;
      record.nextStepAt = nowMs + POPULATION_STREAMING.dormantStepMs;
    }
    while (remaining > 0 && trafficRecords.length > 0) {
      const record = trafficRecords[this.dormantTrafficCursor % trafficRecords.length];
      this.dormantTrafficCursor = (this.dormantTrafficCursor + 1) % trafficRecords.length;
      remaining--;
      if (record.active || nowMs < record.nextStepAt) continue;
      this.advanceDormantTraffic(record);
      record.nextStepAt = nowMs + POPULATION_STREAMING.dormantStepMs;
    }
  }

  private advanceDormantTraffic(record: VirtualTrafficRecord): void {
    record.step++;
    const previous = {column: record.spawn.column, row: record.spawn.row};
    const current = {column: record.spawn.targetColumn, row: record.spawn.targetRow};
    const neighbors = this.options.world.roadNeighbors(current.column, current.row);
    const forwardChoices = neighbors.filter((candidate) => (
      candidate.column !== previous.column || candidate.row !== previous.row
    ));
    const choices = forwardChoices.length > 0 ? forwardChoices : neighbors;
    if (choices.length === 0) return;
    const next = choices[this.options.random.integer(
      'stream-traffic-route',
      `${record.id}:${record.step}`,
      0,
      choices.length
    )];
    const point = this.options.world.roadPoint(current);
    record.spawn = {
      x: point.x,
      y: point.y,
      column: current.column,
      row: current.row,
      targetColumn: next.column,
      targetRow: next.row,
      angle: Math.atan2(next.row - current.row, next.column - current.column)
    };
  }

  private materializeVehicle(record: VirtualTrafficRecord): void {
    const position = this.trafficPosition(record.spawn);
    const vehicle = new VehicleState();
    vehicle.id = record.id;
    vehicle.kind = record.kind;
    vehicle.x = position.x;
    vehicle.y = position.y;
    vehicle.angle = record.spawn.angle;
    vehicle.maxHealth = vehicleConfig(record.kind).maxHealth;
    vehicle.health = vehicle.maxHealth;
    vehicle.speed = record.cruiseSpeed * 0.72;
    vehicle.traffic = true;
    this.options.state.vehicles.set(vehicle.id, vehicle);
    this.options.traffic.register(vehicle.id, record.spawn, record.cruiseSpeed);
    this.options.onVehicleMaterialized?.(vehicle);
    record.active = true;
  }

  private captureVehicleRoute(record: VirtualTrafficRecord, vehicle: VehicleState): void {
    const node = this.options.world.nearestRoadNode(vehicle.x, vehicle.y, VEHICLE_RADIUS);
    if (!node) return;
    const neighbors = this.options.world.roadNeighbors(node.column, node.row);
    const next = nearestHeadingNeighbor(node, neighbors, vehicle.angle) ?? node;
    const point = this.options.world.roadPoint(node);
    record.spawn = {
      x: point.x,
      y: point.y,
      column: node.column,
      row: node.row,
      targetColumn: next.column,
      targetRow: next.row,
      angle: Math.atan2(next.row - node.row, next.column - node.column)
    };
  }

  private canStreamOutVehicle(vehicle: VehicleState): boolean {
    if (
      !vehicle.traffic ||
      vehicle.driverId ||
      vehicle.hijackBy ||
      vehicle.destroyed ||
      vehicle.onFire ||
      vehicle.health !== vehicle.maxHealth ||
      vehicle.engineDamage > 0 ||
      vehicle.damageFront > 0 ||
      vehicle.damageRear > 0 ||
      vehicle.damageLeft > 0 ||
      vehicle.damageRight > 0
    ) return false;
    for (const player of this.options.state.players.values()) {
      if (player.vehicleId === vehicle.id) return false;
    }
    for (const mission of this.options.state.missions.values()) {
      if (mission.targetVehicleId === vehicle.id) return false;
    }
    return true;
  }

  private vehicleSpawnIsClear(x: number, y: number): boolean {
    if (
      !this.options.world.canOccupy(x, y, VEHICLE_RADIUS) ||
      !this.options.world.isRoadAt(x, y)
    ) return false;
    for (const vehicle of this.options.state.vehicles.values()) {
      if (Math.hypot(vehicle.x - x, vehicle.y - y) < 64) return false;
    }
    return true;
  }

  private trafficPosition(spawn: TrafficSpawn): {x: number; y: number} {
    const lane = trafficLanePoint(spawn);
    return this.options.world.canOccupy(lane.x, lane.y, VEHICLE_RADIUS) &&
      this.options.world.isRoadAt(lane.x, lane.y)
      ? lane
      : {x: spawn.x, y: spawn.y};
  }

  private activePedestrianCount(): number {
    return [...this.pedestrians.values()].filter((record) => record.active).length;
  }

  private activeTrafficCount(): number {
    return [...this.traffic.values()].filter((record) => record.active).length;
  }

  private stepOffset(id: string): number {
    return Math.round(this.options.random.range(
      'stream-step-offset',
      id,
      0,
      POPULATION_STREAMING.dormantStepMs
    ));
  }
}

function nearestDistance(x: number, y: number, anchors: readonly PopulationAnchor[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) nearest = Math.min(nearest, Math.hypot(anchor.x - x, anchor.y - y));
  return nearest;
}

function compareCandidate<T extends {id: string}>(
  left: {record: T; distance: number},
  right: {record: T; distance: number}
): number {
  return left.distance - right.distance || left.record.id.localeCompare(right.record.id);
}

function nearestHeadingNeighbor(
  current: RoadNode,
  neighbors: readonly RoadNode[],
  angle: number
): RoadNode | undefined {
  return [...neighbors].sort((left, right) => {
    const leftAngle = Math.atan2(left.row - current.row, left.column - current.column);
    const rightAngle = Math.atan2(right.row - current.row, right.column - current.column);
    return angularDistance(leftAngle, angle) - angularDistance(rightAngle, angle) ||
      left.row - right.row || left.column - right.column;
  })[0];
}

function angularDistance(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}
