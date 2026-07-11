import Phaser from 'phaser';
import {
  cameraFollowPolicy,
  cameraTargetKey,
  cameraZoom,
  type CameraFollowMode
} from './camera-policy.ts';

export class CameraPresentationController {
  private targetKey = '';

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  configure(worldWidth: number, worldHeight: number): void {
    const camera = this.scene.cameras.main;
    camera.setBounds(0, 0, worldWidth, worldHeight);
    camera.setBackgroundColor('#080808');
    camera.setZoom(cameraZoom(this.scene.scale.width));
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
  }

  followPlayer(
    playerId: string,
    target: Phaser.GameObjects.GameObject,
    x: number,
    y: number
  ): void {
    this.follow('player', playerId, target, x, y);
  }

  followVehicle(vehicleId: string, target: Phaser.GameObjects.GameObject): void {
    this.follow('vehicle', vehicleId, target);
  }

  localDamageFeedback(): void {
    this.scene.cameras.main.shake(110, 0.004);
    this.scene.cameras.main.flash(90, 150, 20, 20, false);
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.targetKey = '';
  }

  private follow(
    mode: CameraFollowMode,
    entityId: string,
    target: Phaser.GameObjects.GameObject,
    x?: number,
    y?: number
  ): void {
    const key = cameraTargetKey(mode, entityId);
    if (this.targetKey === key) return;
    const policy = cameraFollowPolicy(mode);
    this.scene.cameras.main.startFollow(target, true, policy.lerpX, policy.lerpY);
    if (policy.centerOnAcquire && x !== undefined && y !== undefined) {
      this.scene.cameras.main.centerOn(x, y);
    }
    this.targetKey = key;
  }

  private handleResize(size: Phaser.Structs.Size): void {
    this.scene.cameras.main.setZoom(cameraZoom(size.width));
  }
}
