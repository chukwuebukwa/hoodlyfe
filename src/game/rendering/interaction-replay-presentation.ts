import type {
  InteractionEntityState,
  KinematicInteractionState
} from '../../../shared/protocol/interaction-contracts.ts';
import {
  INTERACTION_REPLAY_STEP_SECONDS,
  type InteractionIslandReplayResult
} from '../prediction/interaction-island-replay.ts';
import type {InteractionIslandBaseline} from '../prediction/island-state-history.ts';

export type InteractionPresentationKind = KinematicInteractionState['kind'];

export interface InteractionReplayPresentationPose {
  readonly id: string;
  readonly kind: InteractionPresentationKind;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly angularVelocity: number;
  readonly speed?: number;
  readonly targetServerTick: number;
  readonly authorityReleaseServerTimeMs: number;
}

export class InteractionReplayPresentation {
  private readonly promoted = new Map<string, InteractionReplayPresentationPose>();

  promote(
    baseline: InteractionIslandBaseline,
    result: InteractionIslandReplayResult
  ): number {
    if (!result.replayed) return 0;
    const authorityReleaseServerTimeMs = baseline.serverTimeMs +
      result.replayedTicks * INTERACTION_REPLAY_STEP_SECONDS * 1_000;
    let promoted = 0;
    for (const entity of result.entities) {
      if (entity.id === baseline.rootId) continue;
      const key = presentationKey(entity.kind, entity.id);
      const current = this.promoted.get(key);
      if (current && current.targetServerTick > result.targetServerTick) continue;
      this.promoted.set(key, presentationPose(
        entity,
        result.targetServerTick,
        authorityReleaseServerTimeMs
      ));
      promoted++;
    }
    return promoted;
  }

  observeAuthority(
    kind: InteractionPresentationKind,
    id: string,
    serverTimeMs: number
  ): void {
    const key = presentationKey(kind, id);
    const current = this.promoted.get(key);
    if (
      current && Number.isFinite(serverTimeMs) &&
      serverTimeMs + 0.001 >= current.authorityReleaseServerTimeMs
    ) this.promoted.delete(key);
  }

  pose(
    kind: InteractionPresentationKind,
    id: string
  ): InteractionReplayPresentationPose | undefined {
    return this.promoted.get(presentationKey(kind, id));
  }

  remove(kind: InteractionPresentationKind, id: string): void {
    this.promoted.delete(presentationKey(kind, id));
  }

  clear(): void {
    this.promoted.clear();
  }

  size(): number {
    return this.promoted.size;
  }
}

function presentationPose(
  entity: InteractionEntityState,
  targetServerTick: number,
  authorityReleaseServerTimeMs: number
): InteractionReplayPresentationPose {
  return Object.freeze({
    id: entity.id,
    kind: entity.kind,
    x: entity.x,
    y: entity.y,
    angle: entity.angle,
    velocityX: entity.velocityX,
    velocityY: entity.velocityY,
    angularVelocity: entity.angularVelocity,
    speed: entity.kind === 'vehicle' ? entity.speed : undefined,
    targetServerTick,
    authorityReleaseServerTimeMs
  });
}

function presentationKey(kind: InteractionPresentationKind, id: string): string {
  return `${kind}:${id}`;
}
