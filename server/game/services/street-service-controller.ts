import {
  STREET_SERVICE_RADIUS,
  combatResupplyQuote,
  vehicleRepairQuote,
  type StreetServiceKind
} from '../../../shared/content/street-services.ts';
import type {GameNotice} from '../../../shared/protocol/notices.ts';
import {
  VEHICLE_NEON_COLORS,
  isVehicleNeonColor,
  normalizeVehicleNeonColor,
  vehicleNeonColorLabel,
  vehicleNeonUpgradeQuote
} from '../../../shared/content/vehicle-neon.ts';
import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  STOREFRONT_PROTOCOL_VERSION,
  type StorefrontProduct,
  type StorefrontPurchaseMessage,
  type StorefrontResultMessage,
  type StorefrontSnapshot
} from '../../../shared/protocol/storefront.ts';
import {StreetServiceState, type DistrictState, type PlayerState, type VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {StreetEconomyPort, StreetEconomyResult} from '../economy/street-economy-controller.ts';
import type {MedicalCareController} from '../medical/medical-care-controller.ts';
import {
  STREET_SPACE_ID,
  interiorServiceAnchor
} from '../../../shared/content/interior-catalog.ts';
import {
  DEFAULT_SEAMLESS_INTERIOR_CATALOG,
  type SeamlessInteriorCatalog
} from '../../../shared/content/seamless-interior-catalog.ts';

interface StreetServiceControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  economy: StreetEconomyPort;
  clock: () => {tick: number};
  repairVehicle: (vehicle: VehicleState) => void;
  restockPlayer: (playerId: string) => void;
  medical: Pick<MedicalCareController, 'canTreat' | 'treat'>;
  openWardrobe: (playerId: string, serviceId: string) => void;
  openStorefront: (playerId: string, snapshot: StorefrontSnapshot) => void;
  notice: (playerId: string, message: string, tone: GameNotice['tone']) => void;
  seamlessInteriors?: SeamlessInteriorCatalog;
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
    const repairs = (this.options.seamlessInteriors ?? DEFAULT_SEAMLESS_INTERIOR_CATALOG)
      .serviceAnchors('repair');
    if (repairs.length === 0) throw new Error('Missing authored seamless repair garage service anchor.');
    this.addService(
      'ammunition-counter',
      'ammunition',
      'Ammu-Nation',
      ammunition.x,
      ammunition.y,
      ammunition.spaceId
    );
    for (const repair of repairs) {
      this.addService(repair.id, 'repair', repair.label, repair.x, repair.y, STREET_SPACE_ID);
    }
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
        return this.openRepairStorefront(player, service);
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

  purchase(
    playerId: string,
    request: StorefrontPurchaseMessage,
    nowMs: number
  ): StorefrontResultMessage {
    const player = this.options.state.players.get(playerId);
    const service = this.options.state.services.get(request.storeId);
    const vehicle = this.options.state.vehicles.get(request.vehicleId);
    const invalid = this.validateRepairStorefront(player, service, vehicle);
    if (invalid) return this.result(request.sequence, 'unavailable', invalid);
    if (!player || !service || !vehicle) {
      return this.result(request.sequence, 'invalid', 'Garage session is no longer valid.');
    }

    if (request.productId === 'repair.full') {
      return this.purchaseRepair(player, service, vehicle, request, nowMs);
    }
    if (!request.productId.startsWith('neon.')) {
      return this.result(request.sequence, 'invalid', 'Unknown garage product.');
    }
    const color = request.productId.slice('neon.'.length);
    if (!isVehicleNeonColor(color)) {
      return this.result(request.sequence, 'invalid', 'Unknown neon color.');
    }
    return this.purchaseNeon(player, service, vehicle, color, request, nowMs);
  }

  private canOfferRepair(player: PlayerState): boolean {
    if (!player.vehicleId || player.vehicleSeat !== 0) return false;
    return this.options.state.vehicles.has(player.vehicleId);
  }

  private canOfferAmmunition(player: PlayerState): boolean {
    return !player.vehicleId && combatResupplyQuote(player) > 0;
  }

  private openRepairStorefront(player: PlayerState, service: StreetServiceState): boolean {
    const vehicle = this.options.state.vehicles.get(player.vehicleId);
    if (!vehicle) return false;
    const invalid = this.validateRepairStorefront(player, service, vehicle);
    if (invalid) {
      this.options.notice(player.id, invalid, 'warning');
      return true;
    }
    this.options.openStorefront(player.id, this.repairStorefrontSnapshot(player, service, vehicle));
    return true;
  }

  private purchaseRepair(
    player: PlayerState,
    service: StreetServiceState,
    vehicle: VehicleState,
    request: StorefrontPurchaseMessage,
    nowMs: number
  ): StorefrontResultMessage {
    const repairQuote = vehicleRepairQuote(vehicle);
    if (repairQuote <= 0) {
      return this.result(
        request.sequence,
        'unavailable',
        'Vehicle is already fully repaired.',
        this.repairStorefrontSnapshot(player, service, vehicle)
      );
    }
    const result = this.options.economy.debit(
      player.id,
      repairQuote,
      'vehicle-repair',
      this.purchaseKey(service.id, player.id, request),
      nowMs
    );
    if (result.status !== 'applied') {
      return this.purchaseFailure(
        request.sequence,
        result,
        repairQuote,
        this.repairStorefrontSnapshot(player, service, vehicle)
      );
    }
    this.options.repairVehicle(vehicle);
    const charged = result.transaction?.amount ?? repairQuote;
    this.options.notice(player.id, `Vehicle repaired -$${charged}`, 'success');
    return this.result(
      request.sequence,
      'applied',
      `Vehicle repaired for $${charged}.`,
      this.repairStorefrontSnapshot(player, service, vehicle)
    );
  }

  private purchaseNeon(
    player: PlayerState,
    service: StreetServiceState,
    vehicle: VehicleState,
    color: ReturnType<typeof normalizeVehicleNeonColor>,
    request: StorefrontPurchaseMessage,
    nowMs: number
  ): StorefrontResultMessage {
    const repairQuote = vehicleRepairQuote(vehicle);
    if (repairQuote > 0) {
      return this.result(
        request.sequence,
        'unavailable',
        'Repair the vehicle before installing lighting.',
        this.repairStorefrontSnapshot(player, service, vehicle)
      );
    }
    const current = normalizeVehicleNeonColor(vehicle.neonColor);
    if (current === color) {
      return this.result(
        request.sequence,
        'unavailable',
        `${vehicleNeonColorLabel(color)} is already equipped.`,
        this.repairStorefrontSnapshot(player, service, vehicle)
      );
    }
    if (color === 'off') {
      vehicle.neonColor = 'off';
      this.options.notice(player.id, 'Vehicle neon removed.', 'success');
      return this.result(
        request.sequence,
        'applied',
        'Vehicle neon removed.',
        this.repairStorefrontSnapshot(player, service, vehicle)
      );
    }
    const quote = vehicleNeonUpgradeQuote(current);
    const result = this.options.economy.debit(
      player.id,
      quote,
      'vehicle-neon',
      this.purchaseKey(service.id, player.id, request),
      nowMs
    );
    if (result.status !== 'applied') {
      return this.purchaseFailure(
        request.sequence,
        result,
        quote,
        this.repairStorefrontSnapshot(player, service, vehicle)
      );
    }
    vehicle.neonColor = color;
    const charged = result.transaction?.amount ?? quote;
    this.options.notice(
      player.id,
      `${vehicleNeonColorLabel(color)} neon installed -$${charged}`,
      'success'
    );
    return this.result(
      request.sequence,
      'applied',
      `${vehicleNeonColorLabel(color)} neon installed for $${charged}.`,
      this.repairStorefrontSnapshot(player, service, vehicle)
    );
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

  private repairStorefrontSnapshot(
    player: PlayerState,
    service: StreetServiceState,
    vehicle: VehicleState
  ): StorefrontSnapshot {
    const repairQuote = vehicleRepairQuote(vehicle);
    const currentNeon = normalizeVehicleNeonColor(vehicle.neonColor);
    const lightingBlocked = repairQuote > 0;
    const products: StorefrontProduct[] = [{
      id: 'repair.full',
      category: 'service',
      label: 'Full Repair',
      description: 'Restore body panels, engine condition, and vehicle health.',
      price: repairQuote,
      available: repairQuote > 0,
      selected: false,
      unavailableReason: repairQuote > 0 ? undefined : 'Vehicle is already repaired.'
    }, {
      id: 'neon.off',
      category: 'lighting',
      label: 'No Neon',
      description: 'Remove the installed underglow.',
      price: 0,
      available: !lightingBlocked && currentNeon !== 'off',
      selected: currentNeon === 'off',
      unavailableReason: lightingBlocked ? 'Repair vehicle first.' : undefined,
      swatch: 'off'
    }, ...VEHICLE_NEON_COLORS.map((color): StorefrontProduct => ({
      id: `neon.${color}`,
      category: 'lighting',
      label: `${titleCase(color)} Neon`,
      description: 'Install a road-facing underglow kit.',
      price: currentNeon === color ? 0 : vehicleNeonUpgradeQuote(currentNeon),
      available: !lightingBlocked && currentNeon !== color,
      selected: currentNeon === color,
      unavailableReason: lightingBlocked ? 'Repair vehicle first.' : undefined,
      swatch: color
    }))];
    const definition = vehicleDefinition(vehicle.kind);
    return {
      protocolVersion: STOREFRONT_PROTOCOL_VERSION,
      storeId: service.id,
      kind: 'repair',
      label: service.label,
      balance: player.cash,
      vehicle: {
        id: vehicle.id,
        kind: definition.id,
        label: definition.label,
        health: vehicle.health,
        maxHealth: vehicle.maxHealth,
        engineDamage: vehicle.engineDamage,
        bodyDamage: vehicle.damageFront + vehicle.damageRear + vehicle.damageLeft + vehicle.damageRight,
        currentNeon
      },
      products
    };
  }

  private validateRepairStorefront(
    player: PlayerState | undefined,
    service: StreetServiceState | undefined,
    vehicle: VehicleState | undefined
  ): string | undefined {
    if (!player?.alive || !service || service.kind !== 'repair' || !vehicle) {
      return 'Garage session is no longer valid.';
    }
    if (player.vehicleId !== vehicle.id || player.vehicleSeat !== 0) {
      return 'You must be driving this vehicle.';
    }
    if (service.spaceId !== player.spaceId) return 'Vehicle is outside the repair garage.';
    if (this.distanceToService(player, 'repair', service.x, service.y) > service.radius) {
      return 'Vehicle left the repair garage.';
    }
    if (player.wanted > 0) return 'Lose police heat before using the repair garage.';
    if (vehicle.destroyed || vehicle.onFire) return 'This vehicle is too dangerous to service.';
    if (Math.abs(vehicle.speed) > 12) return 'Stop the vehicle inside the repair garage.';
    return undefined;
  }

  private purchaseFailure(
    sequence: number,
    economyResult: StreetEconomyResult,
    quote: number,
    snapshot: StorefrontSnapshot
  ): StorefrontResultMessage {
    if (economyResult.status === 'duplicate') {
      return this.result(sequence, 'duplicate', 'Purchase was already processed.', snapshot);
    }
    if (economyResult.status === 'insufficient-funds') {
      return this.result(sequence, 'insufficient-funds', `Not enough cash. Price is $${quote}.`, snapshot);
    }
    return this.result(sequence, 'unavailable', 'Service unavailable. Try again.', snapshot);
  }

  private purchaseKey(
    serviceId: string,
    playerId: string,
    request: StorefrontPurchaseMessage
  ): string {
    return `storefront:${serviceId}:${playerId}:${request.sequence}:${request.productId}`;
  }

  private result(
    sequence: number,
    status: StorefrontResultMessage['status'],
    message: string,
    snapshot?: StorefrontSnapshot
  ): StorefrontResultMessage {
    return {
      protocolVersion: STOREFRONT_PROTOCOL_VERSION,
      sequence,
      status,
      message,
      snapshot
    };
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

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
