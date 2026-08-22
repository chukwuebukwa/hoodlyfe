import {
  boundedId,
  boundedString,
  finiteInRange,
  normalizeAngle,
  objectRecord,
  safeNonnegativeInteger,
  safePositiveInteger
} from './protocol-validation.ts';
import {SIMULATION_STEP_MS} from '../simulation/timing.ts';

export const INTERACTION_SNAPSHOT_MESSAGE = 'simulation.interaction.snapshot';
export const INTERACTION_PROTOCOL_VERSION = 7;
export const DEFAULT_INTERACTION_HISTORY_MS = 800;
export const DEFAULT_INTERACTION_HISTORY_TICKS = Math.ceil(
  DEFAULT_INTERACTION_HISTORY_MS / SIMULATION_STEP_MS
);
export const MAX_INTERACTION_BODIES = 64;

const MAX_BODY_KEY_LENGTH = 128;
const MAX_SHAPE_KEY_LENGTH = 128;
const MAX_SPACE_KEY_LENGTH = 128;
const MAX_ABSOLUTE_POSITION = 1_000_000;
const MAX_ABSOLUTE_VELOCITY = 100_000;

export type InteractionActorType = 'vehicle' | 'player' | 'pedestrian' | 'prop';
export type InteractionRootMode = 'on-foot' | 'driver';
export type InteractionPhysicalPriority = 'player-controlled' | 'mission-critical' | 'ambient';

export interface InteractionBodyState {
  readonly key: string;
  readonly actorType: InteractionActorType;
  readonly entityId: string;
  readonly spaceId: string;
  readonly surfaceId: string;
  readonly shapeKey: string;
  readonly shapeRevision: number;
  readonly lifecycleRevision: number;
  readonly priority: InteractionPhysicalPriority;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly linvelX: number;
  readonly linvelY: number;
  readonly angvel: number;
}

export interface InteractionIntentState {
  readonly bodyKey: string;
  readonly appliedAtServerTick: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly steering: number;
  readonly throttle: number;
  readonly handbrake: boolean;
  readonly movementScale: number;
}

export interface InteractionContactPair {
  readonly firstBodyKey: string;
  readonly secondBodyKey: string;
}

export interface InteractionSnapshot {
  readonly protocolVersion: number;
  readonly serverTick: number;
  readonly baselineTick: number;
  readonly serverTimeMs: number;
  readonly worldCollisionRevision: number;
  readonly streamRevision: number;
  readonly surfaceRevision: number;
  readonly controlRevision: number;
  readonly rootLifecycleRevision: number;
  readonly rootBodyKey: string;
  readonly rootMode: InteractionRootMode;
  readonly acknowledgedLocalInputSequence: number;
  readonly confirmedEventsThrough: number;
  readonly bodies: readonly InteractionBodyState[];
  readonly intents: readonly InteractionIntentState[];
  readonly contacts: readonly InteractionContactPair[];
}

export interface InteractionSnapshotValidationContext {
  readonly currentServerTick: number;
  readonly expectedWorldCollisionRevision: number;
  readonly expectedStreamRevision?: number;
  readonly expectedSurfaceRevision?: number;
  readonly expectedControlRevision?: number;
  readonly expectedRootBodyKey?: string;
  readonly maximumHistoryTicks?: number;
  readonly maximumFutureTicks?: number;
  readonly maximumBodies?: number;
}

export type InteractionSnapshotRejection =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'invalid-server-tick'
  | 'stale-snapshot'
  | 'future-snapshot'
  | 'invalid-revision'
  | 'collision-revision-mismatch'
  | 'stream-revision-mismatch'
  | 'surface-revision-mismatch'
  | 'control-revision-mismatch'
  | 'invalid-root'
  | 'capacity-exceeded'
  | 'invalid-body'
  | 'duplicate-body'
  | 'mixed-space-baseline'
  | 'mixed-surface-baseline'
  | 'invalid-intent'
  | 'duplicate-intent'
  | 'missing-intent-body'
  | 'invalid-contact'
  | 'duplicate-contact'
  | 'missing-contact-body';

export type InteractionSnapshotValidation =
  | {readonly accepted: true; readonly value: InteractionSnapshot}
  | {readonly accepted: false; readonly reason: InteractionSnapshotRejection};

