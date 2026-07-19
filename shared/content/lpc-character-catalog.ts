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

export const LPC_SKIN_COLORS = [
  'pale',
  'light',
  'tan',
  'olive',
  'brown',
  'deep'
] as const;
export type LpcSkinColorId = typeof LPC_SKIN_COLORS[number];

export interface LpcOption<T extends string> {
  id: T;
  label: string;
}

export type LpcBodyId = 'male' | 'female';
export type LpcHairId =
  | 'pixie'
  | 'buzzcut'
  | 'messy1'
  | 'afro'
  | 'cornrows'
  | 'braid'
  | 'braid2'
  | 'curly_short'
  | 'dreadlocks_short'
  | 'twists_fade'
  | 'ponytail'
  | 'long';
export type LpcFaceId =
  | 'neutral'
  | 'happy'
  | 'anger'
  | 'sad'
  | 'shock'
  | 'blush'
  | 'closed'
  | 'look_l'
  | 'look_r'
  | 'shame';
export type LpcHatId =
  | 'none'
  | 'yarmulke'
  | 'bandana'
  | 'hood'
  | 'leather_cap'
  | 'bowler'
  | 'crown'
  | 'tiara'
  | 'tophat'
  | 'santa'
  | 'elf'
  | 'wizard'
  | 'pirate_bandana'
  | 'tricorne'
  | 'norman_helmet'
  | 'flattop_helmet'
  | 'winter_hat'
  | 'cavalier';
export type LpcTopId =
  | 'tshirt'
  | 'polo'
  | 'buttoned'
  | 'longsleeve'
  | 'cardigan'
  | 'sleeveless'
  | 'formal'
  | 'overalls'
  | 'suspenders'
  | 'leather_armor'
  | 'chainmail'
  | 'smiley'
  | 'puffer';
export type LpcLegsId =
  | 'pants'
  | 'formal'
  | 'formal_striped'
  | 'cuffed'
  | 'leggings'
  | 'shorts'
  | 'skirt'
  | 'plate_legs';
export type LpcShoesId =
  | 'shoes'
  | 'revised_shoes'
  | 'boots'
  | 'fold_boots'
  | 'sandals'
  | 'slippers'
  | 'timbs';

