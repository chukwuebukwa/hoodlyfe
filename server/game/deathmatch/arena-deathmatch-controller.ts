import type {ArenaDeathmatchDefinition, DeathmatchSpawnPose} from '../../../shared/content/arena-deathmatch.ts';
import type {GameEvent} from '../events/game-events.ts';
import type {StreetEconomyPort} from '../economy/street-economy-controller.ts';
import {DeathmatchEntrantState, type DistrictState, type PlayerState} from '../../state.ts';
import {confiscateWeapons, setAmmo, setMagazine} from '../../weapons.ts';

const COUNTDOWN_MS = 5_000;
const RESULTS_MS = 12_000;
const RESPAWN_MS = 3_000;
const WINNER_PAYOUT = 1_500;
const PARTICIPATION_PAYOUT = 300;

interface ArenaDeathmatchControllerOptions {
  state: DistrictState;
  arena: ArenaDeathmatchDefinition;
  economy: StreetEconomyPort;
  relocate(player: PlayerState, pose: DeathmatchSpawnPose): void;
  notice(playerId: string, message: string, tone: 'info' | 'success' | 'warning'): void;
}

export class ArenaDeathmatchController {
  private spawnSequence = 0;
  private readonly assignedSpawns = new Map<string, DeathmatchSpawnPose>();

  constructor(private readonly options: ArenaDeathmatchControllerOptions) {
    const match = options.state.deathmatch;
    match.arenaId = options.arena.id;
    match.arenaLabel = options.arena.label;
    match.scoreLimit = options.arena.scoreLimit;
    match.matchDurationMs = options.arena.durationMs;
    match.phase = 'waiting';
  }

  register(player: PlayerState): void {
    let entrant = this.options.state.deathmatch.entrants.get(player.id);
    if (!entrant) {
      entrant = new DeathmatchEntrantState();
      entrant.playerId = player.id;
      this.options.state.deathmatch.entrants.set(player.id, entrant);
    }
    entrant.playerName = player.name;
    entrant.alive = true;
    this.preparePlayer(player);
    this.updatePositions();
  }

  unregister(playerId: string): void {
    this.options.state.deathmatch.entrants.delete(playerId);
    this.assignedSpawns.delete(playerId);
    if (this.options.state.deathmatch.entrants.size === 0) this.resetWaiting();
    else this.updatePositions();
  }

  update(nowMs: number): void {
    const match = this.options.state.deathmatch;
    this.normalizePlayers();
    if (match.phase === 'waiting') {
      if (match.entrants.size > 0) this.beginCountdown(nowMs);
      return;
    }
    if (match.phase === 'countdown') {
      this.holdSpawns();
      if (nowMs >= match.countdownEndsAt) this.startMatch(nowMs);
      return;
    }
    if (match.phase === 'results') {
      if (nowMs >= match.resultsEndsAt) this.beginCountdown(nowMs, true);
      return;
    }
    match.remainingMs = Math.max(0, match.endsAt - nowMs);
    if (match.remainingMs <= 0) this.finishMatch(nowMs);
  }

  observeEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'entity.killed' && event.entityKind === 'player') {
        this.recordKill(event.entityId, event.attackerId, event.nowMs);
      } else if (event.type === 'player.respawned') {
        this.respawn(event.playerId);
      }
    }
  }

  private recordKill(victimId: string, attackerId: string, nowMs: number): void {
    const match = this.options.state.deathmatch;
    if (match.phase !== 'active') return;
    const victim = match.entrants.get(victimId);
    if (!victim) return;
    victim.deaths++;
    victim.streak = 0;
    victim.alive = false;
    const victimPlayer = this.options.state.players.get(victimId);
    if (victimPlayer) victimPlayer.respawnAt = nowMs + RESPAWN_MS;

    const attacker = attackerId !== victimId ? match.entrants.get(attackerId) : undefined;
    if (attacker) {
      attacker.kills++;
      attacker.score++;
      attacker.streak++;
      this.options.notice(attackerId, `Eliminated ${victim.playerName}`, 'success');
    }
    this.updatePositions();
    if (attacker && attacker.score >= match.scoreLimit) this.finishMatch(nowMs, attackerId);
  }

  private respawn(playerId: string): void {
    const entrant = this.options.state.deathmatch.entrants.get(playerId);
    const player = this.options.state.players.get(playerId);
    if (!entrant || !player) return;
    entrant.alive = true;
    this.preparePlayer(player);
  }

  private beginCountdown(nowMs: number, advanceMatch = false): void {
    const match = this.options.state.deathmatch;
    if (advanceMatch) match.matchNumber++;
    match.phase = 'countdown';
    match.countdownEndsAt = nowMs + COUNTDOWN_MS;
    match.startedAt = 0;
    match.endsAt = 0;
    match.finishedAt = 0;
    match.resultsEndsAt = 0;
    match.remainingMs = match.matchDurationMs;
    match.winnerId = '';
    match.winnerName = '';
    for (const entrant of match.entrants.values()) {
      entrant.kills = 0;
      entrant.deaths = 0;
      entrant.score = 0;
      entrant.streak = 0;
      entrant.position = 1;
      entrant.alive = true;
      const player = this.options.state.players.get(entrant.playerId);
      if (player) this.preparePlayer(player);
      this.options.notice(entrant.playerId, 'Deathmatch starts in 5', 'info');
    }
  }

  private startMatch(nowMs: number): void {
    const match = this.options.state.deathmatch;
    match.phase = 'active';
    match.countdownEndsAt = 0;
    match.startedAt = nowMs;
    match.endsAt = nowMs + match.matchDurationMs;
    match.remainingMs = match.matchDurationMs;
    for (const entrant of match.entrants.values()) {
      this.options.notice(entrant.playerId, 'FIGHT!', 'success');
    }
  }

  private finishMatch(nowMs: number, forcedWinnerId?: string): void {
    const match = this.options.state.deathmatch;
    if (match.phase !== 'active') return;
    this.updatePositions();
    const winner = forcedWinnerId
      ? match.entrants.get(forcedWinnerId)
      : [...match.entrants.values()].sort(compareEntrants)[0];
    match.phase = 'results';
    match.finishedAt = nowMs;
    match.resultsEndsAt = nowMs + RESULTS_MS;
    match.remainingMs = 0;
    match.winnerId = winner?.playerId ?? '';
    match.winnerName = winner?.playerName ?? '';
    for (const entrant of match.entrants.values()) {
      const won = entrant.playerId === winner?.playerId;
      const payout = won ? WINNER_PAYOUT : PARTICIPATION_PAYOUT;
      this.options.economy.credit(
        entrant.playerId,
        payout,
        'activity-payout',
        `deathmatch:${match.matchNumber}:${entrant.playerId}`,
        nowMs
      );
      this.options.notice(
        entrant.playerId,
        won ? `Victory +$${payout}` : `${winner?.playerName ?? 'No winner'} wins +$${payout}`,
        won ? 'success' : 'info'
      );
    }
  }

  private normalizePlayers(): void {
    for (const entrant of this.options.state.deathmatch.entrants.values()) {
      const player = this.options.state.players.get(entrant.playerId);
      if (!player) continue;
      player.wanted = 0;
    }
  }

  private preparePlayer(player: PlayerState): void {
    const spawn = this.nextSpawn();
    this.assignedSpawns.set(player.id, spawn);
    this.options.relocate(player, spawn);
    player.health = 100;
    player.armor = 50;
    player.alive = true;
    player.wanted = 0;
    player.respawnAt = 0;
    player.vehicleId = '';
    player.vehicleSeat = -1;
    equipDeathmatchLoadout(player);
  }

  private holdSpawns(): void {
    for (const entrant of this.options.state.deathmatch.entrants.values()) {
      const player = this.options.state.players.get(entrant.playerId);
      const spawn = this.assignedSpawns.get(entrant.playerId);
      if (player && spawn) this.options.relocate(player, spawn);
    }
  }

  private nextSpawn(): DeathmatchSpawnPose {
    const spawns = this.options.arena.spawns;
    const spawn = spawns[this.spawnSequence % spawns.length];
    this.spawnSequence++;
    return spawn;
  }

  private updatePositions(): void {
    [...this.options.state.deathmatch.entrants.values()]
      .sort(compareEntrants)
      .forEach((entrant, index) => {
        entrant.position = index + 1;
      });
  }

  private resetWaiting(): void {
    const match = this.options.state.deathmatch;
    match.phase = 'waiting';
    match.countdownEndsAt = 0;
    match.startedAt = 0;
    match.endsAt = 0;
    match.finishedAt = 0;
    match.resultsEndsAt = 0;
    match.remainingMs = match.matchDurationMs;
    match.winnerId = '';
    match.winnerName = '';
  }
}

function equipDeathmatchLoadout(player: PlayerState): void {
  confiscateWeapons(player);
  player.weapon = 'smg';
  setMagazine(player, 'pistol', 12);
  setAmmo(player, 'pistol', 72);
  setMagazine(player, 'smg', 30);
  setAmmo(player, 'smg', 150);
  setMagazine(player, 'shotgun', 6);
  setAmmo(player, 'shotgun', 30);
}

function compareEntrants(
  left: DeathmatchEntrantState,
  right: DeathmatchEntrantState
): number {
  return right.score - left.score ||
    right.kills - left.kills ||
    left.deaths - right.deaths ||
    left.playerId.localeCompare(right.playerId);
}
