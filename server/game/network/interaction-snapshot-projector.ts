import type {DistrictState} from '../../state.ts';
import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  INTERACTION_PROTOCOL_VERSION,
  MAX_INTERACTION_BODIES,
  type InteractionBodyState,
  type InteractionContactPair,
  type InteractionIntentState,
  type InteractionPhysicalPriority,
  type InteractionRootMode,
  type InteractionSnapshot
} from '../../../shared/protocol/interaction-islands.ts';
import {validateInteractionSnapshot} from '../../../shared/protocol/interaction-islands.ts';
import type {
  InteractionPhysicsFrame
} from '../vehicles/vehicle-simulation-controller.ts';

export const INTERACTION_SERVER_BUDGET_POINTS = 32;
export const INTERACTION_HORIZON_SECONDS = 0.65;

export interface InteractionAppliedIntent {
  inputX: number;
  inputY: number;
  sequence: number;
  handbrake?: boolean;
}

interface InteractionClock {
  tick: number;
  nowMs: number;
}

export interface InteractionSnapshotProjectorOptions {
  state: DistrictState;
  clock: () => InteractionClock;
  physicsFrame: () => InteractionPhysicsFrame;
  worldCollisionRevision: number;
  playerIntentFor?: (playerId: string) => InteractionAppliedIntent | undefined;
  vehicleIntentFor?: (playerId: string, vehicleId: string) => InteractionAppliedIntent | undefined;
  priorityFor?: (bodyKey: string) => InteractionPhysicalPriority | undefined;
  streamRevisionFor?: (playerId: string) => number;
  surfaceRevisionFor?: (playerId: string) => number;
  publish?: (playerId: string, snapshot: InteractionSnapshot) => void;
  historyTicks?: number;
  budgetPoints?: number;
}

interface ControlTrack {
  signature: string;
  revision: number;
  lastSeenTick: number;
}

export class InteractionSnapshotProjector {
  private readonly histories = new Map<string, InteractionSnapshot[]>();
  private readonly controls = new Map<string, ControlTrack>();
  private readonly historyTicks: number;
  private readonly budgetPoints: number;

  constructor(private readonly options: InteractionSnapshotProjectorOptions) {
    this.historyTicks = positiveInteger(
      options.historyTicks ?? DEFAULT_INTERACTION_HISTORY_TICKS,
      'Interaction history ticks'
    );
    this.budgetPoints = positiveInteger(
      options.budgetPoints ?? INTERACTION_SERVER_BUDGET_POINTS,
      'Interaction body budget'
    );
    if (this.budgetPoints > MAX_INTERACTION_BODIES * bodyWeight('player')) {
      throw new RangeError('Interaction body budget exceeds protocol capacity.');
    }
  }

  publishCurrent(playerIds: Iterable<string>, confirmedEventsThrough?: number): number {
    if (!this.options.publish) return 0;
    let published = 0;
    for (const playerId of playerIds) {
      const snapshot = this.project(playerId, confirmedEventsThrough);
      if (!snapshot) continue;
      this.options.publish(playerId, snapshot);
      published++;
    }
    return published;
  }

  project(playerId: string, confirmedEventsThrough?: number): InteractionSnapshot | undefined {
    const clock = this.options.clock();
    if (!validClock(clock)) return undefined;
    const frame = this.options.physicsFrame();
    const byKey = new Map(frame.bodies.map((body) => [body.key, body]));
    const root = this.rootFor(playerId, byKey);
    if (!root) return undefined;
    const selected = this.selectBodies(root.body, frame, byKey);
    const selectedKeys = new Set(selected.map(({key}) => key));
    const contacts = deduplicateContacts(frame.contacts
      .map(canonicalContact)
      .filter(({firstBodyKey, secondBodyKey}) => (
        selectedKeys.has(firstBodyKey) && selectedKeys.has(secondBodyKey)
      )));
    const controlRevision = this.controlRevision(playerId, root.body.key, root.mode, clock.tick);
    const snapshot = {
      protocolVersion: INTERACTION_PROTOCOL_VERSION,
      serverTick: clock.tick,
      baselineTick: clock.tick,
      serverTimeMs: clock.nowMs,
      worldCollisionRevision: this.options.worldCollisionRevision,
      streamRevision: positiveRevision(this.options.streamRevisionFor?.(playerId)),
      surfaceRevision: positiveRevision(this.options.surfaceRevisionFor?.(playerId)),
      controlRevision,
      rootLifecycleRevision: root.body.lifecycleRevision,
      rootBodyKey: root.body.key,
      rootMode: root.mode,
      acknowledgedLocalInputSequence: root.acknowledgedSequence,
      confirmedEventsThrough: Math.min(
        clock.tick,
        nonnegativeInteger(confirmedEventsThrough ?? clock.tick)
      ),
      bodies: selected.map((body) => this.projectBody(body)),
      intents: selected.map((body) => this.intentFor(body, clock.tick))
        .filter((intent): intent is InteractionIntentState => Boolean(intent)),
      contacts
    } satisfies InteractionSnapshot;
    const validated = validateInteractionSnapshot(snapshot, {
      currentServerTick: clock.tick,
      expectedWorldCollisionRevision: this.options.worldCollisionRevision,
      expectedStreamRevision: snapshot.streamRevision,
      expectedSurfaceRevision: snapshot.surfaceRevision,
      expectedControlRevision: controlRevision,
      expectedRootBodyKey: root.body.key,
      maximumHistoryTicks: this.historyTicks,
      maximumBodies: MAX_INTERACTION_BODIES
    });
    if (!validated.accepted) return undefined;
    this.pin(playerId, validated.value);
    return validated.value;
  }

