import type {DistrictState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {vehicleConfig} from './vehicle-config.ts';

const PLAYER_RADIUS = 11;
const ENTER_DURATION_MS = 320;
const HIJACK_DURATION_MS = 1050;

interface VehicleAccessControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  nearbyVehicles: (x: number, y: number, radius: number) => VehicleState[];
  createEjectedDriver: (vehicle: VehicleState, hijacker: PlayerState, nowMs: number) => string;
  recordTheft: (
    playerId: string,
    victimId: string,
    x: number,
    y: number,
    nowMs: number
  ) => void;
  releaseTrafficControl: (vehicleId: string) => void;
}

export class VehicleAccessController {
  constructor(private readonly options: VehicleAccessControllerOptions) {}

  interact(playerId: string, nowMs: number): void {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || player.action) return;
    if (player.vehicleId) {
      const vehicle = this.options.state.vehicles.get(player.vehicleId);
      if (!vehicle) {
        player.vehicleId = '';
        player.vehicleSeat = -1;
        return;
      }
      this.exit(player, vehicle);
      return;
    }

    let nearest: VehicleState | undefined;
    let nearestDistance = 72;
    for (const vehicle of this.options.nearbyVehicles(player.x, player.y, nearestDistance)) {
      if (
        vehicle.destroyed ||
        this.occupants(vehicle.id).length >= vehicleConfig(vehicle.kind).seats
      ) continue;
      if (vehicle.hijackBy && vehicle.hijackBy !== player.id) continue;
      const distance = Math.hypot(vehicle.x - player.x, vehicle.y - player.y);
      if (distance < nearestDistance) {
        nearest = vehicle;
        nearestDistance = distance;
      }
    }
    if (!nearest) return;
    this.beginAction(player, nearest, nearest.traffic && !nearest.driverId ? 'hijacking' : 'entering', nowMs);
  }

  updateAction(player: PlayerState, nowMs: number): void {
    if (nowMs < player.actionUntil) return;
    const action = player.action;
    const vehicle = this.options.state.vehicles.get(player.actionVehicleId);
    if (!vehicle || vehicle.destroyed || Math.hypot(vehicle.x - player.x, vehicle.y - player.y) > 112) {
      if (vehicle?.hijackBy === player.id) vehicle.hijackBy = '';
      this.clearAction(player);
      return;
    }

    if (action === 'hijacking') {
      if (vehicle.hijackBy !== player.id || !vehicle.traffic) {
        this.clearAction(player);
        return;
      }
      vehicle.traffic = false;
      vehicle.hijackBy = '';
      vehicle.speed = 0;
      this.options.releaseTrafficControl(vehicle.id);
      const victimId = this.options.createEjectedDriver(vehicle, player, nowMs);
      this.options.recordTheft(player.id, victimId, vehicle.x, vehicle.y, nowMs);
    }

    this.clearAction(player);
    this.enter(player, vehicle);
  }

  removePlayer(player: PlayerState): void {
    const vehicle = player.vehicleId ? this.options.state.vehicles.get(player.vehicleId) : undefined;
    const wasDriver = vehicle?.driverId === player.id;
    player.vehicleId = '';
    player.vehicleSeat = -1;
    if (vehicle && wasDriver) {
      vehicle.driverId = '';
      this.promotePassenger(vehicle);
    }
    if (player.actionVehicleId) {
      const actionVehicle = this.options.state.vehicles.get(player.actionVehicleId);
      if (actionVehicle?.hijackBy === player.id) actionVehicle.hijackBy = '';
    }
    this.clearAction(player);
  }

  occupants(vehicleId: string): PlayerState[] {
    return [...this.options.state.players.values()].filter((player) => player.vehicleId === vehicleId);
  }

  promotePassenger(vehicle: VehicleState): void {
    const passenger = this.occupants(vehicle.id)
      .filter((occupant) => occupant.alive)
      .sort((left, right) => left.vehicleSeat - right.vehicleSeat)[0];
    if (!passenger) return;
    passenger.vehicleSeat = 0;
    vehicle.driverId = passenger.id;
  }

  clearAction(player: PlayerState): void {
    player.action = '';
    player.actionUntil = 0;
    player.actionVehicleId = '';
  }

  cancelAction(player: PlayerState): void {
    if (player.actionVehicleId) {
      const vehicle = this.options.state.vehicles.get(player.actionVehicleId);
      if (vehicle?.hijackBy === player.id) vehicle.hijackBy = '';
    }
    this.clearAction(player);
  }

  private beginAction(
    player: PlayerState,
    vehicle: VehicleState,
    action: 'entering' | 'hijacking',
    nowMs: number
  ): void {
    const sideAngle = vehicle.angle + Math.PI / 2;
    const sides = [1, -1].sort((left, right) => {
      const leftDistance = Math.hypot(
        player.x - (vehicle.x + Math.cos(sideAngle) * 38 * left),
        player.y - (vehicle.y + Math.sin(sideAngle) * 38 * left)
      );
      const rightDistance = Math.hypot(
        player.x - (vehicle.x + Math.cos(sideAngle) * 38 * right),
        player.y - (vehicle.y + Math.sin(sideAngle) * 38 * right)
      );
      return leftDistance - rightDistance;
    });
    for (const side of sides) {
      const x = vehicle.x + Math.cos(sideAngle) * 38 * side;
      const y = vehicle.y + Math.sin(sideAngle) * 38 * side;
      if (!this.options.world.canOccupy(x, y, PLAYER_RADIUS)) continue;
      player.x = x;
      player.y = y;
      break;
    }
    player.angle = vehicle.angle;
    player.action = action;
    player.actionVehicleId = vehicle.id;
    player.actionUntil = nowMs + (action === 'hijacking' ? HIJACK_DURATION_MS : ENTER_DURATION_MS);
    if (action === 'hijacking') vehicle.hijackBy = player.id;
  }

  private enter(player: PlayerState, vehicle: VehicleState): void {
    const occupiedSeats = new Set(this.occupants(vehicle.id).map((occupant) => occupant.vehicleSeat));
    let seat = vehicle.driverId ? 1 : 0;
    const maximumOccupants = vehicleConfig(vehicle.kind).seats;
    while (seat < maximumOccupants && occupiedSeats.has(seat)) seat++;
    if (seat >= maximumOccupants) return;
    player.vehicleId = vehicle.id;
    player.vehicleSeat = seat;
    player.x = vehicle.x;
    player.y = vehicle.y;
    player.surfaceId = vehicle.surfaceId;
    player.angle = vehicle.angle;
    if (seat === 0) vehicle.driverId = player.id;
  }

  private exit(player: PlayerState, vehicle: VehicleState): void {
    const sideAngle = vehicle.angle + Math.PI / 2;
    for (const side of [1, -1, 1.55, -1.55]) {
      const x = vehicle.x + Math.cos(sideAngle) * 42 * side;
      const y = vehicle.y + Math.sin(sideAngle) * 42 * side;
      const surfaceId = this.options.world.surfaceAfterMove(
        vehicle.surfaceId,
        vehicle.x,
        vehicle.y,
        x,
        y,
        PLAYER_RADIUS,
        'player'
      );
      if (!surfaceId) continue;
      player.x = x;
      player.y = y;
      player.surfaceId = surfaceId;
      this.removePlayer(player);
      vehicle.speed *= 0.4;
      return;
    }
  }
}
