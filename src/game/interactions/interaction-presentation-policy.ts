import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  combatResupplyQuote,
  medicalTreatmentQuote,
  vehicleRepairQuote
} from '../../../shared/content/street-services.ts';
import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import type {
  DistrictNetworkState,
  NetworkPlayer,
  NetworkStreetService,
  NetworkVehicle
} from '../types.ts';
import {STREET_SPACE_ID, clientInteriorDefinitions} from '../../../shared/content/interior-catalog.ts';
import {
  nextVehicleNeonColor,
  normalizeVehicleNeonColor,
  vehicleNeonColorLabel,
  vehicleNeonUpgradeQuote
} from '../../../shared/content/vehicle-neon.ts';

export type InteractionAffordanceKind =
  | 'hidden'
  | 'ammunition'
  | 'repair'
  | 'hospital'
  | 'clothing'
  | 'exit-vehicle'
  | 'enter-vehicle'
  | 'hijack-vehicle'
  | 'ride-along';

export interface InteractionAffordance {
  visible: boolean;
  kind: InteractionAffordanceKind;
  label: string;
  touchLabel: string;
  ariaLabel: string;
  anchor?: InteractionAnchor;
}

export interface InteractionAnchor {
  x: number;
  y: number;
  vehicleId?: string;
}

export function serviceMinimapPoints(
  state: DistrictNetworkState,
  spaceId = STREET_SPACE_ID
): MinimapPointInput[] {
  return [...(state.services?.values() ?? [])]
    .filter((service) => (service.spaceId || STREET_SPACE_ID) === spaceId)
    .map((service) => ({
      id: service.id,
      kind: 'shop',
      x: service.x,
      y: service.y
    }));
}

export function storefrontMinimapPoints(spaceId = STREET_SPACE_ID): MinimapPointInput[] {
  if (spaceId !== STREET_SPACE_ID) return [];
  return clientInteriorDefinitions().map((interior) => ({
    id: `location-${interior.id}`,
    kind: interior.kind === 'vehicle-store' ? 'shop' : interior.kind,
    x: interior.exteriorDoor.x,
    y: interior.exteriorDoor.y
  }));
}

export function projectInteractionAffordance(
  state: DistrictNetworkState,
  localPlayerId: string
): InteractionAffordance {
  const player = state.players?.get(localPlayerId);
  if (!player?.alive || player.action) return hiddenAffordance();
  const service = nearestUsableService(state, player);
  if (service) {
    if (service.kind === 'clothing') {
      return {
        visible: true,
        kind: 'clothing',
        label: 'Browse Looks',
        touchLabel: 'STYLE',
        ariaLabel: `${service.label}, open wardrobe`,
        anchor: serviceAnchor(service)
      };
    }
    const quote = serviceQuote(state, player, service);
    const repairVehicle = service.kind === 'repair'
      ? state.vehicles.get(player.vehicleId)
      : undefined;
    const repairsNeeded = repairVehicle ? vehicleRepairQuote(repairVehicle) > 0 : false;
    const nextNeon = repairVehicle ? nextVehicleNeonColor(repairVehicle.neonColor) : 'cyan';
    const label = service.kind === 'repair'
      ? repairsNeeded
        ? `Repair Car ($${quote})`
        : normalizeVehicleNeonColor(repairVehicle?.neonColor) === 'off'
          ? `Install Neon ($${quote})`
          : `Neon ${titleCase(vehicleNeonColorLabel(nextNeon))} ($${quote})`
      : (service.kind === 'hospital'
          ? `Get Treatment ($${quote})`
          : `Resupply ($${quote})`);
    return {
      visible: true,
      kind: service.kind,
      label,
      touchLabel: service.kind === 'repair'
        ? (repairsNeeded ? 'FIX' : 'NEON')
        : (service.kind === 'hospital' ? 'CARE' : 'GEAR'),
      ariaLabel: `${service.label}, ${quote} dollars`,
      anchor: repairVehicle
        ? {x: repairVehicle.x, y: repairVehicle.y, vehicleId: repairVehicle.id}
        : serviceAnchor(service)
    };
  }
  if (player.vehicleId) {
    return {
      visible: true,
      kind: 'exit-vehicle',
      label: 'Exit Car',
      touchLabel: 'EXIT',
      ariaLabel: 'Exit vehicle'
    };
  }
  const nearest = nearestEnterableVehicle(state, player);
  if (!nearest) return hiddenAffordance();
  if (nearest.traffic) {
    return {
      visible: true,
      kind: 'hijack-vehicle',
      label: 'Hijack Car',
      touchLabel: 'TAKE',
      ariaLabel: 'Hijack vehicle',
      anchor: vehicleAnchor(nearest)
    };
  }
  if (nearest.driverId) {
    return {
      visible: true,
      kind: 'ride-along',
      label: 'Ride Along',
      touchLabel: 'RIDE',
      ariaLabel: 'Enter vehicle as passenger',
      anchor: vehicleAnchor(nearest)
    };
  }
  return {
    visible: true,
    kind: 'enter-vehicle',
    label: 'Enter Car',
    touchLabel: 'CAR',
    ariaLabel: 'Enter vehicle',
    anchor: vehicleAnchor(nearest)
  };
}

