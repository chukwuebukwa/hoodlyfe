import {
  interactionShapesOverlap,
  sweptCircleTimeToContact
} from '../../../shared/physics/interaction-contact-geometry.ts';
import type {
  InteractionEntityState,
  InteractionSnapshot
} from '../../../shared/protocol/interaction-contracts.ts';
import {
  DESKTOP_INTERACTION_ISLAND_BUDGET,
  INTERACTION_CONTACT_RETENTION_TICKS,
  INTERACTION_CONTACT_SLOP,
  INTERACTION_MEMBERSHIP_TTC_BONUS_SECONDS,
  INTERACTION_TTC_MARGIN,
  interactionContactShape,
  interactionEntityActive,
  interactionEntityWeight,
  interactionExitHorizonSeconds,
  interactionGameplayPriority,
  interactionHorizonSeconds,
  interactionMotionCircle,
  interactionStableKey,
  type InteractionNetworkConditions
} from './interaction-island-policy.ts';

export type InteractionIslandMemberReason =
  | 'root'
  | 'current-contact'
  | 'contact-retained'
  | 'imminent-contact'
  | 'exit-hysteresis'
  | 'contact-closure';

export interface InteractionIslandMember {
  readonly entity: InteractionEntityState;
  readonly weight: number;
  readonly reason: InteractionIslandMemberReason;
  readonly timeToContactMs: number;
}

export interface InteractionIslandSelection {
  readonly serverTick: number;
  readonly rootId: string;
  readonly members: readonly InteractionIslandMember[];
  readonly memberIds: readonly string[];
  readonly weightedPoints: number;
  readonly budget: number;
  readonly overflowIds: readonly string[];
  readonly overflowPoints: number;
  readonly candidateCount: number;
  readonly currentContactCount: number;
  readonly retainedContactCount: number;
  readonly closureCount: number;
  readonly horizonMs: number;
  readonly exitHorizonMs: number;
}

export interface InteractionIslandSelectionOptions {
  readonly budget?: number;
  readonly network: InteractionNetworkConditions;
}

interface MembershipTrack {
  lifecycleRevision: number;
  colliderRevision: number;
  lastSelectedTick: number;
  lastContactTick: number;
}

interface CandidateScore {
  entity: InteractionEntityState;
  key: string;
  weight: number;
  currentContact: boolean;
  retainedContact: boolean;
  previousMember: boolean;
  timeToContact: number;
  adjustedTimeToContact: number;
  gameplayPriority: number;
  reason: Exclude<InteractionIslandMemberReason, 'root' | 'contact-closure'>;
}

export class InteractionIslandSelector {
  private readonly tracks = new Map<string, MembershipTrack>();
  private lastServerTick = -1;
  private latestSelection?: InteractionIslandSelection;

