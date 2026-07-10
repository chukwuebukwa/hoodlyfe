import type {WardrobeItemId} from '../content/wardrobe-catalog.ts';

export const WARDROBE_REQUEST_MESSAGE = 'wardrobe.request';
export const WARDROBE_STATE_MESSAGE = 'wardrobe.state';
export const WARDROBE_OPEN_MESSAGE = 'wardrobe.open';

export interface WardrobeStateMessage {
  ownedItemIds: WardrobeItemId[];
  developmentGrants: boolean;
}

export interface WardrobeOpenMessage {
  serviceId: string;
}
