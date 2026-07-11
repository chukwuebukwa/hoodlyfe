import type {
  CombatReactionDirection,
  CombatReactionKind
} from '../types.ts';

export interface CombatReactionState {
  reactionKind?: CombatReactionKind;
  reactionDirection?: CombatReactionDirection;
  reactionProgress?: number;
}

export interface CombatReactionPresentation {
  active: boolean;
  stopMovement: boolean;
  rotationOffset: number;
  scaleX: number;
  scaleY: number;
  tint?: number;
}

export function combatReactionPresentation(
  state: CombatReactionState
): CombatReactionPresentation {
  const kind = state.reactionKind ?? '';
  if (!kind) return neutralReactionPresentation();

  const progress = clamp01(state.reactionProgress ?? 0);
  const direction = state.reactionDirection ?? 'front';
  const directionSign = direction === 'left' || direction === 'back' ? -1 : 1;
  const sideHit = direction === 'left' || direction === 'right';

  if (kind === 'knockdown') {
    const settle = easeOutCubic(progress);
    return {
      active: true,
      stopMovement: true,
      rotationOffset: directionSign * settle * Math.PI * 0.47,
      scaleX: sideHit ? 1 - settle * 0.34 : 1 + settle * 0.12,
      scaleY: sideHit ? 1 + settle * 0.12 : 1 - settle * 0.48,
      tint: 0xff6f61
    };
  }

  const pulse = Math.sin(Math.PI * progress);
  const strength = kind === 'stagger' ? 1 : 0.48;
  return {
    active: true,
    stopMovement: true,
    rotationOffset: directionSign * pulse * 0.38 * strength,
    scaleX: sideHit ? 1 - pulse * 0.16 * strength : 1 + pulse * 0.1 * strength,
    scaleY: sideHit ? 1 + pulse * 0.1 * strength : 1 - pulse * 0.18 * strength,
    tint: kind === 'stagger' ? 0xff8f7d : 0xffc2b8
  };
}

function neutralReactionPresentation(): CombatReactionPresentation {
  return {
    active: false,
    stopMovement: false,
    rotationOffset: 0,
    scaleX: 1,
    scaleY: 1
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}