  select(
    snapshot: InteractionSnapshot,
    options: InteractionIslandSelectionOptions
  ): InteractionIslandSelection | undefined {
    if (snapshot.serverTick < this.lastServerTick) return this.latestSelection;
    const root = snapshot.entities[0];
    if (!root) return undefined;
    const budget = positiveInteger(options.budget ?? DESKTOP_INTERACTION_ISLAND_BUDGET);
    const horizon = interactionHorizonSeconds(options.network);
    const exitHorizon = interactionExitHorizonSeconds(horizon);
    const previousTick = this.lastServerTick;
    const candidates = snapshot.entities.slice(1).filter(interactionEntityActive);
    const scores = candidates.map((entity) => this.score(
      root,
      entity,
      snapshot.serverTick,
      previousTick,
      horizon,
      exitHorizon
    )).filter((candidate): candidate is CandidateScore => Boolean(candidate));
    scores.sort(compareCandidates);
    const scoresByKey = new Map(scores.map((score) => [score.key, score]));

    const members: InteractionIslandMember[] = [{
      entity: root,
      weight: interactionEntityWeight(root),
      reason: 'root',
      timeToContactMs: 0
    }];
    const selected = new Set([interactionStableKey(root)]);
    const overflow = new Map<string, number>();
    let weightedPoints = members[0].weight;
    let closureCount = 0;

    const add = (
      candidate: CandidateScore,
      reason: InteractionIslandMemberReason = candidate.reason
    ): boolean => {
      if (selected.has(candidate.key)) return true;
      if (weightedPoints + candidate.weight > budget) {
        overflow.set(candidate.key, candidate.weight);
        return false;
      }
      selected.add(candidate.key);
      overflow.delete(candidate.key);
      weightedPoints += candidate.weight;
      members.push({
        entity: candidate.entity,
        weight: candidate.weight,
        reason,
        timeToContactMs: roundedMilliseconds(candidate.timeToContact)
      });
      return true;
    };

    for (const candidate of scores) {
      if (selected.has(candidate.key)) continue;
      if (!add(candidate)) continue;
      const closure = candidates.filter((entity) => {
        const key = interactionStableKey(entity);
        return !selected.has(key) &&
        key !== candidate.key &&
        interactionShapesOverlap(
          interactionContactShape(candidate.entity),
          interactionContactShape(entity),
          INTERACTION_CONTACT_SLOP
        );
      }).map((entity) => (
        scoresByKey.get(interactionStableKey(entity)) ??
        this.closureScore(root, entity, previousTick)
      )).sort(compareClosureCandidates);
      for (const peer of closure) {
        this.noteContact(peer, snapshot.serverTick);
        if (add(peer, 'contact-closure')) closureCount++;
      }
    }

    for (const score of scores) {
      if (!selected.has(score.key)) overflow.set(score.key, score.weight);
    }
    for (const member of members) {
      const key = interactionStableKey(member.entity);
      const track = this.trackFor(member.entity);
      track.lastSelectedTick = snapshot.serverTick;
      if (member.reason === 'current-contact' || member.reason === 'contact-closure') {
        track.lastContactTick = snapshot.serverTick;
      }
      this.tracks.set(key, track);
    }
    this.pruneTracks(snapshot.serverTick, new Set(snapshot.entities.map(interactionStableKey)));
    this.lastServerTick = Math.max(this.lastServerTick, snapshot.serverTick);
    this.latestSelection = Object.freeze({
      serverTick: snapshot.serverTick,
      rootId: root.id,
      members: Object.freeze(members),
      memberIds: Object.freeze(members.map(({entity}) => entity.id)),
      weightedPoints,
      budget,
      overflowIds: Object.freeze([...overflow.keys()].sort()),
      overflowPoints: [...overflow.values()].reduce((sum, weight) => sum + weight, 0),
      candidateCount: candidates.length,
      currentContactCount: scores.filter(({currentContact}) => currentContact).length,
      retainedContactCount: scores.filter(({retainedContact}) => retainedContact).length,
      closureCount,
      horizonMs: roundedMilliseconds(horizon),
      exitHorizonMs: roundedMilliseconds(exitHorizon)
    });
    return this.latestSelection;
  }

  latest(): InteractionIslandSelection | undefined {
    return this.latestSelection;
  }

  reset(): void {
    this.tracks.clear();
    this.lastServerTick = -1;
    this.latestSelection = undefined;
  }

