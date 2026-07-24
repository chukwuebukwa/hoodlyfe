import {VehicleState, type DistrictState, type NpcState} from '../../state.ts';
import type {CollisionMap, TrafficSpawn} from '../../world-map.ts';
import type {PedestrianController} from '../pedestrians/pedestrian-controller.ts';
import {PEDESTRIAN_RADIUS} from '../pedestrians/pedestrian-config.ts';
import {trafficLanePoint, type TrafficController} from '../traffic/traffic-controller.ts';
import {vehicleConfig, VEHICLE_RADIUS} from '../vehicles/vehicle-config.ts';
import {
  CIVILIAN_TRAFFIC_VEHICLE_KINDS,
  type VehicleKind
} from '../../../shared/content/vehicle-catalog.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import {
  TRAFFIC_JAM_RETIREMENT,
  selectInvisibleTrafficJamRetirements
} from './traffic-jam-retirement-policy.ts';
import {
  POPULATION_INTEREST,
  nearestPopulationAnchorDistance,
  populationInterestAt,
  type PopulationInterestAnchor
} from './population-activation-policy.ts';
import {
  nearestPopulationInterestCluster,
  populationInterestClusters,
  type PopulationInterestCluster
} from './population-interest-cluster-policy.ts';
import {
  fairPopulationCandidateOrder,
  populationClusterCapacityPlan
} from './population-cluster-capacity-policy.ts';
import {PopulationZoneProfileController} from './population-zone-profile-controller.ts';

export const STREAMED_CIVILIAN_RECORDS = 72;
export const STREAMED_POLICE_RECORDS = 8;
export const STREAMED_TRAFFIC_RECORDS = 64;
const STREAMING_DENSITY_REFERENCE_TILES = 96 * 96;
const MAXIMUM_STREAMING_DENSITY_SCALE = 8;
const STREAMED_TRAFFIC_KINDS: readonly VehicleKind[] = CIVILIAN_TRAFFIC_VEHICLE_KINDS;

export const POPULATION_STREAMING = Object.freeze({
  materializeRadius: POPULATION_INTEREST.prewarmRadius,
  dematerializeRadius: POPULATION_INTEREST.retentionRadius,
  maxMaterializationsPerTick: 10,
  maxDematerializationsPerTick: 10,
  dormantStepMs: 3_000,
  maxDormantStepsPerTick: 16,
  maxActivePedestrians: 40,
  maxActiveTraffic: 18
});

interface VirtualPedestrianRecord {
  id: string;
  kind: 'civilian' | 'police';
  x: number;
  y: number;
  surfaceId: string;
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
  enabled?: boolean;
  pedestrians: Pick<
    PedestrianController,
    'spawnAmbientAt' | 'canStreamOut' | 'streamOutAmbient'
  >;
  traffic: Pick<
    TrafficController,
    'register' | 'release' | 'spawn' | 'advanceVirtual' | 'captureVirtual' | 'diagnostics'
  > & {allowsSpawn?: (spawn: TrafficSpawn) => boolean};
  worldMinute?: () => number;
  onVehicleMaterialized?: (vehicle: VehicleState) => void;
  onVehicleDematerialized?: (vehicleId: string) => void;
}

interface DematerializationBudget {
  pedestrians: number;
  traffic: number;
}

export interface PopulationStreamingDiagnostic {
  potentialPedestrians: number;
  activePedestrians: number;
  potentialTraffic: number;
  activeTraffic: number;
  pinnedPedestrians: number;
  pinnedTraffic: number;
  jamRetirements: number;
  hotActors: number;
  warmActors: number;
  dormantActors: number;
  deferredVisibleActors: number;
  lookaheadAnchors: number;
  interestClusters: number;
  quotaPressureClusters: number;
  quotaRebalances: number;
  worldMinute: number;
  populationDayWeight: number;
  zoneActivity: string;
  profileDeferredActors: number;
  profileRebalances: number;
}

export interface StreamedPopulationTargets {
  civilians: number;
  police: number;
  traffic: number;
}

