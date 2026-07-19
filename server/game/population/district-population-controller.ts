import type {PedestrianController} from '../pedestrians/pedestrian-controller.ts';
import {trafficLanePoint, type TrafficController} from '../traffic/traffic-controller.ts';
import {vehicleConfig, VEHICLE_RADIUS} from '../vehicles/vehicle-config.ts';
import {VehicleState, type DistrictState} from '../../state.ts';
import type {VehicleKind} from '../../../shared/content/vehicle-catalog.ts';
import type {CollisionMap, TrafficSpawn} from '../../world-map.ts';

export const AMBIENT_TRAFFIC_TARGET = 16;
const TRAFFIC_SPAWN_ATTEMPTS = 24;
const TRAFFIC_SPAWN_GAP = 64;
const PARKED_VEHICLE_KINDS: readonly VehicleKind[] = ['sedan', 'police', 'taxi', 'r33', 's15'];
const AMBIENT_TRAFFIC_KINDS: readonly VehicleKind[] = [
  'sedan',
  'sedan',
  'taxi',
  'sedan',
  'taxi',
  'sedan'
];

interface DistrictPopulationControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  pedestrians: PedestrianController;
  traffic: TrafficController;
  includeAmbientPedestrians?: boolean;
  includeAmbientTraffic?: boolean;
  onVehicleSpawned?: (vehicle: VehicleState) => void;
}

export interface DistrictPopulationResult {
  civilians: number;
  police: number;
  parkedVehicles: number;
  trafficVehicles: number;
}

export class DistrictPopulationController {
  private initialized = false;
  private result?: DistrictPopulationResult;

  constructor(private readonly options: DistrictPopulationControllerOptions) {}

  populate(): DistrictPopulationResult {
    if (this.initialized && this.result) return {...this.result};
    this.options.state.missionContactX = this.options.world.spawn.x;
    this.options.state.missionContactY = this.options.world.spawn.y;
    if (this.options.includeAmbientPedestrians !== false) this.spawnPedestrians();
    this.spawnParkedVehicles();
    if (this.options.includeAmbientTraffic !== false) this.spawnTraffic();
    this.initialized = true;
    this.result = {
      civilians: this.options.includeAmbientPedestrians === false ? 0 : 10,
      police: this.options.includeAmbientPedestrians === false ? 0 : 3,
      parkedVehicles: PARKED_VEHICLE_KINDS.length,
      trafficVehicles: this.options.includeAmbientTraffic === false ? 0 : AMBIENT_TRAFFIC_TARGET
    };
    return {...this.result};
  }

  private spawnPedestrians(): void {
    for (let index = 0; index < 10; index++) {
      this.options.pedestrians.spawn(`civilian-${index + 1}`, 'civilian', index, 130, 760);
    }
    for (let index = 0; index < 3; index++) {
      this.options.pedestrians.spawn(`police-${index + 1}`, 'police', index + 30, 420, 900);
    }
  }

  private spawnParkedVehicles(): void {
    const kinds = PARKED_VEHICLE_KINDS;
    for (let index = 0; index < kinds.length; index++) {
      let angle = index % 2 === 0 ? -Math.PI / 2 : 0;
      let position: {x: number; y: number; surfaceId?: string};
      if (index === 0) {
        const starter = this.starterVehiclePosition();
        position = starter.position;
        angle = starter.angle;
      } else if (kinds[index] === 'police') {
        const spawn = this.options.world.trafficSpawn(157, VEHICLE_RADIUS);
        position = spawn;
        angle = spawn.angle;
      } else {
        position = this.options.world.openPointNear(
          this.options.world.spawn.x,
          this.options.world.spawn.y,
          180 + index * 80,
          420 + index * 120,
          VEHICLE_RADIUS,
          70 + index
        );
      }
      const vehicle = this.createVehicle(`vehicle-${index + 1}`, kinds[index], position, angle);
      this.options.state.vehicles.set(vehicle.id, vehicle);
      this.options.onVehicleSpawned?.(vehicle);
    }
  }

  private spawnTraffic(): void {
    for (let index = 0; index < AMBIENT_TRAFFIC_TARGET; index++) {
      const spawn = this.openTrafficSpawn(index);
      const lane = trafficLanePoint(spawn);
      const position = this.options.world.canOccupy(lane.x, lane.y, VEHICLE_RADIUS)
        ? lane
        : spawn;
      const vehicle = this.createVehicle(
        `traffic-${index + 1}`,
        AMBIENT_TRAFFIC_KINDS[index % AMBIENT_TRAFFIC_KINDS.length],
        position,
        spawn.angle
      );
      vehicle.speed = 90 + index * 4;
      vehicle.traffic = true;
      this.options.state.vehicles.set(vehicle.id, vehicle);
      this.options.traffic.register(vehicle.id, spawn, vehicleConfig(vehicle.kind).traffic.cruiseSpeed);
      this.options.onVehicleSpawned?.(vehicle);
    }
  }

  private openTrafficSpawn(index: number): TrafficSpawn {
    let fallback = this.options.traffic.spawn(200 + index * 19, VEHICLE_RADIUS);
    for (let attempt = 0; attempt < TRAFFIC_SPAWN_ATTEMPTS; attempt++) {
      const candidate = this.options.traffic.spawn(
        200 + index * 193 + attempt * 43,
        VEHICLE_RADIUS
      );
      fallback = candidate;
      const separated = [...this.options.state.vehicles.values()].every((vehicle) => (
        Math.hypot(vehicle.x - candidate.x, vehicle.y - candidate.y) >= TRAFFIC_SPAWN_GAP
      ));
      if (separated) return candidate;
    }
    return fallback;
  }

  private starterVehiclePosition(): {
    position: {x: number; y: number; surfaceId: string};
    angle: number;
  } {
    const offsets = [[52, 0], [-52, 0], [0, 52], [0, -52]];
    for (const [offsetX, offsetY] of offsets) {
      const candidate = {
        x: this.options.world.spawn.x + offsetX,
        y: this.options.world.spawn.y + offsetY
      };
      const surfaceId = this.options.world.surfaces.surfaceIdsAt(
        candidate.x,
        candidate.y,
        'vehicle'
      ).find((id) => this.options.world.canOccupy(
        candidate.x,
        candidate.y,
        VEHICLE_RADIUS,
        id,
        'vehicle'
      ));
      if (!surfaceId) continue;
      return {position: {...candidate, surfaceId}, angle: Math.atan2(offsetY, offsetX)};
    }
    const fallback = this.options.world.trafficSpawn(0, VEHICLE_RADIUS);
    return {
      position: {
        x: fallback.x,
        y: fallback.y,
        surfaceId: fallback.surfaceId ?? 'street-ground'
      },
      angle: fallback.angle
    };
  }

  private createVehicle(
    id: string,
    kind: VehicleKind,
    position: {x: number; y: number; surfaceId?: string},
    angle: number
  ): VehicleState {
    const vehicle = new VehicleState();
    vehicle.id = id;
    vehicle.kind = kind;
    vehicle.x = position.x;
    vehicle.y = position.y;
    if (position.surfaceId) vehicle.surfaceId = position.surfaceId;
    vehicle.angle = angle;
    vehicle.maxHealth = vehicleConfig(kind).maxHealth;
    vehicle.health = vehicle.maxHealth;
    return vehicle;
  }
}