export interface LpcCharacterRecipe {
  version: typeof LPC_RECIPE_VERSION;
  name: string;
  body: LpcBodyId;
  skinColor: LpcSkinColorId;
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

export const LPC_BODY_OPTIONS: readonly LpcOption<LpcBodyId>[] = Object.freeze([
  {id: 'male', label: 'Male'},
  {id: 'female', label: 'Female'}
]);

export const LPC_HAIR_OPTIONS: readonly LpcOption<LpcHairId>[] = Object.freeze([
  {id: 'pixie', label: 'Pixie'},
  {id: 'buzzcut', label: 'Buzzcut'},
  {id: 'messy1', label: 'Messy'},
  {id: 'afro', label: 'Afro'},
  {id: 'cornrows', label: 'Cornrows'},
  {id: 'braid', label: 'Braid'},
  {id: 'braid2', label: 'Double Braid'},
  {id: 'curly_short', label: 'Curly Short'},
  {id: 'dreadlocks_short', label: 'Short Locs'},
  {id: 'twists_fade', label: 'Twists Fade'},
  {id: 'ponytail', label: 'Ponytail'},
  {id: 'long', label: 'Long'}
]);

export const LPC_FACE_OPTIONS: readonly LpcOption<LpcFaceId>[] = Object.freeze([
  {id: 'neutral', label: 'Neutral'},
  {id: 'happy', label: 'Happy'},
  {id: 'anger', label: 'Angry'},
  {id: 'sad', label: 'Sad'},
  {id: 'shock', label: 'Shocked'},
  {id: 'blush', label: 'Blush'},
  {id: 'closed', label: 'Eyes Closed'},
  {id: 'look_l', label: 'Look Left'},
  {id: 'look_r', label: 'Look Right'},
  {id: 'shame', label: 'Shame'}
]);

export const LPC_HAT_OPTIONS: readonly LpcOption<LpcHatId>[] = Object.freeze([
  {id: 'none', label: 'No Hat'},
  {id: 'yarmulke', label: 'Yarmulke'},
  {id: 'bandana', label: 'Bandana'},
  {id: 'hood', label: 'Hood'},
  {id: 'leather_cap', label: 'Leather Cap'},
  {id: 'bowler', label: 'Bowler'},
  {id: 'crown', label: 'Crown'},
  {id: 'tiara', label: 'Tiara'},
  {id: 'tophat', label: 'Top Hat'},
  {id: 'santa', label: 'Santa Hat'},
  {id: 'elf', label: 'Elf Hat'},
  {id: 'wizard', label: 'Wizard Hat'},
  {id: 'pirate_bandana', label: 'Pirate Bandana'},
  {id: 'tricorne', label: 'Tricorne'},
  {id: 'winter_hat', label: 'Winter Hat'},
  {id: 'cavalier', label: 'Cavalier'},
  {id: 'norman_helmet', label: 'Norman Helm'},
  {id: 'flattop_helmet', label: 'Flat Helm'}
]);

export const LPC_TOP_OPTIONS: readonly LpcOption<LpcTopId>[] = Object.freeze([
  {id: 'tshirt', label: 'Vest'},
  {id: 'polo', label: 'Polo'},
  {id: 'buttoned', label: 'Buttoned Tee'},
  {id: 'longsleeve', label: 'Laced Sleeve'},
  {id: 'cardigan', label: 'Cardigan'},
  {id: 'sleeveless', label: 'Sleeveless'},
  {id: 'formal', label: 'Open Vest'},
  {id: 'overalls', label: 'Overalls'},
  {id: 'suspenders', label: 'Suspenders'},
  {id: 'leather_armor', label: 'Leather Armor'},
  {id: 'chainmail', label: 'Chainmail'},
  {id: 'smiley', label: 'Smiley Tee'},
  {id: 'puffer', label: 'Puffer Jacket'}
]);

export const LPC_LEGS_OPTIONS: readonly LpcOption<LpcLegsId>[] = Object.freeze([
  {id: 'pants', label: 'Pants'},
  {id: 'formal', label: 'Formal Pants'},
  {id: 'formal_striped', label: 'Striped Pants'},
  {id: 'cuffed', label: 'Cuffed Pants'},
  {id: 'leggings', label: 'Leggings'},
  {id: 'shorts', label: 'Shorts'},
  {id: 'skirt', label: 'Skirt'},
  {id: 'plate_legs', label: 'Plate Legs'}
]);

export const LPC_SHOE_OPTIONS: readonly LpcOption<LpcShoesId>[] = Object.freeze([
  {id: 'shoes', label: 'Shoes'},
  {id: 'revised_shoes', label: 'Low Shoes'},
  {id: 'boots', label: 'Boots'},
  {id: 'fold_boots', label: 'Fold Boots'},
  {id: 'sandals', label: 'Sandals'},
  {id: 'slippers', label: 'Slippers'},
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

export const LPC_SKIN_COLOR_OPTIONS: readonly LpcOption<LpcSkinColorId>[] = Object.freeze([
  {id: 'pale', label: 'Pale'},
  {id: 'light', label: 'Light'},
  {id: 'tan', label: 'Tan'},
  {id: 'olive', label: 'Olive'},
  {id: 'brown', label: 'Brown'},
  {id: 'deep', label: 'Deep'}
]);

export const LPC_SKIN_COLOR_VALUES: Readonly<Record<LpcSkinColorId, string>> = Object.freeze({
  pale: '#f2c7a3',
  light: '#d99d73',
  tan: '#b9784f',
  olive: '#9f7650',
  brown: '#754c35',
  deep: '#4b2f28'
});

export const DEFAULT_LPC_RECIPE: Readonly<LpcCharacterRecipe> = Object.freeze({
  version: LPC_RECIPE_VERSION,
  name: 'LPC Driver',
  body: 'male',
  skinColor: 'light',
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
    !member(input.body, LPC_BODY_OPTIONS) ||
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
    body: input.body,
    skinColor: member(input.skinColor, LPC_SKIN_COLOR_OPTIONS) ? input.skinColor : DEFAULT_LPC_RECIPE.skinColor,
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
    {id: 'body', label: 'Body', path: `spritesheets/body/bodies/${recipe.body}`, zPos: 10},
    layerForShoes(recipe),
    layerForLegs(recipe),
    layerForTop(recipe),
    {id: 'head', label: 'Head', path: `spritesheets/head/heads/human/${recipe.body}`, zPos: 100},
    {id: 'face', label: 'Face', path: `spritesheets/head/faces/${recipe.body}/${recipe.face}`, zPos: 101},
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
  const shape = lpcBodyShape(recipe);
  if (recipe.top === 'smiley') {
    return {
      id: 'top',
      label: 'Top',
      path: `spritesheets/torso/clothes/custom/smiley_tee/${shape}`,
      zPos: 35
    };
  }
  if (recipe.top === 'puffer') {
    return {
      id: 'top',
      label: 'Top',
      path: `spritesheets/torso/clothes/custom/puffer/${shape}`,
      zPos: 35,
      variant: recipe.topColor
    };
  }
  const base = topPath(recipe.top, shape);
  return {id: 'top', label: 'Top', path: base, zPos: 35, variant: recipe.topColor};
}

function layerForLegs(recipe: LpcCharacterRecipe): LpcLayerDefinition {
  const shape = lpcBodyShape(recipe);
  const base = recipe.legs === 'formal'
    ? `spritesheets/legs/formal/${shape}`
    : recipe.legs === 'formal_striped'
      ? `spritesheets/legs/formal_striped/${shape}`
      : recipe.legs === 'cuffed'
        ? `spritesheets/legs/cuffed/${shape}`
        : recipe.legs === 'leggings'
          ? `spritesheets/legs/leggings/${shape}`
          : recipe.legs === 'shorts'
            ? `spritesheets/legs/shorts/shorts/${shape}`
            : recipe.legs === 'skirt'
              ? `spritesheets/legs/skirts/plain/${shape}`
              : recipe.legs === 'plate_legs'
                ? `spritesheets/legs/armour/plate/${shape}`
                : `spritesheets/legs/pants/${recipe.body === 'female' ? 'female' : 'male'}`;
  return {id: 'legs', label: 'Legs', path: base, zPos: 20, variant: recipe.legsColor};
}

function layerForShoes(recipe: LpcCharacterRecipe): LpcLayerDefinition {
  const shape = lpcBodyShape(recipe);
  if (recipe.shoes === 'timbs') {
    return {
      id: 'shoes',
      label: 'Shoes',
      path: `spritesheets/feet/boots/custom/timbs/${shape}`,
      zPos: 15
    };
  }
  const base = recipe.shoes === 'revised_shoes'
    ? `spritesheets/feet/shoes/revised/${shape}`
    : recipe.shoes === 'boots'
    ? `spritesheets/feet/boots/basic/${shape}`
    : recipe.shoes === 'fold_boots'
      ? `spritesheets/feet/boots/fold/${shape}`
    : recipe.shoes === 'sandals'
      ? `spritesheets/feet/sandals/${shape}`
      : recipe.shoes === 'slippers'
        ? `spritesheets/feet/slippers/${shape}`
        : `spritesheets/feet/shoes/basic/${shape}`;
  return {id: 'shoes', label: 'Shoes', path: base, zPos: 15, variant: recipe.shoesColor};
}

function hairLayers(hair: LpcHairId): LpcLayerDefinition[] {
  if (['ponytail', 'braid', 'braid2'].includes(hair)) {
    return [
      {id: 'hair-bg', label: 'Hair Back', path: `spritesheets/hair/${hair}/adult/bg`, zPos: 90},
      {id: 'hair-fg', label: 'Hair Front', path: `spritesheets/hair/${hair}/adult/fg`, zPos: 120}
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
    hood: 'spritesheets/hat/cloth/hood/adult',
    tophat: 'spritesheets/hat/formal/tophat/adult',
    norman_helmet: 'spritesheets/hat/helmet/norman/adult',
    flattop_helmet: 'spritesheets/hat/helmet/flattop/male'
  };
  const colorPaths: Partial<Record<LpcHatId, string>> = {
    bandana: 'spritesheets/hat/cloth/bandana/adult',
    bowler: 'spritesheets/hat/formal/bowler/adult',
    crown: 'spritesheets/hat/formal/crown/adult',
    tiara: 'spritesheets/hat/formal/tiara/adult',
    winter_hat: 'spritesheets/hat/holiday/christmas/adult',
    santa: 'spritesheets/hat/holiday/santa/adult',
    elf: 'spritesheets/hat/holiday/elf/adult',
    wizard: 'spritesheets/hat/magic/wizard/base/adult',
    pirate_bandana: 'spritesheets/hat/pirate/bandana/adult',
    cavalier: 'spritesheets/hat/pirate/cavalier/adult',
    tricorne: 'spritesheets/hat/pirate/tricorne/basic/adult'
  };
  const fixedPath = fixedPaths[recipe.hat];
  if (fixedPath) return [{id: 'hat', label: 'Hat', path: fixedPath, zPos: 130}];
  const colorPath = colorPaths[recipe.hat];
  if (colorPath) return [{id: 'hat', label: 'Hat', path: colorPath, zPos: 130, variant: recipe.hatColor}];
  return [];
}

function lpcBodyShape(recipe: LpcCharacterRecipe): 'male' | 'thin' {
  return recipe.body === 'female' ? 'thin' : 'male';
}

function topPath(top: LpcTopId, shape: 'male' | 'thin'): string {
  const torsoShape = shape === 'thin' ? 'female' : 'male';
  if (top === 'polo') return `spritesheets/torso/clothes/shortsleeve/shortsleeve_polo/${torsoShape}`;
  if (top === 'buttoned') return `spritesheets/torso/clothes/shortsleeve/tshirt_buttoned/${torsoShape}`;
  if (top === 'cardigan') return `spritesheets/torso/clothes/longsleeve/longsleeve2_cardigan/${torsoShape}`;
  if (top === 'overalls') return `spritesheets/torso/aprons/overalls/${torsoShape}`;
  if (top === 'suspenders') return `spritesheets/torso/aprons/suspenders/${torsoShape}`;
  if (top === 'leather_armor') return `spritesheets/torso/armour/leather/${torsoShape}`;
  if (top === 'chainmail') return `spritesheets/torso/chainmail/${torsoShape}`;
  if (shape === 'thin') {
    return top === 'tshirt'
      ? 'spritesheets/torso/clothes/shortsleeve/tshirt/female'
      : top === 'longsleeve'
        ? 'spritesheets/torso/clothes/longsleeve/longsleeve/female'
        : top === 'formal'
          ? 'spritesheets/torso/clothes/blouse/female'
          : 'spritesheets/torso/clothes/sleeveless/sleeveless/female';
  }
  return top === 'tshirt'
    ? 'spritesheets/torso/clothes/vest/male'
    : top === 'longsleeve'
      ? 'spritesheets/torso/clothes/longsleeve/laced/male'
      : top === 'formal'
        ? 'spritesheets/torso/clothes/vest_open/male'
        : 'spritesheets/torso/clothes/sleeveless/sleeveless/male';
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