export function validateInteractionSnapshot(
  message: unknown,
  context: InteractionSnapshotValidationContext
): InteractionSnapshotValidation {
  const record = objectRecord(message);
  if (!record) return rejected('invalid-shape');
  if (record.protocolVersion !== INTERACTION_PROTOCOL_VERSION) {
    return rejected('unsupported-version');
  }
  const serverTick = safeNonnegativeInteger(record.serverTick);
  const baselineTick = safeNonnegativeInteger(record.baselineTick);
  if (serverTick === undefined || baselineTick === undefined || baselineTick > serverTick) {
    return rejected('invalid-server-tick');
  }
  const maximumHistoryTicks = context.maximumHistoryTicks ?? DEFAULT_INTERACTION_HISTORY_TICKS;
  if (baselineTick < context.currentServerTick - maximumHistoryTicks) {
    return rejected('stale-snapshot');
  }
  if (serverTick > context.currentServerTick + (context.maximumFutureTicks ?? 1)) {
    return rejected('future-snapshot');
  }

  const serverTimeMs = finiteInRange(record.serverTimeMs, 0, Number.MAX_SAFE_INTEGER);
  const worldCollisionRevision = safePositiveInteger(record.worldCollisionRevision);
  const streamRevision = safePositiveInteger(record.streamRevision);
  const surfaceRevision = safePositiveInteger(record.surfaceRevision);
  const controlRevision = safePositiveInteger(record.controlRevision);
  const rootLifecycleRevision = safePositiveInteger(record.rootLifecycleRevision);
  const acknowledgedLocalInputSequence = safeNonnegativeInteger(
    record.acknowledgedLocalInputSequence
  );
  const confirmedEventsThrough = safeNonnegativeInteger(record.confirmedEventsThrough);
  if (
    serverTimeMs === undefined || worldCollisionRevision === undefined ||
    streamRevision === undefined || surfaceRevision === undefined ||
    controlRevision === undefined || rootLifecycleRevision === undefined ||
    acknowledgedLocalInputSequence === undefined || confirmedEventsThrough === undefined ||
    confirmedEventsThrough > serverTick
  ) return rejected('invalid-revision');
  if (worldCollisionRevision !== context.expectedWorldCollisionRevision) {
    return rejected('collision-revision-mismatch');
  }
  if (
    context.expectedStreamRevision !== undefined &&
    streamRevision !== context.expectedStreamRevision
  ) return rejected('stream-revision-mismatch');
  if (
    context.expectedSurfaceRevision !== undefined &&
    surfaceRevision !== context.expectedSurfaceRevision
  ) return rejected('surface-revision-mismatch');
  if (
    context.expectedControlRevision !== undefined &&
    controlRevision !== context.expectedControlRevision
  ) return rejected('control-revision-mismatch');

  const rootBodyKey = boundedString(record.rootBodyKey, MAX_BODY_KEY_LENGTH);
  const rootMode = enumValue(record.rootMode, ['on-foot', 'driver'] as const);
  if (!rootBodyKey || !rootMode) return rejected('invalid-root');
  if (context.expectedRootBodyKey !== undefined && rootBodyKey !== context.expectedRootBodyKey) {
    return rejected('invalid-root');
  }
  if (!Array.isArray(record.bodies) || !Array.isArray(record.intents) || !Array.isArray(record.contacts)) {
    return rejected('invalid-shape');
  }
  if (record.bodies.length === 0 || record.bodies.length > (context.maximumBodies ?? MAX_INTERACTION_BODIES)) {
    return rejected('capacity-exceeded');
  }

  const bodies: InteractionBodyState[] = [];
  const bodyKeys = new Set<string>();
  let baselineSpaceId: string | undefined;
  let baselineSurfaceId: string | undefined;
  for (const candidate of record.bodies) {
    const body = parseBody(candidate);
    if (!body) return rejected('invalid-body');
    if (bodyKeys.has(body.key)) return rejected('duplicate-body');
    if (baselineSpaceId === undefined) {
      baselineSpaceId = body.spaceId;
      baselineSurfaceId = body.surfaceId;
    } else if (body.spaceId !== baselineSpaceId) {
      return rejected('mixed-space-baseline');
    } else if (body.surfaceId !== baselineSurfaceId) {
      return rejected('mixed-surface-baseline');
    }
    bodyKeys.add(body.key);
    bodies.push(body);
  }
  const root = bodies.find(({key}) => key === rootBodyKey);
  if (!root || root.lifecycleRevision !== rootLifecycleRevision) return rejected('invalid-root');
  if (
    (rootMode === 'driver' && root.actorType !== 'vehicle') ||
    (rootMode === 'on-foot' && root.actorType !== 'player')
  ) return rejected('invalid-root');

  const intents: InteractionIntentState[] = [];
  const intentKeys = new Set<string>();
  for (const candidate of record.intents) {
    const intent = parseIntent(candidate, serverTick, maximumHistoryTicks);
    if (!intent) return rejected('invalid-intent');
    if (intentKeys.has(intent.bodyKey)) return rejected('duplicate-intent');
    if (!bodyKeys.has(intent.bodyKey)) return rejected('missing-intent-body');
    intentKeys.add(intent.bodyKey);
    intents.push(intent);
  }

  const contacts: InteractionContactPair[] = [];
  const contactKeys = new Set<string>();
  for (const candidate of record.contacts) {
    const contact = parseContact(candidate);
    if (!contact) return rejected('invalid-contact');
    if (!bodyKeys.has(contact.firstBodyKey) || !bodyKeys.has(contact.secondBodyKey)) {
      return rejected('missing-contact-body');
    }
    const key = `${contact.firstBodyKey}\u0000${contact.secondBodyKey}`;
    if (contactKeys.has(key)) return rejected('duplicate-contact');
    contactKeys.add(key);
    contacts.push(contact);
  }

  return accepted(Object.freeze({
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    baselineTick,
    serverTimeMs,
    worldCollisionRevision,
    streamRevision,
    surfaceRevision,
    controlRevision,
    rootLifecycleRevision,
    rootBodyKey,
    rootMode,
    acknowledgedLocalInputSequence,
    confirmedEventsThrough,
    bodies: Object.freeze(bodies),
    intents: Object.freeze(intents),
    contacts: Object.freeze(contacts)
  }));
}

