import Phaser from 'phaser';
import type {NetworkFireZone} from '../types.ts';

interface RenderedFireZone {
  container: Phaser.GameObjects.Container;
  flames: Phaser.GameObjects.Ellipse[];
  state: NetworkFireZone;
}

export class FireZoneRenderer {
  private readonly rendered = new Map<string, RenderedFireZone>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(fires?: Map<string, NetworkFireZone>): void {
    const present = new Set<string>();
    fires?.forEach((fire, fireId) => {
      present.add(fireId);
      let rendered = this.rendered.get(fireId);
      if (!rendered) {
        rendered = this.create(fire);
        this.rendered.set(fireId, rendered);
      }
      rendered.state = fire;
      rendered.container.setPosition(fire.x, fire.y);
    });
    for (const [fireId, rendered] of this.rendered) {
      if (present.has(fireId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(fireId);
    }
  }

  update(nowMs: number): void {
    for (const [fireId, rendered] of this.rendered) {
      const remaining = Math.max(0, rendered.state.expiresAt - nowMs);
      const lifeAlpha = Math.min(1, remaining / 550);
      rendered.flames.forEach((flame, index) => {
        const phase = nowMs / (105 + index * 13) + index * 1.7 + fireId.length;
        flame.setScale(0.82 + Math.sin(phase) * 0.18, 0.9 + Math.cos(phase * 0.8) * 0.16)
          .setAlpha((0.62 + Math.sin(phase * 1.3) * 0.18) * lifeAlpha);
      });
    }
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.container.destroy(true);
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private create(fire: NetworkFireZone): RenderedFireZone {
    const glow = this.scene.add.ellipse(0, 0, fire.radius * 1.7, fire.radius * 1.15, 0xf05a24, 0.2)
      .setBlendMode(Phaser.BlendModes.ADD);
    const flames = [
      this.flame(-20, 8, 22, 38, 0xff722e),
      this.flame(1, -4, 26, 46, 0xffb52f),
      this.flame(22, 9, 20, 34, 0xff5a28),
      this.flame(-7, 15, 15, 27, 0xffe47a)
    ];
    const container = this.scene.add.container(fire.x, fire.y, [glow, ...flames]).setDepth(900_016);
    return {container, flames, state: fire};
  }

  private flame(x: number, y: number, width: number, height: number, color: number): Phaser.GameObjects.Ellipse {
    return this.scene.add.ellipse(x, y, width, height, color, 0.82)
      .setOrigin(0.5, 0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
  }
}