  private score(
    root: InteractionEntityState,
    entity: InteractionEntityState,
    serverTick: number,
    previousTick: number,
    horizon: number,
    exitHorizon: number
  ): CandidateScore | undefined {
    const key = interactionStableKey(entity);
    const track = this.compatibleTrack(entity);
    const previousMember = Boolean(track && track.lastSelectedTick === previousTick);
    const currentContact = interactionShapesOverlap(
      interactionContactShape(root),
      interactionContactShape(entity),
      INTERACTION_CONTACT_SLOP
    );
    if (currentContact) this.noteContactEntity(entity, serverTick);
    const retainedContact = !currentContact && Boolean(
      track && serverTick - track.lastContactTick <= INTERACTION_CONTACT_RETENTION_TICKS
    );
    const maximumHorizon = previousMember ? exitHorizon : horizon;
    const timeToContact = currentContact
      ? 0
      : sweptCircleTimeToContact(
        interactionMotionCircle(root),
        interactionMotionCircle(entity),
        maximumHorizon,
        INTERACTION_TTC_MARGIN
      );
    if (!currentContact && !retainedContact && timeToContact === undefined) return undefined;
    const contactTime = timeToContact ?? maximumHorizon;
    const adjustedTimeToContact = Math.max(
      0,
      contactTime - (previousMember ? INTERACTION_MEMBERSHIP_TTC_BONUS_SECONDS : 0)
    );
    return {
      entity,
      key,
      weight: interactionEntityWeight(entity),
      currentContact,
      retainedContact,
      previousMember,
      timeToContact: contactTime,
      adjustedTimeToContact,
      gameplayPriority: interactionGameplayPriority(entity, root),
      reason: currentContact
        ? 'current-contact'
        : retainedContact
          ? 'contact-retained'
          : previousMember && contactTime > horizon
            ? 'exit-hysteresis'
            : 'imminent-contact'
    };
  }

  private compatibleTrack(entity: InteractionEntityState): MembershipTrack | undefined {
    const track = this.tracks.get(interactionStableKey(entity));
    return track?.lifecycleRevision === entity.lifecycleRevision &&
      track.colliderRevision === entity.colliderRevision
      ? track
      : undefined;
  }

  private closureScore(
    root: InteractionEntityState,
    entity: InteractionEntityState,
    previousTick: number
  ): CandidateScore {
    const key = interactionStableKey(entity);
    const track = this.compatibleTrack(entity);
    return {
      entity,
      key,
      weight: interactionEntityWeight(entity),
      currentContact: false,
      retainedContact: false,
      previousMember: Boolean(track && track.lastSelectedTick === previousTick),
      timeToContact: 0,
      adjustedTimeToContact: 0,
      gameplayPriority: interactionGameplayPriority(entity, root),
      reason: 'imminent-contact'
    };
  }

  private trackFor(entity: InteractionEntityState): MembershipTrack {
    return this.compatibleTrack(entity) ?? {
      lifecycleRevision: entity.lifecycleRevision,
      colliderRevision: entity.colliderRevision,
      lastSelectedTick: -1,
      lastContactTick: Number.NEGATIVE_INFINITY
    };
  }

  private noteContact(candidate: CandidateScore, serverTick: number): void {
    this.noteContactEntity(candidate.entity, serverTick);
  }

  private noteContactEntity(entity: InteractionEntityState, serverTick: number): void {
    const track = this.trackFor(entity);
    track.lastContactTick = serverTick;
    this.tracks.set(interactionStableKey(entity), track);
  }

  private pruneTracks(serverTick: number, present: ReadonlySet<string>): void {
    for (const [key, track] of this.tracks) {
      const recentTick = Math.max(track.lastSelectedTick, track.lastContactTick);
      if (!present.has(key) || serverTick - recentTick > INTERACTION_CONTACT_RETENTION_TICKS + 1) {
        this.tracks.delete(key);
      }
    }
  }
}

function compareCandidates(left: CandidateScore, right: CandidateScore): number {
  return contactRank(left) - contactRank(right) ||
    left.adjustedTimeToContact - right.adjustedTimeToContact ||
    left.gameplayPriority - right.gameplayPriority ||
    left.key.localeCompare(right.key);
}

function contactRank(candidate: CandidateScore): number {
  if (candidate.currentContact) return 0;
  if (candidate.retainedContact) return 1;
  return 2;
}

function compareClosureCandidates(left: CandidateScore, right: CandidateScore): number {
  return left.gameplayPriority - right.gameplayPriority ||
    left.weight - right.weight ||
    left.key.localeCompare(right.key);
}

function roundedMilliseconds(seconds: number): number {
  return Math.round(seconds * 1000 * 10) / 10;
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Interaction island budget must be a positive safe integer.');
  }
  return value;
}
