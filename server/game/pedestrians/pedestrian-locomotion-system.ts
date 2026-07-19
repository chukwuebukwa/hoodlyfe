import type {NpcState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {PEDESTRIAN_RADIUS} from './pedestrian-config.ts';

export class PedestrianLocomotionSystem {
  constructor(private readonly world: CollisionMap) {}

  move(
    npc: NpcState,
    angle: number,
    speed: number,
    deltaSeconds: number,
    avoidEnteringRoad = false
  ): boolean {
    if (speed <= 0) return true;
    const nextX = npc.x + Math.cos(angle) * speed * deltaSeconds;
    const nextY = npc.y + Math.sin(angle) * speed * deltaSeconds;
    let moved = false;
    const startedOnRoad = avoidEnteringRoad && this.world.isRoadAt(npc.x, npc.y);
    const moveSurface = this.world.surfaceAfterMove;
    const xSurface = typeof moveSurface === 'function'
      ? moveSurface.call(
        this.world,
        npc.surfaceId,
        npc.x,
        npc.y,
        nextX,
        npc.y,
        PEDESTRIAN_RADIUS,
        'pedestrian'
      )
      : npc.surfaceId;
    if (xSurface && (!avoidEnteringRoad || startedOnRoad || !this.world.isRoadAt(nextX, npc.y))) {
      npc.x = nextX;
      npc.surfaceId = xSurface;
      moved = true;
    }
    const ySurface = typeof moveSurface === 'function'
      ? moveSurface.call(
        this.world,
        npc.surfaceId,
        npc.x,
        npc.y,
        npc.x,
        nextY,
        PEDESTRIAN_RADIUS,
        'pedestrian'
      )
      : npc.surfaceId;
    if (ySurface && (!avoidEnteringRoad || startedOnRoad || !this.world.isRoadAt(npc.x, nextY))) {
      npc.y = nextY;
      npc.surfaceId = ySurface;
      moved = true;
    }
    return moved;
  }
}
