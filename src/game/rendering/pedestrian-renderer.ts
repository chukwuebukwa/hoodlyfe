import Phaser from 'phaser';
import type {NetworkNpc} from '../types.ts';
import {interpolatePosition, rotateTowards} from './interpolation-policy.ts';
import {pedestrianMotionPresentation} from './pedestrian-render-policy.ts';

interface RenderNpc {
  sprite: Phaser.GameObjects.Sprite;
  targetX: number;
  targetY: number;
  targetAngle: number;
  targetAction: string;
}

export class PedestrianRenderer {
  private readonly rendered = new Map<string, RenderNpc>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(npcs?: Map<string, NetworkNpc>): void {
    const present = new Set<string>();
    npcs?.forEach((npc, npcId) => {
      present.add(npcId);
      this.synchronizeOne(npcId, npc);
    });
    for (const [npcId, rendered] of this.rendered) {
      if (present.has(npcId)) continue;
      rendered.sprite.destroy();
      this.rendered.delete(npcId);
    }
  }

  interpolate(): void {
    for (const rendered of this.rendered.values()) {
      const position = interpolatePosition(
        rendered.sprite.x,
        rendered.sprite.y,
        rendered.targetX,
        rendered.targetY,
        0.22,
        120
      );
      rendered.sprite.setPosition(position.x, position.y);
      rendered.sprite.rotation = rotateTowards(
        rendered.sprite.rotation,
        rendered.targetAngle - Math.PI / 2,
        0.14
      );
      this.updatePresentation(
        rendered.sprite,
        `${rendered.sprite.texture.key}-walk`,
        position.distance,
        rendered.targetAction
      );
      rendered.sprite.setDepth(Math.round(rendered.sprite.y) + 95);
    }
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.sprite.destroy();
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private synchronizeOne(npcId: string, npc: NetworkNpc): void {
    let rendered = this.rendered.get(npcId);
    if (!rendered) {
      const sprite = this.scene.add.sprite(npc.x, npc.y, npc.kind, 0)
        .setDisplaySize(72, 72)
        .setOrigin(0.5)
        .setDepth(Math.round(npc.y) + 95);
      rendered = {
        sprite,
        targetX: npc.x,
        targetY: npc.y,
        targetAngle: npc.angle,
        targetAction: npc.action ?? 'wander'
      };
      this.rendered.set(npcId, rendered);
    }
    rendered.targetX = npc.x;
    rendered.targetY = npc.y;
    rendered.targetAngle = npc.angle;
    rendered.targetAction = npc.action ?? 'wander';
    rendered.sprite.setVisible(npc.alive);
  }

  private updatePresentation(
    sprite: Phaser.GameObjects.Sprite,
    key: string,
    distance: number,
    action: string
  ): void {
    if (!sprite.visible) return;
    const presentation = pedestrianMotionPresentation(action, distance);
    sprite.setAlpha(presentation.alpha);
    if (presentation.tint === undefined) sprite.clearTint();
    else sprite.setTint(presentation.tint);
    sprite.anims.timeScale = presentation.timeScale;
    if (presentation.animate) sprite.play(key, true);
    else if (sprite.anims.isPlaying) sprite.stop().setFrame(0);
  }
}
