import type {NetworkExplosion} from '../types.ts';

export interface ExplosionPresentation {
  coreColor: number;
  edgeColor: number;
  particleColor: number;
  durationMs: number;
  shakeDurationMs: number;
  shakeIntensity: number;
}

export function explosionPresentation(explosion: NetworkExplosion): ExplosionPresentation {
  return explosion.kind === 'vehicle'
    ? {
        coreColor: 0xfff2a6,
        edgeColor: 0xff4d22,
        particleColor: 0x202326,
        durationMs: 820,
        shakeDurationMs: 260,
        shakeIntensity: 0.008
      }
    : {
        coreColor: 0xfff6be,
        edgeColor: 0xff7a2d,
        particleColor: 0x34383a,
        durationMs: 620,
        shakeDurationMs: 180,
        shakeIntensity: 0.005
      };
}
