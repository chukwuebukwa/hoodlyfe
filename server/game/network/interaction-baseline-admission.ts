import {
  interactionShapesOverlap,
  sweptCircleTimeToContact
} from '../../../shared/physics/interaction-contact-geometry.ts';
import type {InteractionEntityState} from '../../../shared/protocol/interaction-contracts.ts';
import {
  INTERACTION_CONTACT_SLOP,
  INTERACTION_TTC_MARGIN,
  interactionContactShape,
  interactionMotionCircle,
  interactionStableKey
} from '../../../shared/simulation/interaction-entity-geometry.ts';

export const INTERACTION_BASELINE_HORIZON_SECONDS = 0.65;

interface BaselineAdmissionScore {
  entity: InteractionEntityState;
  currentContact: boolean;
  timeToContact: number;
  distance: number;
  familyPriority: number;
  key: string;
}

export function rankInteractionBaselineCandidates(
  root: InteractionEntityState,
  candidates: readonly InteractionEntityState[]
): InteractionEntityState[] {
  return candidates.map((entity): BaselineAdmissionScore => {
    const currentContact = interactionShapesOverlap(
      interactionContactShape(root),
      interactionContactShape(entity),
      INTERACTION_CONTACT_SLOP
    );
    const timeToContact = currentContact
      ? 0
      : sweptCircleTimeToContact(
        interactionMotionCircle(root),
        interactionMotionCircle(entity),
        INTERACTION_BASELINE_HORIZON_SECONDS,
        INTERACTION_TTC_MARGIN
      ) ?? Number.POSITIVE_INFINITY;
    return {
      entity,
      currentContact,
      timeToContact,
      distance: Math.hypot(entity.x - root.x, entity.y - root.y),
      familyPriority: familyPriority(entity, root),
      key: interactionStableKey(entity)
    };
  }).sort((left, right) => (
    Number(right.currentContact) - Number(left.currentContact) ||
    Number(!Number.isFinite(left.timeToContact)) - Number(!Number.isFinite(right.timeToContact)) ||
    left.timeToContact - right.timeToContact ||
    left.familyPriority - right.familyPriority ||
    left.distance - right.distance ||
    left.key.localeCompare(right.key)
  )).map(({entity}) => entity);
}

function familyPriority(entity: InteractionEntityState, root: InteractionEntityState): number {
  if (entity.interactionPriority === 'player-controlled') return 0;
  if (entity.interactionPriority === 'mission-critical') return 1;
  if (entity.kind === 'projectile' && entity.ownerId === root.id) return 2;
  if (entity.kind === 'vehicle') return 3;
  if (entity.kind === 'projectile') return 4;
  if (entity.kind === 'prop') return 5;
  return 6;
}
