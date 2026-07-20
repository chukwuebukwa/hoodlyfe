import {
  STREET_SERVICE_RADIUS,
  combatResupplyQuote,
  vehicleRepairQuote,
  type StreetServiceKind
} from '../../../shared/content/street-services.ts';
import type {GameNotice} from '../../../shared/protocol/notices.ts';
import {
  nextVehicleNeonColor,
  vehicleNeonColorLabel,
  vehicleNeonUpgradeQuote
} from '../../../shared/content/vehicle-neon.ts';
import {StreetServiceState, type DistrictState, type PlayerState, type VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {StreetEconomyPort, StreetEconomyResult} from '../economy/street-economy-controller.ts';
import type {MedicalCareController} from '../medical/medical-care-controller.ts';
import {
  STREET_SPACE_ID,
  interiorServiceAnchor
} from '../../../shared/content/interior-catalog.ts';

interface StreetServiceControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  economy: StreetEconomyPort;
  clock: () => {tick: number};
  repairVehicle: (vehicle: VehicleState) => void;
  restockPlayer: (playerId: string) => void;
  medical: Pick<MedicalCareController, 'canTreat' | 'treat'>;
  openWardrobe: (playerId: string, serviceId: string) => void;
  notice: (playerId: string, message: string, tone: GameNotice['tone']) => void;
}

export class StreetServiceController {
  private initialized = false;

  constructor(private readonly options: StreetServiceControllerOptions) {}

  initialize(): void {
    if (this.initialized) return;
    const {world} = this.options;
    const ammunition = interiorServiceAnchor('ammunition-counter');
    const clothing = interiorServiceAnchor('clothing-store');
    if (!ammunition || !clothing) {
      throw new Error('Missing authored store interior service anchors.');
    }
    const repair = world.openPointNear(
      world.spawn.x,
      world.spawn.y,
      330,
      520,
      20,
      2411
    );
    this.addService(
      'ammunition-counter',
      'ammunition',
      'Ammu-Nation',
      ammunition.x,
      ammunition.y,
      ammunition.spaceId
    );
    this.addService('repair-garage', 'repair', 'Repair Garage', repair.x, repair.y);
    this.addService(
      'clothing-store',
      'clothing',
      'Threads',
      clothing.x,
      clothing.y,
      clothing.spaceId
    );
    this.initialized = true;
  }

  interact(playerId: string, nowMs: number): boolean {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || player.action) return false;
    const services = [...this.options.state.services.values()]
      .filter((service) => service.spaceId === player.spaceId)
      .sort((left, right) => (
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
      if (kind === 'clothing' && !player.vehicleId) {
        return this.openWardrobe(player, service.id);
      }
    }
    return false;
  }

  private canOfferRepair(player: PlayerState): boolean {
    if (!player.vehicleId || player.vehicleSeat !== 0) return false;
    return this.options.state.vehicles.has(player.vehicleId);
  }

  private canOfferAmmunition(player: PlayerState): boolean {
    return !player.vehicleId && combatResupplyQuote(player) > 0;
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
    const repairQuote = vehicleRepairQuote(vehicle);
    const neonUpgrade = repairQuote <= 0;
    const nextNeonColor = nextVehicleNeonColor(vehicle.neonColor);
    const quote = neonUpgrade ? vehicleNeonUpgradeQuote(vehicle.neonColor) : repairQuote;
    const result = this.options.economy.debit(
      player.id,
      quote,
      neonUpgrade ? 'vehicle-neon' : 'vehicle-repair',
      `service:${service.id}:${player.id}:${vehicle.id}:${this.options.clock().tick}`,
      nowMs
    );
    if (result.status !== 'applied') {
      this.noticeFailure(player.id, result, quote);
      return true;
    }
    if (neonUpgrade) {
      vehicle.neonColor = nextNeonColor;
      this.options.notice(
        player.id,
        `${vehicleNeonColorLabel(nextNeonColor)} neon installed -$${result.transaction?.amount ?? quote}`,
        'success'
      );
    } else {
      this.options.repairVehicle(vehicle);
      this.options.notice(player.id, `Vehicle repaired -$${result.transaction?.amount ?? quote}`, 'success');
    }
    return true;
  }

  private restock(player: PlayerState, service: StreetServiceState, nowMs: number): boolean {
    const quote = combatResupplyQuote(player);
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
    this.options.notice(player.id, `Combat resupply -$${result.transaction?.amount ?? quote}`, 'success');
    return true;
  }

  private openWardrobe(player: PlayerState, serviceId: string): boolean {
    if (player.wanted > 0) {
      this.options.notice(player.id, 'Lose police heat before entering the clothing store.', 'warning');
      return true;
    }
    this.options.openWardrobe(player.id, serviceId);
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
    y: number,
    spaceId = STREET_SPACE_ID
  ): void {
    const service = new StreetServiceState();
    service.id = id;
    service.kind = kind;
    service.label = label;
    service.spaceId = spaceId;
    service.x = x;
    service.y = y;
    service.radius = STREET_SERVICE_RADIUS[kind];
    this.options.state.services.set(id, service);
  }
}
