export const BODY_TYPES = ['standard', 'slim', 'broad'] as const;
export const SKIN_TONES = ['deep', 'umber', 'bronze', 'olive', 'warm', 'light'] as const;
export const HAIR_STYLES = ['cropped', 'fade', 'curls'] as const;
export const HEADWEAR_STYLES = ['none', 'cap', 'beanie'] as const;
export const TOP_STYLES = ['tee', 'jacket', 'hoodie'] as const;
export const BOTTOM_STYLES = ['jeans', 'cargos', 'track'] as const;
export const SHOE_STYLES = ['runners', 'boots'] as const;
export const APPEARANCE_COLORS = [
  'charcoal',
  'white',
  'red',
  'amber',
  'green',
  'cyan',
  'blue',
  'violet',
  'pink',
  'denim'
] as const;

export type BodyTypeId = typeof BODY_TYPES[number];
export type SkinToneId = typeof SKIN_TONES[number];
export type HairStyleId = typeof HAIR_STYLES[number];
export type HeadwearStyleId = typeof HEADWEAR_STYLES[number];
export type TopStyleId = typeof TOP_STYLES[number];
export type BottomStyleId = typeof BOTTOM_STYLES[number];
export type ShoeStyleId = typeof SHOE_STYLES[number];
export type AppearanceColorId = typeof APPEARANCE_COLORS[number];

export interface PlayerAppearance {
  outfitName: string;
  bodyType: BodyTypeId;
  skinTone: SkinToneId;
  hairStyle: HairStyleId;
  hairColor: AppearanceColorId;
  headwear: HeadwearStyleId;
  topStyle: TopStyleId;
  topColor: AppearanceColorId;
  accentColor: AppearanceColorId;
  bottomStyle: BottomStyleId;
  bottomColor: AppearanceColorId;
  shoeStyle: ShoeStyleId;
  shoeColor: AppearanceColorId;
}

export interface AppearanceOption<T extends string> {
  id: T;
  label: string;
}

export const BODY_OPTIONS: readonly AppearanceOption<BodyTypeId>[] = Object.freeze([
  {id: 'standard', label: 'Standard'},
  {id: 'slim', label: 'Slim'},
  {id: 'broad', label: 'Broad'}
]);
export const SKIN_OPTIONS: readonly AppearanceOption<SkinToneId>[] = Object.freeze([
  {id: 'deep', label: 'Deep'},
  {id: 'umber', label: 'Umber'},
  {id: 'bronze', label: 'Bronze'},
  {id: 'olive', label: 'Olive'},
  {id: 'warm', label: 'Warm'},
  {id: 'light', label: 'Light'}
]);
export const HAIR_OPTIONS: readonly AppearanceOption<HairStyleId>[] = Object.freeze([
  {id: 'cropped', label: 'Cropped'},
  {id: 'fade', label: 'Fade'},
  {id: 'curls', label: 'Curls'}
]);
export const HEADWEAR_OPTIONS: readonly AppearanceOption<HeadwearStyleId>[] = Object.freeze([
  {id: 'none', label: 'None'},
  {id: 'cap', label: 'Cap'},
  {id: 'beanie', label: 'Beanie'}
]);
export const TOP_OPTIONS: readonly AppearanceOption<TopStyleId>[] = Object.freeze([
  {id: 'tee', label: 'Tee'},
  {id: 'jacket', label: 'Jacket'},
  {id: 'hoodie', label: 'Hoodie'}
]);
export const BOTTOM_OPTIONS: readonly AppearanceOption<BottomStyleId>[] = Object.freeze([
  {id: 'jeans', label: 'Jeans'},
  {id: 'cargos', label: 'Cargos'},
  {id: 'track', label: 'Track'},
]);
export const SHOE_OPTIONS: readonly AppearanceOption<ShoeStyleId>[] = Object.freeze([
  {id: 'runners', label: 'Runners'},
  {id: 'boots', label: 'Boots'}
]);
export const COLOR_OPTIONS: readonly AppearanceOption<AppearanceColorId>[] = Object.freeze([
  {id: 'charcoal', label: 'Charcoal'},
  {id: 'white', label: 'White'},
  {id: 'red', label: 'Red'},
  {id: 'amber', label: 'Amber'},
  {id: 'green', label: 'Green'},
  {id: 'cyan', label: 'Cyan'},
  {id: 'blue', label: 'Blue'},
  {id: 'violet', label: 'Violet'},
  {id: 'pink', label: 'Pink'},
  {id: 'denim', label: 'Denim'}
]);

