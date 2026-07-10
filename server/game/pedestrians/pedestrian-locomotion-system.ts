import type {NpcState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

export class PedestrianLocomotionSystem {
  constructor(
    private readonly world: CollisionMap,
    private readonly radius: number
  ) {}

  move(npc: NpcState, angle: number, speed: number, deltaSeconds: number): boolean {
    if (speed <= 0) return true;
    const nextX = npc.x + Math.cos(angle) * speed * deltaSeconds;
    const nextY = npc.y + Math.sin(angle) * speed * deltaSeconds;
    let moved = false;
    if (this.world.canOccupy(nextX, npc.y, this.radius)) {
      npc.x = nextX;
      moved = true;
    }
    if (this.world.canOccupy(npc.x, nextY, this.radius)) {
      npc.y = nextY;
      moved = true;
    }
    return moved;
  }
}
