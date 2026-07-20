import {
  SOCCER_BALL_ID,
  SOCCER_BALL_KICK_COOLDOWN_MS,
  SOCCER_BALL_KICK_IMPULSE,
  SOCCER_BALL_KICK_REACH,
  SOCCER_BALL_RADIUS
} from '../../../shared/content/soccer-ball.ts';
import type {SoccerBallKickMessage} from '../../../shared/protocol/soccer-ball.ts';
import type {CollisionMap} from '../../world-map.ts';
import {SoccerBallState, type DistrictState} from '../../state.ts';

interface SoccerBallControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  queueImpulse: (ballId: string, impulseX: number, impulseY: number) => boolean;
}

export class SoccerBallController {
  private readonly lastKickAt = new Map<string, number>();

  constructor(private readonly options: SoccerBallControllerOptions) {}

  initialize(): SoccerBallState {
    const existing = this.options.state.soccerBalls.get(SOCCER_BALL_ID);
    if (existing) return existing;
    const spawn = this.spawnPoint();
    const ball = new SoccerBallState();
    ball.id = SOCCER_BALL_ID;
    ball.x = spawn.x;
    ball.y = spawn.y;
    ball.surfaceId = spawn.surfaceId;
    this.options.state.soccerBalls.set(ball.id, ball);
    return ball;
  }

  kick(playerId: string, nowMs: number, message?: SoccerBallKickMessage): boolean {
    const player = this.options.state.players.get(playerId);
    if (!player?.alive || player.vehicleId || player.spaceId !== 'street' || player.action) return false;
    if (!Number.isFinite(nowMs)) return false;
    const previousKickAt = this.lastKickAt.get(playerId) ?? Number.NEGATIVE_INFINITY;
    if (nowMs - previousKickAt < SOCCER_BALL_KICK_COOLDOWN_MS) return false;

    const ball = this.nearestKickableBall(player.x, player.y, player.surfaceId, message?.ballId);
    if (!ball) return false;
    const offsetX = ball.x - player.x;
    const offsetY = ball.y - player.y;
    const distance = Math.hypot(offsetX, offsetY);
    const directionX = distance > 0.001 ? offsetX / distance : Math.cos(player.angle);
    const directionY = distance > 0.001 ? offsetY / distance : Math.sin(player.angle);
    if (!this.options.queueImpulse(
      ball.id,
      directionX * SOCCER_BALL_KICK_IMPULSE,
      directionY * SOCCER_BALL_KICK_IMPULSE
    )) return false;
    this.lastKickAt.set(playerId, nowMs);
    return true;
  }

  clearPlayer(playerId: string): void {
    this.lastKickAt.delete(playerId);
  }

  private nearestKickableBall(
    playerX: number,
    playerY: number,
    surfaceId: string,
    requestedBallId?: string
  ): SoccerBallState | undefined {
    const candidates = requestedBallId
      ? [this.options.state.soccerBalls.get(requestedBallId)].filter(
        (ball): ball is SoccerBallState => Boolean(ball)
      )
      : [...this.options.state.soccerBalls.values()].sort((left, right) => left.id.localeCompare(right.id));
    let nearest: SoccerBallState | undefined;
    let nearestDistance = SOCCER_BALL_KICK_REACH;
    for (const ball of candidates) {
      if (ball.surfaceId !== surfaceId) continue;
      const distance = Math.hypot(ball.x - playerX, ball.y - playerY);
      if (distance > nearestDistance) continue;
      if (distance === nearestDistance && nearest && ball.id.localeCompare(nearest.id) >= 0) continue;
      nearest = ball;
      nearestDistance = distance;
    }
    return nearest;
  }

  private spawnPoint(): {x: number; y: number; surfaceId: string} {
    const origin = this.options.world.spawnFor(0, SOCCER_BALL_RADIUS);
    const offsets = [
      [56, 0], [0, 56], [-56, 0], [0, -56],
      [48, 48], [-48, 48], [48, -48], [-48, -48]
    ] as const;
    for (const [offsetX, offsetY] of offsets) {
      const candidate = {x: origin.x + offsetX, y: origin.y + offsetY, surfaceId: origin.surfaceId};
      if (this.options.world.canOccupy(
        candidate.x,
        candidate.y,
        SOCCER_BALL_RADIUS,
        candidate.surfaceId,
        'prop'
      )) return candidate;
    }
    return this.options.world.openPoint(17, SOCCER_BALL_RADIUS);
  }
}
