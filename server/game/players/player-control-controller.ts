import type {DistrictState, PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

export const PLAYER_RADIUS = 11;

const PLAYER_SPEED = 190;

export interface PlayerMoveInput {
  x?: number;
  y?: number;
}

export interface PlayerAimInput {
  angle?: number;
}

export interface PlayerControlState {
  inputX: number;
  inputY: number;
}

interface PlayerControlControllerOptions {
  state: DistrictState;
  world: CollisionMap;
}

export class PlayerControlController {
  private readonly controls = new Map<string, PlayerControlState>();

  constructor(private readonly options: PlayerControlControllerOptions) {}

  register(playerId: string): void {
    this.controls.set(playerId, {inputX: 0, inputY: 0});
  }

  unregister(playerId: string): void {
    this.controls.delete(playerId);
  }

  setMove(playerId: string, input?: PlayerMoveInput): void {
    const control = this.controls.get(playerId);
    if (!control) return;
    const x = Number(input?.x);
    const y = Number(input?.y);
    control.inputX = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
    control.inputY = Number.isFinite(y) ? clamp(y, -1, 1) : 0;
  }

  setAim(playerId: string, input?: PlayerAimInput): void {
    const player = this.options.state.players.get(playerId);
    const angle = Number(input?.angle);
    const canAim = player && (!player.vehicleId || player.vehicleSeat > 0);
    if (!player?.alive || !canAim || player.action || !Number.isFinite(angle)) return;
    player.angle = normalizeAngle(angle);
  }

  reset(playerId: string): void {
    const control = this.controls.get(playerId);
    if (!control) return;
    control.inputX = 0;
    control.inputY = 0;
  }

  inputFor(playerId: string): PlayerControlState | undefined {
    return this.controls.get(playerId);
  }

  updateOnFoot(player: PlayerState, deltaSeconds: number): void {
    const control = this.controls.get(player.id);
    if (!control || !player.alive || player.action || player.vehicleId) return;
    const magnitude = Math.hypot(control.inputX, control.inputY);
    if (magnitude === 0) return;
    const inputScale = magnitude > 1 ? 1 / magnitude : 1;
    const moveX = control.inputX * inputScale * PLAYER_SPEED * deltaSeconds;
    const moveY = control.inputY * inputScale * PLAYER_SPEED * deltaSeconds;
    const nextX = player.x + moveX;
    if (this.options.world.canOccupy(nextX, player.y, PLAYER_RADIUS)) player.x = nextX;
    const nextY = player.y + moveY;
    if (this.options.world.canOccupy(player.x, nextY, PLAYER_RADIUS)) player.y = nextY;
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
