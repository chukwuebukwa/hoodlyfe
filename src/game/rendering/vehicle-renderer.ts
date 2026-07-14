import Phaser from 'phaser';
import type {NetworkVehicle} from '../types.ts';
import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {interpolatePosition, rotateTowards} from './interpolation-policy.ts';
import type {VehicleRenderPose} from './render-types.ts';
import {vehicleFrame, vehicleVisualState} from './vehicle-render-policy.ts';
import type {MovementVector} from '../input/client-input-policy.ts';
import {
  SavedVehiclePrediction,
  type VehicleInputMove
} from '../prediction/saved-vehicle-prediction.ts';
import {vehicleMechanicalSpeedMultiplier} from '../../../shared/simulation/vehicle-step.ts';
import {type RemoteMotionSample, type RemoteMotionTimeline} from '../network/remote-motion-timeline.ts';
import {createRemoteMotionTimeline} from '../network/remote-timeline-config.ts';
import {
  angleCorrectionOffset,
  decayCorrectionOffset,
  positionCorrectionOffset,
  VEHICLE_CORRECTION_DECAY_RATE
} from './correction-smoothing.ts';
import type {InteractionIslandReplayResult} from '../prediction/interaction-island-replay.ts';
import type {InteractionIslandBaseline} from '../prediction/island-state-history.ts';
import {
  applyVehicleInteractionReplay,
  prepareVehicleInteractionReplay,
  type VehicleInteractionReplayPreparation
} from '../prediction/vehicle-interaction-replay.ts';
import type {InteractionReplayPresentation} from './interaction-replay-presentation.ts';

interface RenderVehicle {
  vehicleId: string;
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
  maximumSpeedMultiplier: number;
  kind: string;
  localOccupant: boolean;
  localDriver: boolean;
  authorityDirty: boolean;
  prediction: SavedVehiclePrediction;
  visualOffsetX: number;
  visualOffsetY: number;
  visualOffsetAngle: number;
  acknowledgedSequence: number;
  interactionReplayAcknowledgedSequence?: number;
  motion: RemoteMotionTimeline;
}

interface VehicleRendererOptions {
  onLocalOccupant: (
    vehicleId: string,
    container: Phaser.GameObjects.Container,
    vehicle: NetworkVehicle
  ) => void;
  remoteTimelinesEnabled?: () => boolean;
  onPrediction?: (
    error: number,
    snapped: boolean,
    pendingMoves: number,
    acknowledgedMove: number,
    resimulated: boolean
  ) => void;
  canOccupy?: (x: number, y: number, radius: number) => boolean;
  sendVehicleMoves?: (vehicleId: string, moves: VehicleInputMove[]) => void;
  onRemoteTimeline?: (
    sample: Pick<RemoteMotionSample, 'snapshotAgeMs' | 'bufferUnderrun' | 'mode'>
  ) => void;
  replayPresentation?: InteractionReplayPresentation;
}

