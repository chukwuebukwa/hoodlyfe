import type {DistrictState, PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {InteriorController} from '../interiors/interior-controller.ts';
import type {OnFootInputBatchMessage} from '../../../shared/protocol/on-foot-input.ts';
import {
  ON_FOOT_PLAYER_RADIUS,
  ON_FOOT_PLAYER_SPEED,
  integrateOnFootPose,
  onFootMovementScale,
  stepInteriorOnFootPose
} from '../../../shared/simulation/on-foot-step.ts';
import {stepAirborneMotion} from '../../../shared/simulation/airborne-motion.ts';

export const PLAYER_RADIUS = ON_FOOT_PLAYER_RADIUS;
export const PLAYER_JUMP_VERTICAL_SPEED = 245;

export interface PlayerMoveInput {
  x?: number;
  y?: number;
  sequence?: number;
  handbrake?: boolean;
}

export interface PlayerAimInput {
  angle?: number;
}

export interface PlayerControlState {
  inputX: number;
  inputY: number;
  lastSequence: number;
  handbrake?: boolean;
}

interface PlayerControlRuntime {
  receivedSequence: number;
  held: PlayerControlState;
  pending: PlayerControlState[];
}

interface PlayerControlControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  interiors?: InteriorController;
}

export class PlayerControlController {
  private readonly controls = new Map<string, PlayerControlRuntime>();

  constructor(private readonly options: PlayerControlControllerOptions) {}

  register(playerId: string): void {
    const acknowledged = this.options.state.players.get(playerId)?.lastInputSequence ?? 0;
    this.controls.set(playerId, {
      receivedSequence: acknowledged,
      held: {inputX: 0, inputY: 0, lastSequence: acknowledged},
      pending: []
    });
  }

  unregister(playerId: string): void {
    this.controls.delete(playerId);
  }

  setMove(playerId: string, input?: PlayerMoveInput): void {
    const runtime = this.controls.get(playerId);
    if (!runtime) return;
    const requestedSequence = Number(input?.sequence);
    const sequence = Number.isSafeInteger(requestedSequence)
      ? requestedSequence
      : runtime.receivedSequence + 1;
    if (!this.acceptMove(runtime, input, sequence)) return;
    // Legacy single-input clients hold their newest intent immediately. New clients use
    // acceptBatch(), whose moves are consumed exactly once per fixed simulation tick.
    const latest = runtime.pending.pop();
    runtime.pending = [];
    if (latest) runtime.held = latest;
  }

  acceptBatch(playerId: string, message?: OnFootInputBatchMessage): number {
    const runtime = this.controls.get(playerId);
    const player = this.options.state.players.get(playerId);
    if (!runtime || !player?.alive || player.vehicleId) return 0;
    const moves = Array.isArray(message?.moves) ? message.moves.slice(0, MAX_BATCH_MOVES) : [];
    let accepted = 0;
    for (const move of moves) {
      if (this.acceptMove(runtime, move, Number(move?.sequence))) accepted++;
    }
    if (runtime.pending.length > MAX_PENDING_MOVES) {
      runtime.pending.splice(0, runtime.pending.length - MAX_PENDING_MOVES);
    }
    return accepted;
  }

  setAim(playerId: string, input?: PlayerAimInput): void {
    const player = this.options.state.players.get(playerId);
    const angle = Number(input?.angle);
    const canAim = player && (!player.vehicleId || player.vehicleSeat > 0);
    if (!player?.alive || !canAim || player.action || !Number.isFinite(angle)) return;
    player.angle = normalizeAngle(angle);
  }

  reset(playerId: string): void {
    const runtime = this.controls.get(playerId);
    if (!runtime) return;
    runtime.pending = [];
    runtime.held = {inputX: 0, inputY: 0, lastSequence: runtime.receivedSequence};
    const player = this.options.state.players.get(playerId);
    if (player) player.lastInputSequence = runtime.receivedSequence;
  }

  inputFor(playerId: string): PlayerControlState | undefined {
    return this.controls.get(playerId)?.held;
  }

  jump(playerId: string): boolean {
    const player = this.options.state.players.get(playerId);
    const control = this.controls.get(playerId)?.held;
    if (
      !player?.alive || player.spaceId !== 'street' || player.vehicleId ||
      player.action || player.airborne
    ) return false;
    const elevation = this.options.world.heightAt(
      player.surfaceId,
      player.x,
      player.y
    );
    if (elevation === undefined) return false;
    const inputX = control?.inputX ?? 0;
    const inputY = control?.inputY ?? 0;
    const magnitude = Math.hypot(inputX, inputY);
    const normalization = magnitude > 1 ? 1 / magnitude : 1;
    player.airborne = true;
    player.elevation = elevation;
    player.verticalVelocity = PLAYER_JUMP_VERTICAL_SPEED;
    player.airborneVelocityX = inputX * normalization * ON_FOOT_PLAYER_SPEED;
    player.airborneVelocityY = inputY * normalization * ON_FOOT_PLAYER_SPEED;
    player.landingSurfaceId = player.surfaceId;
    return true;
  }

