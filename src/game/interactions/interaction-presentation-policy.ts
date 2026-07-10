import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {
  ammunitionRestockQuote,
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
}

export function serviceMinimapPoints(state: DistrictNetworkState): MinimapPointInput[] {
  return [...(state.services?.values() ?? [])].map((service) => ({
    id: service.id,
    kind: 'shop',
    x: service.x,
    y: service.y
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
        label: 'BROWSE LOOKS',
        touchLabel: 'STYLE',
        ariaLabel: `${service.label}, open wardrobe`
      };
    }
    const quote = serviceQuote(state, player, service);
    const label = service.kind === 'repair'
      ? `REPAIR $${quote}`
      : (service.kind === 'hospital' ? `TREAT $${quote}` : `RESTOCK $${quote}`);
    return {
      visible: true,
      kind: service.kind,
      label,
      touchLabel: service.kind === 'repair' ? 'FIX' : (service.kind === 'hospital' ? 'CARE' : 'AMMO'),
      ariaLabel: `${service.label}, ${quote} dollars`
    };
  }
  if (player.vehicleId) {
    return {
      visible: true,
      kind: 'exit-vehicle',
      label: 'EXIT CAR',
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
      label: 'HIJACK CAR',
      touchLabel: 'TAKE',
      ariaLabel: 'Hijack vehicle'
    };
  }
  if (nearest.driverId) {
    return {
      visible: true,
      kind: 'ride-along',
      label: 'RIDE ALONG',
      touchLabel: 'RIDE',
      ariaLabel: 'Enter vehicle as passenger'
    };
  }
  return {
    visible: true,
    kind: 'enter-vehicle',
    label: 'ENTER CAR',
    touchLabel: 'CAR',
    ariaLabel: 'Enter vehicle'
  };
}

function nearestUsableService(
  state: DistrictNetworkState,
  player: NetworkPlayer
): NetworkStreetService | undefined {
  const candidates: Array<{service: NetworkStreetService; distance: number}> = [];
  for (const service of state.services?.values() ?? []) {
    if (service.kind === 'repair') {
      if (!player.vehicleId || player.vehicleSeat !== 0) continue;
      const vehicle = state.vehicles.get(player.vehicleId);
      if (!vehicle || vehicleRepairQuote(vehicle) <= 0) continue;
      const distance = Math.hypot(vehicle.x - service.x, vehicle.y - service.y);
      if (distance <= service.radius) candidates.push({service, distance});
    } else if (service.kind === 'ammunition') {
      if (player.vehicleId || ammunitionRestockQuote(player) <= 0) continue;
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
    return vehicleRepairQuote(state.vehicles.get(player.vehicleId) as NetworkVehicle);
  }
  if (service.kind === 'hospital') return medicalTreatmentQuote(player.health);
  if (service.kind === 'clothing') return 0;
  return ammunitionRestockQuote(player);
}

function nearestEnterableVehicle(
  state: DistrictNetworkState,
  player: NetworkPlayer
): NetworkVehicle | undefined {
  const occupancy = new Map<string, number>();
  for (const occupant of state.players.values()) {
    if (!occupant.vehicleId) continue;
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
