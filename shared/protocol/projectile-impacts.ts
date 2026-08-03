export const PROJECTILE_IMPACTS_MESSAGE = 'projectile.impacts';

export interface ProjectileImpactPayload {
  id: string;
  tick: number;
  weapon: string;
  targetKind: 'world' | 'player' | 'npc' | 'vehicle' | 'prop';
  targetId?: string;
  x: number;
  y: number;
  angle: number;
  surfaceId: string;
}

export interface ProjectileImpactsMessage {
  tick: number;
  impacts: ProjectileImpactPayload[];
}
