import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {PedestrianRuntime} from './pedestrian-runtime.ts';

interface PedestrianNavigationOptions {
  random: DeterministicRandom;
  clock: () => {tick: number};
}

export class PedestrianNavigationSystem {
  constructor(private readonly options: PedestrianNavigationOptions) {}

  recoverFromBlock(
    runtime: PedestrianRuntime,
    npcId: string,
    intendedAngle: number,
    nowMs: number
  ): void {
    const detour = Math.PI * this.options.random.range(
      'npc-collision-turn',
      `${npcId}:${this.options.clock().tick}`,
      0.55,
      1.55
    );
    runtime.avoidAngle = normalizeAngle(intendedAngle + detour);
    runtime.avoidUntil = nowMs + 250;
    runtime.wanderAngle = runtime.avoidAngle;
    runtime.nextThinkAt = nowMs + 250;
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