export const SKIN_COLORS: Readonly<Record<SkinToneId, number>> = Object.freeze({
  deep: 0x513126,
  umber: 0x754a36,
  bronze: 0xa66b4b,
  olive: 0xb78a63,
  warm: 0xd5a07b,
  light: 0xf0c8a5
});

export const COLOR_VALUES: Readonly<Record<AppearanceColorId, number>> = Object.freeze({
  charcoal: 0x25292b,
  white: 0xe8eceb,
  red: 0xc93f45,
  amber: 0xe3a72f,
  green: 0x3b9a61,
  cyan: 0x37aeba,
  blue: 0x4266be,
  violet: 0x7754b8,
  pink: 0xc75683,
  denim: 0x405b72
});

export const DEFAULT_APPEARANCE: Readonly<PlayerAppearance> = Object.freeze({
  outfitName: 'Street Fit',
  bodyType: 'standard',
  skinTone: 'bronze',
  hairStyle: 'cropped',
  hairColor: 'charcoal',
  headwear: 'none',
  topStyle: 'jacket',
  topColor: 'charcoal',
  accentColor: 'amber',
  bottomStyle: 'jeans',
  bottomColor: 'denim',
  shoeStyle: 'runners',
  shoeColor: 'white'
});

export function validateAppearance(value: unknown): PlayerAppearance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const outfitName = sanitizeOutfitName(input.outfitName);
  if (
    !outfitName ||
    !member(input.bodyType, BODY_TYPES) ||
    !member(input.skinTone, SKIN_TONES) ||
    !member(input.hairStyle, HAIR_STYLES) ||
    !member(input.hairColor, APPEARANCE_COLORS) ||
    !member(input.headwear, HEADWEAR_STYLES) ||
    !member(input.topStyle, TOP_STYLES) ||
    !member(input.topColor, APPEARANCE_COLORS) ||
    !member(input.accentColor, APPEARANCE_COLORS) ||
    !member(input.bottomStyle, BOTTOM_STYLES) ||
    !member(input.bottomColor, APPEARANCE_COLORS) ||
    !member(input.shoeStyle, SHOE_STYLES) ||
    !member(input.shoeColor, APPEARANCE_COLORS)
  ) {
    return undefined;
  }
  return {
    outfitName,
    bodyType: input.bodyType,
    skinTone: input.skinTone,
    hairStyle: input.hairStyle,
    hairColor: input.hairColor,
    headwear: input.headwear,
    topStyle: input.topStyle,
    topColor: input.topColor,
    accentColor: input.accentColor,
    bottomStyle: input.bottomStyle,
    bottomColor: input.bottomColor,
    shoeStyle: input.shoeStyle,
    shoeColor: input.shoeColor
  };
}

export function cloneAppearance(
  appearance: Readonly<PlayerAppearance> = DEFAULT_APPEARANCE
): PlayerAppearance {
  return {...appearance};
}

export function appearanceTextureKey(appearance: PlayerAppearance): string {
  return [
    appearance.bodyType,
    appearance.skinTone,
    appearance.hairStyle,
    appearance.hairColor,
    appearance.headwear,
    appearance.topStyle,
    appearance.topColor,
    appearance.accentColor,
    appearance.bottomStyle,
    appearance.bottomColor,
    appearance.shoeStyle,
    appearance.shoeColor
  ].join('-');
}

function sanitizeOutfitName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^A-Za-z0-9 '.&-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function member<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
