import type {GameEventStream} from '../events/game-events.ts';
import type {DistrictState, PlayerState} from '../../state.ts';
import {confiscateWeapons, refillAmmo} from '../../weapons.ts';
import type {CrimeResponseController} from '../police/crime-response-controller.ts';
import type {VehicleAccessController} from '../vehicles/vehicle-access-controller.ts';
import type {MedicalCareController} from '../medical/medical-care-controller.ts';
import type {CustodyOutcomePort} from '../police/custody-outcome-controller.ts';

interface PlayerLifecycleControllerOptions {
  state: DistrictState;
  events: GameEventStream;
  access: VehicleAccessController;
  crime: CrimeResponseController;
  medical: Pick<MedicalCareController, 'begin' | 'complete' | 'clearPlayer'>;
  custody: CustodyOutcomePort;
  clock: () => {tick: number};
  resetInput: (playerId: string) => void;
  clearCombatState?: (playerId: string) => void;
}

const SPAWN_PROTECTION_MS = 3000;

export class PlayerLifecycleController {
  private readonly protectionUntil = new Map<string, number>();

  constructor(private readonly options: PlayerLifecycleControllerOptions) {}

  kill(player: PlayerState, nowMs: number, attackerId: string): void {
    player.alive = false;
    player.health = 0;
    player.armor = 0;
    player.wanted = 0;
    player.spawnProtected = false;
    player.reactionKind = '';
    player.reactionProgress = 1;
    this.protectionUntil.delete(player.id);
    this.options.medical.begin(player, player.x, player.y, nowMs);
    this.options.crime.clearSuspect(player.id);
    this.options.events.publish({
      type: 'entity.killed',
      tick: this.options.clock().tick,
      nowMs,
      entityId: player.id,
      entityKind: 'player',
      attackerId
    });
    this.options.resetInput(player.id);
    const vehicle = player.vehicleId ? this.options.state.vehicles.get(player.vehicleId) : undefined;
    this.options.access.removePlayer(player);
    if (vehicle) vehicle.speed *= 0.45;
  }

  tryRespawn(player: PlayerState, nowMs: number): boolean {
    if (nowMs < player.respawnAt) return false;
    const plan = this.options.medical.complete(player.id, nowMs);
    player.x = plan.x;
    player.y = plan.y;
    player.spaceId = plan.spaceId;
    player.angle = plan.angle;
    player.health = 100;
    player.armor = 0;
    player.alive = true;
    player.respawnAt = 0;
    player.respawnCare = '';
    player.spawnProtected = true;
    player.onFire = false;
    player.fireStartedAt = 0;
    player.fireExpiresAt = 0;
    player.reactionKind = '';
    player.reactionProgress = 1;
    this.protectionUntil.set(player.id, nowMs + SPAWN_PROTECTION_MS);
    player.wanted = 0;
    player.vehicleId = '';
    player.vehicleSeat = -1;
    this.options.access.clearAction(player);
    if (plan.restoreAmmo) refillAmmo(player);
    this.options.crime.clearSuspect(player.id);
    this.options.events.publish({
      type: 'player.respawned',
      tick: this.options.clock().tick,
      nowMs,
      playerId: player.id,
      x: player.x,
      y: player.y
    });
    return true;
  }

  completeArrest(
    player: PlayerState,
    arrestId: string,
    officerId: string,
    wantedLevel: number,
    nowMs: number
  ): boolean {
    if (!player.alive || player.action !== 'arrested') return false;
    const outcome = this.options.custody.resolve(player, arrestId, wantedLevel, nowMs);
    this.options.clearCombatState?.(player.id);
    this.options.access.removePlayer(player);
    player.x = outcome.x;
    player.y = outcome.y;
    player.spaceId = outcome.spaceId;
    player.angle = outcome.angle;
    player.health = 100;
    player.armor = 0;
    player.wanted = 0;
    player.spawnProtected = true;
    player.onFire = false;
    player.fireStartedAt = 0;
    player.fireExpiresAt = 0;
    player.reactionKind = '';
    player.reactionProgress = 1;
    confiscateWeapons(player);
    this.protectionUntil.set(player.id, nowMs + SPAWN_PROTECTION_MS);
    this.options.crime.clearSuspect(player.id);
    this.options.resetInput(player.id);
    this.options.events.publish({
      type: 'player.busted',
      tick: this.options.clock().tick,
      nowMs,
      arrestId,
      officerId,
      playerId: player.id,
      wantedLevel,
      fine: outcome.fine,
      x: outcome.x,
      y: outcome.y
    });
    return true;
  }

  isProtected(playerId: string, nowMs: number): boolean {
    return this.options.state.players.get(playerId)?.action === 'arrested' ||
      nowMs < (this.protectionUntil.get(playerId) ?? 0);
  }

  updateProtection(player: PlayerState, nowMs: number): void {
    if (this.isProtected(player.id, nowMs)) return;
    this.cancelProtection(player.id);
  }

  cancelProtection(playerId: string): void {
    this.protectionUntil.delete(playerId);
    const player = this.options.state.players.get(playerId);
    if (player) player.spawnProtected = false;
  }

  clearPlayer(playerId: string): void {
    this.protectionUntil.delete(playerId);
  }
}
