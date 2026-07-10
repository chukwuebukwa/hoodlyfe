import type {DeterministicRandom} from '../world/deterministic-random.ts';
import type {NpcState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {PedestrianIntent} from './pedestrian-intent.ts';
import {PedestrianPathPlanner} from './pedestrian-path-planner.ts';
import {clearPedestrianNavigation, type PedestrianRuntime} from './pedestrian-runtime.ts';

interface PedestrianNavigationOptions {
  random: DeterministicRandom;
  clock: () => {tick: number};
  world?: CollisionMap;
  radius?: number;
  maxPathRequestsPerTick?: number;
}

export class PedestrianNavigationSystem {
  private readonly planner?: PedestrianPathPlanner;
  private readonly radius: number;
  private readonly maxPathRequestsPerTick: number;
  private budgetTick = -1;
  private requestsThisTick = 0;

  constructor(private readonly options: PedestrianNavigationOptions) {
    this.planner = options.world ? new PedestrianPathPlanner(options.world) : undefined;
    this.radius = options.radius ?? 10;
    this.maxPathRequestsPerTick = options.maxPathRequestsPerTick ?? 2;
  }

  resolveAngle(
    npc: NpcState,
    runtime: PedestrianRuntime,
    intent: PedestrianIntent,
    nowMs: number
  ): number {
    if (runtime.avoidUntil > nowMs && intent.speed > 0) return runtime.avoidAngle;
    const targetX = intent.targetX;
    const targetY = intent.targetY;
    if (
      !this.planner ||
      intent.speed <= 0 ||
      typeof targetX !== 'number' || !Number.isFinite(targetX) ||
      typeof targetY !== 'number' || !Number.isFinite(targetY)
    ) {
      if (
        typeof targetX !== 'number' || !Number.isFinite(targetX) ||
        typeof targetY !== 'number' || !Number.isFinite(targetY)
      ) {
        clearPedestrianNavigation(runtime);
      }
      return intent.angle;
    }

    const goal = {x: targetX, y: targetY};
    if (this.planner.pathIsClear(npc, goal, this.radius)) {
      clearPedestrianNavigation(runtime);
      return intent.angle;
    }

    const navigation = runtime.navigation;
    const goalChanged = !Number.isFinite(navigation.goalX) ||
      Math.hypot(goal.x - navigation.goalX, goal.y - navigation.goalY) > 32;
    if (goalChanged) {
      clearPedestrianNavigation(runtime);
      runtime.navigation.goalX = goal.x;
      runtime.navigation.goalY = goal.y;
    }
    if (
      runtime.navigation.waypoints.length === 0 &&
      nowMs >= runtime.navigation.nextPathAt &&
      this.takePathBudget()
    ) {
      const path = this.planner.plan(npc, goal, this.radius);
      runtime.navigation.nextPathAt = nowMs + (path ? 850 : 650);
      if (path) {
        runtime.navigation.waypoints = path.points;
        runtime.navigation.waypointIndex = 0;
        runtime.navigation.routeComplete = path.complete;
      }
    }

    while (runtime.navigation.waypointIndex < runtime.navigation.waypoints.length) {
      const waypoint = runtime.navigation.waypoints[runtime.navigation.waypointIndex];
      if (Math.hypot(waypoint.x - npc.x, waypoint.y - npc.y) > 18) {
        return Math.atan2(waypoint.y - npc.y, waypoint.x - npc.x);
      }
      runtime.navigation.waypointIndex++;
    }
    if (runtime.navigation.waypoints.length > 0) {
      const routeComplete = runtime.navigation.routeComplete;
      runtime.navigation.waypoints = [];
      runtime.navigation.waypointIndex = 0;
      if (!routeComplete) runtime.navigation.nextPathAt = nowMs;
    }
    return intent.angle;
  }

  recoverFromBlock(
    runtime: PedestrianRuntime,
    npcId: string,
    intendedAngle: number,
    nowMs: number
  ): void {
    const detour = Math.PI * this.options.random.range(
      'npc-collision-turn',
      `${npcId}:${this.options.clock().tick}`,
      0.55,
      1.55
    );
    runtime.avoidAngle = normalizeAngle(intendedAngle + detour);
    runtime.avoidUntil = nowMs + 250;
    runtime.wanderAngle = runtime.avoidAngle;
    runtime.nextThinkAt = nowMs + 250;
    runtime.navigation.waypoints = [];
    runtime.navigation.waypointIndex = 0;
    runtime.navigation.nextPathAt = nowMs + 250;
  }

  private takePathBudget(): boolean {
    const tick = this.options.clock().tick;
    if (tick !== this.budgetTick) {
      this.budgetTick = tick;
      this.requestsThisTick = 0;
    }
    if (this.requestsThisTick >= this.maxPathRequestsPerTick) return false;
    this.requestsThisTick++;
    return true;
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
