import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  type InteractionEntityState
} from '../../../shared/protocol/interaction-contracts.ts';
import type {InteractionIslandBaseline} from './island-state-history.ts';
import {
  continueRemoteIntent,
  NEUTRAL_INTERACTION_REPLAY_CONTROL,
  type InteractionReplayControl
} from './remote-intent-continuation.ts';
import {
  ReplaySideEffectGate,
  type ReplaySuppressionCounts
} from './replay-side-effect-gate.ts';
import {stableInteractionPairs} from './stable-interaction-pairs.ts';
import {interactionStableKey} from './interaction-island-policy.ts';

export const INTERACTION_REPLAY_STEP_SECONDS = 1 / 30;

export interface InteractionReplayCommand extends Omit<InteractionReplayControl, 'source'> {
  readonly serverTick: number;
  readonly entityId: string;
}

export interface InteractionReplayStepContext {
  readonly serverTick: number;
  readonly deltaSeconds: number;
  readonly sideEffects: ReplaySideEffectGate;
}

export type InteractionReplayBodyStep = (
  entity: InteractionEntityState,
  control: InteractionReplayControl,
  context: InteractionReplayStepContext
) => InteractionEntityState;

export type InteractionReplayPairStep = (
  left: InteractionEntityState,
  right: InteractionEntityState,
  context: InteractionReplayStepContext
) => readonly [InteractionEntityState, InteractionEntityState] | undefined;

// Steps a set of entities together once per replay tick (a shared simulation world
// needs all bodies driven before it advances). Entities absent from the returned
// map fall through to the per-entity body step.
export type InteractionReplayBatchStep = (
  entities: readonly InteractionEntityState[],
  controls: ReadonlyMap<string, InteractionReplayControl>,
  context: InteractionReplayStepContext
) => ReadonlyMap<string, InteractionEntityState> | undefined;

export interface InteractionIslandReplayRequest {
  readonly baseline: InteractionIslandBaseline;
  readonly targetServerTick: number;
  readonly expectedWorldCollisionRevision: number;
  readonly currentEntities?: readonly InteractionEntityState[];
  readonly localCommands?: readonly InteractionReplayCommand[];
  readonly stepBody: InteractionReplayBodyStep;
  readonly stepBatch?: InteractionReplayBatchStep;
  readonly resolvePair?: InteractionReplayPairStep;
  readonly sideEffects?: ReplaySideEffectGate;
  readonly maximumReplayTicks?: number;
}

export interface InteractionIslandReplaySuccess {
  readonly replayed: true;
  readonly baselineTick: number;
  readonly targetServerTick: number;
  readonly replayedTicks: number;
  readonly bodySteps: number;
  readonly pairSteps: number;
  readonly confirmedEventsThrough: number;
  readonly entities: readonly InteractionEntityState[];
  readonly rootStates: readonly InteractionReplayRootState[];
  readonly suppressedEffects: ReplaySuppressionCounts;
}

export interface InteractionReplayRootState {
  readonly serverTick: number;
  readonly entity: InteractionEntityState;
}

export type InteractionIslandReplayRejection =
  | 'invalid-target-tick'
  | 'history-window-exceeded'
  | 'world-revision-mismatch'
  | 'entity-revision-mismatch'
  | 'invalid-command'
  | 'kernel-error';

export interface InteractionIslandReplayFailure {
  readonly replayed: false;
  readonly reason: InteractionIslandReplayRejection;
}

export type InteractionIslandReplayResult =
  | InteractionIslandReplaySuccess
  | InteractionIslandReplayFailure;

