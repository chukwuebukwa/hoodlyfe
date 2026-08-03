import type {Room} from 'colyseus.js';
import * as THREE from 'three';
import type {DistrictNetworkState, NetworkPlayer} from '../types.ts';
import {
  canRequestPrimaryAttack,
  directionalVehicleMovement,
  normalizeMovement
} from './client-input-policy.ts';
import {TouchControls} from '../touch-controls.ts';
import {scenePointToServerAimAngle} from '../presentation/scene-policy.ts';
import {SOCCER_BALL_KICK_MESSAGE} from '../../../shared/protocol/soccer-ball.ts';
import {PLAYER_JUMP_MESSAGE} from '../../../shared/protocol/player-jump.ts';
import {weaponDefinition} from '../../../shared/content/weapon-catalog.ts';
import {isMissionTemplateId} from '../../../shared/content/mission-catalog.ts';
import {MISSION_START_MESSAGE} from '../../../shared/protocol/missions.ts';
import {
  WEAPON_RELOAD_PROTOCOL_VERSION,
  WEAPON_RELOAD_RECEIPT_MESSAGE,
  WEAPON_RELOAD_REQUEST_MESSAGE,
  type WeaponReloadReceipt,
  type WeaponReloadRequest
} from '../../../shared/protocol/weapon-reload.ts';

const AIM_INTERVAL_MS = 50;
const FIRE_INTERVAL_MS = 90;

interface InputControllerOptions {
  room: Room<DistrictNetworkState>;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  player: () => NetworkPlayer | undefined;
  aimOrigin?: () => {x: number; y: number} | undefined;
  vehicleAngle?: (vehicleId: string) => number | undefined;
  surfaceZ: () => number;
  onFire?: (angle: number) => void;
  isBlocked?: () => boolean;
  isAuthoring?: () => boolean;
  directAimAngle?: () => number | undefined;
  onReloadReceipt?: (receipt: WeaponReloadReceipt) => void;
}

export interface MovementInput {
  x: number;
  y: number;
  handbrake: boolean;
}

export class InputController {
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
  private nextReloadSequence = 1;

  constructor(private readonly options: InputControllerOptions) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    options.canvas.addEventListener('pointermove', this.handlePointerMove);
    options.canvas.addEventListener('pointerdown', this.handlePointerDown);
    options.canvas.addEventListener('pointerup', this.handlePointerUp);
    options.canvas.addEventListener('pointercancel', this.handlePointerUp);
    options.canvas.addEventListener('wheel', this.handleWheel, {passive: false});
    this.bindClick('#weapon-prev', () => this.cycleWeapon(-1));
    this.bindClick('#weapon-next', () => this.cycleWeapon(1));
    this.bindClick('#vehicle-action-button', this.performContextAction);
    this.bindClick('#reload-button', () => this.requestReload());
    const removeReloadReceipt = options.room.onMessage<WeaponReloadReceipt>(
      WEAPON_RELOAD_RECEIPT_MESSAGE,
      (receipt) => {
        if (receipt.protocolVersion === WEAPON_RELOAD_PROTOCOL_VERSION) {
          options.onReloadReceipt?.(receipt);
        }
      }
    );
    if (typeof removeReloadReceipt === 'function') this.cleanup.push(removeReloadReceipt);
  }

  update(nowMs: number): MovementInput {
    const player = this.options.player();
    if (this.options.isBlocked?.() || !player) {
      this.fireQueued = false;
      return {x: 0, y: 0, handbrake: false};
    }
    const driving = Boolean(player.vehicleId && player.vehicleSeat === 0);
    if (!driving) this.touch.handbrake = false;
    const touchMovement = driving
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
    const input = {
      ...movement,
      handbrake: driving && (this.keys.has('Space') || this.touch.handbrake)
    };
    if (!player.alive) return input;
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
        angle = scenePointToServerAimAngle(origin.x, origin.y, target.x, target.y);
      }
    }
    if (angle !== undefined) {
      this.aimAngle = angle;
      if (nowMs - this.lastAimAt >= AIM_INTERVAL_MS) {
        this.options.room.send('aim', {angle});
        this.lastAimAt = nowMs;
      }
    }
    if (this.options.isAuthoring?.()) {
      this.fireQueued = false;
      this.firing = false;
      return input;
    }
    const definition = weaponDefinition(player.weapon);
    const continuousFire = 'trigger' in definition && definition.trigger === 'automatic';
    const firePressed = this.fireQueued || this.touch.consumeFirePress();
    if (
      canRequestPrimaryAttack(player) &&
      (firePressed || (continuousFire && (this.firing || this.touch.firing))) &&
      nowMs - this.lastFireAt >= FIRE_INTERVAL_MS
    ) {
      const fireAngle = this.aimAngle ?? player.angle;
      if (this.options.onFire) this.options.onFire(fireAngle);
      else this.options.room.send('shoot');
      this.fireQueued = false;
      this.lastFireAt = nowMs;
    }
    if (this.touch.consumeInteract()) this.performContextAction();
    return input;
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
    const player = this.options.player();
    if (this.options.isBlocked?.() || !player) return;
    if (this.options.isAuthoring?.()) {
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    if (event.code === 'KeyF') this.performContextAction();
    if (event.code === 'Space') {
      event.preventDefault();
      if (!player.vehicleId) this.options.room.send(PLAYER_JUMP_MESSAGE);
      if (!player.vehicleId || player.vehicleSeat !== 0) {
        this.options.room.send(SOCCER_BALL_KICK_MESSAGE);
      }
    }
    if (event.code === 'KeyQ') this.cycleWeapon(-1);
    if (event.code === 'KeyE') this.cycleWeapon(1);
    if (event.code === 'KeyR') this.requestReload();
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
    if (event.button !== 0 || this.options.isAuthoring?.()) return;
    this.firing = true;
    this.fireQueued = true;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.button === 0) this.firing = false;
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.options.isAuthoring?.()) return;
    event.preventDefault();
    if (Math.abs(event.deltaY) <= 1) return;
    this.cycleWeapon(event.deltaY > 0 ? 1 : -1);
  };

  private cycleWeapon(direction: -1 | 1): void {
    if (this.options.isBlocked?.() || this.options.isAuthoring?.() || !this.options.player()?.alive) return;
    this.options.room.send('cycleWeapon', {direction});
  }

  private requestReload(): void {
    const player = this.options.player();
    if (this.options.isBlocked?.() || this.options.isAuthoring?.() || !player?.alive) return;
    const request: WeaponReloadRequest = {
      protocolVersion: WEAPON_RELOAD_PROTOCOL_VERSION,
      sequence: this.nextReloadSequence++,
      controlledEntityId: player.id
    };
    this.options.room.send(WEAPON_RELOAD_REQUEST_MESSAGE, request);
  }

  private readonly performContextAction = (): void => {
    if (this.options.isAuthoring?.()) return;
    const prompt = document.querySelector<HTMLButtonElement>('#vehicle-action-button');
    const templateId = prompt?.dataset.templateId;
    if (
      prompt &&
      !prompt.classList.contains('hidden') &&
      prompt.dataset.command === 'mission-start' &&
      isMissionTemplateId(templateId)
    ) {
      this.options.room.send(MISSION_START_MESSAGE, {templateId});
      return;
    }
    this.options.room.send('interact');
  };

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
