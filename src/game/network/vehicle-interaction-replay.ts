import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  type InteractionBodyState,
  type InteractionIntentState,
  type InteractionSnapshot
} from '../../../shared/protocol/interaction-islands.ts';
import {
  isVehicleKind,
  vehicleDefinition,
  type VehicleKind
} from '../../../shared/content/vehicle-catalog.ts';
import {
  initializePhysicsEngine,
  PhysicsWorld
} from '../../../shared/physics/physics-world.ts';
import {
  captureVehicleBody,
  driveVehicleBody
} from '../../../shared/simulation/vehicle-body-drive.ts';
import {
  VEHICLE_SIMULATION_STEP_SECONDS,
  type VehicleControlCommand,
  type VehicleMotionState,
  type VehicleStepModifiers
} from '../../../shared/simulation/vehicle-step.ts';
import {SurfaceMap} from '../../../shared/world/surface-map.ts';
import type {InteractionIslandSelection} from './interaction-island-selector.ts';
import {continuedVehicleIntent} from './remote-intent-continuation.ts';
import type {
  VehiclePredictionPendingMove,
  VehiclePredictionPose
} from './vehicle-prediction-controller.ts';

export type VehicleInteractionReplayReason =
  | 'replayed'
  | 'cached'
  | 'not-driver'
  | 'selection-mismatch'
  | 'missing-root'
  | 'no-vehicle-peer'
  | 'unsupported-body'
  | 'invalid-vehicle-shape'
  | 'input-gap'
  | 'history-capacity'
  | 'capture-failed';

export interface VehicleInteractionReplayInput {
  readonly snapshot: InteractionSnapshot;
  readonly selection: InteractionIslandSelection;
  readonly pendingMoves: readonly VehiclePredictionPendingMove[] | undefined;
  readonly currentLocalPose: VehiclePredictionPose | undefined;
}

export interface VehicleInteractionReplayObservation {
  readonly active: boolean;
  readonly reason: VehicleInteractionReplayReason;
  readonly serverTick: number;
  readonly replayTicks: number;
  readonly vehicleBodies: number;
  readonly contacts: number;
  readonly correctionErrorPx: number;
  readonly angularErrorRad: number;
  readonly surfaceRejects: number;
  readonly rootPose?: VehiclePredictionPose;
}

interface ReplayVehicleState extends VehicleMotionState {
  readonly key: string;
  readonly entityId: string;
  readonly kind: VehicleKind;
  readonly surfaceId: string;
}

interface ReplayCommand {
  readonly command: VehicleControlCommand;
  readonly modifiers: VehicleStepModifiers;
}

export class VehicleInteractionReplayController {
  private lastSignature = '';
  private lastObservation?: VehicleInteractionReplayObservation;

  private constructor(
    private readonly world: PhysicsWorld,
    private readonly surfaces: SurfaceMap
  ) {}

  static async create(surfaces: SurfaceMap): Promise<VehicleInteractionReplayController> {
    await initializePhysicsEngine();
    return new VehicleInteractionReplayController(PhysicsWorld.create({
      width: 1,
      height: 1,
      tileWidth: 1,
      tileHeight: 1,
      collisions: Object.freeze([]),
      encloseBorders: false
    }), surfaces);
  }

