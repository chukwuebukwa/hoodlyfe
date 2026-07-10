import type {Room} from 'colyseus.js';
import Phaser from 'phaser';
import {
  MISSION_ABANDON_MESSAGE,
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_START_MESSAGE
} from '../../../shared/protocol/missions.ts';
import {TouchControls} from '../touch-controls.ts';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';
import {
  canUseWeaponControls,
  ClientInputCadence,
  type MovementVector,
  normalizeMovement
} from './client-input-policy.ts';

interface ClientInputControllerOptions {
  scene: Phaser.Scene;
  room: Room<DistrictNetworkState>;
  getPlayer: () => NetworkPlayer | undefined;
  getAimOrigin: () => {x: number; y: number} | undefined;
  onAim: (angle: number) => void;
}

export class ClientInputController {
  private readonly cadence = new ClientInputCadence();
  private readonly cleanup: Array<() => void> = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private previousWeaponKey!: Phaser.Input.Keyboard.Key;
  private nextWeaponKey!: Phaser.Input.Keyboard.Key;
  private touch?: TouchControls;
  private started = false;

  constructor(private readonly options: ClientInputControllerOptions) {}

  start(): void {
    if (this.started) return;
    const {scene} = this.options;
    if (!scene.input.keyboard) throw new Error('Keyboard input is unavailable.');
    this.started = true;
    this.cursors = scene.input.keyboard.createCursorKeys();
    this.wasd = scene.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.interactKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.previousWeaponKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.nextWeaponKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.touch = new TouchControls();

    scene.input.on('wheel', this.handleWheel);
    this.cleanup.push(() => scene.input.off('wheel', this.handleWheel));
    this.bindClick('#weapon-prev', (event) => {
      event.stopPropagation();
      this.cycleWeapon(-1, scene.time.now);
    });
    this.bindClick('#weapon-next', (event) => {
      event.stopPropagation();
      this.cycleWeapon(1, scene.time.now);
    });
    this.bindClick('#vehicle-action-button', (event) => {
      event.stopPropagation();
      this.options.room.send('interact');
    });
    this.bindClick('#mission-action', (event) => {
      event.stopPropagation();
      this.activateMissionAction();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  update(time: number): MovementVector {
    const movement = this.readMovement();
    if (this.cadence.shouldSendMovement(movement, time)) {
      this.options.room.send('input', movement);
    }
    this.updateAim(time);
    this.updateShooting(time);
    if (Phaser.Input.Keyboard.JustDown(this.interactKey) || this.touch?.consumeInteract()) {
      this.options.room.send('interact');
    }
    if (Phaser.Input.Keyboard.JustDown(this.previousWeaponKey)) {
      this.cycleWeapon(-1, time);
    } else if (Phaser.Input.Keyboard.JustDown(this.nextWeaponKey)) {
      this.cycleWeapon(1, time);
    }
    return movement;
  }

  usesTouchAim(): boolean {
    return Boolean(this.touch?.active || this.touch?.firing);
  }

  destroy(): void {
    if (!this.started) return;
    this.started = false;
    this.options.room.send('input', {x: 0, y: 0});
    for (const remove of this.cleanup.splice(0)) remove();
    this.touch?.destroy();
    this.touch = undefined;
    this.options.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private readMovement(): MovementVector {
    let x = this.touch?.movement.x ?? 0;
    let y = this.touch?.movement.y ?? 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) x -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) x += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) y -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) y += 1;
    return normalizeMovement(x, y);
  }

  private updateAim(time: number): void {
    if (!canUseWeaponControls(this.options.getPlayer())) return;
    const origin = this.options.getAimOrigin();
    if (!origin) return;
    const {scene} = this.options;
    let angle: number;
    if (this.touch?.active || this.touch?.firing) {
      angle = Math.atan2(this.touch.aim.y, this.touch.aim.x);
    } else {
      const pointer = scene.input.activePointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2;
      angle = Phaser.Math.Angle.Between(origin.x, origin.y, pointer.x, pointer.y);
    }
    this.options.onAim(angle);
    if (this.cadence.shouldSendAim(time)) this.options.room.send('aim', {angle});
  }

  private updateShooting(time: number): void {
    if (!canUseWeaponControls(this.options.getPlayer())) return;
    const pointerEvent = this.options.scene.input.activePointer.event as PointerEvent | undefined;
    const firing = Boolean(this.touch?.firing) || (
      this.options.scene.input.activePointer.isDown && pointerEvent?.pointerType !== 'touch'
    );
    if (firing && this.cadence.shouldSendFire(time)) this.options.room.send('shoot');
  }

  private cycleWeapon(direction: -1 | 1, time: number): void {
    if (!canUseWeaponControls(this.options.getPlayer())) return;
    if (!this.cadence.shouldCycleWeapon(time)) return;
    this.options.room.send('cycleWeapon', {direction});
  }

  private activateMissionAction(): void {
    const button = document.querySelector<HTMLButtonElement>('#mission-action');
    const action = button?.dataset.action;
    const missionId = button?.dataset.missionId ?? '';
    if (action === 'start') this.options.room.send(MISSION_START_MESSAGE);
    else if (action === 'join') this.options.room.send(MISSION_JOIN_MESSAGE, {missionId});
    else if (action === 'launch') this.options.room.send(MISSION_LAUNCH_MESSAGE, {missionId});
    else if (action === 'abandon') this.options.room.send(MISSION_ABANDON_MESSAGE, {missionId});
  }

  private bindClick(selector: string, listener: (event: Event) => void): void {
    const element = document.querySelector(selector);
    if (!element) return;
    element.addEventListener('click', listener);
    this.cleanup.push(() => element.removeEventListener('click', listener));
  }

  private readonly handleWheel = (
    _pointer: unknown,
    _objects: unknown,
    _deltaX: number,
    deltaY: number
  ): void => {
    if (Math.abs(deltaY) > 1) this.cycleWeapon(deltaY > 0 ? 1 : -1, this.options.scene.time.now);
  };
}
