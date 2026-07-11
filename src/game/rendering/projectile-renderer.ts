import Phaser from 'phaser';
import type {NetworkBullet} from '../types.ts';
import {interpolatePosition} from './interpolation-policy.ts';
import {projectileStyle} from './projectile-render-policy.ts';

interface RenderProjectile {
  circle: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
}

interface ProjectileRendererOptions {
  onCreated?: (bullet: NetworkBullet) => void;
}

export class ProjectileRenderer {
  private readonly rendered = new Map<string, RenderProjectile>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: ProjectileRendererOptions = {}
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(bullets?: Map<string, NetworkBullet>): void {
    const present = new Set<string>();
    bullets?.forEach((bullet, bulletId) => {
      present.add(bulletId);
      this.synchronizeOne(bulletId, bullet);
    });
    for (const [bulletId, rendered] of this.rendered) {
      if (present.has(bulletId)) continue;
      rendered.circle.destroy();
      this.rendered.delete(bulletId);
    }
  }

  interpolate(): void {
    for (const rendered of this.rendered.values()) {
      const position = interpolatePosition(
        rendered.circle.x,
        rendered.circle.y,
        rendered.targetX,
        rendered.targetY,
        0.62
      );
      rendered.circle.setPosition(position.x, position.y);
    }
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.circle.destroy();
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private synchronizeOne(bulletId: string, bullet: NetworkBullet): void {
    let rendered = this.rendered.get(bulletId);
    if (!rendered) {
      const style = projectileStyle(bullet);
      const circle = this.scene.add.circle(bullet.x, bullet.y, style.radius, style.color, 1)
        .setStrokeStyle(1, 0xffffff, 0.8)
        .setDepth(900_000);
      rendered = {circle, targetX: bullet.x, targetY: bullet.y};
      this.rendered.set(bulletId, rendered);
      this.options.onCreated?.(bullet);
      const flash = this.scene.add.circle(bullet.x, bullet.y, 9, style.color, 0.68)
        .setDepth(899_999);
      this.scene.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 1.8,
        duration: 90,
        onComplete: () => flash.destroy()
      });
    }
    rendered.targetX = bullet.x;
    rendered.targetY = bullet.y;
  }
}
