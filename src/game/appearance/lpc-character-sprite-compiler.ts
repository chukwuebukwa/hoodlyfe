import {
  LPC_ASSET_ROOT,
  LPC_COLOR_VALUES,
  LPC_DIRECTIONS,
  LPC_FRAME_SIZE,
  LPC_SKIN_COLOR_VALUES,
  NOCK0_FRAME_SIZE,
  lpcAssetCandidates,
  lpcLayerDefinitions,
  lpcRecipeKey,
  type LpcAnimationId,
  type LpcCharacterRecipe,
  type LpcLayerDefinition
} from '../../../shared/content/lpc-character-catalog.ts';

const DOWN_ROW = 2;
const LPC_IMAGE_LOAD_BATCH_SIZE = 32;
const LPC_BASE_SKIN_PALETTE = [
  [250, 236, 231],
  [249, 213, 186],
  [228, 164, 124],
  [204, 134, 101],
  [153, 66, 60]
] as const;

export interface LpcSpriteSources {
  images: ReadonlyMap<string, HTMLImageElement>;
}

export interface CompiledLpcCharacterSpriteSet {
  walk: HTMLCanvasElement;
  actions: HTMLCanvasElement;
  key: string;
}

export async function loadLpcSpriteSources(): Promise<LpcSpriteSources> {
  const response = await fetch(`${LPC_ASSET_ROOT}/manifest.json`);
  if (!response.ok) throw new Error(`Unable to load LPC asset manifest: ${response.status}`);
  const manifest = await response.json() as {assets?: unknown};
  if (!Array.isArray(manifest.assets)) throw new Error('LPC asset manifest is invalid.');
  const urls = manifest.assets.filter((value): value is string => typeof value === 'string');
  const pairs: Array<readonly [string, HTMLImageElement]> = [];
  for (let index = 0; index < urls.length; index += LPC_IMAGE_LOAD_BATCH_SIZE) {
    const batch = urls.slice(index, index + LPC_IMAGE_LOAD_BATCH_SIZE);
    const loaded = await Promise.all(batch.map(loadImagePair));
    pairs.push(...loaded.filter((pair): pair is readonly [string, HTMLImageElement] => Boolean(pair)));
  }
  return {images: new Map(pairs)};
}

async function loadImagePair(url: string): Promise<readonly [string, HTMLImageElement] | undefined> {
  try {
    return [url, await loadImage(url)] as const;
  } catch (error) {
    console.warn(`Skipping LPC asset ${url}`, error);
    return undefined;
  }
}

export function compileLpcCharacterSpriteSet(
  sources: LpcSpriteSources,
  recipe: LpcCharacterRecipe
): CompiledLpcCharacterSpriteSet {
  const walk = document.createElement('canvas');
  walk.width = NOCK0_FRAME_SIZE * 9;
  walk.height = NOCK0_FRAME_SIZE * 4;
  const actions = document.createElement('canvas');
  actions.width = NOCK0_FRAME_SIZE * 4;
  actions.height = NOCK0_FRAME_SIZE * 3;
  const layers = lpcLayerDefinitions(recipe);

  for (let row = 0; row < LPC_DIRECTIONS.length; row++) {
    pasteGridFrame(walk, 0, row, composeFrame(sources, recipe, layers, 'idle', 0, row));
    for (let column = 1; column < 9; column++) {
      pasteGridFrame(walk, column, row, composeFrame(sources, recipe, layers, 'walk', column, row));
    }
  }

  for (let frame = 0; frame < 4; frame++) {
    pasteFrame(actions, frame, composeFrame(sources, recipe, layers, 'slash', frame, DOWN_ROW));
  }
  for (const [targetFrame, sourceColumn] of [[4, 0], [5, 1], [6, 3], [7, 5]] as const) {
    pasteFrame(actions, targetFrame, composeFrame(sources, recipe, layers, 'hurt', sourceColumn, 0));
  }
  for (const [targetFrame, sourceColumn] of [[8, 0], [9, 1], [10, 2], [11, 2]] as const) {
    pasteFrame(actions, targetFrame, composeFrame(sources, recipe, layers, 'sit', sourceColumn, DOWN_ROW));
  }

  return {
    walk,
    actions,
    key: `lpc:${lpcRecipeKey(recipe)}`
  };
}

