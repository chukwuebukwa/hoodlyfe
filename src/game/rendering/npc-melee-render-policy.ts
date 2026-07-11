import {NPC_MELEE_IMPACT_PROGRESS} from '../../../shared/content/pedestrian-combat.ts';

export interface NpcMeleeRenderState {
  action?: string;
  attackProgress?: number;
}

export interface NpcMeleePresentation {
  active: boolean;
  stopMovement: boolean;
  rotationOffset: number;
  scaleX: number;
  scaleY: number;
  tint?: number;
}

export function npcMeleePresentation(state: NpcMeleeRenderState): NpcMeleePresentation {
  if (state.action !== 'melee') return neutral();
  const progress = clamp01(state.attackProgress ?? 0);
  if (progress >= 1) return neutral();
  if (progress < NPC_MELEE_IMPACT_PROGRESS) {
    const windup = easeInOut(progress / NPC_MELEE_IMPACT_PROGRESS);
    return {
      active: true,
      stopMovement: true,
      rotationOffset: -0.34 * windup,
      scaleX: 1 - 0.12 * windup,
      scaleY: 1 + 0.08 * windup,
      tint: 0xff9a76
    };
  }
  const recovery = clamp01(
    (progress - NPC_MELEE_IMPACT_PROGRESS) / (1 - NPC_MELEE_IMPACT_PROGRESS)
  );
  const strike = 1 - easeOutCubic(recovery);
  return {
    active: true,
    stopMovement: true,
    rotationOffset: 0.46 * strike,
    scaleX: 1 + 0.2 * strike,
    scaleY: 1 - 0.15 * strike,
    tint: 0xff735d
  };
}

function neutral(): NpcMeleePresentation {
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

function easeInOut(value: number): number {
  return value * value * (3 - 2 * value);
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}