export function replayInteractionIsland(
  request: InteractionIslandReplayRequest
): InteractionIslandReplayResult {
  const maximumReplayTicks = positiveInteger(
    request.maximumReplayTicks ?? DEFAULT_INTERACTION_HISTORY_TICKS
  );
  const replayedTicks = request.targetServerTick - request.baseline.serverTick;
  if (!Number.isSafeInteger(request.targetServerTick) || replayedTicks < 0) {
    return rejection('invalid-target-tick');
  }
  if (replayedTicks > maximumReplayTicks) return rejection('history-window-exceeded');
  if (request.baseline.worldCollisionRevision !== request.expectedWorldCollisionRevision) {
    return rejection('world-revision-mismatch');
  }
  if (request.currentEntities && !compatibleRevisions(
    request.baseline.entities,
    request.currentEntities
  )) {
    return rejection('entity-revision-mismatch');
  }
  const commands = commandMap(request.localCommands ?? [], request.baseline, request.targetServerTick);
  if (!commands) return rejection('invalid-command');
  const sideEffects = request.sideEffects ?? new ReplaySideEffectGate();
  const beforeSuppression = sideEffects.suppressed();
  const remoteIntents = new Map(
    request.baseline.remoteIntents.map((intent) => [intent.entityId, intent])
  );
  const rootId = request.baseline.rootId;
  let states = new Map(
    request.baseline.entities.map((entity) => [entity.id, cloneEntity(entity)])
  );
  const rootStates: InteractionReplayRootState[] = [];
  let bodySteps = 0;
  let pairSteps = 0;
  try {
    for (
      let serverTick = request.baseline.serverTick + 1;
      serverTick <= request.targetServerTick;
      serverTick++
    ) {
      const context = Object.freeze({
        serverTick,
        deltaSeconds: INTERACTION_REPLAY_STEP_SECONDS,
        sideEffects
      });
      states = sideEffects.runReplay(() => {
        const stepped = new Map<string, InteractionEntityState>();
        const entities = stableEntities(states);
        const controls = new Map<string, InteractionReplayControl>();
        for (const entity of entities) {
          const local = commands.get(commandKey(serverTick, entity.id));
          controls.set(entity.id, local
            ? localControl(local)
            : continueRemoteIntent(remoteIntents.get(entity.id), serverTick));
        }
        const batched = request.stepBatch?.(entities, controls, context);
        for (const entity of entities) {
          const next = batched?.get(entity.id) ??
            request.stepBody(entity, controls.get(entity.id)!, context);
          if (!validKernelState(entity, next)) throw new Error('invalid replay body state');
          stepped.set(next.id, cloneEntity(next));
          bodySteps++;
        }
        if (!request.resolvePair) return stepped;
        for (const pair of stableInteractionPairs([...stepped.values()])) {
          const left = stepped.get(pair.leftId);
          const right = stepped.get(pair.rightId);
          if (!left || !right) throw new Error('missing replay pair member');
          const resolved = request.resolvePair(left, right, context);
          pairSteps++;
          if (!resolved) continue;
          if (!validKernelState(left, resolved[0]) || !validKernelState(right, resolved[1])) {
            throw new Error('invalid replay pair state');
          }
          stepped.set(left.id, cloneEntity(resolved[0]));
          stepped.set(right.id, cloneEntity(resolved[1]));
        }
        return stepped;
      });
      const rootState = states.get(rootId);
      if (!rootState) throw new Error('missing replay root');
      rootStates.push(Object.freeze({serverTick, entity: cloneEntity(rootState)}));
    }
  } catch {
    return rejection('kernel-error');
  }
  const finalStates = stableEntities(states);
  const root = finalStates.find(({id}) => id === rootId);
  if (!root) return rejection('kernel-error');
  const ordered = [root, ...finalStates.filter(({id}) => id !== rootId)];
  return Object.freeze({
    replayed: true,
    baselineTick: request.baseline.serverTick,
    targetServerTick: request.targetServerTick,
    replayedTicks,
    bodySteps,
    pairSteps,
    confirmedEventsThrough: request.baseline.confirmedEventsThrough,
    entities: Object.freeze(ordered.map(cloneEntity)),
    rootStates: Object.freeze(rootStates),
    suppressedEffects: suppressionDelta(beforeSuppression, sideEffects.suppressed())
  });
}