function composeFrame(
  sources: LpcSpriteSources,
  recipe: LpcCharacterRecipe,
  layers: readonly LpcLayerDefinition[],
  animation: LpcAnimationId,
  column: number,
  row: number
): HTMLCanvasElement {
  const frame = document.createElement('canvas');
  frame.width = LPC_FRAME_SIZE;
  frame.height = LPC_FRAME_SIZE;
  const context = frame.getContext('2d');
  if (!context) throw new Error('LPC frame canvas is unavailable.');
  context.imageSmoothingEnabled = false;
  for (const layer of layers) {
    const image = resolveLayerImage(sources, layer, animation);
    if (!image) continue;
    const sourceRow = image.height >= LPC_FRAME_SIZE * 4 ? row : 0;
    if (layer.id.startsWith('hair')) {
      context.drawImage(tintedFrame(image, LPC_COLOR_VALUES[recipe.hairColor], column, sourceRow, 'all'), 0, 0);
      continue;
    }
    if (layer.id === 'body' || layer.id === 'head' || layer.id === 'face') {
      context.drawImage(tintedFrame(image, LPC_SKIN_COLOR_VALUES[recipe.skinColor], column, sourceRow, 'skin'), 0, 0);
      continue;
    }
    context.drawImage(
      image,
      column * LPC_FRAME_SIZE,
      sourceRow * LPC_FRAME_SIZE,
      LPC_FRAME_SIZE,
      LPC_FRAME_SIZE,
      0,
      0,
      LPC_FRAME_SIZE,
      LPC_FRAME_SIZE
    );
  }
  return frame;
}

function resolveLayerImage(
  sources: LpcSpriteSources,
  layer: LpcLayerDefinition,
  animation: LpcAnimationId
): HTMLImageElement | undefined {
  return lpcAssetCandidates(layer, animation)
    .map((url) => sources.images.get(url))
    .find(Boolean);
}

function tintedFrame(
  image: HTMLImageElement,
  color: string,
  column: number,
  row: number,
  mode: 'all' | 'skin'
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = LPC_FRAME_SIZE;
  canvas.height = LPC_FRAME_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('LPC tint canvas is unavailable.');
  context.imageSmoothingEnabled = false;
  context.drawImage(
    image,
    column * LPC_FRAME_SIZE,
    row * LPC_FRAME_SIZE,
    LPC_FRAME_SIZE,
    LPC_FRAME_SIZE,
    0,
    0,
    LPC_FRAME_SIZE,
    LPC_FRAME_SIZE
  );
  const target = hexToRgb(color);
  const pixels = context.getImageData(0, 0, LPC_FRAME_SIZE, LPC_FRAME_SIZE);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3] === 0) continue;
    if (mode === 'skin' && !isLpcBaseSkinPixel(
      pixels.data[index],
      pixels.data[index + 1],
      pixels.data[index + 2]
    )) {
      continue;
    }
    const luminance = (pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114) / 255;
    const shade = 0.45 + luminance * 0.95;
    pixels.data[index] = Math.min(255, Math.round(target.r * shade));
    pixels.data[index + 1] = Math.min(255, Math.round(target.g * shade));
    pixels.data[index + 2] = Math.min(255, Math.round(target.b * shade));
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function isLpcBaseSkinPixel(red: number, green: number, blue: number): boolean {
  return LPC_BASE_SKIN_PALETTE.some(([skinRed, skinGreen, skinBlue]) =>
    Math.abs(red - skinRed) <= 4 &&
    Math.abs(green - skinGreen) <= 4 &&
    Math.abs(blue - skinBlue) <= 4
  );
}

function hexToRgb(hex: string): {r: number; g: number; b: number} {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function pasteFrame(atlas: HTMLCanvasElement, index: number, frame: HTMLCanvasElement): void {
  const columns = atlas.width / NOCK0_FRAME_SIZE;
  pasteGridFrame(atlas, index % columns, Math.floor(index / columns), frame);
}

function pasteGridFrame(
  atlas: HTMLCanvasElement,
  column: number,
  row: number,
  frame: HTMLCanvasElement
): void {
  const context = atlas.getContext('2d');
  if (!context) throw new Error('LPC atlas canvas is unavailable.');
  context.imageSmoothingEnabled = false;
  context.drawImage(frame, column * NOCK0_FRAME_SIZE + 4, row * NOCK0_FRAME_SIZE + 4);
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), {once: true});
    image.addEventListener('error', () => reject(new Error(`Unable to load ${source}`)), {once: true});
    image.src = source;
  });
}
