import {
  COLOR_VALUES,
  SKIN_COLORS,
  appearanceTextureKey,
  type BodyTypeId,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';

const FRAME_SIZE = 72;

export interface AppearanceSpritePresentation {
  textureKey: string;
  animationKey: string;
  bodyScaleX: number;
}

export function appearanceSpritePresentation(
  appearance: PlayerAppearance
): AppearanceSpritePresentation {
  const identity = appearanceTextureKey(appearance);
  return {
    textureKey: `driver-look:${identity}`,
    animationKey: `driver-walk:${identity}`,
    bodyScaleX: bodyScaleX(appearance.bodyType)
  };
}

export function renderAppearanceSheet(
  source: CanvasImageSource,
  target: HTMLCanvasElement,
  appearance: PlayerAppearance
): void {
  target.width = 216;
  target.height = 216;
  const context = target.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('Character appearance canvas is unavailable.');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0, target.width, target.height);
  const pixels = context.getImageData(0, 0, target.width, target.height);
  for (let y = 0; y < target.height; y++) {
    for (let x = 0; x < target.width; x++) {
      const offset = (y * target.width + x) * 4;
      const alpha = pixels.data[offset + 3];
      if (alpha < 8) continue;
      const red = pixels.data[offset];
      const green = pixels.data[offset + 1];
      const blue = pixels.data[offset + 2];
      const replacement = appearancePixelColor(
        red,
        green,
        blue,
        x % FRAME_SIZE,
        y % FRAME_SIZE,
        appearance
      );
      if (replacement === undefined) continue;
      pixels.data[offset] = replacement >> 16;
      pixels.data[offset + 1] = (replacement >> 8) & 0xff;
      pixels.data[offset + 2] = replacement & 0xff;
    }
  }
  context.putImageData(pixels, 0, 0);
  drawStyleDetails(context, appearance);
}

export function appearancePixelColor(
  red: number,
  green: number,
  blue: number,
  localX: number,
  localY: number,
  appearance: PlayerAppearance
): number | undefined {
  const lightness = Math.max(red, green, blue) / 255;
  if (lightness < 0.11) return undefined;
  const warmPixel = red > green * 1.04 && green > blue * 1.08;
  const headZone = localY >= 14 && localY <= 25;
  const armZone = localY >= 24 && localY <= 38 && (localX <= 29 || localX >= 43);
  if (warmPixel && (headZone || armZone)) {
    return shade(SKIN_COLORS[appearance.skinTone], lightness, 0.48);
  }
  if (headZone) return shade(COLOR_VALUES[appearance.hairColor], lightness, 0.42);
  if (localY <= 35) return shade(COLOR_VALUES[appearance.topColor], lightness, 0.42);
  if (localY <= 42) return shade(COLOR_VALUES[appearance.bottomColor], lightness, 0.38);
  return shade(COLOR_VALUES[appearance.shoeColor], lightness, 0.38);
}

function drawStyleDetails(
  context: CanvasRenderingContext2D,
  appearance: PlayerAppearance
): void {
  const accent = cssColor(COLOR_VALUES[appearance.accentColor]);
  const hair = cssColor(COLOR_VALUES[appearance.hairColor]);
  const top = cssColor(COLOR_VALUES[appearance.topColor]);
  const bottom = cssColor(COLOR_VALUES[appearance.bottomColor]);
  const shoes = cssColor(COLOR_VALUES[appearance.shoeColor]);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const originX = column * FRAME_SIZE;
      const originY = row * FRAME_SIZE;
      context.save();
      context.imageSmoothingEnabled = false;
      context.globalCompositeOperation = 'source-atop';
      if (appearance.topStyle === 'jacket') {
        context.fillStyle = accent;
        context.fillRect(originX + 35, originY + 27, 2, 9);
      } else if (appearance.topStyle === 'hoodie') {
        context.fillStyle = top;
        context.fillRect(originX + 30, originY + 24, 12, 3);
        context.fillStyle = accent;
        context.fillRect(originX + 34, originY + 29, 1, 5);
        context.fillRect(originX + 38, originY + 29, 1, 5);
      }
      if (appearance.bottomStyle === 'cargos') {
        context.fillStyle = accent;
        context.fillRect(originX + 28, originY + 37, 3, 2);
        context.fillRect(originX + 41, originY + 37, 3, 2);
      } else if (appearance.bottomStyle === 'track') {
        context.fillStyle = accent;
        context.fillRect(originX + 31, originY + 36, 1, 7);
        context.fillRect(originX + 40, originY + 36, 1, 7);
      } else {
        context.fillStyle = bottom;
        context.fillRect(originX + 35, originY + 38, 2, 4);
      }
      if (appearance.shoeStyle === 'boots') {
        context.fillStyle = shoes;
        context.fillRect(originX + 28, originY + 42, 5, 3);
        context.fillRect(originX + 39, originY + 42, 5, 3);
      }
      context.restore();

      context.save();
      context.imageSmoothingEnabled = false;
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = hair;
      if (appearance.hairStyle === 'fade') {
        context.fillRect(originX + 31, originY + 17, 10, 3);
      } else if (appearance.hairStyle === 'curls') {
        context.fillRect(originX + 30, originY + 17, 4, 4);
        context.fillRect(originX + 34, originY + 15, 4, 5);
        context.fillRect(originX + 38, originY + 17, 4, 4);
      }
      if (appearance.headwear === 'cap') {
        context.fillStyle = top;
        context.fillRect(originX + 29, originY + 16, 14, 5);
        context.fillStyle = accent;
        context.fillRect(originX + 35, originY + 13, 8, 4);
      } else if (appearance.headwear === 'beanie') {
        context.fillStyle = top;
        context.fillRect(originX + 29, originY + 14, 14, 7);
        context.fillStyle = accent;
        context.fillRect(originX + 29, originY + 20, 14, 2);
      }
      context.restore();
    }
  }
}

function bodyScaleX(bodyType: BodyTypeId): number {
  if (bodyType === 'slim') return 0.92;
  if (bodyType === 'broad') return 1.08;
  return 1;
}

function shade(color: number, sourceLightness: number, minimum: number): number {
  const factor = minimum + Math.max(0, Math.min(1, sourceLightness)) * (1 - minimum);
  const red = Math.round(((color >> 16) & 0xff) * factor);
  const green = Math.round(((color >> 8) & 0xff) * factor);
  const blue = Math.round((color & 0xff) * factor);
  return (red << 16) | (green << 8) | blue;
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
