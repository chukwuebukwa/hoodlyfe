import Phaser from 'phaser';
import type {NetworkThrownProjectile} from '../types.ts';
import {interpolatePosition} from './interpolation-policy.ts';
import {thrownProjectilePresentation} from './thrown-projectile-render-policy.ts';

interface RenderedThrownProjectile {
  container: Phaser.GameObjects.Container;
  grenade: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  state: NetworkThrownProjectile;
  targetX: number;
  targetY: number;
}

export class ThrownProjectileRenderer {
  private readonly rendered = new Map<string, RenderedThrownProjectile>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(projectiles?: Map<string, NetworkThrownProjectile>): void {
    const present = new Set<string>();
    projectiles?.forEach((projectile, projectileId) => {
      present.add(projectileId);
      let rendered = this.rendered.get(projectileId);
      if (!rendered) {
        const shadow = this.scene.add.ellipse(0, 2, 16, 8, 0x050708, 0.45);
        const grenade = this.scene.add.image(0, -projectile.height, 'weapon-grenade');
        const container = this.scene.add.container(projectile.x, projectile.y, [shadow, grenade])
          .setDepth(900_020);
        rendered = {
          container,
          grenade,
          shadow,
          state: projectile,
          targetX: projectile.x,
          targetY: projectile.y
        };
        this.rendered.set(projectileId, rendered);
      }
      rendered.state = projectile;
      rendered.targetX = projectile.x;
      rendered.targetY = projectile.y;
      rendered.grenade.setRotation(projectile.angle);
    });
    for (const [projectileId, rendered] of this.rendered) {
      if (present.has(projectileId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(projectileId);
    }
  }

  interpolate(): void {
    const nowMs = this.scene.time.now;
    for (const rendered of this.rendered.values()) {
      const position = interpolatePosition(
        rendered.container.x,
        rendered.container.y,
        rendered.targetX,
        rendered.targetY,
        0.58
      );
      rendered.container.setPosition(position.x, position.y);
      const presentation = thrownProjectilePresentation(rendered.state, nowMs);
      rendered.grenade.setY(presentation.modelY).setScale(presentation.modelScale);
      rendered.shadow.setScale(presentation.shadowScale).setAlpha(presentation.shadowAlpha);
    }
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.container.destroy(true);
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }
}
