import type {VehicleKind} from '../content/vehicle-catalog.ts';
import type {VehicleNeonColor} from '../content/vehicle-neon.ts';

export const STOREFRONT_PROTOCOL_VERSION = 1;
export const STOREFRONT_OPEN_MESSAGE = 'storefront.open';
export const STOREFRONT_PURCHASE_MESSAGE = 'storefront.purchase';
export const STOREFRONT_RESULT_MESSAGE = 'storefront.result';

export type StorefrontKind = 'repair';
export type StorefrontProductCategory = 'service' | 'lighting';
export type StorefrontProductId =
  | 'repair.full'
  | `neon.${VehicleNeonColor}`;

export interface StorefrontProduct {
  id: StorefrontProductId;
  category: StorefrontProductCategory;
  label: string;
  description: string;
  price: number;
  available: boolean;
  selected: boolean;
  unavailableReason?: string;
  swatch?: VehicleNeonColor;
}

export interface StorefrontVehicleSnapshot {
  id: string;
  kind: VehicleKind;
  label: string;
  health: number;
  maxHealth: number;
  engineDamage: number;
  bodyDamage: number;
  currentNeon: VehicleNeonColor;
}

export interface StorefrontSnapshot {
  protocolVersion: typeof STOREFRONT_PROTOCOL_VERSION;
  storeId: string;
  kind: StorefrontKind;
  label: string;
  balance: number;
  vehicle: StorefrontVehicleSnapshot;
  products: StorefrontProduct[];
}

export interface StorefrontOpenMessage {
  snapshot: StorefrontSnapshot;
}

export interface StorefrontPurchaseMessage {
  protocolVersion: typeof STOREFRONT_PROTOCOL_VERSION;
  sequence: number;
  storeId: string;
  vehicleId: string;
  productId: StorefrontProductId;
}

export type StorefrontPurchaseStatus =
  | 'applied'
  | 'duplicate'
  | 'insufficient-funds'
  | 'unavailable'
  | 'invalid';

export interface StorefrontResultMessage {
  protocolVersion: typeof STOREFRONT_PROTOCOL_VERSION;
  sequence: number;
  status: StorefrontPurchaseStatus;
  message: string;
  snapshot?: StorefrontSnapshot;
}

export function isStorefrontProductId(value: unknown): value is StorefrontProductId {
  return value === 'repair.full' ||
    value === 'neon.off' ||
    value === 'neon.cyan' ||
    value === 'neon.magenta' ||
    value === 'neon.violet' ||
    value === 'neon.lime' ||
    value === 'neon.amber' ||
    value === 'neon.white';
}

export function isStorefrontPurchaseMessage(value: unknown): value is StorefrontPurchaseMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StorefrontPurchaseMessage>;
  return candidate.protocolVersion === STOREFRONT_PROTOCOL_VERSION &&
    Number.isSafeInteger(candidate.sequence) &&
    Number(candidate.sequence) > 0 &&
    typeof candidate.storeId === 'string' &&
    candidate.storeId.length > 0 &&
    candidate.storeId.length <= 80 &&
    typeof candidate.vehicleId === 'string' &&
    candidate.vehicleId.length > 0 &&
    candidate.vehicleId.length <= 120 &&
    isStorefrontProductId(candidate.productId);
}