  evaluate(input: VehicleInteractionReplayInput): VehicleInteractionReplayObservation {
    const signature = replaySignature(input);
    if (signature === this.lastSignature && this.lastObservation) {
      return Object.freeze({...this.lastObservation, reason: 'cached'});
    }
    this.lastSignature = signature;
    const rejected = validateReplayInput(input);
    if (rejected) return this.remember(observation(input.snapshot.serverTick, rejected));

    const pendingMoves = input.pendingMoves!;
    const vehicles = parseReplayVehicles(input.selection);
    if (!vehicles) {
      return this.remember(observation(input.snapshot.serverTick, 'invalid-vehicle-shape'));
    }
    this.clearWorld();
    let states = new Map(vehicles.map((vehicle) => [vehicle.key, vehicle]));
    for (const vehicle of vehicles) {
      this.world.registerVehicle(vehicle.key, vehicle.kind, physicsState(vehicle));
    }

    const intents = new Map(input.snapshot.intents.map((intent) => [intent.bodyKey, intent]));
    let surfaceRejects = 0;
    for (let index = 0; index < pendingMoves.length; index++) {
      const replayTick = input.snapshot.serverTick + index + 1;
      const pending = pendingMoves[index];
      const desired = new Map<string, VehicleMotionState>();
      const ordered = [...states.values()].sort((left, right) => left.key.localeCompare(right.key));
      for (const vehicle of ordered) {
        const replayCommand = vehicle.key === input.snapshot.rootBodyKey
          ? localReplayCommand(pending)
          : remoteReplayCommand(intents.get(vehicle.key), replayTick);
        desired.set(vehicle.key, driveVehicleBody(
          this.world,
          vehicle.key,
          vehicle.kind,
          vehicle,
          replayCommand.command,
          VEHICLE_SIMULATION_STEP_SECONDS,
          replayCommand.modifiers
        ));
      }
      this.world.step();

      const nextStates = new Map<string, ReplayVehicleState>();
      for (const vehicle of ordered) {
        const captured = captureVehicleBody(this.world, vehicle.key, desired.get(vehicle.key)!);
        if (!captured) {
          return this.remember(observation(
            input.snapshot.serverTick,
            'capture-failed',
            pendingMoves.length,
            vehicles.length
          ));
        }
        const nextSurfaceId = this.surfaces.transitionFor(
          vehicle.surfaceId,
          vehicle.x,
          vehicle.y,
          captured.pose.x,
          captured.pose.y,
          'vehicle'
        )?.surfaceId ?? vehicle.surfaceId;
        const radius = vehicleDefinition(vehicle.kind).radius;
        if (!this.surfaces.canOccupyConnected(
          nextSurfaceId,
          captured.pose.x,
          captured.pose.y,
          radius,
          'vehicle'
        )) {
          surfaceRejects++;
          const stopped = stopVehicle(vehicle);
          this.world.writeback(vehicle.key, physicsState(stopped));
          nextStates.set(vehicle.key, stopped);
          continue;
        }
        nextStates.set(vehicle.key, Object.freeze({
          ...captured.pose,
          key: vehicle.key,
          entityId: vehicle.entityId,
          kind: vehicle.kind,
          surfaceId: nextSurfaceId
        }));
      }
      states = nextStates;
    }

    const root = states.get(input.snapshot.rootBodyKey)!;
    const rootPose: VehiclePredictionPose = Object.freeze({
      vehicleId: root.entityId,
      kind: root.kind,
      surfaceId: root.surfaceId,
      x: root.x,
      y: root.y,
      angle: root.angle,
      speed: root.speed,
      linvelX: root.linvelX,
      linvelY: root.linvelY,
      angvel: root.angvel
    });
    const current = input.currentLocalPose;
    return this.remember(Object.freeze({
      active: true,
      reason: 'replayed',
      serverTick: input.snapshot.serverTick,
      replayTicks: pendingMoves.length,
      vehicleBodies: vehicles.length,
      contacts: this.world.contacts().length,
      correctionErrorPx: current
        ? round(Math.hypot(rootPose.x - current.x, rootPose.y - current.y))
        : 0,
      angularErrorRad: current ? round(Math.abs(shortestAngle(rootPose.angle, current.angle))) : 0,
      surfaceRejects,
      rootPose
    }));
  }

  destroy(): void {
    this.clearWorld();
    this.world.free();
    this.lastSignature = '';
    this.lastObservation = undefined;
  }

  private clearWorld(): void {
    for (const key of [...this.world.keys()]) this.world.remove(key);
  }

  private remember(result: VehicleInteractionReplayObservation): VehicleInteractionReplayObservation {
    this.lastObservation = result;
    return result;
  }
}

