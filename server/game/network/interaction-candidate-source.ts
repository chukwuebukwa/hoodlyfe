import type {DistrictState} from '../../state.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import type {
  InteractionCandidateReference,
  InteractionProjectionAnchor
} from './interaction-snapshot-projector.ts';

export type InteractionBroadphaseActorKind = 'player' | 'npc' | 'vehicle';

export interface InteractionBroadphaseActor {
  id: string;
  kind: InteractionBroadphaseActorKind;
  x: number;
  y: number;
}

export interface InteractionCandidateSourceOptions {
  queryActors: (x: number, y: number, radius: number) => readonly InteractionBroadphaseActor[];
  radius?: number;
}

export const INTERACTION_BASELINE_RADIUS = 768;

export class InteractionCandidateSource {
  private readonly radius: number;

  constructor(
    private readonly state: DistrictState,
    private readonly options: InteractionCandidateSourceOptions
  ) {
    this.radius = positive(options.radius ?? INTERACTION_BASELINE_RADIUS);
  }

  forAnchor(anchor: InteractionProjectionAnchor): InteractionCandidateReference[] {
    const candidates: Array<InteractionCandidateReference & {distance: number}> = [];
    const seen = new Set<string>();
    for (const actor of this.options.queryActors(anchor.x, anchor.y, this.radius)) {
      const reference = this.actorReference(actor, anchor.spaceId);
      if (!reference) continue;
      if (reference.kind === anchor.kind && reference.id === anchor.id) continue;
      this.add(candidates, seen, reference, distance(anchor.x, anchor.y, actor.x, actor.y));
    }
    if (anchor.spaceId === STREET_SPACE_ID) {
      for (const rocket of this.state.rockets.values()) {
        this.addProjectile(candidates, seen, anchor, rocket.id, rocket.x, rocket.y);
      }
      for (const projectile of this.state.thrownProjectiles.values()) {
        this.addProjectile(candidates, seen, anchor, projectile.id, projectile.x, projectile.y);
      }
    }
    return candidates
      .sort((left, right) => (
        left.distance - right.distance ||
        familyOrder(left.kind) - familyOrder(right.kind) ||
        left.id.localeCompare(right.id)
      ))
      .map(({kind, id}) => ({kind, id}));
  }

  private actorReference(
    actor: InteractionBroadphaseActor,
    spaceId: string
  ): InteractionCandidateReference | undefined {
    if (actor.kind === 'player') {
      const player = this.state.players.get(actor.id);
      if (!player || (player.spaceId || STREET_SPACE_ID) !== spaceId || player.vehicleId) {
        return undefined;
      }
      return {kind: 'player', id: actor.id};
    }
    if (spaceId !== STREET_SPACE_ID) return undefined;
    if (actor.kind === 'npc') {
      return this.state.npcs.has(actor.id) ? {kind: 'pedestrian', id: actor.id} : undefined;
    }
    return this.state.vehicles.has(actor.id) ? {kind: 'vehicle', id: actor.id} : undefined;
  }

  private addProjectile(
    candidates: Array<InteractionCandidateReference & {distance: number}>,
    seen: Set<string>,
    anchor: InteractionProjectionAnchor,
    id: string,
    x: number,
    y: number
  ): void {
    const projectileDistance = distance(anchor.x, anchor.y, x, y);
    if (projectileDistance > this.radius) return;
    this.add(candidates, seen, {kind: 'projectile', id}, projectileDistance);
  }

  private add(
    candidates: Array<InteractionCandidateReference & {distance: number}>,
    seen: Set<string>,
    reference: InteractionCandidateReference,
    candidateDistance: number
  ): void {
    const key = `${reference.kind}:${reference.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({...reference, distance: candidateDistance});
  }
}

function familyOrder(kind: InteractionCandidateReference['kind']): number {
  if (kind === 'player') return 0;
  if (kind === 'vehicle') return 1;
  if (kind === 'pedestrian') return 2;
  if (kind === 'prop') return 3;
  return 4;
}

function distance(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.hypot(rightX - leftX, rightY - leftY);
}

function positive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Interaction candidate radius must be a positive finite number.');
  }
  return value;
}
