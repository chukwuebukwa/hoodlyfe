import {
  isMeleeWeapon,
  weaponDefinition,
  type WeaponId
} from '../../../shared/content/weapon-catalog.ts';
import type {NetworkPlayer} from '../types.ts';
import type {ActorRenderPose, VehicleRenderPose} from './render-types.ts';

export interface WeaponPresentation {
  texture: string;
  width: number;
  height: number;
  visible: boolean;
  originX: number;
}

export interface MeleeAttackPresentation {
  active: boolean;
  bodyRotationOffset: number;
  bodyScaleX: number;
  bodyScaleY: number;
  weaponRotationOffset: number;
  weaponDistance: number;
}

export interface PassengerPresentation {
  baseX: number;
  baseY: number;
  spriteX: number;
  spriteY: number;
  scale: number;
}

export interface PlayerAttachmentPresentation {
  root: ActorRenderPose;
  body: ActorRenderPose;
  weaponBase: {x: number; y: number};
  passenger?: PassengerPresentation;
  occupied: boolean;
  bodyVisible: boolean;
  humanoidColliderVisible: boolean;
}

export function weaponPresentation(weapon: NetworkPlayer['weapon']): WeaponPresentation {
  const presentation = weaponDefinition(weapon).presentation;
  return {
    texture: `weapon-${presentation.assetId}`,
    width: presentation.heldWidth,
    height: presentation.heldHeight,
    visible: presentation.heldVisible,
    originX: presentation.heldOriginX ?? 0.16
  };
}

export function meleeAttackPresentationAtProgress(
  weapon: WeaponId,
  combo: number,
  progress: number
): MeleeAttackPresentation {
  const definition = weaponDefinition(weapon);
  if (!isMeleeWeapon(definition) || !Number.isFinite(progress)) {
    return neutralMeleePresentation();
  }
  const comboIndex = Math.abs(Math.floor(combo)) % definition.strikes.length;
  return meleeAttackPresentation(
    weapon,
    comboIndex,
    Math.max(0, Math.min(1, progress)) * definition.strikes[comboIndex].durationMs
  );
}

export function meleeAttackPresentation(
  weapon: WeaponId,
  combo: number,
  elapsedMs: number
): MeleeAttackPresentation {
  const definition = weaponDefinition(weapon);
  if (!isMeleeWeapon(definition) || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return neutralMeleePresentation();
  }
  const comboIndex = Math.abs(Math.floor(combo)) % definition.strikes.length;
  const strike = definition.strikes[comboIndex];
  if (elapsedMs >= strike.durationMs) return neutralMeleePresentation();

  const direction = comboIndex % 2 === 0 ? 1 : -1;
  const finisherScale = comboIndex === definition.strikes.length - 1 && definition.strikes.length > 1
    ? 1.18
    : 1;
  const swing = elapsedMs <= strike.impactMs
    ? easeOutCubic(elapsedMs / Math.max(1, strike.impactMs))
    : 1 - easeOutCubic(
      (elapsedMs - strike.impactMs) / Math.max(1, strike.durationMs - strike.impactMs)
    );
  const bodyPulse = Math.sin(Math.PI * elapsedMs / strike.durationMs);
  return {
    active: true,
    bodyRotationOffset: direction * swing * 0.34 * finisherScale,
    bodyScaleX: 1 + bodyPulse * 0.12 * finisherScale,
    bodyScaleY: 1 - bodyPulse * 0.06,
    weaponRotationOffset: direction * (-0.72 + swing * 2.05) * finisherScale,
    weaponDistance: definition.id === 'bat' ? 14 + swing * 6 : 7
  };
}

export function passengerPresentation(
  vehicle: VehicleRenderPose,
  seat: number,
  aimAngle: number,
  time: number,
  recoilActive: boolean
): PassengerPresentation {
  const forwardOffset = seat === 3 ? -11 : 5;
  const sideOffset = seat === 1 ? 15 : (seat === 2 ? -15 : 0);
  const sideAngle = vehicle.angle + Math.PI / 2;
  const baseX = vehicle.x + Math.cos(vehicle.angle) * forwardOffset +
    Math.cos(sideAngle) * sideOffset;
  const baseY = vehicle.y + Math.sin(vehicle.angle) * forwardOffset +
    Math.sin(sideAngle) * sideOffset;
  const peek = 3 + Math.sin(time / 95 + seat) * 1.4;
  const peekAngle = seat === 3
    ? vehicle.angle + Math.PI
    : sideAngle + (sideOffset < 0 ? Math.PI : 0);
  const recoil = recoilActive ? 4 : 0;
  return {
    baseX,
    baseY,
    spriteX: baseX + Math.cos(peekAngle) * peek - Math.cos(aimAngle) * recoil,
    spriteY: baseY + Math.sin(peekAngle) * peek - Math.sin(aimAngle) * recoil,
    scale: recoilActive ? 0.64 : 0.58
  };
}

export function playerAttachmentPresentation(
  actor: ActorRenderPose,
  vehicle: VehicleRenderPose | undefined,
  seat: number,
  aimAngle: number,
  time: number,
  recoilActive: boolean
): PlayerAttachmentPresentation {
  if (!vehicle) {
    return {
      root: {...actor},
      body: {...actor},
      weaponBase: {x: actor.x, y: actor.y},
      occupied: false,
      bodyVisible: true,
      humanoidColliderVisible: true
    };
  }
  if (seat <= 0) {
    return {
      root: {...vehicle},
      body: {...vehicle},
      weaponBase: {x: vehicle.x, y: vehicle.y},
      occupied: true,
      bodyVisible: false,
      humanoidColliderVisible: false
    };
  }
  const passenger = passengerPresentation(vehicle, seat, aimAngle, time, recoilActive);
  return {
    root: {...vehicle},
    body: {x: passenger.spriteX, y: passenger.spriteY, angle: aimAngle},
    weaponBase: {x: passenger.baseX, y: passenger.baseY},
    passenger,
    occupied: true,
    bodyVisible: true,
    humanoidColliderVisible: false
  };
}

function neutralMeleePresentation(): MeleeAttackPresentation {
  return {
    active: false,
    bodyRotationOffset: 0,
    bodyScaleX: 1,
    bodyScaleY: 1,
    weaponRotationOffset: 0,
    weaponDistance: 7
  };
}

function easeOutCubic(value: number): number {
  const progress = Math.max(0, Math.min(1, value));
  return 1 - (1 - progress) ** 3;
}
