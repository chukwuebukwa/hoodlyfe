import type {GameEvent} from '../events/game-events.ts';
import {RaceEntrantState} from '../../state.ts';
import type {DistrictState, PlayerState, VehicleState} from '../../state.ts';
import type {
  ArenaRaceTrackDefinition,
  RaceGridPose
} from '../../../shared/content/arena-race.ts';

const COUNTDOWN_MS = 5_000;
const RESULTS_MS = 12_000;
const MINIMUM_CHECKPOINT_REENTRY_MS = 500;

interface ArenaRaceControllerOptions {
  state: DistrictState;
  track: ArenaRaceTrackDefinition;
  spawnVehicle(player: PlayerState, pose: RaceGridPose, gridIndex: number): VehicleState;
  resetVehicle(vehicle: VehicleState, pose: RaceGridPose): void;
  removeVehicle(vehicleId: string): void;
  notice(playerId: string, message: string, tone: 'info' | 'success' | 'warning'): void;
}

interface EntrantRuntime {
  insideCheckpoint: boolean;
  lastCheckpointAt: number;
  lapStartedAt: number;
}

export class ArenaRaceController {
  private readonly runtime = new Map<string, EntrantRuntime>();

  constructor(private readonly options: ArenaRaceControllerOptions) {
    const race = options.state.race;
    race.trackId = options.track.id;
    race.trackLabel = options.track.label;
    race.lapsRequired = options.track.laps;
    race.phase = 'waiting';
    this.updateCheckpointProjection();
  }

  register(player: PlayerState): void {
    let entrant = this.options.state.race.entrants.get(player.id);
    if (!entrant) {
      entrant = new RaceEntrantState();
      entrant.playerId = player.id;
      entrant.playerName = player.name;
      this.options.state.race.entrants.set(player.id, entrant);
    }
    entrant.playerName = player.name;
    const gridIndex = this.gridIndex(player.id);
    const vehicle = this.options.spawnVehicle(player, this.gridPose(gridIndex), gridIndex);
    entrant.vehicleId = vehicle.id;
    entrant.finished = false;
    this.runtime.set(player.id, {
      insideCheckpoint: false,
      lastCheckpointAt: Number.NEGATIVE_INFINITY,
      lapStartedAt: 0
    });
    this.updateCheckpointProjection();
  }

  unregister(playerId: string): void {
    const entrant = this.options.state.race.entrants.get(playerId);
    if (entrant?.vehicleId) this.options.removeVehicle(entrant.vehicleId);
    const player = this.options.state.players.get(playerId);
    if (player) {
      player.vehicleId = '';
      player.vehicleSeat = -1;
    }
    this.options.state.race.entrants.delete(playerId);
    this.runtime.delete(playerId);
    if (this.options.state.race.entrants.size === 0) this.resetWaiting();
  }

  update(nowMs: number): void {
    const race = this.options.state.race;
    if (race.phase === 'waiting') {
      if (race.entrants.size > 0) {
        race.phase = 'countdown';
        race.countdownEndsAt = nowMs + COUNTDOWN_MS;
        this.resetGrid();
      }
      return;
    }
    if (race.phase === 'countdown') {
      this.holdGrid();
      if (nowMs >= race.countdownEndsAt) this.startRace(nowMs);
      return;
    }
    if (race.phase === 'results') {
      if (nowMs >= race.resultsEndsAt) this.resetHeat(nowMs);
      return;
    }
    this.updateRacing(nowMs);
  }

  observeEvents(_events: readonly GameEvent[]): void {}

  private startRace(nowMs: number): void {
    const race = this.options.state.race;
    race.phase = 'racing';
    race.startedAt = nowMs;
    race.countdownEndsAt = 0;
    for (const entrant of race.entrants.values()) {
      entrant.lap = 1;
      entrant.checkpointIndex = 1;
      entrant.finished = false;
      entrant.finishTimeMs = 0;
      entrant.lastLapMs = 0;
      entrant.bestLapMs = 0;
      const runtime = this.runtime.get(entrant.playerId);
      if (runtime) {
        runtime.insideCheckpoint = false;
        runtime.lastCheckpointAt = nowMs;
        runtime.lapStartedAt = nowMs;
      }
      this.options.notice(entrant.playerId, 'GO!', 'success');
    }
    this.updateCheckpointProjection();
  }

  private updateRacing(nowMs: number): void {
    const race = this.options.state.race;
    let active = 0;
    for (const entrant of race.entrants.values()) {
      if (entrant.finished) continue;
      active++;
      const player = this.options.state.players.get(entrant.playerId);
      let vehicle = entrant.vehicleId
        ? this.options.state.vehicles.get(entrant.vehicleId)
        : undefined;
      if (!player) continue;
      if (!vehicle) {
        vehicle = this.options.spawnVehicle(
          player,
          this.gridPose(this.gridIndex(player.id)),
          this.gridIndex(player.id)
        );
        entrant.vehicleId = vehicle.id;
        entrant.checkpointIndex = 1;
        continue;
      }
      if (vehicle.destroyed) {
        this.options.resetVehicle(vehicle, this.gridPose(this.gridIndex(player.id)));
        entrant.checkpointIndex = 1;
        entrant.lap = Math.max(1, entrant.lap);
      }
      const checkpoint = this.options.track.checkpoints[entrant.checkpointIndex];
      if (!checkpoint) continue;
      const distance = Math.hypot(vehicle.x - checkpoint.x, vehicle.y - checkpoint.y);
      const runtime = this.runtime.get(entrant.playerId);
      if (!runtime) continue;
      const inside = distance <= checkpoint.radius;
      if (
        inside &&
        !runtime.insideCheckpoint &&
        nowMs - runtime.lastCheckpointAt >= MINIMUM_CHECKPOINT_REENTRY_MS
      ) {
        runtime.lastCheckpointAt = nowMs;
        this.advanceCheckpoint(entrant, runtime, nowMs);
      }
      runtime.insideCheckpoint = inside;
    }
    this.updatePositions();
    this.updateCheckpointProjection();
    if (active === 0 && race.entrants.size > 0) this.finishHeat(nowMs);
  }

