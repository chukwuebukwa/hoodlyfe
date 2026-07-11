import Phaser from 'phaser';
import type {NetworkNpc} from '../types.ts';
import {interpolatePosition, rotateTowards} from './interpolation-policy.ts';
import {pedestrianMotionPresentation} from './pedestrian-render-policy.ts';
import {
  combatReactionPresentation,
  type CombatReactionPresentation
} from './combat-reaction-render-policy.ts';
import type {CombatReactionDirection, CombatReactionKind} from '../types.ts';
import {npcMeleePresentation} from './npc-melee-render-policy.ts';

interface RenderNpc {
  sprite: Phaser.GameObjects.Sprite;
  targetX: number;
  targetY: number;
  targetAngle: number;
  targetAction: string;
  reactionKind: CombatReactionKind;
  reactionDirection: CombatReactionDirection;
  reactionProgress: number;
  attackProgress: number;
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
      const reaction = combatReactionPresentation(rendered);
      const melee = npcMeleePresentation({
        action: rendered.targetAction,
        attackProgress: rendered.attackProgress
      });
      const rotationOffset = reaction.active ? reaction.rotationOffset : melee.rotationOffset;
      const scaleX = reaction.active ? reaction.scaleX : melee.scaleX;
      const scaleY = reaction.active ? reaction.scaleY : melee.scaleY;
      const targetRotation = rendered.targetAngle - Math.PI / 2 + rotationOffset;
      rendered.sprite.rotation = reaction.active || melee.active
        ? targetRotation
        : rotateTowards(rendered.sprite.rotation, targetRotation, 0.14);
      rendered.sprite.setDisplaySize(72 * scaleX, 72 * scaleY);
      this.updatePresentation(
        rendered.sprite,
        `${rendered.sprite.texture.key}-walk`,
        position.distance,
        rendered.targetAction,
        reaction,
        melee.active,
        melee.tint
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
        targetAction: npc.action ?? 'wander',
        reactionKind: npc.reactionKind ?? '',
        reactionDirection: npc.reactionDirection ?? 'front',
        reactionProgress: npc.reactionProgress ?? 0,
        attackProgress: npc.attackProgress ?? 1
      };
      this.rendered.set(npcId, rendered);
    }
    rendered.targetX = npc.x;
    rendered.targetY = npc.y;
    rendered.targetAngle = npc.angle;
    rendered.targetAction = npc.action ?? 'wander';
    rendered.reactionKind = npc.reactionKind ?? '';
    rendered.reactionDirection = npc.reactionDirection ?? 'front';
    rendered.reactionProgress = npc.reactionProgress ?? 0;
    rendered.attackProgress = npc.attackProgress ?? 1;
    rendered.sprite.setVisible(npc.alive);
  }

  private updatePresentation(
    sprite: Phaser.GameObjects.Sprite,
    key: string,
    distance: number,
    action: string,
    reaction: CombatReactionPresentation,
    meleeActive: boolean,
    meleeTint?: number
  ): void {
    if (!sprite.visible) return;
    const presentation = pedestrianMotionPresentation(
      action,
      distance,
      reaction.stopMovement || meleeActive
    );
    sprite.setAlpha(presentation.alpha);
    const tint = reaction.tint ?? meleeTint ?? presentation.tint;
    if (tint === undefined) sprite.clearTint();
    else sprite.setTint(tint);
    sprite.anims.timeScale = presentation.timeScale;
    if (presentation.animate) sprite.play(key, true);
    else if (sprite.anims.isPlaying) sprite.stop().setFrame(0);
  }
}
