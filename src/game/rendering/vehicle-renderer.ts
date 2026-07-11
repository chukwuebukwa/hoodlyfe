import Phaser from 'phaser';
import type {NetworkVehicle} from '../types.ts';
import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {interpolatePosition, rotateTowards} from './interpolation-policy.ts';
import type {VehicleRenderPose} from './render-types.ts';
import {vehicleFrame, vehicleVisualState} from './vehicle-render-policy.ts';
import type {MovementVector} from '../input/client-input-policy.ts';
import {
  predictVehiclePose,
  reconcileVehiclePose
} from '../prediction/vehicle-prediction-policy.ts';

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
  targetSpeed: number;
  predictedSpeed: number;
  kind: string;
  localOccupant: boolean;
  localDriver: boolean;
}

interface VehicleRendererOptions {
  onLocalOccupant: (
    vehicleId: string,
    container: Phaser.GameObjects.Container,
    vehicle: NetworkVehicle
  ) => void;
  onPrediction?: (error: number, snapped: boolean) => void;
}

export class VehicleRenderer {
  private readonly rendered = new Map<string, RenderVehicle>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: VehicleRendererOptions
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(
    vehicles?: Map<string, NetworkVehicle>,
    localVehicleId = '',
    localDriverVehicleId = ''
  ): void {
    const present = new Set<string>();
    vehicles?.forEach((vehicle, vehicleId) => {
      present.add(vehicleId);
      this.synchronizeOne(
        vehicleId,
        vehicle,
        localVehicleId === vehicleId,
        localDriverVehicleId === vehicleId
      );
    });
    for (const [vehicleId, rendered] of this.rendered) {
      if (present.has(vehicleId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(vehicleId);
    }
  }

  interpolate(time: number, deltaSeconds = 1 / 60): void {
    for (const rendered of this.rendered.values()) {
      if (rendered.localDriver) {
        const reconciliation = reconcileVehiclePose({
          x: rendered.container.x,
          y: rendered.container.y,
          angle: rendered.container.rotation - Math.PI / 2,
          speed: rendered.predictedSpeed
        }, {
          x: rendered.targetX,
          y: rendered.targetY,
          angle: rendered.targetAngle,
          speed: rendered.targetSpeed
        }, deltaSeconds);
        rendered.container.setPosition(reconciliation.pose.x, reconciliation.pose.y);
        rendered.container.rotation = reconciliation.pose.angle + Math.PI / 2;
        rendered.predictedSpeed = reconciliation.pose.speed;
        rendered.container.setDepth(Math.round(rendered.container.y) + 90);
        this.animateEffects(rendered, time);
        this.options.onPrediction?.(reconciliation.error, reconciliation.snapped);
        continue;
      }
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

  predictLocalVehicle(movement: MovementVector, deltaSeconds: number): void {
    const rendered = [...this.rendered.values()].find((candidate) => candidate.localDriver);
    if (!rendered) return;
    const predicted = predictVehiclePose({
      x: rendered.container.x,
      y: rendered.container.y,
      angle: rendered.container.rotation - Math.PI / 2,
      speed: rendered.predictedSpeed
    }, movement, rendered.kind, deltaSeconds);
    rendered.container.setPosition(predicted.x, predicted.y);
    rendered.container.rotation = predicted.angle + Math.PI / 2;
    rendered.predictedSpeed = predicted.speed;
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
    localOccupant: boolean,
    localDriver: boolean
  ): void {
    let rendered = this.rendered.get(vehicleId);
    if (!rendered) {
      rendered = this.create(vehicle);
      this.rendered.set(vehicleId, rendered);
    }
    const becameLocalDriver = localDriver && !rendered.localDriver;
    rendered.targetX = vehicle.x;
    rendered.targetY = vehicle.y;
    rendered.targetAngle = vehicle.angle;
    rendered.targetSpeed = vehicle.speed;
    rendered.kind = vehicle.kind;
    rendered.localOccupant = localOccupant;
    rendered.localDriver = localDriver;
    if (becameLocalDriver) {
      rendered.container.setPosition(vehicle.x, vehicle.y);
      rendered.container.rotation = vehicle.angle + Math.PI / 2;
      rendered.predictedSpeed = vehicle.speed;
    }
    const visual = vehicleVisualState(vehicle);
    rendered.sprite.setFrame(visual.frame).setAlpha(visual.alpha);
    rendered.smoke.setVisible(visual.smoke);
    rendered.fire.setVisible(visual.fire);
    rendered.redLight?.setVisible(Boolean(vehicle.siren) && !vehicle.destroyed);
    rendered.blueLight?.setVisible(Boolean(vehicle.siren) && !vehicle.destroyed);
    if (visual.tint === undefined) rendered.sprite.clearTint();
    else rendered.sprite.setTint(visual.tint);
    if (localOccupant) this.options.onLocalOccupant(vehicleId, rendered.container, vehicle);
  }

  private create(vehicle: NetworkVehicle): RenderVehicle {
    const definition = vehicleDefinition(vehicle.kind);
    const sprite = this.scene.add.sprite(0, 0, 'vehicles', vehicleFrame(vehicle.kind))
      .setDisplaySize(definition.presentation.width, definition.presentation.height);
    const smoke = this.scene.add.circle(0, -17, 6, 0x2d3436, 0.75)
      .setStrokeStyle(2, 0x9aa2a4, 0.5)
      .setVisible(false);
    const fire = this.scene.add.circle(0, -14, 4, 0xff8c24, 0.95)
      .setStrokeStyle(2, 0xffd34d, 0.9)
      .setVisible(false);
    const children: Phaser.GameObjects.GameObject[] = [sprite, smoke, fire];
    let redLight: Phaser.GameObjects.Arc | undefined;
    let blueLight: Phaser.GameObjects.Arc | undefined;
    if (definition.presentation.emergencyLights) {
      redLight = this.scene.add.circle(-8, 0, 2.6, 0xff3030, 1)
        .setStrokeStyle(1.5, 0xff8a8a, 0.7)
        .setVisible(Boolean(vehicle.siren));
      blueLight = this.scene.add.circle(8, 0, 2.6, 0x3c73ff, 1)
        .setStrokeStyle(1.5, 0x8eb0ff, 0.7)
        .setVisible(Boolean(vehicle.siren));
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
      targetSpeed: vehicle.speed,
      predictedSpeed: vehicle.speed,
      kind: vehicle.kind,
      localOccupant: false,
      localDriver: false
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
