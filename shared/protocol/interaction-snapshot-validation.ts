import {isVehicleKind} from '../content/vehicle-catalog.ts';
import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  INTERACTION_PROTOCOL_VERSION,
  MAX_INTERACTION_ENTITIES,
  type InteractionEntityState,
  type InteractionSnapshot,
  type InteractionSnapshotValidationContext,
  type InteractionValidationResult,
  type KinematicInteractionState,
  type RemoteIntentState
} from './interaction-contracts.ts';
import {
  MAX_ABSOLUTE_POSITION,
  MAX_ABSOLUTE_VELOCITY,
  MAX_COLLIDER_SIZE,
  MAX_SPACE_ID_LENGTH,
  accepted,
  boundedId,
  boundedString,
  finiteInRange,
  normalizeAngle,
  objectRecord,
  oneOf,
  positiveFinite,
  rejected,
  safeNonnegativeInteger,
  safePositiveInteger
} from './interaction-validation.ts';

export function validateInteractionSnapshot(
  message: unknown,
  context: InteractionSnapshotValidationContext
): InteractionValidationResult<InteractionSnapshot> {
  const record = objectRecord(message);
  if (!record) return rejected('invalid-shape');
  if (record.protocolVersion !== INTERACTION_PROTOCOL_VERSION) {
    return rejected('unsupported-version');
  }
  const serverTick = safeNonnegativeInteger(record.serverTick);
  if (serverTick === undefined) return rejected('invalid-server-tick');
  const historyTicks = context.maximumHistoryTicks ?? DEFAULT_INTERACTION_HISTORY_TICKS;
  if (serverTick < context.currentServerTick - historyTicks) return rejected('stale-snapshot');
  if (serverTick > context.currentServerTick + (context.maximumFutureTicks ?? 1)) {
    return rejected('future-snapshot');
  }
  const serverTimeMs = finiteInRange(record.serverTimeMs, 0, Number.MAX_SAFE_INTEGER);
  const worldCollisionRevision = safePositiveInteger(record.worldCollisionRevision);
  const acknowledgedLocalInputSequence = safeNonnegativeInteger(
    record.acknowledgedLocalInputSequence
  );
  const confirmedEventsThrough = safeNonnegativeInteger(record.confirmedEventsThrough);
  if (serverTimeMs === undefined || acknowledgedLocalInputSequence === undefined) {
    return rejected('invalid-number');
  }
  if (confirmedEventsThrough === undefined || confirmedEventsThrough > serverTick) {
    return rejected('invalid-server-tick');
  }
  if (worldCollisionRevision !== context.expectedWorldCollisionRevision) {
    return rejected('collision-revision-mismatch');
  }
  if (!Array.isArray(record.entities) || !Array.isArray(record.remoteIntents)) {
    return rejected('invalid-shape');
  }
  if (record.entities.length > (context.maximumEntities ?? MAX_INTERACTION_ENTITIES)) {
    return rejected('capacity-exceeded');
  }
  const entities: InteractionEntityState[] = [];
  const entityIds = new Set<string>();
  let baselineSpace: string | undefined;
  let baselineLayer: string | undefined;
  for (const candidate of record.entities) {
    const entity = parseInteractionEntity(candidate);
    if (!entity) return rejected('invalid-entity');
    if (entityIds.has(entity.id)) return rejected('duplicate-entity');
    if (baselineSpace === undefined) {
      baselineSpace = entity.spaceId;
      baselineLayer = entity.layerId;
    } else if (entity.spaceId !== baselineSpace || entity.layerId !== baselineLayer) {
      return rejected('mixed-space-baseline');
    }
    entityIds.add(entity.id);
    entities.push(entity);
  }
  const remoteIntents: RemoteIntentState[] = [];
  const intentIds = new Set<string>();
  for (const candidate of record.remoteIntents) {
    const intent = parseRemoteIntent(candidate, serverTick, historyTicks);
    if (!intent) return rejected('invalid-intent');
    if (intentIds.has(intent.entityId)) return rejected('duplicate-intent');
    if (!entityIds.has(intent.entityId)) return rejected('missing-intent-entity');
    intentIds.add(intent.entityId);
    remoteIntents.push(intent);
  }
  return accepted(Object.freeze({
    protocolVersion: INTERACTION_PROTOCOL_VERSION,
    serverTick,
    serverTimeMs,
    worldCollisionRevision,
    acknowledgedLocalInputSequence,
    entities: Object.freeze(entities),
    remoteIntents: Object.freeze(remoteIntents),
    confirmedEventsThrough
  }));
}

