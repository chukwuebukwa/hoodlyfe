import {vehicleDefinition} from '../content/vehicle-catalog.ts';
import type {InteractionEntityState} from '../protocol/interaction-contracts.ts';
import type {
  InteractionContactShape,
  InteractionMotionCircle
} from '../physics/interaction-contact-geometry.ts';

export const INTERACTION_CONTACT_SLOP = 0.5;
export const INTERACTION_TTC_MARGIN = 8;

export function interactionContactShape(entity: InteractionEntityState): InteractionContactShape {
  if (entity.kind === 'vehicle') {
    const collision = vehicleDefinition(entity.vehicleKind).collision;
    return {
      shape: 'box',
      x: entity.x,
      y: entity.y,
      angle: entity.angle,
      halfLength: collision.length / 2,
      halfWidth: collision.width / 2
    };
  }
  return {
    shape: 'circle',
    x: entity.x,
    y: entity.y,
    radius: entity.radius
  };
}

export function interactionMotionCircle(entity: InteractionEntityState): InteractionMotionCircle {
  return {
    x: entity.x,
    y: entity.y,
    velocityX: entity.velocityX,
    velocityY: entity.velocityY,
    radius: interactionEntityReach(entity)
  };
}

export function interactionEntityReach(entity: InteractionEntityState): number {
  if (entity.kind !== 'vehicle') return entity.radius;
  const collision = vehicleDefinition(entity.vehicleKind).collision;
  return Math.hypot(collision.length / 2, collision.width / 2);
}

export function interactionEntityActive(entity: InteractionEntityState): boolean {
  if (entity.kind === 'player' || entity.kind === 'pedestrian') return entity.alive;
  return true;
}

export function interactionStableKey(entity: InteractionEntityState): string {
  return `${entity.kind}:${entity.id}`;
}
