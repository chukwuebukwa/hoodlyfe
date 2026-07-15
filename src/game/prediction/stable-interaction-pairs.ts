import type {InteractionEntityState} from '../../../shared/protocol/interaction-contracts.ts';
import {interactionStableKey} from './interaction-island-policy.ts';

export interface StableInteractionPair {
  readonly leftId: string;
  readonly rightId: string;
  readonly leftKey: string;
  readonly rightKey: string;
}

export function stableInteractionPairs(
  entities: readonly InteractionEntityState[]
): readonly StableInteractionPair[] {
  const ordered = [...entities].sort((left, right) => (
    interactionStableKey(left).localeCompare(interactionStableKey(right))
  ));
  const pairs: StableInteractionPair[] = [];
  for (let left = 0; left < ordered.length; left++) {
    for (let right = left + 1; right < ordered.length; right++) {
      pairs.push(Object.freeze({
        leftId: ordered[left].id,
        rightId: ordered[right].id,
        leftKey: interactionStableKey(ordered[left]),
        rightKey: interactionStableKey(ordered[right])
      }));
    }
  }
  return Object.freeze(pairs);
}