function serviceAnchor(service: NetworkStreetService): InteractionAnchor {
  return {x: service.x, y: service.y};
}

function vehicleAnchor(vehicle: NetworkVehicle): InteractionAnchor {
  return {x: vehicle.x, y: vehicle.y, vehicleId: vehicle.id};
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function nearestUsableService(
  state: DistrictNetworkState,
  player: NetworkPlayer
): NetworkStreetService | undefined {
  const candidates: Array<{service: NetworkStreetService; distance: number}> = [];
  for (const service of state.services?.values() ?? []) {
    if ((service.spaceId || STREET_SPACE_ID) !== (player.spaceId || STREET_SPACE_ID)) continue;
    if (service.kind === 'repair') {
      if (!player.vehicleId || player.vehicleSeat !== 0) continue;
      const vehicle = state.vehicles.get(player.vehicleId);
      if (!vehicle) continue;
      const distance = Math.hypot(vehicle.x - service.x, vehicle.y - service.y);
      if (distance <= service.radius) candidates.push({service, distance});
    } else if (service.kind === 'ammunition') {
      if (player.vehicleId || combatResupplyQuote(player) <= 0) continue;
      const distance = Math.hypot(player.x - service.x, player.y - service.y);
      if (distance <= service.radius) candidates.push({service, distance});
    } else if (service.kind === 'hospital') {
      if (player.vehicleId || medicalTreatmentQuote(player.health) <= 0) continue;
      const distance = Math.hypot(player.x - service.x, player.y - service.y);
      if (distance <= service.radius) candidates.push({service, distance});
    } else {
      if (player.vehicleId) continue;
      const distance = Math.hypot(player.x - service.x, player.y - service.y);
      if (distance <= service.radius) candidates.push({service, distance});
    }
  }
  return candidates.sort((left, right) => (
    left.distance - right.distance || left.service.id.localeCompare(right.service.id)
  ))[0]?.service;
}

function serviceQuote(
  state: DistrictNetworkState,
  player: NetworkPlayer,
  service: NetworkStreetService
): number {
  if (service.kind === 'repair') {
    const vehicle = state.vehicles.get(player.vehicleId) as NetworkVehicle;
    const repairQuote = vehicleRepairQuote(vehicle);
    return repairQuote > 0 ? repairQuote : vehicleNeonUpgradeQuote(vehicle.neonColor);
  }
  if (service.kind === 'hospital') return medicalTreatmentQuote(player.health);
  if (service.kind === 'clothing') return 0;
  return combatResupplyQuote(player);
}

function nearestEnterableVehicle(
  state: DistrictNetworkState,
  player: NetworkPlayer
): NetworkVehicle | undefined {
  if ((player.spaceId || STREET_SPACE_ID) !== STREET_SPACE_ID) return undefined;
  const occupancy = new Map<string, number>();
  for (const occupant of state.players.values()) {
    if (!occupant.vehicleId || (occupant.spaceId || STREET_SPACE_ID) !== STREET_SPACE_ID) continue;
    occupancy.set(occupant.vehicleId, (occupancy.get(occupant.vehicleId) ?? 0) + 1);
  }
  return [...state.vehicles.values()].filter((vehicle) => (
    !vehicle.destroyed &&
    (occupancy.get(vehicle.id) ?? 0) < vehicleDefinition(vehicle.kind).seats &&
    (!vehicle.hijackBy || vehicle.hijackBy === player.id) &&
    Math.hypot(vehicle.x - player.x, vehicle.y - player.y) < 82
  )).sort((left, right) => (
    Math.hypot(left.x - player.x, left.y - player.y) -
      Math.hypot(right.x - player.x, right.y - player.y) ||
    left.id.localeCompare(right.id)
  ))[0];
}

function hiddenAffordance(): InteractionAffordance {
  return {visible: false, kind: 'hidden', label: '', touchLabel: 'CAR', ariaLabel: ''};
}