export function streamedPopulationTargets(
  world: Pick<CollisionMap, 'width' | 'height'>
): StreamedPopulationTargets {
  const rawArea = world.width * world.height;
  const area = Number.isFinite(rawArea) && rawArea > 0
    ? rawArea
    : STREAMING_DENSITY_REFERENCE_TILES;
  const scale = Math.min(
    MAXIMUM_STREAMING_DENSITY_SCALE,
    Math.max(1, area / STREAMING_DENSITY_REFERENCE_TILES)
  );
  return {
    civilians: Math.round(STREAMED_CIVILIAN_RECORDS * scale),
    police: Math.round(STREAMED_POLICE_RECORDS * scale),
    traffic: Math.round(STREAMED_TRAFFIC_RECORDS * scale)
  };
}

export class PopulationStreamingController {
  private readonly pedestrians = new Map<string, VirtualPedestrianRecord>();
  private readonly traffic = new Map<string, VirtualTrafficRecord>();
  private initialized = false;
  private dormantPedestrianCursor = 0;
  private dormantTrafficCursor = 0;
  private readonly trafficStationarySince = new Map<string, number>();
  private anchors: PopulationInterestAnchor[] = [];
  private clusters: PopulationInterestCluster[] = [];
  private lastJamRetirementAt = Number.NEGATIVE_INFINITY;
  private jamRetirementCount = 0;
  private quotaRebalanceCount = 0;
  private profileRebalanceCount = 0;
  private readonly zoneProfiles: PopulationZoneProfileController;

  constructor(private readonly options: PopulationStreamingControllerOptions) {
    this.zoneProfiles = new PopulationZoneProfileController({
      random: options.random,
      worldMinute: options.worldMinute
    });
  }

  initialize(nowMs = 0): void {
    if (this.initialized) return;
    if (this.options.enabled === false) {
      this.initialized = true;
      return;
    }
    const targets = streamedPopulationTargets(this.options.world);
    for (let index = 0; index < targets.civilians + targets.police; index++) {
      const id = index < targets.civilians
        ? `stream-civilian-${index + 1}`
        : `stream-police-${index - targets.civilians + 1}`;
      const position = this.options.world.pedestrianSpawn(5_000 + index * 47, PEDESTRIAN_RADIUS);
      this.pedestrians.set(id, {
        id,
        kind: index < targets.civilians ? 'civilian' : 'police',
        x: position.x,
        y: position.y,
        surfaceId: position.surfaceId,
        angle: this.options.random.unit('stream-ped-angle', id) * Math.PI * 2,
        active: false,
        step: 0,
        nextStepAt: nowMs + this.stepOffset(id)
      });
    }
    for (let index = 0; index < targets.traffic; index++) {
      const id = `stream-traffic-${index + 1}`;
      this.traffic.set(id, {
        id,
        kind: STREAMED_TRAFFIC_KINDS[index % STREAMED_TRAFFIC_KINDS.length],
        spawn: this.options.traffic.spawn(10_000 + index * 193, VEHICLE_RADIUS),
        cruiseSpeed: 104 + index % 8 * 7,
        active: false,
        step: 0,
        nextStepAt: nowMs + this.stepOffset(id)
      });
    }
    this.initialized = true;
  }

