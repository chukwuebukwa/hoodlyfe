import Phaser from 'phaser';
import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import type {NetworkWeaponPickup} from '../types.ts';
import {weaponPickupMinimapPoints} from './weapon-pickup-render-policy.ts';

export class WeaponPickupRenderer {
  private readonly rendered = new Map<string, {
    container: Phaser.GameObjects.Container;
    ring: Phaser.GameObjects.Arc;
  }>();
  private pickups?: Map<string, NetworkWeaponPickup>;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(pickups?: Map<string, NetworkWeaponPickup>): void {
    this.pickups = pickups;
    const present = new Set<string>();
    pickups?.forEach((pickup, pickupId) => {
      if (!pickup.available) return;
      present.add(pickupId);
      let rendered = this.rendered.get(pickupId);
      if (!rendered) {
        const ring = this.scene.add.circle(0, 0, 20, 0xffd75a, 0.1)
          .setStrokeStyle(2, 0xffd75a, 0.9);
        const icon = this.scene.add.image(0, -4, 'weapon-grenade').setScale(0.58);
        const label = this.scene.add.text(0, 23, `GRENADES x${pickup.quantity}`, {
          color: '#fff2a8',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          stroke: '#050708',
          strokeThickness: 3
        }).setOrigin(0.5);
        const container = this.scene.add.container(pickup.x, pickup.y, [ring, icon, label])
          .setDepth(899_980);
        rendered = {container, ring};
        this.rendered.set(pickupId, rendered);
      }
      rendered.container.setPosition(pickup.x, pickup.y);
    });
    for (const [pickupId, rendered] of this.rendered) {
      if (present.has(pickupId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(pickupId);
    }
  }

  interpolate(): void {
    const pulse = 1 + Math.sin(this.scene.time.now / 180) * 0.08;
    for (const rendered of this.rendered.values()) rendered.ring.setScale(pulse);
  }

  minimapPoints(): MinimapPointInput[] {
    return weaponPickupMinimapPoints(this.pickups?.values());
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.container.destroy(true);
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }
}
