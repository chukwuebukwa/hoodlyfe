import type {CharacterClipId} from './character-animation-manifest.ts';
import {WARDROBE_ITEMS, type WardrobeItemId, type WardrobeSlot} from './wardrobe-catalog.ts';

export type CharacterBodyFamilyId = 'standard-01';
export type CharacterMaterialChannel = 'skin' | 'hair' | 'primary' | 'secondary' | 'shoes';

export interface CharacterPartDefinition {
  readonly id: WardrobeItemId;
  readonly slot: WardrobeSlot;
  readonly bodyFamilies: readonly CharacterBodyFamilyId[];
  readonly channels: readonly CharacterMaterialChannel[];
  readonly clips: readonly CharacterClipId[];
  readonly hides: readonly WardrobeSlot[];
  readonly renderMode: 'procedural-fallback' | 'authored-layers';
}

const COMPLETE_CLIPS: readonly CharacterClipId[] = Object.freeze([
  'idle', 'walk', 'melee', 'hit', 'knockdown', 'dead', 'vehicleEnter', 'carjack', 'ejected'
]);

export const CHARACTER_PARTS: readonly CharacterPartDefinition[] = Object.freeze(
  WARDROBE_ITEMS.map((item) => Object.freeze({
    id: item.id,
    slot: item.slot,
    bodyFamilies: Object.freeze(['standard-01'] as const),
    channels: channelsFor(item.slot),
    clips: COMPLETE_CLIPS,
    hides: hidesFor(item.id),
    renderMode: 'procedural-fallback' as const
  }))
);

const PARTS_BY_ID = new Map(CHARACTER_PARTS.map((part) => [part.id, part]));

export function characterPartDefinition(id: WardrobeItemId): CharacterPartDefinition {
  const definition = PARTS_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown character part: ${id}`);
  return definition;
}

function channelsFor(slot: WardrobeSlot): readonly CharacterMaterialChannel[] {
  if (slot === 'hair' || slot === 'headwear') return Object.freeze(['hair', 'primary']);
  if (slot === 'shoes') return Object.freeze(['shoes', 'secondary']);
  return Object.freeze(['primary', 'secondary']);
}

function hidesFor(id: WardrobeItemId): readonly WardrobeSlot[] {
  if (id === 'headwear:cap' || id === 'headwear:beanie') return Object.freeze(['hair']);
  return Object.freeze([]);
}
