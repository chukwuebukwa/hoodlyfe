import Phaser from 'phaser';
import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import type {NetworkCashPickup} from '../types.ts';
import {cashPickupLabel, cashPickupMinimapPoints} from './cash-pickup-render-policy.ts';

export class CashPickupRenderer {
  private readonly rendered = new Map<string, {
    container: Phaser.GameObjects.Container;
    ring: Phaser.GameObjects.Arc;
    label: Phaser.GameObjects.Text;
  }>();
  private pickups?: Map<string, NetworkCashPickup>;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(pickups?: Map<string, NetworkCashPickup>): void {
    this.pickups = pickups;
    const present = new Set<string>();
    pickups?.forEach((pickup, pickupId) => {
      if (pickup.amount <= 0) return;
      present.add(pickupId);
      let rendered = this.rendered.get(pickupId);
      if (!rendered) {
        const ring = this.scene.add.circle(0, 0, 17, 0x55e58b, 0.12)
          .setStrokeStyle(2, 0x55e58b, 0.95);
        const glyph = this.scene.add.text(0, -1, '$', {
          color: '#55e58b',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '20px',
          fontStyle: 'bold',
          stroke: '#050708',
          strokeThickness: 4
        }).setOrigin(0.5);
        const label = this.scene.add.text(0, 23, cashPickupLabel(pickup.amount), {
          color: '#a8ffc5',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          stroke: '#050708',
          strokeThickness: 3
        }).setOrigin(0.5);
        const container = this.scene.add.container(pickup.x, pickup.y, [ring, glyph, label])
          .setDepth(899_981);
        rendered = {container, ring, label};
        this.rendered.set(pickupId, rendered);
      }
      rendered.container.setPosition(pickup.x, pickup.y);
      rendered.label.setText(cashPickupLabel(pickup.amount));
    });
    for (const [pickupId, rendered] of this.rendered) {
      if (present.has(pickupId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(pickupId);
    }
  }

  interpolate(): void {
    const pulse = 1 + Math.sin(this.scene.time.now / 190) * 0.08;
    for (const rendered of this.rendered.values()) rendered.ring.setScale(pulse);
  }

  minimapPoints(): MinimapPointInput[] {
    return cashPickupMinimapPoints(this.pickups?.values());
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.container.destroy(true);
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }
}
