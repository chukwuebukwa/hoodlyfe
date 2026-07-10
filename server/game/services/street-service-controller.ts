import {
  STREET_SERVICE_RADIUS,
  ammunitionRestockQuote,
  vehicleRepairQuote,
  type StreetServiceKind
} from '../../../shared/content/street-services.ts';
import type {GameNotice} from '../../../shared/protocol/notices.ts';
import {StreetServiceState, type DistrictState, type PlayerState, type VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {StreetEconomyPort, StreetEconomyResult} from '../economy/street-economy-controller.ts';
import type {MedicalCareController} from '../medical/medical-care-controller.ts';

interface StreetServiceControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  economy: StreetEconomyPort;
  clock: () => {tick: number};
  repairVehicle: (vehicle: VehicleState) => void;
  restockPlayer: (playerId: string) => void;
  medical: Pick<MedicalCareController, 'canTreat' | 'treat'>;
  notice: (playerId: string, message: string, tone: GameNotice['tone']) => void;
}

export class StreetServiceController {
  private initialized = false;

  constructor(private readonly options: StreetServiceControllerOptions) {}

  initialize(): void {
    if (this.initialized) return;
    const {world} = this.options;
    const ammunition = world.openPointNear(
      world.spawn.x,
      world.spawn.y,
      150,
      280,
      11,
      1709
    );
    const repair = world.openPointNear(
      world.spawn.x,
      world.spawn.y,
      330,
      520,
      20,
      2411
    );
    this.addService('ammunition-counter', 'ammunition', 'Ammunition', ammunition.x, ammunition.y);
    this.addService('repair-garage', 'repair', 'Repair Garage', repair.x, repair.y);
    this.initialized = true;
  }

  interact(playerId: string, nowMs: number): boolean {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || player.action) return false;
    const services = [...this.options.state.services.values()].sort((left, right) => (
      this.distanceToService(player, left.kind as StreetServiceKind, left.x, left.y) -
        this.distanceToService(player, right.kind as StreetServiceKind, right.x, right.y) ||
      left.id.localeCompare(right.id)
    ));
    for (const service of services) {
      const kind = service.kind as StreetServiceKind;
      if (this.distanceToService(player, kind, service.x, service.y) > service.radius) continue;
      if (kind === 'repair' && this.canOfferRepair(player)) {
        return this.repair(player, service, nowMs);
      }
      if (kind === 'ammunition' && this.canOfferAmmunition(player)) {
        return this.restock(player, service, nowMs);
      }
      if (kind === 'hospital' && this.options.medical.canTreat(player)) {
        return this.options.medical.treat(player.id, service.id, nowMs);
      }
    }
    return false;
  }

  private canOfferRepair(player: PlayerState): boolean {
    if (!player.vehicleId || player.vehicleSeat !== 0) return false;
    const vehicle = this.options.state.vehicles.get(player.vehicleId);
    return Boolean(vehicle && vehicleRepairQuote(vehicle) > 0);
  }

  private canOfferAmmunition(player: PlayerState): boolean {
    return !player.vehicleId && ammunitionRestockQuote(player) > 0;
  }

  private repair(player: PlayerState, service: StreetServiceState, nowMs: number): boolean {
    const vehicle = this.options.state.vehicles.get(player.vehicleId);
    if (!vehicle) return false;
    if (player.wanted > 0) {
      this.options.notice(player.id, 'Lose police heat before using the repair garage.', 'warning');
      return true;
    }
    if (vehicle.destroyed || vehicle.onFire) {
      this.options.notice(player.id, 'This vehicle is too dangerous to repair.', 'warning');
      return true;
    }
    if (Math.abs(vehicle.speed) > 12) {
      this.options.notice(player.id, 'Stop the vehicle inside the repair garage.', 'warning');
      return true;
    }
    const quote = vehicleRepairQuote(vehicle);
    const result = this.options.economy.debit(
      player.id,
      quote,
      'vehicle-repair',
      `service:${service.id}:${player.id}:${vehicle.id}:${this.options.clock().tick}`,
      nowMs
    );
    if (result.status !== 'applied') {
      this.noticeFailure(player.id, result, quote);
      return true;
    }
    this.options.repairVehicle(vehicle);
    this.options.notice(player.id, `Vehicle repaired -$${result.transaction?.amount ?? quote}`, 'success');
    return true;
  }

  private restock(player: PlayerState, service: StreetServiceState, nowMs: number): boolean {
    const quote = ammunitionRestockQuote(player);
    const result = this.options.economy.debit(
      player.id,
      quote,
      'ammunition',
      `service:${service.id}:${player.id}:${this.options.clock().tick}`,
      nowMs
    );
    if (result.status !== 'applied') {
      this.noticeFailure(player.id, result, quote);
      return true;
    }
    this.options.restockPlayer(player.id);
    this.options.notice(player.id, `Ammunition restocked -$${result.transaction?.amount ?? quote}`, 'success');
    return true;
  }

  private noticeFailure(playerId: string, result: StreetEconomyResult, quote: number): void {
    const message = result.status === 'insufficient-funds'
      ? `Not enough cash. Service costs $${quote}.`
      : 'Service unavailable. Try again.';
    this.options.notice(playerId, message, 'warning');
  }

  private distanceToService(
    player: PlayerState,
    kind: StreetServiceKind,
    x: number,
    y: number
  ): number {
    if (kind === 'repair' && player.vehicleId) {
      const vehicle = this.options.state.vehicles.get(player.vehicleId);
      if (vehicle) return Math.hypot(vehicle.x - x, vehicle.y - y);
    }
    return Math.hypot(player.x - x, player.y - y);
  }

  private addService(
    id: string,
    kind: StreetServiceKind,
    label: string,
    x: number,
    y: number
  ): void {
    const service = new StreetServiceState();
    service.id = id;
    service.kind = kind;
    service.label = label;
    service.x = x;
    service.y = y;
    service.radius = STREET_SERVICE_RADIUS[kind];
    this.options.state.services.set(id, service);
  }
}