  updateOnFoot(player: PlayerState, deltaSeconds: number): void {
    const runtime = this.controls.get(player.id);
    if (!runtime || !player.alive || player.vehicleId) return;
    const next = runtime.pending.shift();
    if (next) runtime.held = next;
    const control = runtime.held;
    if (player.airborne) {
      this.updateAirborne(player, deltaSeconds);
      player.lastInputSequence = control.lastSequence;
      return;
    }
    const pose = {x: player.x, y: player.y, spaceId: player.spaceId};
    const command = {moveX: control.inputX, moveY: control.inputY};
    const modifiers = {
      movementScale: onFootMovementScale(player.action, player.weapon, player.attackCombo)
    };
    const moved = player.spaceId === 'street'
      ? integrateOnFootPose(pose, command, deltaSeconds, modifiers)
      : stepInteriorOnFootPose(
        pose,
        command,
        deltaSeconds,
        (spaceId, x, y, radius) =>
          this.options.interiors?.canOccupy(spaceId, x, y, radius) ?? false,
        modifiers
      ).pose;
    if (player.spaceId === 'street') {
      const moveSurface = this.options.world.surfaceAfterMove;
      const surfaceId = typeof moveSurface === 'function'
        ? moveSurface.call(
          this.options.world,
          player.surfaceId,
          player.x,
          player.y,
          moved.x,
          moved.y,
          PLAYER_RADIUS,
          'player'
        )
        : player.surfaceId;
      if (surfaceId) {
        player.x = moved.x;
        player.y = moved.y;
        player.surfaceId = surfaceId;
      } else {
        const landing = this.options.world.dropTargetAfterMove(
          player.surfaceId,
          player.x,
          player.y,
          moved.x,
          moved.y,
          PLAYER_RADIUS,
          'player'
        );
        if (landing) {
          const delta = Math.max(0.001, deltaSeconds);
          const takeoffHeight = this.options.world.heightAt(
            player.surfaceId,
            player.x,
            player.y
          ) ?? landing.height;
          player.airborne = true;
          player.elevation = takeoffHeight;
          player.verticalVelocity = 0;
          player.airborneVelocityX = (moved.x - player.x) / delta;
          player.airborneVelocityY = (moved.y - player.y) / delta;
          player.landingSurfaceId = landing.surfaceId;
          player.x = moved.x;
          player.y = moved.y;
        }
      }
    } else {
      player.x = moved.x;
      player.y = moved.y;
    }
    if (player.spaceId !== 'street') this.options.interiors?.afterMove(player);
    if (!player.action) this.options.interiors?.tryEnter(player);
    player.lastInputSequence = control.lastSequence;
  }

  private updateAirborne(player: PlayerState, deltaSeconds: number): void {
    const stepped = stepAirborneMotion({
      x: player.x,
      y: player.y,
      angle: player.angle,
      elevation: player.elevation,
      verticalVelocity: player.verticalVelocity,
      velocityX: player.airborneVelocityX,
      velocityY: player.airborneVelocityY
    }, deltaSeconds);
    const landing = this.options.world.landingBelow(
      '',
      stepped.x,
      stepped.y,
      PLAYER_RADIUS,
      'player',
      stepped.previousElevation
    );
    player.x = stepped.x;
    player.y = stepped.y;
    player.elevation = stepped.elevation;
    player.verticalVelocity = stepped.verticalVelocity;
    if (landing && stepped.elevation <= landing.height) {
      player.surfaceId = landing.surfaceId;
      player.elevation = landing.height;
      player.airborne = false;
      player.verticalVelocity = 0;
      player.airborneVelocityX = 0;
      player.airborneVelocityY = 0;
      player.landingSurfaceId = '';
      return;
    }
    if (player.elevation < -1_024) {
      const spawn = this.options.world.spawnFor(0, PLAYER_RADIUS);
      player.x = spawn.x;
      player.y = spawn.y;
      player.surfaceId = spawn.surfaceId;
      player.elevation = this.options.world.heightAt(spawn.surfaceId, spawn.x, spawn.y) ?? 0;
      player.airborne = false;
      player.verticalVelocity = 0;
      player.airborneVelocityX = 0;
      player.airborneVelocityY = 0;
      player.landingSurfaceId = '';
    }
  }

  private acceptMove(
    runtime: PlayerControlRuntime,
    input: PlayerMoveInput | undefined,
    sequence: number
  ): boolean {
    if (
      !Number.isSafeInteger(sequence) || sequence <= runtime.receivedSequence ||
      sequence - runtime.receivedSequence > MAX_SEQUENCE_ADVANCE
    ) return false;
    const x = Number(input?.x);
    const y = Number(input?.y);
    runtime.pending.push({
      inputX: Number.isFinite(x) ? clamp(x, -1, 1) : 0,
      inputY: Number.isFinite(y) ? clamp(y, -1, 1) : 0,
      lastSequence: sequence,
      ...(input?.handbrake === true ? {handbrake: true} : {})
    });
    runtime.receivedSequence = sequence;
    return true;
  }
}

const MAX_BATCH_MOVES = 4;
const MAX_PENDING_MOVES = 24;
const MAX_SEQUENCE_ADVANCE = 4_096;

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
