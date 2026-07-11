import type {NpcState, PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {PedestrianIntent} from './pedestrian-intent.ts';
import type {PedestrianRuntime} from './pedestrian-runtime.ts';
import {NPC_MELEE} from '../../../shared/content/pedestrian-combat.ts';

const HOSTILE_STOP_DISTANCE = 105;
const HOSTILE_FIRE_DISTANCE = 430;
const HOSTILE_MOVE_SPEED = 158;

export class PedestrianCombatSystem {
  constructor(private readonly world: CollisionMap) {}

  decide(
    npc: NpcState,
    runtime: PedestrianRuntime,
    target: PlayerState,
    nowMs: number
  ): PedestrianIntent {
    const angle = Math.atan2(target.y - npc.y, target.x - npc.x);
    const distance = Math.hypot(target.x - npc.x, target.y - npc.y);
    const canSeeTarget = distance <= HOSTILE_FIRE_DISTANCE && this.world.hasLineOfSight(
      npc.x,
      npc.y,
      target.x,
      target.y
    );
    const pointBlank = canSeeTarget && !target.vehicleId && target.spaceId === 'street' &&
      distance <= NPC_MELEE.engageDistance;
    const canMelee = pointBlank && nowMs >= runtime.melee.cooldownUntil;
    const canFire = !pointBlank && canSeeTarget &&
      nowMs - runtime.lastShotAt >= runtime.combatFireCooldownMs;
    if (canFire) runtime.lastShotAt = nowMs;
    return {
      objective: 'assault',
      angle,
      speed: pointBlank ? 0 : (distance > HOSTILE_STOP_DISTANCE || !canSeeTarget ? HOSTILE_MOVE_SPEED : 0),
      fire: canFire,
      aimAngle: angle,
      targetX: target.x,
      targetY: target.y,
      meleeTargetId: canMelee ? target.id : undefined
    };
  }
}
