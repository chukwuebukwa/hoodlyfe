import type {NetworkPlayer} from '../types.ts';
import type {VehicleRenderPose} from './render-types.ts';

export interface WeaponPresentation {
  texture: string;
  width: number;
  height: number;
}

export interface PassengerPresentation {
  baseX: number;
  baseY: number;
  spriteX: number;
  spriteY: number;
  scale: number;
}

export function weaponPresentation(weapon: NetworkPlayer['weapon']): WeaponPresentation {
  if (weapon === 'grenade') return {texture: 'weapon-grenade', width: 15, height: 15};
  if (weapon === 'smg') return {texture: 'weapon-smg', width: 33, height: 11};
  if (weapon === 'shotgun') return {texture: 'weapon-shotgun', width: 42, height: 10};
  return {texture: 'weapon-pistol', width: 25, height: 9};
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
