import Phaser from 'phaser';
import type {PlayerAppearance} from '../../../shared/content/appearance-catalog.ts';
import {
  appearanceSpritePresentation,
  renderAppearanceSheet,
  type AppearanceSpritePresentation
} from './appearance-render-policy.ts';

export class PlayerAppearanceTextureFactory {
  private readonly created: AppearanceSpritePresentation[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  ensure(appearance: PlayerAppearance): AppearanceSpritePresentation {
    const presentation = appearanceSpritePresentation(appearance);
    if (!this.scene.textures.exists(presentation.textureKey)) {
      const source = this.scene.textures.get('driver').getSourceImage() as CanvasImageSource;
      const texture = this.scene.textures.createCanvas(presentation.textureKey, 216, 216);
      if (!texture) throw new Error('Character appearance texture could not be created.');
      renderAppearanceSheet(source, texture.getCanvas(), appearance);
      for (let frame = 0; frame < 9; frame++) {
        texture.add(frame, 0, (frame % 3) * 72, Math.floor(frame / 3) * 72, 72, 72);
      }
      texture.refresh();
      this.created.push(presentation);
    }
    if (!this.scene.anims.exists(presentation.animationKey)) {
      this.scene.anims.create({
        key: presentation.animationKey,
        frames: this.scene.anims.generateFrameNumbers(presentation.textureKey, {start: 1, end: 8}),
        frameRate: 9,
        repeat: -1
      });
    }
    return presentation;
  }

  prune(activeTextureKeys: ReadonlySet<string>, capacity = 96): void {
    if (this.created.length <= capacity) return;
    for (let index = 0; index < this.created.length && this.created.length > capacity;) {
      const presentation = this.created[index];
      if (activeTextureKeys.has(presentation.textureKey)) {
        index += 1;
        continue;
      }
      this.scene.anims.remove(presentation.animationKey);
      this.scene.textures.remove(presentation.textureKey);
      this.created.splice(index, 1);
    }
  }
}