function parseInteractionEntity(value: unknown): InteractionEntityState | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const common = parseKinematic(record);
  if (!common) return undefined;
  if (common.kind === 'player' || common.kind === 'pedestrian') {
    const radius = positiveFinite(record.radius, MAX_COLLIDER_SIZE);
    const movementMode = oneOf(record.movementMode, ['idle', 'walk', 'run', 'sprint', 'aim']);
    const actionPhase = oneOf(
      record.actionPhase,
      ['free', 'melee', 'reload', 'hit', 'knockdown', 'entering']
    );
    const actionTick = safeNonnegativeInteger(record.actionTick);
    const surfaceId = boundedString(record.surfaceId, MAX_SPACE_ID_LENGTH);
    if (
      radius === undefined || !movementMode || !actionPhase || actionTick === undefined ||
      !surfaceId || typeof record.alive !== 'boolean'
    ) return undefined;
    return Object.freeze({
      ...common,
      kind: common.kind,
      radius,
      movementMode,
      actionPhase,
      actionTick,
      surfaceId,
      alive: record.alive
    });
  }
  if (common.kind === 'vehicle') return parseVehicle(record, common);
  if (common.kind === 'prop') {
    const radius = positiveFinite(record.radius, MAX_COLLIDER_SIZE);
    const mass = positiveFinite(record.mass, 1_000_000);
    if (radius === undefined || mass === undefined) return undefined;
    return Object.freeze({...common, kind: 'prop', radius, mass});
  }
  const radius = positiveFinite(record.radius, MAX_COLLIDER_SIZE);
  const ownerId = boundedId(record.ownerId);
  if (radius === undefined || !ownerId) return undefined;
  return Object.freeze({...common, kind: 'projectile', radius, ownerId});
}

function parseVehicle(
  record: Record<string, unknown>,
  common: KinematicInteractionState
): InteractionEntityState | undefined {
  const vehicleKind = typeof record.vehicleKind === 'string' && isVehicleKind(record.vehicleKind)
    ? record.vehicleKind
    : undefined;
  const speed = finiteInRange(record.speed, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY);
  const steering = finiteInRange(record.steering, -1, 1);
  const engineDamage = finiteInRange(record.engineDamage, 0, 250);
  if (
    !vehicleKind || speed === undefined || steering === undefined || engineDamage === undefined ||
    typeof record.onFire !== 'boolean' || typeof record.destroyed !== 'boolean'
  ) return undefined;
  return Object.freeze({
    ...common,
    kind: 'vehicle',
    vehicleKind,
    speed,
    steering,
    engineDamage,
    onFire: record.onFire,
    destroyed: record.destroyed
  });
}

function parseKinematic(record: Record<string, unknown>): KinematicInteractionState | undefined {
  const id = boundedId(record.id);
  const kind = oneOf(record.kind, ['player', 'pedestrian', 'vehicle', 'prop', 'projectile']);
  const spaceId = boundedString(record.spaceId, MAX_SPACE_ID_LENGTH);
  const layerId = boundedString(record.layerId, MAX_SPACE_ID_LENGTH);
  const x = finiteInRange(record.x, -MAX_ABSOLUTE_POSITION, MAX_ABSOLUTE_POSITION);
  const y = finiteInRange(record.y, -MAX_ABSOLUTE_POSITION, MAX_ABSOLUTE_POSITION);
  const angle = finiteInRange(record.angle, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const velocityX = finiteInRange(record.velocityX, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY);
  const velocityY = finiteInRange(record.velocityY, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY);
  const angularVelocity = finiteInRange(
    record.angularVelocity,
    -MAX_ABSOLUTE_VELOCITY,
    MAX_ABSOLUTE_VELOCITY
  );
  const colliderRevision = safePositiveInteger(record.colliderRevision);
  const lifecycleRevision = safePositiveInteger(record.lifecycleRevision);
  if (
    !id || !kind || !spaceId || !layerId || x === undefined || y === undefined ||
    angle === undefined || velocityX === undefined || velocityY === undefined ||
    angularVelocity === undefined || colliderRevision === undefined ||
    lifecycleRevision === undefined
  ) return undefined;
  return Object.freeze({
    id,
    kind,
    spaceId,
    layerId,
    x,
    y,
    angle: normalizeAngle(angle),
    velocityX,
    velocityY,
    angularVelocity,
    colliderRevision,
    lifecycleRevision
  });
}

function parseRemoteIntent(
  value: unknown,
  serverTick: number,
  historyTicks: number
): RemoteIntentState | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const entityId = boundedId(record.entityId);
  const appliedAtServerTick = safeNonnegativeInteger(record.appliedAtServerTick);
  const moveX = finiteInRange(record.moveX, -1, 1);
  const moveY = finiteInRange(record.moveY, -1, 1);
  const steering = finiteInRange(record.steering, -1, 1);
  const throttle = finiteInRange(record.throttle, -1, 1);
  if (
    !entityId || appliedAtServerTick === undefined || moveX === undefined || moveY === undefined ||
    steering === undefined || throttle === undefined || appliedAtServerTick > serverTick ||
    appliedAtServerTick < serverTick - historyTicks
  ) return undefined;
  return Object.freeze({entityId, appliedAtServerTick, moveX, moveY, steering, throttle});
}
