import type {NetworkBullet} from '../types.ts';

export interface ProjectileStyle {
  color: number;
  length: number;
  width: number;
}

export function projectileStyle(
  bullet: Pick<NetworkBullet, 'ownerKind' | 'weapon'>
): ProjectileStyle {
  const dimensions = weaponDimensions(bullet.weapon);
  if (bullet.ownerKind === 'hostile') return {color: 0xff9d3f, ...dimensions};
  if (bullet.ownerKind === 'police') return {color: 0xff6262, ...dimensions};
  if (bullet.weapon === 'smg') return {color: 0xff9f43, ...dimensions};
  if (bullet.weapon === 'shotgun') return {color: 0xffe8a3, ...dimensions};
  return {color: 0xffdc55, ...dimensions};
}

function weaponDimensions(weapon: NetworkBullet['weapon']): Pick<ProjectileStyle, 'length' | 'width'> {
  if (weapon === 'smg') return {length: 10, width: 1.5};
  if (weapon === 'shotgun') return {length: 8, width: 2.1};
  return {length: 13, width: 2};
}