function compatibleRevisions(
  baseline: readonly InteractionEntityState[],
  current: readonly InteractionEntityState[]
): boolean {
  const currentByKey = new Map(current.map((entity) => [interactionStableKey(entity), entity]));
  return baseline.every((entity) => {
    const other = currentByKey.get(interactionStableKey(entity));
    return other?.lifecycleRevision === entity.lifecycleRevision &&
      other.colliderRevision === entity.colliderRevision;
  });
}

function commandMap(
  commands: readonly InteractionReplayCommand[],
  baseline: InteractionIslandBaseline,
  targetServerTick: number
): Map<string, InteractionReplayCommand> | undefined {
  const entityIds = new Set(baseline.entities.map(({id}) => id));
  const mapped = new Map<string, InteractionReplayCommand>();
  for (const command of commands) {
    if (
      !Number.isSafeInteger(command.serverTick) ||
      command.serverTick <= baseline.serverTick ||
      command.serverTick > targetServerTick ||
      !entityIds.has(command.entityId) ||
      !finiteControls(command)
    ) {
      return undefined;
    }
    const key = commandKey(command.serverTick, command.entityId);
    if (mapped.has(key)) return undefined;
    mapped.set(key, Object.freeze({...command}));
  }
  return mapped;
}

function localControl(command: InteractionReplayCommand): InteractionReplayControl {
  return Object.freeze({
    moveX: finiteClamp(command.moveX, -1, 1),
    moveY: finiteClamp(command.moveY, -1, 1),
    steering: finiteClamp(command.steering, -1, 1),
    throttle: finiteClamp(command.throttle, -1, 1),
    movementScale: finiteClamp(command.movementScale, 0, 2),
    source: 'local'
  });
}

function finiteControls(control: Omit<InteractionReplayControl, 'source'>): boolean {
  return Number.isFinite(control.moveX) && Number.isFinite(control.moveY) &&
    Number.isFinite(control.steering) && Number.isFinite(control.throttle) &&
    Number.isFinite(control.movementScale);
}

function stableEntities(
  states: ReadonlyMap<string, InteractionEntityState>
): InteractionEntityState[] {
  return [...states.values()].sort((left, right) => (
    interactionStableKey(left).localeCompare(interactionStableKey(right))
  ));
}

function validKernelState(
  previous: InteractionEntityState,
  next: InteractionEntityState
): boolean {
  return previous.id === next?.id && previous.kind === next.kind &&
    previous.spaceId === next.spaceId && previous.layerId === next.layerId &&
    previous.lifecycleRevision === next.lifecycleRevision &&
    previous.colliderRevision === next.colliderRevision &&
    Number.isFinite(next.x) && Number.isFinite(next.y) && Number.isFinite(next.angle) &&
    Number.isFinite(next.velocityX) && Number.isFinite(next.velocityY) &&
    Number.isFinite(next.angularVelocity);
}

function suppressionDelta(
  before: ReplaySuppressionCounts,
  after: ReplaySuppressionCounts
): ReplaySuppressionCounts {
  return Object.freeze({
    'idempotent-presentation': after['idempotent-presentation'] - before['idempotent-presentation'],
    'one-shot-presentation': after['one-shot-presentation'] - before['one-shot-presentation'],
    'authoritative-gameplay': after['authoritative-gameplay'] - before['authoritative-gameplay'],
    'durable-transaction': after['durable-transaction'] - before['durable-transaction']
  });
}

function cloneEntity(entity: InteractionEntityState): InteractionEntityState {
  return Object.freeze({...entity}) as InteractionEntityState;
}

function commandKey(serverTick: number, entityId: string): string {
  return `${serverTick}:${entityId}`;
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Maximum interaction replay ticks must be a positive safe integer.');
  }
  return value;
}

function rejection(reason: InteractionIslandReplayRejection): InteractionIslandReplayFailure {
  return Object.freeze({replayed: false, reason});
}
