import type {Room} from 'colyseus.js';
import * as THREE from 'three';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';
import {
  canRequestPrimaryAttack,
  normalizeMovement
} from '../input/client-input-policy.ts';
import {TouchControls} from '../touch-controls.ts';
import {threePointToServerAimAngle} from './three-prototype-policy.ts';

const MOVEMENT_HEARTBEAT_MS = 100;
const AIM_INTERVAL_MS = 50;
const FIRE_INTERVAL_MS = 90;

interface ThreeInputControllerOptions {
  room: Room<DistrictNetworkState>;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  player: () => NetworkPlayer | undefined;
  surfaceZ: () => number;
  isBlocked?: () => boolean;
}

export class ThreeInputController {
  private readonly keys = new Set<string>();
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly cleanup: Array<() => void> = [];
  private readonly touch = new TouchControls();
  private firing = false;
  private lastMovement = {x: 0, y: 0};
  private lastMovementAt = Number.NEGATIVE_INFINITY;
  private lastAimAt = Number.NEGATIVE_INFINITY;
  private lastFireAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: ThreeInputControllerOptions) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    options.canvas.addEventListener('pointermove', this.handlePointerMove);
    options.canvas.addEventListener('pointerdown', this.handlePointerDown);
    options.canvas.addEventListener('pointerup', this.handlePointerUp);
    options.canvas.addEventListener('pointercancel', this.handlePointerUp);
    options.canvas.addEventListener('wheel', this.handleWheel, {passive: false});
    this.bindClick('#weapon-prev', () => this.cycleWeapon(-1));
    this.bindClick('#weapon-next', () => this.cycleWeapon(1));
    this.bindClick('#vehicle-action-button', () => this.options.room.send('interact'));
  }

  update(nowMs: number): void {
    if (this.options.isBlocked?.()) {
      this.sendStoppedMovement(nowMs);
      return;
    }
    const movement = normalizeMovement(
      this.touch.movement.x +
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0),
      this.touch.movement.y +
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
        (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
    );
    if (
      movement.x !== this.lastMovement.x || movement.y !== this.lastMovement.y ||
      nowMs - this.lastMovementAt >= MOVEMENT_HEARTBEAT_MS
    ) {
      this.options.room.send('input', movement);
      this.lastMovement = movement;
      this.lastMovementAt = nowMs;
    }
    const player = this.options.player();
    if (!player?.alive || nowMs - this.lastAimAt < AIM_INTERVAL_MS) return;
    let angle: number | undefined;
    if (this.touch.active || this.touch.firing) {
      angle = Math.atan2(this.touch.aim.y, this.touch.aim.x);
    } else {
      this.raycaster.setFromCamera(this.pointer, this.options.camera);
      const target = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.options.surfaceZ());
      if (this.raycaster.ray.intersectPlane(plane, target)) {
        angle = threePointToServerAimAngle(player.x, player.y, target.x, target.y);
      }
    }
    if (angle !== undefined) {
      this.options.room.send('aim', {angle});
      this.lastAimAt = nowMs;
    }
    if (
      canRequestPrimaryAttack(player) &&
      (this.firing || this.touch.firing) &&
      nowMs - this.lastFireAt >= FIRE_INTERVAL_MS
    ) {
      this.options.room.send('shoot');
      this.lastFireAt = nowMs;
    }
    if (this.touch.consumeInteract()) this.options.room.send('interact');
  }

  destroy(): void {
    this.options.room.send('input', {x: 0, y: 0});
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.options.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.options.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.options.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.options.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.options.canvas.removeEventListener('wheel', this.handleWheel);
    for (const remove of this.cleanup.splice(0)) remove();
    this.touch.destroy();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    this.keys.add(event.code);
    if (this.options.isBlocked?.()) return;
    if (event.code === 'KeyF') this.options.room.send('interact');
    if (event.code === 'KeyQ') this.cycleWeapon(-1);
    if (event.code === 'KeyE') this.cycleWeapon(1);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const bounds = this.options.canvas.getBoundingClientRect();
    this.pointer.set(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height * 2 - 1)
    );
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.firing = true;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.button === 0) this.firing = false;
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (Math.abs(event.deltaY) <= 1) return;
    this.cycleWeapon(event.deltaY > 0 ? 1 : -1);
  };

  private cycleWeapon(direction: -1 | 1): void {
    if (this.options.isBlocked?.() || !this.options.player()?.alive) return;
    this.options.room.send('cycleWeapon', {direction});
  }

  private sendStoppedMovement(nowMs: number): void {
    if (this.lastMovement.x === 0 && this.lastMovement.y === 0 &&
      nowMs - this.lastMovementAt < MOVEMENT_HEARTBEAT_MS) return;
    this.options.room.send('input', {x: 0, y: 0});
    this.lastMovement = {x: 0, y: 0};
    this.lastMovementAt = nowMs;
  }

  private bindClick(selector: string, action: () => void): void {
    const element = document.querySelector(selector);
    if (!element) return;
    const listener = (event: Event) => {
      event.stopPropagation();
      action();
    };
    element.addEventListener('click', listener);
    this.cleanup.push(() => element.removeEventListener('click', listener));
  }
}