export class VehicleRenderer {
  private readonly rendered = new Map<string, RenderVehicle>();
  private localMovement: MovementVector = {x: 0, y: 0};

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: VehicleRendererOptions
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(
    vehicles?: Map<string, NetworkVehicle>,
    localVehicleId = '',
    localDriverVehicleId = '',
    acknowledgedSequence = 0,
    serverTimeMs = 0
  ): void {
    const present = new Set<string>();
    vehicles?.forEach((vehicle, vehicleId) => {
      present.add(vehicleId);
      this.synchronizeOne(
        vehicleId,
        vehicle,
        localVehicleId === vehicleId,
        localDriverVehicleId === vehicleId,
        acknowledgedSequence,
        serverTimeMs
      );
    });
    for (const [vehicleId, rendered] of this.rendered) {
      if (present.has(vehicleId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(vehicleId);
      this.options.replayPresentation?.remove('vehicle', vehicleId);
    }
  }

  interpolate(
    time: number,
    deltaSeconds = 1 / 60,
    renderServerTimeMs = 0,
    estimatedServerTimeMs = renderServerTimeMs
  ): void {
    for (const rendered of this.rendered.values()) {
      if (rendered.localDriver) {
        rendered.container.setDepth(Math.round(rendered.container.y) + 90);
        this.animateEffects(rendered, time);
        continue;
      }
      const interaction = this.options.replayPresentation?.pose('vehicle', rendered.vehicleId);
      const buffered = !interaction && !rendered.localOccupant && renderServerTimeMs > 0 &&
        (this.options.remoteTimelinesEnabled?.() ?? true)
        ? rendered.motion.sample(renderServerTimeMs, estimatedServerTimeMs)
        : undefined;
      if (buffered) this.options.onRemoteTimeline?.(buffered);
      const position = buffered
        ? {
          x: buffered.x,
          y: buffered.y,
          distance: Math.hypot(buffered.x - rendered.container.x, buffered.y - rendered.container.y),
          snapped: buffered.mode === 'teleported'
        }
        : interpolatePosition(
          rendered.container.x,
          rendered.container.y,
          interaction?.x ?? rendered.targetX,
          interaction?.y ?? rendered.targetY,
          rendered.localOccupant ? 0.34 : 0.25,
          180
        );
      rendered.container.setPosition(position.x, position.y);
      rendered.container.rotation = rotateTowards(
        rendered.container.rotation,
        (interaction?.angle ?? buffered?.angle ?? rendered.targetAngle) + Math.PI / 2,
        buffered ? 1 : 0.2
      );
      rendered.container.setDepth(Math.round(rendered.container.y) + 90);
      this.animateEffects(rendered, time);
    }
  }

  predictLocalVehicle(movement: MovementVector, deltaSeconds: number): void {
    this.localMovement = movement;
    const rendered = [...this.rendered.values()].find((candidate) => candidate.localDriver);
    if (!rendered) return;
    const advanced = rendered.prediction.advance(
      movement,
      rendered.kind,
      deltaSeconds,
      this.options.canOccupy ?? (() => true),
      {maximumSpeedMultiplier: rendered.maximumSpeedMultiplier}
    );
    if (advanced.outboundMoves.length > 0) {
      this.options.sendVehicleMoves?.(rendered.vehicleId, advanced.outboundMoves);
    }
    rendered.visualOffsetX = decayCorrectionOffset(
      rendered.visualOffsetX,
      deltaSeconds,
      VEHICLE_CORRECTION_DECAY_RATE
    );
    rendered.visualOffsetY = decayCorrectionOffset(
      rendered.visualOffsetY,
      deltaSeconds,
      VEHICLE_CORRECTION_DECAY_RATE
    );
    rendered.visualOffsetAngle = decayCorrectionOffset(
      rendered.visualOffsetAngle,
      deltaSeconds,
      VEHICLE_CORRECTION_DECAY_RATE
    );
    rendered.container.setPosition(
      advanced.pose.x + rendered.visualOffsetX,
      advanced.pose.y + rendered.visualOffsetY
    );
    rendered.container.rotation = advanced.pose.angle + rendered.visualOffsetAngle + Math.PI / 2;
    rendered.predictedSpeed = advanced.pose.speed;
  }

  prepareInteractionReplay(
    baseline: InteractionIslandBaseline
  ): VehicleInteractionReplayPreparation | undefined {
    const rendered = this.rendered.get(baseline.rootId);
    if (!rendered?.localDriver) return undefined;
    return prepareVehicleInteractionReplay(rendered.prediction, baseline);
  }

  applyInteractionReplay(
    baseline: InteractionIslandBaseline,
    result: InteractionIslandReplayResult
  ): boolean {
    const rendered = this.rendered.get(baseline.rootId);
    if (!rendered?.localDriver) return false;
    const beforeX = rendered.container.x;
    const beforeY = rendered.container.y;
    const beforeAngle = rendered.container.rotation - Math.PI / 2;
    const correction = applyVehicleInteractionReplay(rendered.prediction, baseline, result);
    if (!correction) return false;
    const offset = positionCorrectionOffset(
      beforeX,
      beforeY,
      correction.pose.x,
      correction.pose.y,
      correction.hardCorrection
    );
    rendered.visualOffsetX = offset.x;
    rendered.visualOffsetY = offset.y;
    rendered.visualOffsetAngle = angleCorrectionOffset(
      beforeAngle,
      correction.pose.angle,
      correction.hardCorrection
    );
    rendered.predictedSpeed = correction.pose.speed;
    rendered.interactionReplayAcknowledgedSequence =
      baseline.acknowledgedLocalInputSequence;
    this.options.onPrediction?.(
      correction.positionError,
      correction.hardCorrection,
      correction.pendingMoveCount,
      baseline.acknowledgedLocalInputSequence,
      correction.resimulated
    );
    return true;
  }

  pose(vehicleId: string): VehicleRenderPose | undefined {
    const rendered = this.rendered.get(vehicleId);
    if (!rendered) return undefined;
    return {
      x: rendered.container.x,
      y: rendered.container.y,
      angle: rendered.container.rotation - Math.PI / 2
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
    localDriver: boolean,
    acknowledgedSequence: number,
    serverTimeMs: number
  ): void {
    let rendered = this.rendered.get(vehicleId);
    if (!rendered) {
      rendered = this.create(vehicle);
      this.rendered.set(vehicleId, rendered);
    }
    const wasLocalDriver = Boolean(rendered.localDriver);
    const becameLocalDriver = localDriver && !wasLocalDriver;
    const authorityChanged = (
      rendered.targetX !== vehicle.x || rendered.targetY !== vehicle.y ||
      rendered.targetAngle !== vehicle.angle || rendered.targetSpeed !== vehicle.speed
    );
    const acknowledgementChanged = rendered.acknowledgedSequence !== acknowledgedSequence;
    rendered.targetX = vehicle.x;
    rendered.targetY = vehicle.y;
    rendered.targetAngle = vehicle.angle;
    rendered.targetSpeed = vehicle.speed;
    rendered.kind = vehicle.kind;
    rendered.maximumSpeedMultiplier = vehicleMechanicalSpeedMultiplier(
      vehicle.engineDamage,
      vehicle.onFire
    );
    rendered.localOccupant = localOccupant;
    rendered.localDriver = localDriver;
    this.options.replayPresentation?.observeAuthority('vehicle', vehicleId, serverTimeMs);
    if (!localDriver && serverTimeMs > 0) {
      if (wasLocalDriver) rendered.motion.clear();
      rendered.motion.push({
        timeMs: serverTimeMs,
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        velocityX: Math.cos(vehicle.angle) * vehicle.speed,
        velocityY: Math.sin(vehicle.angle) * vehicle.speed
      });
    }
    if (becameLocalDriver) {
      rendered.container.setPosition(vehicle.x, vehicle.y);
      rendered.container.rotation = vehicle.angle + Math.PI / 2;
      rendered.predictedSpeed = vehicle.speed;
      rendered.authorityDirty = false;
      rendered.prediction.initialize({
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.speed
      }, acknowledgedSequence);
      rendered.visualOffsetX = 0;
      rendered.visualOffsetY = 0;
      rendered.visualOffsetAngle = 0;
      rendered.acknowledgedSequence = acknowledgedSequence;
    } else if (
      localDriver &&
      (authorityChanged || acknowledgementChanged) &&
      rendered.interactionReplayAcknowledgedSequence !== acknowledgedSequence
    ) {
      const beforeX = rendered.container.x;
      const beforeY = rendered.container.y;
      const beforeAngle = rendered.container.rotation - Math.PI / 2;
      const correction = rendered.prediction.reconcile({
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.speed
      }, acknowledgedSequence, vehicle.kind, this.options.canOccupy ?? (() => true), {
        maximumSpeedMultiplier: rendered.maximumSpeedMultiplier
      });
      const offset = positionCorrectionOffset(
        beforeX,
        beforeY,
        correction.pose.x,
        correction.pose.y,
        correction.hardCorrection
      );
      rendered.visualOffsetX = offset.x;
      rendered.visualOffsetY = offset.y;
      rendered.visualOffsetAngle = angleCorrectionOffset(
        beforeAngle,
        correction.pose.angle,
        correction.hardCorrection
      );
      this.options.onPrediction?.(
        correction.positionError,
        correction.hardCorrection,
        correction.pendingMoveCount,
        acknowledgedSequence,
        correction.resimulated
      );
      rendered.acknowledgedSequence = acknowledgedSequence;
    }
    if (rendered.interactionReplayAcknowledgedSequence === acknowledgedSequence) {
      rendered.interactionReplayAcknowledgedSequence = undefined;
      rendered.acknowledgedSequence = acknowledgedSequence;
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
      vehicleId: vehicle.id,
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
      maximumSpeedMultiplier: vehicleMechanicalSpeedMultiplier(vehicle.engineDamage, vehicle.onFire),
      kind: vehicle.kind,
      localOccupant: false,
      localDriver: false,
      authorityDirty: false,
      prediction: new SavedVehiclePrediction(),
      visualOffsetX: 0,
      visualOffsetY: 0,
      visualOffsetAngle: 0,
      acknowledgedSequence: 0,
      motion: createRemoteMotionTimeline('vehicle')
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

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