  update(anchors: readonly PopulationInterestAnchor[], nowMs: number): void {
    if (!this.initialized) this.initialize(nowMs);
    if (this.options.enabled === false) return;
    this.zoneProfiles.update();
    const normalized = anchors.filter((anchor) => Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
    this.anchors = normalized.map((anchor) => ({
      x: anchor.x,
      y: anchor.y,
      kind: anchor.kind,
      protectsVisibility: anchor.protectsVisibility,
      ownerId: anchor.ownerId
    }));
    this.clusters = populationInterestClusters(this.anchors);
    const dematerializationBudget: DematerializationBudget = {
      pedestrians: Math.ceil(POPULATION_STREAMING.maxDematerializationsPerTick / 2),
      traffic: Math.floor(POPULATION_STREAMING.maxDematerializationsPerTick / 2)
    };
    this.rebalanceClusterQuotas(normalized, nowMs, dematerializationBudget);
    this.rebalanceZoneProfiles(normalized, nowMs, dematerializationBudget);
    this.materializeNearby(normalized, nowMs);
    this.retireInvisibleTrafficJams(normalized, nowMs);
    this.dematerializeFar(normalized, nowMs, dematerializationBudget);
    this.advanceDormant(nowMs);
  }

  diagnostics(): PopulationStreamingDiagnostic {
    const activePedestrians = [...this.pedestrians.values()].filter((record) => record.active);
    const activeTraffic = [...this.traffic.values()].filter((record) => record.active);
    const profile = this.zoneProfiles.diagnostics([
      ...activePedestrians.map((record) => this.options.state.npcs.get(record.id))
        .filter((npc): npc is NpcState => Boolean(npc)),
      ...activeTraffic.map((record) => this.options.state.vehicles.get(record.id))
        .filter((vehicle): vehicle is VehicleState => Boolean(vehicle))
    ]);
    let hotActors = 0;
    let warmActors = 0;
    let deferredVisibleActors = 0;
    for (const record of this.pedestrians.values()) {
      const npc = record.active ? this.options.state.npcs.get(record.id) : undefined;
      const interest = populationInterestAt(npc?.x ?? record.x, npc?.y ?? record.y, this.anchors);
      if (record.active && interest.tier === 'hot') hotActors++;
      else if (record.active && interest.retain) warmActors++;
      else if (!record.active && interest.tier === 'hot') deferredVisibleActors++;
    }
    for (const record of this.traffic.values()) {
      const vehicle = record.active ? this.options.state.vehicles.get(record.id) : undefined;
      const position = vehicle ?? this.trafficPosition(record.spawn);
      const interest = populationInterestAt(position.x, position.y, this.anchors);
      if (record.active && interest.tier === 'hot') hotActors++;
      else if (record.active && interest.retain) warmActors++;
      else if (!record.active && interest.tier === 'hot') deferredVisibleActors++;
    }
    return {
      potentialPedestrians: this.pedestrians.size,
      activePedestrians: activePedestrians.length,
      potentialTraffic: this.traffic.size,
      activeTraffic: activeTraffic.length,
      pinnedPedestrians: activePedestrians.filter((record) => !this.options.pedestrians.canStreamOut(record.id)).length,
      pinnedTraffic: activeTraffic.filter((record) => {
        const vehicle = this.options.state.vehicles.get(record.id);
        return Boolean(vehicle && !this.canStreamOutVehicle(vehicle));
      }).length,
      jamRetirements: this.jamRetirementCount,
      hotActors,
      warmActors,
      dormantActors: this.pedestrians.size + this.traffic.size - activePedestrians.length - activeTraffic.length,
      deferredVisibleActors,
      lookaheadAnchors: this.anchors.filter((anchor) => anchor.kind === 'lookahead').length,
      interestClusters: this.clusters.length,
      quotaPressureClusters: this.quotaPressureClusters(),
      quotaRebalances: this.quotaRebalanceCount,
      worldMinute: profile.worldMinute,
      populationDayWeight: profile.populationDayWeight,
      zoneActivity: profile.zoneActivity,
      profileDeferredActors: this.profileDeferredActorCount(),
      profileRebalances: this.profileRebalanceCount
    };
  }

  retireDestroyedVehicle(vehicleId: string, nowMs: number): boolean {
    const record = this.traffic.get(vehicleId);
    const vehicle = this.options.state.vehicles.get(vehicleId);
    if (!record?.active || !vehicle?.destroyed) return false;
    this.options.traffic.release(vehicleId);
    this.options.state.vehicles.delete(vehicleId);
    this.options.onVehicleDematerialized?.(vehicleId);
    record.active = false;
    record.spawn = this.options.traffic.spawn(nowMs + vehicleId.length * 97, VEHICLE_RADIUS);
    record.nextStepAt = nowMs + this.stepOffset(vehicleId);
    this.trafficStationarySince.delete(vehicleId);
    return true;
  }

  private retireInvisibleTrafficJams(
    anchors: readonly PopulationInterestAnchor[],
    nowMs: number
  ): void {
    const diagnostics = this.options.traffic.diagnostics();
    const diagnosticById = new Map(diagnostics.map((entry) => [entry.vehicleId, entry]));
    const blockedFollowers = new Map<string, number>();
    for (const diagnostic of diagnostics) {
      if (diagnostic.speedReason !== 'vehicle' || !diagnostic.obstacleId) continue;
      blockedFollowers.set(
        diagnostic.obstacleId,
        (blockedFollowers.get(diagnostic.obstacleId) ?? 0) + 1
      );
    }

    const candidates = [];
    for (const record of this.traffic.values()) {
      if (!record.active) {
        this.trafficStationarySince.delete(record.id);
        continue;
      }
      const vehicle = this.options.state.vehicles.get(record.id);
      const diagnostic = diagnosticById.get(record.id);
      if (!vehicle || !diagnostic) {
        this.trafficStationarySince.delete(record.id);
        continue;
      }
      if (Math.abs(vehicle.speed) > 6) {
        this.trafficStationarySince.delete(record.id);
        continue;
      }
      const stationarySince = this.trafficStationarySince.get(record.id) ?? nowMs;
      this.trafficStationarySince.set(record.id, stationarySince);
      candidates.push({
        id: record.id,
        distance: nearestPopulationAnchorDistance(vehicle.x, vehicle.y, anchors),
        stationarySince,
        blockedFollowerCount: blockedFollowers.get(record.id) ?? 0,
        speedReason: diagnostic.speedReason,
        streamable: this.canRetireJammedVehicle(vehicle)
      });
    }

    if (nowMs - this.lastJamRetirementAt < TRAFFIC_JAM_RETIREMENT.cooldownMs) return;
    const selected = selectInvisibleTrafficJamRetirements(candidates, nowMs);
    if (selected.length === 0) return;
    for (const candidate of selected) this.retireJammedVehicle(candidate.id, nowMs);
    this.lastJamRetirementAt = nowMs;
  }

  private retireJammedVehicle(vehicleId: string, nowMs: number): void {
    const record = this.traffic.get(vehicleId);
    const vehicle = this.options.state.vehicles.get(vehicleId);
    if (!record?.active || !vehicle || !this.canRetireJammedVehicle(vehicle)) return;
    this.captureVehicleRoute(record, vehicle);
    this.options.traffic.release(vehicle.id);
    this.options.state.vehicles.delete(vehicle.id);
    this.options.onVehicleDematerialized?.(vehicle.id);
    record.active = false;
    for (let index = 0; index < TRAFFIC_JAM_RETIREMENT.virtualAdvanceSteps; index++) {
      this.advanceDormantTraffic(record);
    }
    record.nextStepAt = nowMs + POPULATION_STREAMING.dormantStepMs;
    this.trafficStationarySince.delete(vehicleId);
    this.jamRetirementCount++;
  }

  private rebalanceClusterQuotas(
    anchors: readonly PopulationInterestAnchor[],
    nowMs: number,
    budget: DematerializationBudget
  ): void {
    if (this.clusters.length <= 1) return;
    this.rebalancePedestrianClusters(anchors, nowMs, budget);
    this.rebalanceTrafficClusters(anchors, nowMs, budget);
  }

  private rebalanceZoneProfiles(
    anchors: readonly PopulationInterestAnchor[],
    nowMs: number,
    budget: DematerializationBudget
  ): void {
    if (!this.zoneProfiles.enabled) return;
    for (const record of this.pedestrians.values()) {
      if (!record.active || budget.pedestrians <= 0) continue;
      const npc = this.options.state.npcs.get(record.id);
      if (!npc) continue;
      if (populationInterestAt(npc.x, npc.y, anchors).tier === 'hot') continue;
      if (this.zoneProfiles.pedestrianAdmits(record.id, npc.x, npc.y)) continue;
      if (!this.options.pedestrians.canStreamOut(record.id)) continue;
      if (!this.dematerializePedestrian(record, npc, nowMs)) continue;
      budget.pedestrians--;
      this.profileRebalanceCount++;
    }
    for (const record of this.traffic.values()) {
      if (!record.active || budget.traffic <= 0) continue;
      const vehicle = this.options.state.vehicles.get(record.id);
      if (!vehicle) continue;
      if (populationInterestAt(vehicle.x, vehicle.y, anchors).tier === 'hot') continue;
      if (this.zoneProfiles.trafficAdmits(record.id, vehicle.x, vehicle.y)) continue;
      if (!this.canStreamOutVehicle(vehicle)) continue;
      if (!this.dematerializeVehicle(record, vehicle, nowMs)) continue;
      budget.traffic--;
      this.profileRebalanceCount++;
    }
  }

  private rebalancePedestrianClusters(
    anchors: readonly PopulationInterestAnchor[],
    nowMs: number,
    budget: DematerializationBudget
  ): void {
    const counts = this.activePedestrianCountsByCluster();
    const plan = populationClusterCapacityPlan(
      this.clusters,
      POPULATION_STREAMING.maxActivePedestrians,
      counts,
      this.pedestrianDemandByCluster(anchors)
    );
    let relief = plan.reliefNeeded;
    if (relief <= 0 || budget.pedestrians <= 0) return;

    const candidates = [...this.pedestrians.values()]
      .filter((record) => record.active)
      .map((record) => {
        const npc = this.options.state.npcs.get(record.id);
        const nearest = npc
          ? nearestPopulationInterestCluster(npc.x, npc.y, this.clusters)
          : undefined;
        return {record, npc, nearest};
      })
      .filter((candidate): candidate is {
        record: VirtualPedestrianRecord;
        npc: NpcState;
        nearest: NonNullable<typeof candidate.nearest>;
      } => Boolean(
        candidate.npc &&
        candidate.nearest &&
        populationInterestAt(candidate.npc.x, candidate.npc.y, anchors).tier !== 'hot' &&
        this.options.pedestrians.canStreamOut(candidate.record.id)
      ))
      .sort((left, right) => (
        right.nearest.distance - left.nearest.distance ||
        left.record.id.localeCompare(right.record.id)
      ));

    for (const candidate of candidates) {
      if (relief <= 0 || budget.pedestrians <= 0) break;
      const clusterId = candidate.nearest.cluster.id;
      const count = counts.get(clusterId) ?? 0;
      if (count <= (plan.quotaByCluster.get(clusterId) ?? 0)) continue;
      if (!this.dematerializePedestrian(candidate.record, candidate.npc, nowMs)) continue;
      counts.set(clusterId, count - 1);
      relief--;
      budget.pedestrians--;
      this.quotaRebalanceCount++;
    }
  }

  private rebalanceTrafficClusters(
    anchors: readonly PopulationInterestAnchor[],
    nowMs: number,
    budget: DematerializationBudget
  ): void {
    const counts = this.activeTrafficCountsByCluster();
    const plan = populationClusterCapacityPlan(
      this.clusters,
      POPULATION_STREAMING.maxActiveTraffic,
      counts,
      this.trafficDemandByCluster(anchors)
    );
    let relief = plan.reliefNeeded;
    if (relief <= 0 || budget.traffic <= 0) return;

    const candidates = [...this.traffic.values()]
      .filter((record) => record.active)
      .map((record) => {
        const vehicle = this.options.state.vehicles.get(record.id);
        const nearest = vehicle
          ? nearestPopulationInterestCluster(vehicle.x, vehicle.y, this.clusters)
          : undefined;
        return {record, vehicle, nearest};
      })
      .filter((candidate): candidate is {
        record: VirtualTrafficRecord;
        vehicle: VehicleState;
        nearest: NonNullable<typeof candidate.nearest>;
      } => Boolean(
        candidate.vehicle &&
        candidate.nearest &&
        populationInterestAt(candidate.vehicle.x, candidate.vehicle.y, anchors).tier !== 'hot' &&
        this.canStreamOutVehicle(candidate.vehicle)
      ))
      .sort((left, right) => (
        right.nearest.distance - left.nearest.distance ||
        left.record.id.localeCompare(right.record.id)
      ));

    for (const candidate of candidates) {
      if (relief <= 0 || budget.traffic <= 0) break;
      const clusterId = candidate.nearest.cluster.id;
      const count = counts.get(clusterId) ?? 0;
      if (count <= (plan.quotaByCluster.get(clusterId) ?? 0)) continue;
      if (!this.dematerializeVehicle(candidate.record, candidate.vehicle, nowMs)) continue;
      counts.set(clusterId, count - 1);
      relief--;
      budget.traffic--;
      this.quotaRebalanceCount++;
    }
  }

  private materializeNearby(anchors: readonly PopulationInterestAnchor[], nowMs: number): void {
    if (anchors.length === 0 || this.clusters.length === 0) return;
    let pedestrianBudget = Math.ceil(POPULATION_STREAMING.maxMaterializationsPerTick / 2);
    let trafficBudget = Math.floor(POPULATION_STREAMING.maxMaterializationsPerTick / 2);
    const pedestrianCounts = this.activePedestrianCountsByCluster();
    const pedestrianCandidates = [...this.pedestrians.values()]
      .filter((record) => !record.active)
      .map((record) => ({
        record,
        interest: populationInterestAt(record.x, record.y, anchors),
        nearest: nearestPopulationInterestCluster(record.x, record.y, this.clusters)
      }))
      .filter((candidate) => (
        candidate.interest.materialize &&
        candidate.nearest &&
        this.zoneProfiles.pedestrianAdmits(
          candidate.record.id,
          candidate.record.x,
          candidate.record.y
        )
      ))
      .map(({record, nearest}) => ({
        record,
        distance: nearest!.distance,
        clusterId: nearest!.cluster.id
      }))
      .sort(compareCandidate);
    pedestrianBudget = Math.min(
      pedestrianBudget,
      Math.max(0, POPULATION_STREAMING.maxActivePedestrians - this.activePedestrianCount())
    );
    const orderedPedestrians = fairPopulationCandidateOrder(
      this.clusters,
      POPULATION_STREAMING.maxActivePedestrians,
      pedestrianCounts,
      pedestrianCandidates
    );
    for (const {record} of orderedPedestrians) {
      if (pedestrianBudget <= 0) break;
      if (this.zoneProfiles.enabled) {
        record.kind = this.zoneProfiles.pedestrianKind(record.id, record.x, record.y);
      }
      this.options.pedestrians.spawnAmbientAt(
        record.id,
        record.kind,
        record.x,
        record.y,
        record.angle,
        record.surfaceId
      );
      record.active = true;
      record.nextStepAt = nowMs + POPULATION_STREAMING.dormantStepMs;
      pedestrianBudget--;
    }

    const trafficCounts = this.activeTrafficCountsByCluster();
    const trafficCandidates = [...this.traffic.values()]
      .filter((record) => !record.active)
      .map((record) => {
        const position = this.trafficPosition(record.spawn);
        return {
          record,
          position,
          interest: populationInterestAt(position.x, position.y, anchors),
          nearest: nearestPopulationInterestCluster(position.x, position.y, this.clusters)
        };
      })
      .filter((candidate) => (
        candidate.interest.materialize &&
        candidate.nearest &&
        this.zoneProfiles.trafficAdmits(
          candidate.record.id,
          candidate.position.x,
          candidate.position.y
        )
      ))
      .map(({record, position, nearest}) => ({
        record,
        position,
        distance: nearest!.distance,
        clusterId: nearest!.cluster.id
      }))
      .sort(compareCandidate);
    trafficBudget = Math.min(
      trafficBudget,
      Math.max(0, POPULATION_STREAMING.maxActiveTraffic - this.activeTrafficCount())
    );
    const orderedTraffic = fairPopulationCandidateOrder(
      this.clusters,
      POPULATION_STREAMING.maxActiveTraffic,
      trafficCounts,
      trafficCandidates
    );
    for (const candidate of orderedTraffic) {
      if (trafficBudget <= 0) break;
      if (this.options.traffic.allowsSpawn?.(candidate.record.spawn) === false) continue;
      if (!this.vehicleSpawnIsClear(candidate.position.x, candidate.position.y)) continue;
      this.materializeVehicle(candidate.record);
      candidate.record.nextStepAt = nowMs + POPULATION_STREAMING.dormantStepMs;
      trafficBudget--;
    }
  }

  private dematerializeFar(
    anchors: readonly PopulationInterestAnchor[],
    nowMs: number,
    budget: DematerializationBudget
  ): void {
    for (const record of this.pedestrians.values()) {
      if (!record.active || budget.pedestrians <= 0) continue;
      const npc = this.options.state.npcs.get(record.id);
      if (!npc) {
        record.active = false;
        continue;
      }
      if (populationInterestAt(npc.x, npc.y, anchors).retain) continue;
      if (!this.options.pedestrians.canStreamOut(record.id)) continue;
      if (this.dematerializePedestrian(record, npc, nowMs)) budget.pedestrians--;
    }
    for (const record of this.traffic.values()) {
      if (!record.active || budget.traffic <= 0) continue;
      const vehicle = this.options.state.vehicles.get(record.id);
      if (!vehicle) {
        record.active = false;
        continue;
      }
      if (populationInterestAt(vehicle.x, vehicle.y, anchors).retain) continue;
      if (!this.canStreamOutVehicle(vehicle)) continue;
      if (this.dematerializeVehicle(record, vehicle, nowMs)) budget.traffic--;
    }
  }

  private activePedestrianCountsByCluster(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const record of this.pedestrians.values()) {
      if (!record.active) continue;
      const npc = this.options.state.npcs.get(record.id);
      const nearest = npc
        ? nearestPopulationInterestCluster(npc.x, npc.y, this.clusters)
        : undefined;
      if (nearest) increment(counts, nearest.cluster.id);
    }
    return counts;
  }

