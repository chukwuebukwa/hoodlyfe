import type {Room} from 'colyseus.js';
import * as THREE from 'three';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';
import {
  canRequestPrimaryAttack,
  directionalVehicleMovement,
  normalizeMovement
} from '../input/client-input-policy.ts';
import {TouchControls} from '../touch-controls.ts';
import {threePointToServerAimAngle} from './three-prototype-policy.ts';

const AIM_INTERVAL_MS = 50;
const FIRE_INTERVAL_MS = 90;

interface ThreeInputControllerOptions {
  room: Room<DistrictNetworkState>;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  player: () => NetworkPlayer | undefined;
  aimOrigin?: () => {x: number; y: number} | undefined;
  vehicleAngle?: (vehicleId: string) => number | undefined;
  surfaceZ: () => number;
  onFire?: (angle: number) => void;
  isBlocked?: () => boolean;
  directAimAngle?: () => number | undefined;
}

export class ThreeInputController {
  private readonly keys = new Set<string>();
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly cleanup: Array<() => void> = [];
  private readonly touch = new TouchControls();
  private firing = false;
  private fireQueued = false;
  private lastAimAt = Number.NEGATIVE_INFINITY;
  private lastFireAt = Number.NEGATIVE_INFINITY;
  private aimAngle?: number;

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

  update(nowMs: number): {x: number; y: number} {
    const player = this.options.player();
    if (this.options.isBlocked?.() || !player) {
      this.fireQueued = false;
      return {x: 0, y: 0};
    }
    const touchMovement = player.vehicleId && player.vehicleSeat === 0
      ? directionalVehicleMovement(
          this.touch.movement.x,
          this.touch.movement.y,
          this.options.vehicleAngle?.(player.vehicleId) ?? player.angle
        )
      : this.touch.movement;
    const movement = normalizeMovement(
      touchMovement.x +
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0),
      touchMovement.y +
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
        (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
    );
    if (!player.alive) return movement;
    let angle = this.options.directAimAngle?.();
    if (angle !== undefined) {
      // Explorer cameras own yaw directly instead of raycasting an overhead ground plane.
    } else if (this.touch.active || this.touch.firing) {
      angle = Math.atan2(this.touch.aim.y, this.touch.aim.x);
    } else {
      this.raycaster.setFromCamera(this.pointer, this.options.camera);
      const target = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.options.surfaceZ());
      if (this.raycaster.ray.intersectPlane(plane, target)) {
        const origin = this.options.aimOrigin?.() ?? player;
        angle = threePointToServerAimAngle(origin.x, origin.y, target.x, target.y);
      }
    }
    if (angle !== undefined) {
      this.aimAngle = angle;
      if (nowMs - this.lastAimAt >= AIM_INTERVAL_MS) {
        this.options.room.send('aim', {angle});
        this.lastAimAt = nowMs;
      }
    }
    if (
      canRequestPrimaryAttack(player) &&
      (this.firing || this.fireQueued || this.touch.firing) &&
      nowMs - this.lastFireAt >= FIRE_INTERVAL_MS
    ) {
      const fireAngle = this.aimAngle ?? player.angle;
      if (this.options.onFire) this.options.onFire(fireAngle);
      else this.options.room.send('shoot');
      this.fireQueued = false;
      this.lastFireAt = nowMs;
    }
    if (this.touch.consumeInteract()) this.options.room.send('interact');
    return movement;
  }

  destroy(): void {
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
    if (this.options.isBlocked?.() || !this.options.player()) return;
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
    if (event.button !== 0) return;
    this.firing = true;
    this.fireQueued = true;
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
