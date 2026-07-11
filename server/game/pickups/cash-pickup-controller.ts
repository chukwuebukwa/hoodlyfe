import {CashPickupState, type DistrictState, type PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {StreetEconomyPort} from '../economy/street-economy-controller.ts';
import type {GameEvent, GameEventStream} from '../events/game-events.ts';
import {CASH_PICKUP_POLICY, deathCashDrop} from './cash-pickup-policy.ts';

interface CashPickupControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  economy: StreetEconomyPort;
  events: GameEventStream;
  clock: () => {tick: number};
  nearbyPlayers: (x: number, y: number, radius: number) => PlayerState[];
  notice: (playerId: string, message: string, tone: 'success' | 'warning') => void;
}

export class CashPickupController {
  constructor(private readonly options: CashPickupControllerOptions) {}

  observeEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type !== 'entity.killed' || event.entityKind !== 'player') continue;
      this.createDeathDrop(event.entityId, event.tick, event.nowMs);
    }
  }

  update(nowMs: number): void {
    const remove = new Set<string>();
    for (const pickup of this.options.state.cashPickups.values()) {
      if (nowMs >= pickup.expiresAt) {
        remove.add(pickup.id);
        continue;
      }
      if (nowMs < pickup.availableAt) continue;
      const candidates = this.options.nearbyPlayers(
        pickup.x,
        pickup.y,
        CASH_PICKUP_POLICY.collectionRadius
      ).filter((player) => (
        player.alive &&
        (player.spaceId || 'street') === 'street' &&
        !player.vehicleId &&
        !player.action
      )).sort((left, right) => (
        Math.hypot(left.x - pickup.x, left.y - pickup.y) -
          Math.hypot(right.x - pickup.x, right.y - pickup.y) ||
        left.id.localeCompare(right.id)
      ));
      for (const player of candidates) {
        if (Math.hypot(player.x - pickup.x, player.y - pickup.y) > CASH_PICKUP_POLICY.collectionRadius) {
          continue;
        }
        const result = this.options.economy.credit(
          player.id,
          pickup.amount,
          'cash-pickup',
          `cash-pickup:${pickup.id}`,
          nowMs
        );
        if (result.status === 'balance-limit') continue;
        if (result.status !== 'applied' && result.status !== 'duplicate') break;
        remove.add(pickup.id);
        if (result.status === 'applied') {
          const amount = result.transaction?.amount ?? pickup.amount;
          this.options.notice(player.id, `CASH +$${amount}`, 'success');
          this.options.events.publish({
            type: 'cash-pickup.collected',
            tick: this.options.clock().tick,
            nowMs,
            pickupId: pickup.id,
            playerId: player.id,
            amount
          });
        }
        break;
      }
    }
    for (const pickupId of remove) this.options.state.cashPickups.delete(pickupId);
  }

  private createDeathDrop(playerId: string, tick: number, nowMs: number): void {
    if (this.options.state.cashPickups.size >= CASH_PICKUP_POLICY.capacity) return;
    const player = this.options.state.players.get(playerId);
    if (!player) return;
    const amount = deathCashDrop(player.cash);
    if (amount <= 0) return;
    const pickupId = `cash:${playerId}:${tick}`;
    if (this.options.state.cashPickups.has(pickupId)) return;
    const debit = this.options.economy.debit(
      playerId,
      amount,
      'death-drop',
      `death-drop:${playerId}:${tick}`,
      nowMs
    );
    if (debit.status !== 'applied' || !debit.transaction?.amount) return;
    const position = this.options.world.canOccupy(player.x, player.y, 8)
      ? {x: player.x, y: player.y}
      : this.options.world.openPointNear(player.x, player.y, 8, 42, 8, tick + playerId.length * 41);
    const pickup = new CashPickupState();
    pickup.id = pickupId;
    pickup.ownerId = playerId;
    pickup.x = position.x;
    pickup.y = position.y;
    pickup.amount = debit.transaction.amount;
    pickup.availableAt = nowMs + CASH_PICKUP_POLICY.collectionDelayMs;
    pickup.expiresAt = nowMs + CASH_PICKUP_POLICY.lifetimeMs;
    this.options.state.cashPickups.set(pickup.id, pickup);
  }
}
