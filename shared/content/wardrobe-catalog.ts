import {
  BOTTOM_STYLES,
  HAIR_STYLES,
  HEADWEAR_STYLES,
  SHOE_STYLES,
  TOP_STYLES,
  type PlayerAppearance
} from './appearance-catalog.ts';

export type WardrobeSlot = 'hair' | 'headwear' | 'top' | 'bottom' | 'shoes';
export type WardrobeItemId = `${WardrobeSlot}:${string}`;

export interface WardrobeItemDefinition {
  id: WardrobeItemId;
  slot: WardrobeSlot;
  styleId: string;
}

export const WARDROBE_ITEMS: readonly WardrobeItemDefinition[] = Object.freeze([
  ...HAIR_STYLES.map((styleId) => item('hair', styleId)),
  ...HEADWEAR_STYLES.map((styleId) => item('headwear', styleId)),
  ...TOP_STYLES.map((styleId) => item('top', styleId)),
  ...BOTTOM_STYLES.map((styleId) => item('bottom', styleId)),
  ...SHOE_STYLES.map((styleId) => item('shoes', styleId))
]);

export const BASE_WARDROBE_GRANTS: readonly WardrobeItemId[] = Object.freeze([
  'hair:cropped',
  'headwear:none',
  'top:jacket',
  'bottom:jeans',
  'shoes:runners'
]);

export const DEVELOPMENT_WARDROBE_GRANTS: readonly WardrobeItemId[] = Object.freeze(
  WARDROBE_ITEMS.map((definition) => definition.id)
);

const WARDROBE_ITEM_IDS = new Set<WardrobeItemId>(DEVELOPMENT_WARDROBE_GRANTS);

export function isWardrobeItemId(value: unknown): value is WardrobeItemId {
  return typeof value === 'string' && WARDROBE_ITEM_IDS.has(value as WardrobeItemId);
}

export function requiredWardrobeItems(appearance: PlayerAppearance): readonly WardrobeItemId[] {
  return [
    `hair:${appearance.hairStyle}`,
    `headwear:${appearance.headwear}`,
    `top:${appearance.topStyle}`,
    `bottom:${appearance.bottomStyle}`,
    `shoes:${appearance.shoeStyle}`
  ];
}

export function wardrobeItemForField(field: keyof PlayerAppearance, styleId: string): WardrobeItemId | undefined {
  const slot = field === 'hairStyle'
    ? 'hair'
    : field === 'headwear'
      ? 'headwear'
      : field === 'topStyle'
        ? 'top'
        : field === 'bottomStyle'
          ? 'bottom'
          : field === 'shoeStyle'
            ? 'shoes'
            : undefined;
  if (!slot) return undefined;
  const id = `${slot}:${styleId}` as WardrobeItemId;
  return isWardrobeItemId(id) ? id : undefined;
}

function item(slot: WardrobeSlot, styleId: string): WardrobeItemDefinition {
  return {id: `${slot}:${styleId}`, slot, styleId};
}
