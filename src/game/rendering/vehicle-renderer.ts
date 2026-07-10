import Phaser from 'phaser';
import type {NetworkVehicle} from '../types.ts';
import {interpolatePosition, rotateTowards} from './interpolation-policy.ts';
import type {VehicleRenderPose} from './render-types.ts';
import {vehicleFrame, vehicleVisualState} from './vehicle-render-policy.ts';

interface RenderVehicle {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  smoke: Phaser.GameObjects.Arc;
  fire: Phaser.GameObjects.Arc;
  redLight?: Phaser.GameObjects.Arc;
  blueLight?: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
  targetAngle: number;
  localOccupant: boolean;
}

interface VehicleRendererOptions {
  onLocalOccupant: (
    vehicleId: string,
    container: Phaser.GameObjects.Container,
    vehicle: NetworkVehicle
  ) => void;
}

export class VehicleRenderer {
  private readonly rendered = new Map<string, RenderVehicle>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: VehicleRendererOptions
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(vehicles?: Map<string, NetworkVehicle>, localVehicleId = ''): void {
    const present = new Set<string>();
    vehicles?.forEach((vehicle, vehicleId) => {
      present.add(vehicleId);
      this.synchronizeOne(vehicleId, vehicle, localVehicleId === vehicleId);
    });
    for (const [vehicleId, rendered] of this.rendered) {
      if (present.has(vehicleId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(vehicleId);
    }
  }

  interpolate(time: number): void {
    for (const rendered of this.rendered.values()) {
      const position = interpolatePosition(
        rendered.container.x,
        rendered.container.y,
        rendered.targetX,
        rendered.targetY,
        rendered.localOccupant ? 0.34 : 0.25,
        180
      );
      rendered.container.setPosition(position.x, position.y);
      rendered.container.rotation = rotateTowards(
        rendered.container.rotation,
        rendered.targetAngle + Math.PI / 2,
        0.2
      );
      rendered.container.setDepth(Math.round(rendered.container.y) + 90);
      this.animateEffects(rendered, time);
    }
  }

  pose(vehicleId: string): VehicleRenderPose | undefined {
    const rendered = this.rendered.get(vehicleId);
    if (!rendered) return undefined;
    return {
      x: rendered.container.x,
      y: rendered.container.y,
      angle: rendered.targetAngle
    };
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.container.destroy(true);
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private synchronizeOne(
    vehicleId: string,
    vehicle: NetworkVehicle,
    localOccupant: boolean
  ): void {
    let rendered = this.rendered.get(vehicleId);
    if (!rendered) {
      rendered = this.create(vehicle);
      this.rendered.set(vehicleId, rendered);
    }
    rendered.targetX = vehicle.x;
    rendered.targetY = vehicle.y;
    rendered.targetAngle = vehicle.angle;
    rendered.localOccupant = localOccupant;
    const visual = vehicleVisualState(vehicle);
    rendered.sprite.setFrame(visual.frame).setAlpha(visual.alpha);
    rendered.smoke.setVisible(visual.smoke);
    rendered.fire.setVisible(visual.fire);
    if (visual.tint === undefined) rendered.sprite.clearTint();
    else rendered.sprite.setTint(visual.tint);
    if (localOccupant) this.options.onLocalOccupant(vehicleId, rendered.container, vehicle);
  }

  private create(vehicle: NetworkVehicle): RenderVehicle {
    const sprite = this.scene.add.sprite(0, 0, 'vehicles', vehicleFrame(vehicle.kind))
      .setDisplaySize(96, 96);
    const smoke = this.scene.add.circle(0, -17, 6, 0x2d3436, 0.75)
      .setStrokeStyle(2, 0x9aa2a4, 0.5)
      .setVisible(false);
    const fire = this.scene.add.circle(0, -14, 4, 0xff8c24, 0.95)
      .setStrokeStyle(2, 0xffd34d, 0.9)
      .setVisible(false);
    const children: Phaser.GameObjects.GameObject[] = [sprite, smoke, fire];
    let redLight: Phaser.GameObjects.Arc | undefined;
    let blueLight: Phaser.GameObjects.Arc | undefined;
    if (vehicle.kind === 'police') {
      redLight = this.scene.add.circle(-8, 0, 2.6, 0xff3030, 1)
        .setStrokeStyle(1.5, 0xff8a8a, 0.7);
      blueLight = this.scene.add.circle(8, 0, 2.6, 0x3c73ff, 1)
        .setStrokeStyle(1.5, 0x8eb0ff, 0.7);
      children.push(redLight, blueLight);
    }
    const container = this.scene.add.container(vehicle.x, vehicle.y, children)
      .setDepth(Math.round(vehicle.y) + 90);
    return {
      container,
      sprite,
      smoke,
      fire,
      redLight,
      blueLight,
      targetX: vehicle.x,
      targetY: vehicle.y,
      targetAngle: vehicle.angle,
      localOccupant: false
    };
  }

  private animateEffects(rendered: RenderVehicle, time: number): void {
    if (rendered.redLight && rendered.blueLight) {
      const phase = Math.floor(time / 120) % 2;
      rendered.redLight.alpha = phase === 0 ? 1 : 0.22;
      rendered.blueLight.alpha = phase === 1 ? 1 : 0.22;
    }
    if (rendered.smoke.visible) {
      rendered.smoke.setPosition(Math.sin(time / 180) * 2.5, -17 - Math.sin(time / 110) * 3);
      rendered.smoke.setScale(0.85 + (Math.sin(time / 140) + 1) * 0.18);
      rendered.smoke.alpha = 0.45 + (Math.sin(time / 170) + 1) * 0.16;
    }
    if (rendered.fire.visible) {
      rendered.fire.setScale(0.78 + (Math.sin(time / 52) + 1) * 0.22);
    }
  }
}
