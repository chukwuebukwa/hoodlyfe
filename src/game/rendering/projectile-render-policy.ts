import type {NetworkBullet} from '../types.ts';

export interface ProjectileStyle {
  color: number;
  radius: number;
}

export function projectileStyle(bullet: NetworkBullet): ProjectileStyle {
  if (bullet.ownerKind === 'hostile') return {color: 0xff9d3f, radius: weaponRadius(bullet.weapon)};
  if (bullet.ownerKind === 'police') return {color: 0xff6262, radius: weaponRadius(bullet.weapon)};
  if (bullet.weapon === 'smg') return {color: 0xff9f43, radius: weaponRadius(bullet.weapon)};
  if (bullet.weapon === 'shotgun') return {color: 0xffe8a3, radius: weaponRadius(bullet.weapon)};
  return {color: 0xffdc55, radius: weaponRadius(bullet.weapon)};
}

function weaponRadius(weapon: NetworkBullet['weapon']): number {
  if (weapon === 'smg') return 2.5;
  if (weapon === 'shotgun') return 3.5;
  return 3.2;
}
