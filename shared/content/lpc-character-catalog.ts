export const LPC_RECIPE_VERSION = 1;
export const LPC_FRAME_SIZE = 64;
export const NOCK0_FRAME_SIZE = 72;
export const LPC_ASSET_ROOT = '/assets/custom/lpc-catalog';

export const LPC_ANIMATIONS = ['idle', 'walk', 'slash', 'hurt', 'sit'] as const;
export type LpcAnimationId = typeof LPC_ANIMATIONS[number];

export const LPC_DIRECTIONS = ['up', 'left', 'down', 'right'] as const;

export const LPC_COLORS = [
  'black',
  'charcoal',
  'white',
  'maroon',
  'orange',
  'red',
  'navy',
  'blue',
  'green',
  'brown',
  'leather'
] as const;
export type LpcColorId = typeof LPC_COLORS[number];

export interface LpcOption<T extends string> {
  id: T;
  label: string;
}

export type LpcHairId =
  | 'pixie'
  | 'buzzcut'
  | 'messy1'
  | 'afro'
  | 'ponytail'
  | 'long';
export type LpcFaceId = 'neutral' | 'happy' | 'anger';
export type LpcHatId =
  | 'none'
  | 'yarmulke'
  | 'leather_cap'
  | 'tophat'
  | 'norman_helmet'
  | 'flattop_helmet'
  | 'winter_hat'
  | 'cavalier';
export type LpcTopId = 'tshirt' | 'longsleeve' | 'sleeveless' | 'formal' | 'smiley';
export type LpcLegsId = 'pants' | 'formal_striped' | 'shorts';
export type LpcShoesId = 'shoes' | 'boots' | 'sandals' | 'timbs';

export interface LpcCharacterRecipe {
  version: typeof LPC_RECIPE_VERSION;
  name: string;
  body: 'male';
  face: LpcFaceId;
  hair: LpcHairId;
  hat: LpcHatId;
  top: LpcTopId;
  legs: LpcLegsId;
  shoes: LpcShoesId;
  hairColor: LpcColorId;
  hatColor: LpcColorId;
  topColor: LpcColorId;
  legsColor: LpcColorId;
  shoesColor: LpcColorId;
}

export interface LpcLayerDefinition {
  id: string;
  label: string;
  path: string;
  zPos: number;
  variant?: LpcColorId;
}

export const LPC_HAIR_OPTIONS: readonly LpcOption<LpcHairId>[] = Object.freeze([
  {id: 'pixie', label: 'Pixie'},
  {id: 'buzzcut', label: 'Buzzcut'},
  {id: 'messy1', label: 'Messy'},
  {id: 'afro', label: 'Afro'},
  {id: 'ponytail', label: 'Ponytail'},
  {id: 'long', label: 'Long'}
]);

export const LPC_FACE_OPTIONS: readonly LpcOption<LpcFaceId>[] = Object.freeze([
  {id: 'neutral', label: 'Neutral'},
  {id: 'happy', label: 'Happy'},
  {id: 'anger', label: 'Angry'}
]);

export const LPC_HAT_OPTIONS: readonly LpcOption<LpcHatId>[] = Object.freeze([
  {id: 'none', label: 'No Hat'},
  {id: 'yarmulke', label: 'Yarmulke'},
  {id: 'leather_cap', label: 'Leather Cap'},
  {id: 'tophat', label: 'Top Hat'},
  {id: 'winter_hat', label: 'Winter Hat'},
  {id: 'cavalier', label: 'Cavalier'},
  {id: 'norman_helmet', label: 'Norman Helm'},
  {id: 'flattop_helmet', label: 'Flat Helm'}
]);

export const LPC_TOP_OPTIONS: readonly LpcOption<LpcTopId>[] = Object.freeze([
  {id: 'tshirt', label: 'Vest'},
  {id: 'longsleeve', label: 'Laced Sleeve'},
  {id: 'sleeveless', label: 'Sleeveless'},
  {id: 'formal', label: 'Open Vest'},
  {id: 'smiley', label: 'Smiley Tee'}
]);

export const LPC_LEGS_OPTIONS: readonly LpcOption<LpcLegsId>[] = Object.freeze([
  {id: 'pants', label: 'Pants'},
  {id: 'formal_striped', label: 'Striped Pants'},
  {id: 'shorts', label: 'Shorts'}
]);

export const LPC_SHOE_OPTIONS: readonly LpcOption<LpcShoesId>[] = Object.freeze([
  {id: 'shoes', label: 'Shoes'},
  {id: 'boots', label: 'Boots'},
  {id: 'sandals', label: 'Sandals'},
  {id: 'timbs', label: 'Timbs'}
]);