function validateReplayInput(input: VehicleInteractionReplayInput): VehicleInteractionReplayReason | undefined {
  const {snapshot, selection, pendingMoves} = input;
  if (snapshot.rootMode !== 'driver') return 'not-driver';
  if (
    selection.serverTick !== snapshot.serverTick ||
    selection.rootBodyKey !== snapshot.rootBodyKey
  ) return 'selection-mismatch';
  const root = selection.members.find(({body}) => body.key === snapshot.rootBodyKey)?.body;
  if (!root || root.actorType !== 'vehicle') return 'missing-root';
  if (selection.members.filter(({body}) => body.actorType === 'vehicle').length < 2) {
    return 'no-vehicle-peer';
  }
  if (selection.members.some(({body}) => body.actorType !== 'vehicle')) return 'unsupported-body';
  if (!pendingMoves) return 'input-gap';
  if (pendingMoves.length > DEFAULT_INTERACTION_HISTORY_TICKS) return 'history-capacity';
  return undefined;
}

function parseReplayVehicles(
  selection: InteractionIslandSelection
): readonly ReplayVehicleState[] | undefined {
  const vehicles: ReplayVehicleState[] = [];
  for (const {body} of selection.members) {
    const kind = vehicleKindFromBody(body);
    if (!kind) return undefined;
    const angle = normalizeAngle(body.rotation);
    vehicles.push(Object.freeze({
      key: body.key,
      entityId: body.entityId,
      kind,
      surfaceId: body.surfaceId,
      x: body.x,
      y: body.y,
      angle,
      speed: body.linvelX * Math.cos(angle) + body.linvelY * Math.sin(angle),
      linvelX: body.linvelX,
      linvelY: body.linvelY,
      angvel: body.angvel
    }));
  }
  return Object.freeze(vehicles.sort((left, right) => left.key.localeCompare(right.key)));
}

function vehicleKindFromBody(body: InteractionBodyState): VehicleKind | undefined {
  if (body.actorType !== 'vehicle' || !body.shapeKey.startsWith('vehicle:')) return undefined;
  const kind = body.shapeKey.slice('vehicle:'.length);
  return isVehicleKind(kind) ? kind : undefined;
}

function localReplayCommand(move: VehiclePredictionPendingMove): ReplayCommand {
  return Object.freeze({
    command: Object.freeze({
      steering: move.message.x,
      throttle: -move.message.y,
      ...(move.message.handbrake ? {handbrake: true} : {})
    }),
    modifiers: move.modifiers
  });
}

function remoteReplayCommand(
  intent: InteractionIntentState | undefined,
  replayTick: number
): ReplayCommand {
  return Object.freeze({
    command: continuedVehicleIntent(intent, replayTick),
    modifiers: Object.freeze({})
  });
}

function physicsState(vehicle: ReplayVehicleState) {
  return {
    x: vehicle.x,
    y: vehicle.y,
    rotation: vehicle.angle,
    linvelX: vehicle.linvelX,
    linvelY: vehicle.linvelY,
    angvel: vehicle.angvel
  };
}

function stopVehicle(vehicle: ReplayVehicleState): ReplayVehicleState {
  return Object.freeze({
    ...vehicle,
    speed: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0
  });
}

function observation(
  serverTick: number,
  reason: VehicleInteractionReplayReason,
  replayTicks = 0,
  vehicleBodies = 0
): VehicleInteractionReplayObservation {
  return Object.freeze({
    active: false,
    reason,
    serverTick,
    replayTicks,
    vehicleBodies,
    contacts: 0,
    correctionErrorPx: 0,
    angularErrorRad: 0,
    surfaceRejects: 0
  });
}

function replaySignature(input: VehicleInteractionReplayInput): string {
  const pending = input.pendingMoves;
  return [
    input.snapshot.serverTick,
    input.snapshot.rootBodyKey,
    input.snapshot.rootLifecycleRevision,
    input.snapshot.acknowledgedLocalInputSequence,
    pending?.length ?? -1,
    pending?.at(-1)?.message.sequence ?? -1,
    input.selection.bodyKeys.join(',')
  ].join(':');
}

function shortestAngle(from: number, to: number): number {
  return normalizeAngle(to - from);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
