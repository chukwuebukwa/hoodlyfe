import type {InteractionReplayBodyStep} from './interaction-island-replay.ts';
import {createHumanoidInteractionBodyStep} from './on-foot-interaction-replay.ts';
import type {InteractionWorldOccupancy} from './vehicle-interaction-replay.ts';

// Street actors are stepped as one Rapier batch. The body fallback exists only for
// on-foot actors in interiors, whose obstacle rectangles are not part of the street world.
export function createMixedInteractionBodyStep(
  canOccupy: InteractionWorldOccupancy
): InteractionReplayBodyStep {
  const stepHumanoid = createHumanoidInteractionBodyStep(canOccupy);
  return (entity, control, context) => (
    entity.kind === 'player' || entity.kind === 'pedestrian'
      ? stepHumanoid(entity, control, context)
      : entity
  );
}
