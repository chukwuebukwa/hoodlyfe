import {
  COLOR_VALUES,
  SKIN_COLORS,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';
import {
  CHARACTER_ASSET_VERSION,
  CHARACTER_ATLASES,
  type CharacterAtlasId
} from '../../../shared/content/character-animation-manifest.ts';
import {appearanceTextureKey} from '../../../shared/content/appearance-catalog.ts';

export type CharacterMaterialRole = 'skin' | 'hair' | 'primary' | 'secondary' | 'shoes';

export interface CharacterCompilerSources {
  walk: CanvasImageSource;
  actions: CanvasImageSource;
  walkMask: CanvasImageSource;
  actionsMask: CanvasImageSource;
  layers?: Partial<Record<CharacterAtlasId, readonly CharacterCompilerLayer[]>>;
}

export interface CharacterCompilerLayer {
  source: CanvasImageSource;
  materialMask?: CanvasImageSource;
  opacity?: number;
}

export interface CompiledCharacterSpriteSet {
  readonly key: string;
  readonly walk: HTMLCanvasElement;
  readonly actions: HTMLCanvasElement;
}

export function compiledCharacterKey(appearance: PlayerAppearance): string {
  return `character:v${CHARACTER_ASSET_VERSION}:${appearanceTextureKey(appearance)}`;
}

export function compileCharacterSpriteSet(
  sources: CharacterCompilerSources,
  appearance: PlayerAppearance,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')
): CompiledCharacterSpriteSet {
  const walk = renderMaterialAtlas(
    sources.walk,
    sources.walkMask,
    'walk',
    appearance,
    createCanvas
  );
  compositeAuthoredLayers(walk, sources.layers?.walk ?? [], 'walk', appearance, createCanvas);
  const actions = renderMaterialAtlas(
    sources.actions,
    sources.actionsMask,
    'actions',
    appearance,
    createCanvas
  );
  compositeAuthoredLayers(
    actions,
    sources.layers?.actions ?? [],
    'actions',
    appearance,
    createCanvas
  );
  return {key: compiledCharacterKey(appearance), walk, actions};
}

function compositeAuthoredLayers(
  target: HTMLCanvasElement,
  layers: readonly CharacterCompilerLayer[],
  atlasId: CharacterAtlasId,
  appearance: PlayerAppearance,
  createCanvas: () => HTMLCanvasElement
): void {
  const context = target.getContext('2d');
  if (!context) throw new Error('Character layer-compositor canvas is unavailable.');
  for (const layer of layers) {
    const rendered = layer.materialMask
      ? renderMaterialAtlas(layer.source, layer.materialMask, atlasId, appearance, createCanvas)
      : layer.source;
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, layer.opacity ?? 1));
    context.imageSmoothingEnabled = false;
    context.drawImage(rendered, 0, 0, target.width, target.height);
    context.restore();
  }
}

export function characterMaterialRole(red: number, green: number, blue: number): CharacterMaterialRole | undefined {
  if (red >= 240 && green <= 16 && blue <= 16) return 'skin';
  if (red >= 112 && red <= 144 && green >= 48 && green <= 80 && blue <= 16) return 'hair';
  if (red <= 16 && green >= 240 && blue <= 16) return 'primary';
  if (red <= 16 && green >= 80 && green <= 112 && blue >= 240) return 'secondary';
  if (red >= 240 && green <= 16 && blue >= 240) return 'shoes';
  return undefined;
}

export function materialColor(
  role: CharacterMaterialRole,
  appearance: PlayerAppearance,
  sourceLightness: number
): number {
  const color = role === 'skin'
    ? SKIN_COLORS[appearance.skinTone]
    : role === 'hair'
      ? COLOR_VALUES[appearance.hairColor]
      : role === 'primary'
        ? COLOR_VALUES[appearance.topColor]
        : role === 'secondary'
          ? COLOR_VALUES[appearance.bottomColor]
          : COLOR_VALUES[appearance.shoeColor];
  const minimum = role === 'skin' ? 0.48 : role === 'hair' ? 0.42 : 0.38;
  return shade(color, sourceLightness, minimum);
}

function renderMaterialAtlas(
  source: CanvasImageSource,
  mask: CanvasImageSource,
  atlasId: CharacterAtlasId,
  appearance: PlayerAppearance,
  createCanvas: () => HTMLCanvasElement
): HTMLCanvasElement {
  const definition = CHARACTER_ATLASES[atlasId];
  const width = definition.columns * definition.frameSize;
  const height = definition.rows * definition.frameSize;
  const target = createCanvas();
  target.width = width;
  target.height = height;
  const context = target.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('Character compiler canvas is unavailable.');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  const maskCanvas = createCanvas();
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext('2d', {willReadFrequently: true});
  if (!maskContext) throw new Error('Character material-mask canvas is unavailable.');
  maskContext.imageSmoothingEnabled = false;
  maskContext.drawImage(mask, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height);
  const materials = maskContext.getImageData(0, 0, width, height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    if (pixels.data[offset + 3] < 8 || materials.data[offset + 3] < 8) continue;
    const role = characterMaterialRole(
      materials.data[offset],
      materials.data[offset + 1],
      materials.data[offset + 2]
    );
    if (!role) continue;
    const sourceLightness = Math.max(
      pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]
    ) / 255;
    const replacement = materialColor(role, appearance, sourceLightness);
    pixels.data[offset] = replacement >> 16;
    pixels.data[offset + 1] = (replacement >> 8) & 0xff;
    pixels.data[offset + 2] = replacement & 0xff;
  }
  context.putImageData(pixels, 0, 0);
  return target;
}

function shade(color: number, sourceLightness: number, minimum: number): number {
  const factor = minimum + Math.max(0, Math.min(1, sourceLightness)) * (1 - minimum);
  const red = Math.round(((color >> 16) & 0xff) * factor);
  const green = Math.round(((color >> 8) & 0xff) * factor);
  const blue = Math.round((color & 0xff) * factor);
  return (red << 16) | (green << 8) | blue;
}