function parseBody(value: unknown): InteractionBodyState | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const key = boundedString(record.key, MAX_BODY_KEY_LENGTH);
  const actorType = enumValue(record.actorType, ['vehicle', 'player', 'pedestrian', 'prop'] as const);
  const entityId = boundedId(record.entityId);
  const spaceId = boundedString(record.spaceId, MAX_SPACE_KEY_LENGTH);
  const surfaceId = boundedString(record.surfaceId, MAX_SPACE_KEY_LENGTH);
  const shapeKey = boundedString(record.shapeKey, MAX_SHAPE_KEY_LENGTH);
  const shapeRevision = safePositiveInteger(record.shapeRevision);
  const lifecycleRevision = safePositiveInteger(record.lifecycleRevision);
  const priority = enumValue(
    record.priority,
    ['player-controlled', 'mission-critical', 'ambient'] as const
  );
  const x = finiteInRange(record.x, -MAX_ABSOLUTE_POSITION, MAX_ABSOLUTE_POSITION);
  const y = finiteInRange(record.y, -MAX_ABSOLUTE_POSITION, MAX_ABSOLUTE_POSITION);
  const rotation = finiteInRange(record.rotation, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const linvelX = finiteInRange(record.linvelX, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY);
  const linvelY = finiteInRange(record.linvelY, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY);
  const angvel = finiteInRange(record.angvel, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY);
  if (
    !key || !actorType || !entityId || !spaceId || !surfaceId || !shapeKey ||
    shapeRevision === undefined || lifecycleRevision === undefined || !priority ||
    x === undefined || y === undefined || rotation === undefined || linvelX === undefined ||
    linvelY === undefined || angvel === undefined
  ) return undefined;
  return Object.freeze({
    key,
    actorType,
    entityId,
    spaceId,
    surfaceId,
    shapeKey,
    shapeRevision,
    lifecycleRevision,
    priority,
    x,
    y,
    rotation: normalizeAngle(rotation),
    linvelX,
    linvelY,
    angvel
  });
}

function parseIntent(
  value: unknown,
  serverTick: number,
  maximumHistoryTicks: number
): InteractionIntentState | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const bodyKey = boundedString(record.bodyKey, MAX_BODY_KEY_LENGTH);
  const appliedAtServerTick = safeNonnegativeInteger(record.appliedAtServerTick);
  const moveX = finiteInRange(record.moveX, -1, 1);
  const moveY = finiteInRange(record.moveY, -1, 1);
  const steering = finiteInRange(record.steering, -1, 1);
  const throttle = finiteInRange(record.throttle, -1, 1);
  const movementScale = finiteInRange(record.movementScale, 0, 2);
  if (
    !bodyKey || appliedAtServerTick === undefined || moveX === undefined || moveY === undefined ||
    steering === undefined || throttle === undefined || movementScale === undefined ||
    typeof record.handbrake !== 'boolean' || appliedAtServerTick > serverTick ||
    appliedAtServerTick < serverTick - maximumHistoryTicks
  ) return undefined;
  return Object.freeze({
    bodyKey,
    appliedAtServerTick,
    moveX,
    moveY,
    steering,
    throttle,
    handbrake: record.handbrake,
    movementScale
  });
}

function parseContact(value: unknown): InteractionContactPair | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const first = boundedString(record.firstBodyKey, MAX_BODY_KEY_LENGTH);
  const second = boundedString(record.secondBodyKey, MAX_BODY_KEY_LENGTH);
  if (!first || !second || first >= second) return undefined;
  return Object.freeze({firstBodyKey: first, secondBodyKey: second});
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T
): T[number] | undefined {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : undefined;
}

function accepted(value: InteractionSnapshot): InteractionSnapshotValidation {
  return {accepted: true, value};
}

function rejected(reason: InteractionSnapshotRejection): InteractionSnapshotValidation {
  return {accepted: false, reason};
}
