import Phaser from 'phaser';
import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import type {DistrictNetworkState, NetworkStreetService} from '../types.ts';
import {
  projectInteractionAffordance,
  serviceMinimapPoints
} from './interaction-presentation-policy.ts';

export class InteractionPresentationController {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly button: HTMLButtonElement | null;
  private readonly touchButton: HTMLButtonElement | null;
  private state?: DistrictNetworkState;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly localPlayerId: string,
    root: Document = document
  ) {
    this.graphics = scene.add.graphics().setDepth(865_000);
    this.button = root.querySelector<HTMLButtonElement>('#vehicle-action-button');
    this.touchButton = root.querySelector<HTMLButtonElement>('#interact-button');
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(state: DistrictNetworkState): void {
    this.state = state;
    const affordance = projectInteractionAffordance(state, this.localPlayerId);
    this.button?.classList.toggle('hidden', !affordance.visible);
    if (this.button && affordance.visible) {
      this.button.textContent = affordance.label;
      this.button.setAttribute('aria-label', affordance.ariaLabel);
    }
    if (this.touchButton) {
      this.touchButton.textContent = affordance.touchLabel;
      this.touchButton.setAttribute(
        'aria-label',
        affordance.visible ? affordance.ariaLabel : 'Interact'
      );
    }
  }

  minimapPoints(): MinimapPointInput[] {
    return this.state ? serviceMinimapPoints(this.state) : [];
  }

  drawWorld(time: number): void {
    this.graphics.clear();
    const present = new Set<string>();
    for (const service of this.state?.services?.values() ?? []) {
      this.drawService(service, time);
      present.add(service.id);
    }
    for (const [serviceId, label] of this.labels) {
      if (present.has(serviceId)) continue;
      label.destroy();
      this.labels.delete(serviceId);
    }
  }

  destroy(): void {
    this.graphics.destroy();
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
    this.state = undefined;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private drawService(service: NetworkStreetService, time: number): void {
    const color = service.kind === 'repair'
      ? 0x55d6ff
      : service.kind === 'hospital'
        ? 0x63df8a
        : service.kind === 'clothing'
          ? 0xff7fb6
          : 0xf2c94c;
    const pulse = 0.58 + (Math.sin(time / 190 + service.id.length) + 1) * 0.15;
    this.graphics.fillStyle(color, 0.055);
    this.graphics.fillCircle(service.x, service.y, service.radius);
    this.graphics.lineStyle(3, color, pulse);
    this.graphics.strokeCircle(service.x, service.y, service.radius);
    this.graphics.lineStyle(2, color, 0.92);
    if (service.kind === 'repair') {
      this.graphics.strokeRect(service.x - 8, service.y - 8, 16, 16);
      this.graphics.lineBetween(service.x - 12, service.y, service.x + 12, service.y);
    } else if (service.kind === 'hospital') {
      this.graphics.lineBetween(service.x - 11, service.y, service.x + 11, service.y);
      this.graphics.lineBetween(service.x, service.y - 11, service.x, service.y + 11);
    } else if (service.kind === 'clothing') {
      this.graphics.lineBetween(service.x - 12, service.y + 8, service.x, service.y - 1);
      this.graphics.lineBetween(service.x, service.y - 1, service.x + 12, service.y + 8);
      this.graphics.lineBetween(service.x - 12, service.y + 8, service.x + 12, service.y + 8);
      this.graphics.strokeCircle(service.x + 3, service.y - 8, 5);
    } else {
      this.graphics.strokeCircle(service.x, service.y, 10);
      this.graphics.lineBetween(service.x - 4, service.y, service.x + 4, service.y);
    }
    let label = this.labels.get(service.id);
    if (!label) {
      label = this.scene.add.text(service.x, service.y - service.radius - 8, service.label.toUpperCase(), {
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: '11px',
        color: `#${color.toString(16).padStart(6, '0')}`,
        stroke: '#050708',
        strokeThickness: 4
      }).setOrigin(0.5, 1).setDepth(865_001);
      this.labels.set(service.id, label);
    }
    label.setPosition(service.x, service.y - service.radius - 8).setVisible(true);
  }
}