export const LPC_COLOR_OPTIONS: readonly LpcOption<LpcColorId>[] = Object.freeze([
  {id: 'black', label: 'Black'},
  {id: 'charcoal', label: 'Charcoal'},
  {id: 'white', label: 'White'},
  {id: 'maroon', label: 'Maroon'},
  {id: 'orange', label: 'Orange'},
  {id: 'red', label: 'Red'},
  {id: 'navy', label: 'Navy'},
  {id: 'blue', label: 'Blue'},
  {id: 'green', label: 'Green'},
  {id: 'brown', label: 'Brown'},
  {id: 'leather', label: 'Leather'}
]);

export const LPC_COLOR_VALUES: Readonly<Record<LpcColorId, string>> = Object.freeze({
  black: '#1b1e20',
  charcoal: '#30373a',
  white: '#e8e9df',
  maroon: '#722d3b',
  orange: '#c95f16',
  red: '#b9403e',
  navy: '#263f66',
  blue: '#4269b8',
  green: '#3c7a4c',
  brown: '#7a5136',
  leather: '#9a6339'
});

export const DEFAULT_LPC_RECIPE: Readonly<LpcCharacterRecipe> = Object.freeze({
  version: LPC_RECIPE_VERSION,
  name: 'LPC Driver',
  body: 'male',
  face: 'neutral',
  hair: 'pixie',
  hat: 'none',
  top: 'sleeveless',
  legs: 'formal_striped',
  shoes: 'sandals',
  hairColor: 'orange',
  hatColor: 'black',
  topColor: 'white',
  legsColor: 'navy',
  shoesColor: 'black'
});

export function cloneLpcRecipe(
  recipe: Readonly<LpcCharacterRecipe> = DEFAULT_LPC_RECIPE
): LpcCharacterRecipe {
  return {...recipe};
}

export function validateLpcCharacterRecipe(value: unknown): LpcCharacterRecipe | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const name = sanitizeLpcName(input.name);
  if (
    input.version !== LPC_RECIPE_VERSION ||
    !name ||
    input.body !== 'male' ||
    !member(input.face, LPC_FACE_OPTIONS) ||
    !member(input.hair, LPC_HAIR_OPTIONS) ||
    !member(input.top, LPC_TOP_OPTIONS) ||
    !member(input.legs, LPC_LEGS_OPTIONS) ||
    !member(input.shoes, LPC_SHOE_OPTIONS) ||
    !member(input.topColor, LPC_COLOR_OPTIONS) ||
    !member(input.legsColor, LPC_COLOR_OPTIONS) ||
    !member(input.shoesColor, LPC_COLOR_OPTIONS)
  ) {
    return undefined;
  }
  return {
    version: LPC_RECIPE_VERSION,
    name,
    body: 'male',
    face: input.face,
    hair: input.hair,
    hat: member(input.hat, LPC_HAT_OPTIONS) ? input.hat : DEFAULT_LPC_RECIPE.hat,
    top: input.top,
    legs: input.legs,
    shoes: input.shoes,
    hairColor: member(input.hairColor, LPC_COLOR_OPTIONS) ? input.hairColor : DEFAULT_LPC_RECIPE.hairColor,
    hatColor: member(input.hatColor, LPC_COLOR_OPTIONS) ? input.hatColor : DEFAULT_LPC_RECIPE.hatColor,
    topColor: input.topColor,
    legsColor: input.legsColor,
    shoesColor: input.shoesColor
  };
}