  private advanceCheckpoint(
    entrant: RaceEntrantState,
    runtime: EntrantRuntime,
    nowMs: number
  ): void {
    const checkpointCount = this.options.track.checkpoints.length;
    if (entrant.checkpointIndex === checkpointCount - 1) {
      entrant.checkpointIndex = 0;
      return;
    }
    if (entrant.checkpointIndex > 0) {
      entrant.checkpointIndex++;
      return;
    }
    const lapTime = nowMs - runtime.lapStartedAt;
    entrant.lastLapMs = lapTime;
    entrant.bestLapMs = entrant.bestLapMs > 0
      ? Math.min(entrant.bestLapMs, lapTime)
      : lapTime;
    if (entrant.lap >= this.options.track.laps) {
      entrant.finished = true;
      entrant.finishTimeMs = nowMs - this.options.state.race.startedAt;
      this.options.notice(
        entrant.playerId,
        `Finished P${this.finishedCount()} - ${formatRaceTime(entrant.finishTimeMs)}`,
        'success'
      );
      return;
    }
    entrant.lap++;
    entrant.checkpointIndex = 1;
    runtime.lapStartedAt = nowMs;
    this.options.notice(
      entrant.playerId,
      `Lap ${entrant.lap}/${this.options.track.laps}`,
      'info'
    );
  }

  private finishHeat(nowMs: number): void {
    const race = this.options.state.race;
    race.phase = 'results';
    race.finishedAt = nowMs;
    race.resultsEndsAt = nowMs + RESULTS_MS;
  }

  private resetHeat(nowMs: number): void {
    const race = this.options.state.race;
    race.raceNumber++;
    race.phase = 'countdown';
    race.startedAt = 0;
    race.finishedAt = 0;
    race.resultsEndsAt = 0;
    race.countdownEndsAt = nowMs + COUNTDOWN_MS;
    for (const entrant of race.entrants.values()) {
      entrant.lap = 0;
      entrant.checkpointIndex = 0;
      entrant.finished = false;
      entrant.finishTimeMs = 0;
      entrant.lastLapMs = 0;
      entrant.bestLapMs = 0;
    }
    this.resetGrid();
    this.updateCheckpointProjection();
  }

  private resetWaiting(): void {
    const race = this.options.state.race;
    race.phase = 'waiting';
    race.countdownEndsAt = 0;
    race.startedAt = 0;
    race.finishedAt = 0;
    race.resultsEndsAt = 0;
  }

  private resetGrid(): void {
    for (const entrant of this.options.state.race.entrants.values()) {
      const vehicle = this.options.state.vehicles.get(entrant.vehicleId);
      if (vehicle) this.options.resetVehicle(vehicle, this.gridPose(this.gridIndex(entrant.playerId)));
    }
  }

  private holdGrid(): void {
    for (const entrant of this.options.state.race.entrants.values()) {
      const vehicle = this.options.state.vehicles.get(entrant.vehicleId);
      if (!vehicle) continue;
      this.options.resetVehicle(vehicle, this.gridPose(this.gridIndex(entrant.playerId)));
    }
  }

  private updatePositions(): void {
    const checkpointCount = this.options.track.checkpoints.length;
    const entrants = [...this.options.state.race.entrants.values()];
    entrants.sort((left, right) => {
      if (left.finished !== right.finished) return left.finished ? -1 : 1;
      if (left.finished) return left.finishTimeMs - right.finishTimeMs;
      const leftProgress = left.lap * checkpointCount + left.checkpointIndex;
      const rightProgress = right.lap * checkpointCount + right.checkpointIndex;
      if (leftProgress !== rightProgress) return rightProgress - leftProgress;
      return left.playerId.localeCompare(right.playerId);
    });
    entrants.forEach((entrant, index) => {
      entrant.position = index + 1;
    });
  }

  private updateCheckpointProjection(): void {
    for (const entrant of this.options.state.race.entrants.values()) {
      const checkpoint = this.options.track.checkpoints[entrant.checkpointIndex] ??
        this.options.track.checkpoints[0];
      entrant.nextCheckpointX = checkpoint.x;
      entrant.nextCheckpointY = checkpoint.y;
      entrant.nextCheckpointRadius = checkpoint.radius;
    }
  }

  private finishedCount(): number {
    return [...this.options.state.race.entrants.values()]
      .filter((entrant) => entrant.finished).length;
  }

  private gridIndex(playerId: string): number {
    const ids = [...this.options.state.race.entrants.keys()].sort();
    return Math.max(0, ids.indexOf(playerId));
  }

  private gridPose(index: number): RaceGridPose {
    return this.options.track.grid[index % this.options.track.grid.length];
  }
}

function formatRaceTime(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = ((durationMs % 60_000) / 1_000).toFixed(3).padStart(6, '0');
  return `${minutes}:${seconds}`;
}
