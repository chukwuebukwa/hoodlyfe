import type {
  InteractionActorType,
  InteractionBodyState,
  InteractionSnapshot
} from '../../../shared/protocol/interaction-islands.ts';

export const DESKTOP_INTERACTION_ISLAND_BUDGET = 32;
export const MOBILE_INTERACTION_ISLAND_BUDGET = 20;
export const INTERACTION_CONTACT_RETENTION_TICKS = 6;

export type InteractionMemberReason =
  | 'root'
  | 'current-contact'
  | 'contact-retained'
  | 'server-ranked';

export interface InteractionIslandMember {
  readonly body: InteractionBodyState;
  readonly points: number;
  readonly reason: InteractionMemberReason;
}

export interface InteractionIslandSelection {
  readonly serverTick: number;
  readonly rootBodyKey: string;
  readonly members: readonly InteractionIslandMember[];
  readonly bodyKeys: readonly string[];
  readonly weightedPoints: number;
  readonly budgetPoints: number;
  readonly overflowBodyKeys: readonly string[];
  readonly resetCount: number;
}

interface MembershipTrack {
  readonly lifecycleRevision: number;
  readonly shapeRevision: number;
  lastContactTick: number;
}

export class InteractionIslandSelector {
  private readonly tracks = new Map<string, MembershipTrack>();
  private latestSelection?: InteractionIslandSelection;
  private lastTick = -1;
  private authoritySignature = '';
  private resetCount = 0;

  constructor(private readonly budgetPoints: number) {
    if (!Number.isSafeInteger(budgetPoints) || budgetPoints <= 0) {
      throw new RangeError('Interaction island budget must be a positive integer.');
    }
  }

  select(snapshot: InteractionSnapshot): InteractionIslandSelection | undefined {
    if (snapshot.serverTick < this.lastTick) return this.latestSelection;
    const root = snapshot.bodies.find(({key}) => key === snapshot.rootBodyKey);
    if (!root) return undefined;
    const signature = authoritySignature(snapshot);
    if (this.authoritySignature && signature !== this.authoritySignature) this.resetTracking();
    this.authoritySignature = signature;

    const contactKeys = rootContacts(snapshot, root.key);
    for (const key of contactKeys) {
      const body = snapshot.bodies.find((candidate) => candidate.key === key);
      if (body) this.track(body, snapshot.serverTick);
    }

    const ranked = snapshot.bodies.filter(({key}) => key !== root.key).map((body, index) => ({
      body,
      index,
      reason: this.reasonFor(body, contactKeys, snapshot.serverTick)
    })).sort((left, right) => {
      const reason = reasonRank(left.reason) - reasonRank(right.reason);
      return reason || left.index - right.index || left.body.key.localeCompare(right.body.key);
    });

    const members: InteractionIslandMember[] = [{
      body: root,
      points: bodyWeight(root.actorType),
      reason: 'root'
    }];
    let weightedPoints = members[0].points;
    const overflowBodyKeys: string[] = [];
    for (const candidate of ranked) {
      const points = bodyWeight(candidate.body.actorType);
      if (weightedPoints + points > this.budgetPoints) {
        overflowBodyKeys.push(candidate.body.key);
        continue;
      }
      members.push({body: candidate.body, points, reason: candidate.reason});
      weightedPoints += points;
    }
    this.prune(snapshot);
    this.lastTick = snapshot.serverTick;
    this.latestSelection = Object.freeze({
      serverTick: snapshot.serverTick,
      rootBodyKey: root.key,
      members: Object.freeze(members.map((member) => Object.freeze(member))),
      bodyKeys: Object.freeze(members.map(({body}) => body.key)),
      weightedPoints,
      budgetPoints: this.budgetPoints,
      overflowBodyKeys: Object.freeze(overflowBodyKeys),
      resetCount: this.resetCount
    });
    return this.latestSelection;
  }

  latest(): InteractionIslandSelection | undefined {
    return this.latestSelection;
  }

  reset(): void {
    this.resetTracking();
    this.authoritySignature = '';
    this.lastTick = -1;
    this.latestSelection = undefined;
  }

  private reasonFor(
    body: InteractionBodyState,
    contacts: ReadonlySet<string>,
    serverTick: number
  ): Exclude<InteractionMemberReason, 'root'> {
    if (contacts.has(body.key)) return 'current-contact';
    const track = this.compatibleTrack(body);
    if (track && serverTick - track.lastContactTick <= INTERACTION_CONTACT_RETENTION_TICKS) {
      return 'contact-retained';
    }
    return 'server-ranked';
  }

  private track(body: InteractionBodyState, tick: number): void {
    const track = this.compatibleTrack(body) ?? {
      lifecycleRevision: body.lifecycleRevision,
      shapeRevision: body.shapeRevision,
      lastContactTick: tick
    };
    track.lastContactTick = tick;
    this.tracks.set(body.key, track);
  }

  private compatibleTrack(body: InteractionBodyState): MembershipTrack | undefined {
    const track = this.tracks.get(body.key);
    return track?.lifecycleRevision === body.lifecycleRevision &&
      track.shapeRevision === body.shapeRevision ? track : undefined;
  }

  private prune(snapshot: InteractionSnapshot): void {
    const present = new Set(snapshot.bodies.map(({key}) => key));
    for (const [key, track] of this.tracks) {
      if (!present.has(key) || snapshot.serverTick - track.lastContactTick > INTERACTION_CONTACT_RETENTION_TICKS) {
        this.tracks.delete(key);
      }
    }
  }

  private resetTracking(): void {
    this.tracks.clear();
    this.resetCount++;
  }
}

function authoritySignature(snapshot: InteractionSnapshot): string {
  return [
    snapshot.rootBodyKey,
    snapshot.rootLifecycleRevision,
    snapshot.controlRevision,
    snapshot.streamRevision,
    snapshot.surfaceRevision,
    snapshot.worldCollisionRevision
  ].join(':');
}

function rootContacts(snapshot: InteractionSnapshot, rootKey: string): Set<string> {
  const contacts = new Set<string>();
  for (const pair of snapshot.contacts) {
    if (pair.firstBodyKey === rootKey) contacts.add(pair.secondBodyKey);
    else if (pair.secondBodyKey === rootKey) contacts.add(pair.firstBodyKey);
  }
  return contacts;
}

function reasonRank(reason: Exclude<InteractionMemberReason, 'root'>): number {
  if (reason === 'current-contact') return 0;
  if (reason === 'contact-retained') return 1;
  return 2;
}

function bodyWeight(actorType: InteractionActorType): number {
  if (actorType === 'vehicle') return 4;
  if (actorType === 'prop') return 2;
  return 1;
}
