import type {NpcState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

export class PedestrianLocomotionSystem {
  constructor(
    private readonly world: CollisionMap,
    private readonly radius: number
  ) {}

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
    if (
      this.world.canOccupy(nextX, npc.y, this.radius) &&
      (!avoidEnteringRoad || startedOnRoad || !this.world.isRoadAt(nextX, npc.y))
    ) {
      npc.x = nextX;
      moved = true;
    }
    if (
      this.world.canOccupy(npc.x, nextY, this.radius) &&
      (!avoidEnteringRoad || startedOnRoad || !this.world.isRoadAt(npc.x, nextY))
    ) {
      npc.y = nextY;
      moved = true;
    }
    return moved;
  }
}