  snapshotAt(playerId: string, tick: number): InteractionSnapshot | undefined {
    return this.histories.get(playerId)?.find((snapshot) => snapshot.serverTick === tick);
  }

  historyFor(playerId: string): readonly InteractionSnapshot[] {
    return Object.freeze([...(this.histories.get(playerId) ?? [])]);
  }

  clearPlayer(playerId: string): void {
    this.histories.delete(playerId);
    this.controls.delete(playerId);
  }

  private rootFor(
    playerId: string,
    bodies: ReadonlyMap<string, InteractionPhysicsFrame['bodies'][number]>
  ): {body: InteractionPhysicsFrame['bodies'][number]; mode: InteractionRootMode; acknowledgedSequence: number} | undefined {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || player.airborne || (player.spaceId || 'street') !== 'street') {
      return undefined;
    }
    if (!player.vehicleId) {
      const body = bodies.get(`player:${playerId}`);
      return body ? {body, mode: 'on-foot', acknowledgedSequence: player.lastInputSequence} : undefined;
    }
    if (player.vehicleSeat !== 0) return undefined;
    const body = bodies.get(`vehicle:${player.vehicleId}`);
    return body ? {
      body,
      mode: 'driver',
      acknowledgedSequence: player.lastVehicleInputSequence
    } : undefined;
  }

  private selectBodies(
    root: InteractionPhysicsFrame['bodies'][number],
    frame: InteractionPhysicsFrame,
    byKey: ReadonlyMap<string, InteractionPhysicsFrame['bodies'][number]>
  ): InteractionPhysicsFrame['bodies'][number][] {
    const touching = new Set<string>();
    for (const contact of frame.contacts) {
      if (contact.firstBodyKey === root.key) touching.add(contact.secondBodyKey);
      if (contact.secondBodyKey === root.key) touching.add(contact.firstBodyKey);
    }
    const candidates = frame.bodies.filter((body) => (
      body.key !== root.key && body.surfaceId === root.surfaceId
    )).map((body) => ({
      body,
      touching: touching.has(body.key),
      timeToContact: touching.has(body.key) ? 0 : timeToContact(root, body),
      distance: Math.hypot(body.x - root.x, body.y - root.y),
      priority: priorityOrder(this.priorityFor(body))
    })).sort((left, right) => (
      Number(right.touching) - Number(left.touching) ||
      Number(!Number.isFinite(left.timeToContact)) - Number(!Number.isFinite(right.timeToContact)) ||
      left.timeToContact - right.timeToContact ||
      left.priority - right.priority ||
      left.distance - right.distance ||
      left.body.key.localeCompare(right.body.key)
    ));
    const selected = [root];
    let points = bodyWeight(root.actorType);
    for (const candidate of candidates) {
      const weight = bodyWeight(candidate.body.actorType);
      if (points + weight > this.budgetPoints || selected.length >= MAX_INTERACTION_BODIES) continue;
      selected.push(byKey.get(candidate.body.key) ?? candidate.body);
      points += weight;
    }
    return selected;
  }

  private projectBody(body: InteractionPhysicsFrame['bodies'][number]): InteractionBodyState {
    return Object.freeze({
      ...body,
      spaceId: 'street',
      priority: this.priorityFor(body)
    });
  }

  private priorityFor(body: InteractionPhysicsFrame['bodies'][number]): InteractionPhysicalPriority {
    if (body.actorType === 'player') return 'player-controlled';
    if (body.actorType === 'vehicle') {
      const vehicle = this.options.state.vehicles.get(body.entityId);
      if (vehicle?.driverId && this.options.state.players.has(vehicle.driverId)) {
        return 'player-controlled';
      }
    }
    return this.options.priorityFor?.(body.key) ?? 'ambient';
  }

  private intentFor(
    body: InteractionPhysicsFrame['bodies'][number],
    tick: number
  ): InteractionIntentState | undefined {
    if (body.actorType === 'player') {
      const intent = this.options.playerIntentFor?.(body.entityId);
      return intent ? interactionIntent(body.key, tick, intent.inputX, intent.inputY, 0, 0, false, 1) : undefined;
    }
    if (body.actorType === 'vehicle') {
      const vehicle = this.options.state.vehicles.get(body.entityId);
      const intent = vehicle?.driverId
        ? this.options.vehicleIntentFor?.(vehicle.driverId, vehicle.id)
        : undefined;
      return intent ? interactionIntent(
        body.key,
        tick,
        0,
        0,
        intent.inputX,
        -intent.inputY,
        Boolean(intent.handbrake),
        1
      ) : undefined;
    }
    const speed = Math.hypot(body.linvelX, body.linvelY);
    if (speed <= 0.001) return undefined;
    return interactionIntent(
      body.key,
      tick,
      body.linvelX / speed,
      body.linvelY / speed,
      0,
      0,
      false,
      Math.min(2, speed / 150)
    );
  }

  private controlRevision(playerId: string, rootKey: string, mode: InteractionRootMode, tick: number): number {
    const signature = `${rootKey}:${mode}`;
    const previous = this.controls.get(playerId);
    const changed = Boolean(previous && (
      previous.signature !== signature || previous.lastSeenTick < tick - 1
    ));
    const revision = previous ? previous.revision + Number(changed) : 1;
    this.controls.set(playerId, {signature, revision, lastSeenTick: tick});
    return revision;
  }

  private pin(playerId: string, snapshot: InteractionSnapshot): void {
    const history = this.histories.get(playerId) ?? [];
    if (history.at(-1)?.serverTick === snapshot.serverTick) history.pop();
    history.push(snapshot);
    const minimumTick = snapshot.serverTick - this.historyTicks + 1;
    while (history[0] && history[0].serverTick < minimumTick) history.shift();
    this.histories.set(playerId, history);
  }
}

