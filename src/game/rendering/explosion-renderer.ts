import Phaser from 'phaser';
import type {NetworkExplosion} from '../types.ts';
import {explosionPresentation} from './explosion-render-policy.ts';

export class ExplosionRenderer {
  private readonly rendered = new Map<string, Phaser.GameObjects.Container>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(explosions?: Map<string, NetworkExplosion>): void {
    const present = new Set<string>();
    explosions?.forEach((explosion, explosionId) => {
      present.add(explosionId);
      if (!this.rendered.has(explosionId)) this.create(explosionId, explosion);
    });
    for (const [explosionId, container] of this.rendered) {
      if (present.has(explosionId)) continue;
      this.scene.tweens.killTweensOf(container.list);
      container.destroy(true);
      this.rendered.delete(explosionId);
    }
  }

  destroy(): void {
    for (const container of this.rendered.values()) {
      this.scene.tweens.killTweensOf(container.list);
      container.destroy(true);
    }
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private create(explosionId: string, explosion: NetworkExplosion): void {
    const style = explosionPresentation(explosion);
    const visualRadius = Math.max(28, explosion.radius * 0.52);
    const glow = this.scene.add.circle(0, 0, visualRadius * 0.38, style.edgeColor, 0.8);
    const core = this.scene.add.circle(0, 0, visualRadius * 0.18, style.coreColor, 1);
    const ring = this.scene.add.circle(0, 0, visualRadius * 0.2, style.edgeColor, 0.18)
      .setStrokeStyle(5, style.coreColor, 0.92);
    const children: Phaser.GameObjects.GameObject[] = [glow, core, ring];
    for (let index = 0; index < 10; index++) {
      const angle = index / 10 * Math.PI * 2;
      const particle = this.scene.add.circle(0, 0, 2 + index % 3, style.particleColor, 0.9);
      children.push(particle);
      this.scene.tweens.add({
        targets: particle,
        x: Math.cos(angle) * visualRadius * (0.58 + (index % 2) * 0.22),
        y: Math.sin(angle) * visualRadius * (0.58 + (index % 3) * 0.12),
        alpha: 0,
        scale: 1.8,
        duration: style.durationMs,
        ease: 'Cubic.Out'
      });
    }
    const container = this.scene.add.container(explosion.x, explosion.y, children)
      .setDepth(900_100);
    this.rendered.set(explosionId, container);
    this.scene.tweens.add({
      targets: core,
      scale: 2.5,
      alpha: 0,
      duration: style.durationMs * 0.45,
      ease: 'Quad.Out'
    });
    this.scene.tweens.add({
      targets: glow,
      scale: 1.45,
      alpha: 0,
      duration: style.durationMs,
      ease: 'Cubic.Out'
    });
    this.scene.tweens.add({
      targets: ring,
      scale: 4.8,
      alpha: 0,
      duration: style.durationMs * 0.8,
      ease: 'Cubic.Out'
    });
    this.scene.cameras.main.shake(style.shakeDurationMs, style.shakeIntensity, true);
  }
}
