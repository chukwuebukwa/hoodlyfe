import {
  SEAMLESS_GARAGE_DOORS,
  type SeamlessGarageDoorDefinition
} from '../../../shared/content/seamless-interior-catalog.ts';
import {
  garageDoorProgress,
  type GarageDoorPhase
} from '../../../shared/content/garage-door.ts';
import type {PhysicsWorld} from '../../../shared/physics/physics-world.ts';
import {GarageDoorState, type DistrictState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

export const GARAGE_DOOR_PASSABLE_PROGRESS = 0.78;
const DOORWAY_SAFETY_MARGIN = 52;

interface GarageDoorControllerOptions {
  state: DistrictState;
  world: Pick<CollisionMap, 'setGarageDoorPassable'>;
  physics: Pick<PhysicsWorld, 'setControlledStaticEnabled'>;
}

export class GarageDoorController {
  private readonly holdUntil = new Map<string, number>();
  private readonly passable = new Map<string, boolean>();

  constructor(private readonly options: GarageDoorControllerOptions) {}

  initialize(nowMs = 0): void {
    this.options.state.garageDoors.clear();
    this.holdUntil.clear();
    this.passable.clear();
    for (const door of [...SEAMLESS_GARAGE_DOORS].sort((left, right) => (
      left.id.localeCompare(right.id)
    ))) {
      const state = new GarageDoorState();
      state.id = door.id;
      state.phaseStartedAt = nowMs;
      this.options.state.garageDoors.set(door.id, state);
      this.setPassable(door.id, false);
    }
  }

  update(nowMs: number): void {
    for (const door of SEAMLESS_GARAGE_DOORS) {
      const state = this.options.state.garageDoors.get(door.id);
      if (!state) continue;
      state.progress = garageDoorProgress(asTimeline(state), door.animationMs, nowMs);
      const triggered = this.isTriggered(door);
      const obstructed = this.isDoorwayObstructed(door);

      if (state.phase === 'closed') {
        if (triggered) this.transition(state, 'opening', nowMs, 0);
      } else if (state.phase === 'opening') {
        if (state.progress >= 1) {
          this.transition(state, 'open', nowMs, 1);
          this.holdUntil.set(door.id, nowMs + door.holdOpenMs);
        }
      } else if (state.phase === 'open') {
        if (triggered || obstructed) {
          this.holdUntil.set(door.id, nowMs + door.holdOpenMs);
        } else if (nowMs >= (this.holdUntil.get(door.id) ?? nowMs)) {
          this.transition(state, 'closing', nowMs, 1);
        }
      } else if (state.phase === 'closing') {
        if (triggered || obstructed) {
          this.transition(state, 'opening', nowMs, state.progress);
        } else if (state.progress <= 0) {
          this.transition(state, 'closed', nowMs, 0);
        }
      }

      state.progress = garageDoorProgress(asTimeline(state), door.animationMs, nowMs);
      this.setPassable(door.id, state.progress >= GARAGE_DOOR_PASSABLE_PROGRESS);
    }
  }

  private isTriggered(door: SeamlessGarageDoorDefinition): boolean {
    for (const player of this.options.state.players.values()) {
      if (
        player.alive && player.spaceId === 'street' &&
        Math.hypot(player.x - door.x, player.y - door.y) <= door.openRadius
      ) return true;
    }
    for (const vehicle of this.options.state.vehicles.values()) {
      if (
        !vehicle.destroyed && vehicle.driverId &&
        Math.hypot(vehicle.x - door.x, vehicle.y - door.y) <= door.openRadius
      ) return true;
    }
    return false;
  }

  private isDoorwayObstructed(door: SeamlessGarageDoorDefinition): boolean {
    for (const player of this.options.state.players.values()) {
      if (
        player.alive && player.spaceId === 'street' &&
        distanceToRect(player.x, player.y, door) <= DOORWAY_SAFETY_MARGIN
      ) return true;
    }
    for (const vehicle of this.options.state.vehicles.values()) {
      if (
        !vehicle.destroyed &&
        distanceToRect(vehicle.x, vehicle.y, door) <= DOORWAY_SAFETY_MARGIN
      ) return true;
    }
    return false;
  }

  private transition(
    state: GarageDoorState,
    phase: GarageDoorPhase,
    nowMs: number,
    progress: number
  ): void {
    state.phase = phase;
    state.phaseStartedAt = nowMs;
    state.transitionFrom = progress;
    state.progress = progress;
  }

  private setPassable(id: string, passable: boolean): void {
    if (this.passable.get(id) === passable) return;
    this.passable.set(id, passable);
    this.options.world.setGarageDoorPassable(id, passable);
    this.options.physics.setControlledStaticEnabled(id, !passable);
  }
}

function asTimeline(state: GarageDoorState) {
  return {
    phase: state.phase as GarageDoorPhase,
    phaseStartedAt: state.phaseStartedAt,
    transitionFrom: state.transitionFrom,
    progress: state.progress
  };
}

function distanceToRect(
  x: number,
  y: number,
  rect: {minX: number; minY: number; maxX: number; maxY: number}
): number {
  const nearestX = Math.max(rect.minX, Math.min(x, rect.maxX));
  const nearestY = Math.max(rect.minY, Math.min(y, rect.maxY));
  return Math.hypot(x - nearestX, y - nearestY);
}