function interactionIntent(
  bodyKey: string,
  tick: number,
  moveX: number,
  moveY: number,
  steering: number,
  throttle: number,
  handbrake: boolean,
  movementScale: number
): InteractionIntentState {
  return Object.freeze({
    bodyKey,
    appliedAtServerTick: tick,
    moveX: clamp(moveX, -1, 1),
    moveY: clamp(moveY, -1, 1),
    steering: clamp(steering, -1, 1),
    throttle: clamp(throttle, -1, 1),
    handbrake,
    movementScale: clamp(movementScale, 0, 2)
  });
}

function canonicalContact(contact: InteractionContactPair): InteractionContactPair {
  return contact.firstBodyKey < contact.secondBodyKey
    ? Object.freeze(contact)
    : Object.freeze({
      firstBodyKey: contact.secondBodyKey,
      secondBodyKey: contact.firstBodyKey
    });
}

function deduplicateContacts(contacts: readonly InteractionContactPair[]): InteractionContactPair[] {
  const unique = new Map<string, InteractionContactPair>();
  for (const contact of contacts) {
    unique.set(`${contact.firstBodyKey}\u0000${contact.secondBodyKey}`, contact);
  }
  return [...unique.values()].sort((left, right) => (
    left.firstBodyKey.localeCompare(right.firstBodyKey) ||
    left.secondBodyKey.localeCompare(right.secondBodyKey)
  ));
}

function timeToContact(
  root: InteractionPhysicsFrame['bodies'][number],
  body: InteractionPhysicsFrame['bodies'][number]
): number {
  const x = body.x - root.x;
  const y = body.y - root.y;
  const velocityX = body.linvelX - root.linvelX;
  const velocityY = body.linvelY - root.linvelY;
  const radius = bodyRadius(root.shapeKey) + bodyRadius(body.shapeKey) + 8;
  const a = velocityX * velocityX + velocityY * velocityY;
  const b = 2 * (x * velocityX + y * velocityY);
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  if (a <= 0.000001) return Number.POSITIVE_INFINITY;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return Number.POSITIVE_INFINITY;
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  return time >= 0 && time <= INTERACTION_HORIZON_SECONDS
    ? time
    : Number.POSITIVE_INFINITY;
}

function bodyRadius(shapeKey: string): number {
  if (shapeKey.startsWith('humanoid:') || shapeKey.startsWith('soccer-ball:')) {
    return Math.max(1, Number(shapeKey.slice(shapeKey.indexOf(':') + 1)) || 1);
  }
  return 42;
}

function bodyWeight(actorType: InteractionPhysicsFrame['bodies'][number]['actorType']): number {
  if (actorType === 'vehicle') return 4;
  if (actorType === 'prop') return 2;
  return 1;
}

function priorityOrder(priority: InteractionPhysicalPriority): number {
  if (priority === 'player-controlled') return 0;
  if (priority === 'mission-critical') return 1;
  return 2;
}

function validClock(clock: InteractionClock): boolean {
  return Number.isSafeInteger(clock.tick) && clock.tick >= 0 &&
    Number.isFinite(clock.nowMs) && clock.nowMs >= 0;
}

function positiveRevision(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 1;
}

function nonnegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be positive.`);
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}
