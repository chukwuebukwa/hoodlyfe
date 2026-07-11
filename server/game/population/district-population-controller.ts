import type {PedestrianController} from '../pedestrians/pedestrian-controller.ts';
import {trafficLanePoint, type TrafficController} from '../traffic/traffic-controller.ts';
import {vehicleConfig, VEHICLE_RADIUS} from '../vehicles/vehicle-config.ts';
import {VehicleState, type DistrictState} from '../../state.ts';
import type {CollisionMap, TrafficSpawn} from '../../world-map.ts';

export const AMBIENT_TRAFFIC_TARGET = 16;
const TRAFFIC_SPAWN_ATTEMPTS = 24;
const TRAFFIC_SPAWN_GAP = 64;

interface DistrictPopulationControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  pedestrians: PedestrianController;
  traffic: TrafficController;
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
    this.spawnPedestrians();
    this.spawnParkedVehicles();
    if (this.options.includeAmbientTraffic !== false) this.spawnTraffic();
    this.initialized = true;
    this.result = {
      civilians: 10,
      police: 3,
      parkedVehicles: 3,
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
    const kinds = ['sedan', 'police', 'taxi'];
    for (let index = 0; index < kinds.length; index++) {
      let angle = index % 2 === 0 ? -Math.PI / 2 : 0;
      let position: {x: number; y: number};
      if (index === 0) {
        const starter = this.starterVehiclePosition();
        position = starter.position;
        angle = starter.angle;
      } else if (kinds[index] === 'police') {
        const spawn = this.options.world.trafficSpawn(157, VEHICLE_RADIUS);
        position = {x: spawn.x, y: spawn.y};
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
        index % 4 === 2 ? 'taxi' : 'sedan',
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
    let fallback = this.options.world.trafficSpawn(200 + index * 19, VEHICLE_RADIUS);
    for (let attempt = 0; attempt < TRAFFIC_SPAWN_ATTEMPTS; attempt++) {
      const candidate = this.options.world.trafficSpawn(
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

  private starterVehiclePosition(): {position: {x: number; y: number}; angle: number} {
    const offsets = [[52, 0], [-52, 0], [0, 52], [0, -52]];
    for (const [offsetX, offsetY] of offsets) {
      const candidate = {
        x: this.options.world.spawn.x + offsetX,
        y: this.options.world.spawn.y + offsetY
      };
      if (!this.options.world.canOccupy(candidate.x, candidate.y, VEHICLE_RADIUS)) continue;
      return {position: candidate, angle: Math.atan2(offsetY, offsetX)};
    }
    return {position: {...this.options.world.spawn}, angle: Math.PI};
  }

  private createVehicle(
    id: string,
    kind: string,
    position: {x: number; y: number},
    angle: number
  ): VehicleState {
    const vehicle = new VehicleState();
    vehicle.id = id;
    vehicle.kind = kind;
    vehicle.x = position.x;
    vehicle.y = position.y;
    vehicle.angle = angle;
    vehicle.maxHealth = vehicleConfig(kind).maxHealth;
    vehicle.health = vehicle.maxHealth;
    return vehicle;
  }
}