export function parseLpcRecipe(value: string | undefined): LpcCharacterRecipe | undefined {
  if (!value || value.length > 1800) return undefined;
  try {
    return validateLpcCharacterRecipe(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function serializeLpcRecipe(recipe: LpcCharacterRecipe): string {
  return JSON.stringify(validateLpcCharacterRecipe(recipe) ?? DEFAULT_LPC_RECIPE);
}

export function lpcRecipeKey(recipe: LpcCharacterRecipe): string {
  return serializeLpcRecipe(recipe);
}

export function lpcLayerDefinitions(recipe: LpcCharacterRecipe): LpcLayerDefinition[] {
  const layers: LpcLayerDefinition[] = [
    {id: 'body', label: 'Body', path: 'spritesheets/body/bodies/male', zPos: 10},
    layerForShoes(recipe),
    layerForLegs(recipe),
    layerForTop(recipe),
    {id: 'head', label: 'Head', path: 'spritesheets/head/heads/human/male', zPos: 100},
    {id: 'face', label: 'Face', path: `spritesheets/head/faces/male/${recipe.face}`, zPos: 101},
    ...hairLayers(recipe.hair),
    ...hatLayers(recipe)
  ];
  return layers.sort((a, b) => a.zPos - b.zPos);
}

export function lpcAssetCandidates(
  layer: LpcLayerDefinition,
  animation: LpcAnimationId
): string[] {
  const names = animation === 'walk' ? ['walk'] : [animation, 'walk'];
  const candidates: string[] = [];
  if (layer.variant) {
    for (const name of names) candidates.push(`${LPC_ASSET_ROOT}/${layer.path}/${name}/${layer.variant}.png`);
  }
  for (const name of names) candidates.push(`${LPC_ASSET_ROOT}/${layer.path}/${name}.png`);
  if (layer.variant) candidates.push(`${LPC_ASSET_ROOT}/${layer.path}/${layer.variant}.png`);
  return candidates;
}

function layerForTop(recipe: LpcCharacterRecipe): LpcLayerDefinition {
  if (recipe.top === 'smiley') {
    return {
      id: 'top',
      label: 'Top',
      path: 'spritesheets/torso/clothes/custom/smiley_tee/male',
      zPos: 35
    };
  }
  const base = recipe.top === 'tshirt'
    ? 'spritesheets/torso/clothes/vest/male'
    : recipe.top === 'longsleeve'
      ? 'spritesheets/torso/clothes/longsleeve/laced/male'
      : recipe.top === 'formal'
        ? 'spritesheets/torso/clothes/vest_open/male'
        : 'spritesheets/torso/clothes/sleeveless/sleeveless/male';
  return {id: 'top', label: 'Top', path: base, zPos: 35, variant: recipe.topColor};
}

function layerForLegs(recipe: LpcCharacterRecipe): LpcLayerDefinition {
  const base = recipe.legs === 'formal_striped'
    ? 'spritesheets/legs/formal_striped/male'
    : recipe.legs === 'shorts'
      ? 'spritesheets/legs/shorts/shorts/male'
      : 'spritesheets/legs/pants/male';
  return {id: 'legs', label: 'Legs', path: base, zPos: 20, variant: recipe.legsColor};
}

function layerForShoes(recipe: LpcCharacterRecipe): LpcLayerDefinition {
  if (recipe.shoes === 'timbs') {
    return {
      id: 'shoes',
      label: 'Shoes',
      path: 'spritesheets/feet/boots/custom/timbs/male',
      zPos: 15
    };
  }
  const base = recipe.shoes === 'boots'
    ? 'spritesheets/feet/boots/basic/male'
    : recipe.shoes === 'sandals'
      ? 'spritesheets/feet/sandals/male'
      : 'spritesheets/feet/shoes/basic/male';
  return {id: 'shoes', label: 'Shoes', path: base, zPos: 15, variant: recipe.shoesColor};
}

function hairLayers(hair: LpcHairId): LpcLayerDefinition[] {
  if (hair === 'ponytail') {
    return [
      {id: 'hair-bg', label: 'Hair Back', path: 'spritesheets/hair/ponytail/adult/bg', zPos: 90},
      {id: 'hair-fg', label: 'Hair Front', path: 'spritesheets/hair/ponytail/adult/fg', zPos: 120}
    ];
  }
  return [{
    id: 'hair',
    label: 'Hair',
    path: `spritesheets/hair/${hair}/adult`,
    zPos: 120
  }];
}

function hatLayers(recipe: LpcCharacterRecipe): LpcLayerDefinition[] {
  if (recipe.hat === 'none') return [];
  const fixedPaths: Partial<Record<LpcHatId, string>> = {
    yarmulke: 'spritesheets/hat/custom/yarmulke/adult',
    leather_cap: 'spritesheets/hat/cloth/leather_cap/adult',
    tophat: 'spritesheets/hat/formal/tophat/adult',
    norman_helmet: 'spritesheets/hat/helmet/norman/adult',
    flattop_helmet: 'spritesheets/hat/helmet/flattop/male'
  };
  const colorPaths: Partial<Record<LpcHatId, string>> = {
    winter_hat: 'spritesheets/hat/holiday/christmas/adult',
    cavalier: 'spritesheets/hat/pirate/cavalier/adult'
  };
  const fixedPath = fixedPaths[recipe.hat];
  if (fixedPath) return [{id: 'hat', label: 'Hat', path: fixedPath, zPos: 130}];
  const colorPath = colorPaths[recipe.hat];
  if (colorPath) return [{id: 'hat', label: 'Hat', path: colorPath, zPos: 130, variant: recipe.hatColor}];
  return [];
}

function sanitizeLpcName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^A-Za-z0-9 '.&-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function member<T extends string>(
  value: unknown,
  options: readonly LpcOption<T>[]
): value is T {
  return typeof value === 'string' && options.some((option) => option.id === value);
}
