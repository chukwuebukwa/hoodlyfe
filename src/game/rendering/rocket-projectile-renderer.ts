import Phaser from 'phaser';
import type {NetworkRocketProjectile} from '../types.ts';
import {interpolatePosition} from './interpolation-policy.ts';

interface RenderedRocket {
  container: Phaser.GameObjects.Container;
  targetX: number;
  targetY: number;
  lastTrailX: number;
  lastTrailY: number;
}

export class RocketProjectileRenderer {
  private readonly rendered = new Map<string, RenderedRocket>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(rockets?: Map<string, NetworkRocketProjectile>): void {
    const present = new Set<string>();
    rockets?.forEach((rocket, id) => {
      present.add(id);
      let rendered = this.rendered.get(id);
      if (!rendered) {
        const exhaust = this.scene.add.circle(-12, 0, 5, 0xff9a32, 0.85);
        const model = this.scene.add.image(0, 0, 'weapon-rocket').setDisplaySize(34, 10);
        const container = this.scene.add.container(rocket.x, rocket.y, [exhaust, model])
          .setRotation(rocket.angle)
          .setDepth(900_002);
        rendered = {
          container,
          targetX: rocket.x,
          targetY: rocket.y,
          lastTrailX: rocket.x,
          lastTrailY: rocket.y
        };
        this.rendered.set(id, rendered);
      }
      rendered.targetX = rocket.x;
      rendered.targetY = rocket.y;
      rendered.container.setRotation(rocket.angle);
      if (Math.hypot(rocket.x - rendered.lastTrailX, rocket.y - rendered.lastTrailY) >= 10) {
        this.emitTrail(rendered.lastTrailX, rendered.lastTrailY);
        rendered.lastTrailX = rocket.x;
        rendered.lastTrailY = rocket.y;
      }
    });
    for (const [id, rendered] of this.rendered) {
      if (present.has(id)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(id);
    }
  }

  interpolate(): void {
    for (const rendered of this.rendered.values()) {
      const position = interpolatePosition(
        rendered.container.x,
        rendered.container.y,
        rendered.targetX,
        rendered.targetY,
        0.72
      );
      rendered.container.setPosition(position.x, position.y);
    }
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.container.destroy(true);
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private emitTrail(x: number, y: number): void {
    const smoke = this.scene.add.circle(x, y, 4, 0x5c6468, 0.58).setDepth(899_998);
    this.scene.tweens.add({
      targets: smoke,
      alpha: 0,
      scale: 2.4,
      duration: 420,
      onComplete: () => smoke.destroy()
    });
  }
}