  private activeTrafficCountsByCluster(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const record of this.traffic.values()) {
      if (!record.active) continue;
      const vehicle = this.options.state.vehicles.get(record.id);
      const nearest = vehicle
        ? nearestPopulationInterestCluster(vehicle.x, vehicle.y, this.clusters)
        : undefined;
      if (nearest) increment(counts, nearest.cluster.id);
    }
    return counts;
  }

  private pedestrianDemandByCluster(
    anchors: readonly PopulationInterestAnchor[] = this.anchors
  ): Map<string, number> {
    const demand = new Map<string, number>();
    for (const record of this.pedestrians.values()) {
      if (
        record.active ||
        !populationInterestAt(record.x, record.y, anchors).materialize ||
        !this.zoneProfiles.pedestrianAdmits(record.id, record.x, record.y)
      ) continue;
      const nearest = nearestPopulationInterestCluster(record.x, record.y, this.clusters);
      if (nearest) increment(demand, nearest.cluster.id);
    }
    return demand;
  }

  private trafficDemandByCluster(
    anchors: readonly PopulationInterestAnchor[] = this.anchors
  ): Map<string, number> {
    const demand = new Map<string, number>();
    for (const record of this.traffic.values()) {
      if (record.active) continue;
      const position = this.trafficPosition(record.spawn);
      if (
        !populationInterestAt(position.x, position.y, anchors).materialize ||
        !this.zoneProfiles.trafficAdmits(record.id, position.x, position.y)
      ) continue;
      const nearest = nearestPopulationInterestCluster(position.x, position.y, this.clusters);
      if (nearest) increment(demand, nearest.cluster.id);
    }
    return demand;
  }

  private quotaPressureClusters(): number {
    if (this.clusters.length === 0) return 0;
    const pressured = new Set<string>();
    const pedestrianPlan = populationClusterCapacityPlan(
      this.clusters,
      POPULATION_STREAMING.maxActivePedestrians,
      this.activePedestrianCountsByCluster(),
      this.pedestrianDemandByCluster()
    );
    for (const clusterId of pedestrianPlan.pressuredClusterIds) pressured.add(clusterId);
    const trafficPlan = populationClusterCapacityPlan(
      this.clusters,
      POPULATION_STREAMING.maxActiveTraffic,
      this.activeTrafficCountsByCluster(),
      this.trafficDemandByCluster()
    );
    for (const clusterId of trafficPlan.pressuredClusterIds) pressured.add(clusterId);
    return pressured.size;
  }

  private dematerializePedestrian(
    record: VirtualPedestrianRecord,
    npc: NpcState,
    nowMs: number
  ): boolean {
    record.x = npc.x;
    record.y = npc.y;
    record.angle = npc.angle;
    if (!this.options.pedestrians.streamOutAmbient(record.id)) return false;
    record.active = false;
    record.nextStepAt = nowMs + this.stepOffset(record.id);
    return true;
  }

  private dematerializeVehicle(
    record: VirtualTrafficRecord,
    vehicle: VehicleState,
    nowMs: number
  ): boolean {
    if (!this.options.state.vehicles.has(vehicle.id)) return false;
    this.captureVehicleRoute(record, vehicle);
    this.options.traffic.release(vehicle.id);
    this.options.state.vehicles.delete(vehicle.id);
    this.options.onVehicleDematerialized?.(vehicle.id);
    record.active = false;
    this.trafficStationarySince.delete(vehicle.id);
    record.nextStepAt = nowMs + this.stepOffset(record.id);
    return true;
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
      record.surfaceId = next.surfaceId;
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
    record.spawn = this.options.traffic.advanceVirtual(
      record.spawn,
      this.options.random.integer(
        'stream-traffic-route',
        `${record.id}:${record.step}`,
        0,
        0x7fff_ffff
      )
    );
  }

  private materializeVehicle(record: VirtualTrafficRecord): void {
    const position = this.trafficPosition(record.spawn);
    if (this.zoneProfiles.enabled) {
      record.kind = this.zoneProfiles.trafficKind(record.id, position.x, position.y);
    }
    const vehicle = new VehicleState();
    vehicle.id = record.id;
    vehicle.kind = record.kind;
    vehicle.x = position.x;
    vehicle.y = position.y;
    vehicle.surfaceId = position.surfaceId;
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
    record.spawn = this.options.traffic.captureVirtual(vehicle);
  }

  private canStreamOutVehicle(vehicle: VehicleState): boolean {
    if (!this.canRetireJammedVehicle(vehicle)) return false;
    if (
      vehicle.health !== vehicle.maxHealth ||
      vehicle.engineDamage > 0 ||
      vehicle.tyreDamageMask > 0 ||
      vehicle.damageFront > 0 ||
      vehicle.damageRear > 0 ||
      vehicle.damageLeft > 0 ||
      vehicle.damageRight > 0
    ) return false;
    return true;
  }

  private canRetireJammedVehicle(vehicle: VehicleState): boolean {
    if (
      !vehicle.traffic ||
      vehicle.driverId ||
      vehicle.hijackBy ||
      vehicle.destroyed ||
      vehicle.onFire
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

  private trafficPosition(spawn: TrafficSpawn): {x: number; y: number; surfaceId: string} {
    const lane = trafficLanePoint(spawn);
    const surfaceId = spawn.surfaceId ?? 'street-ground';
    return this.options.world.canOccupy(lane.x, lane.y, VEHICLE_RADIUS, surfaceId, 'vehicle') &&
      this.options.world.isRoadAt(lane.x, lane.y)
      ? {...lane, surfaceId}
      : {x: spawn.x, y: spawn.y, surfaceId};
  }

  private activePedestrianCount(): number {
    return [...this.pedestrians.values()].filter((record) => record.active).length;
  }

  private activeTrafficCount(): number {
    return [...this.traffic.values()].filter((record) => record.active).length;
  }

  private profileDeferredActorCount(): number {
    if (!this.zoneProfiles.enabled) return 0;
    let count = 0;
    for (const record of this.pedestrians.values()) {
      if (
        !record.active &&
        populationInterestAt(record.x, record.y, this.anchors).materialize &&
        !this.zoneProfiles.pedestrianAdmits(record.id, record.x, record.y)
      ) count++;
    }
    for (const record of this.traffic.values()) {
      const position = this.trafficPosition(record.spawn);
      if (
        !record.active &&
        populationInterestAt(position.x, position.y, this.anchors).materialize &&
        !this.zoneProfiles.trafficAdmits(record.id, position.x, position.y)
      ) count++;
    }
    return count;
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

function compareCandidate<T extends {id: string}>(
  left: {record: T; distance: number},
  right: {record: T; distance: number}
): number {
  return left.distance - right.distance || left.record.id.localeCompare(right.record.id);
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
