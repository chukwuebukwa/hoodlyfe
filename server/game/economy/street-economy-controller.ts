import type {DistrictState} from '../../state.ts';
import type {GameEventStream} from '../events/game-events.ts';

export type StreetEconomyDirection = 'credit' | 'debit';
export type StreetEconomyReason =
  | 'player-kill'
  | 'civilian-kill'
  | 'police-kill'
  | 'mission-payout'
  | 'ammunition'
  | 'vehicle-repair'
  | 'hospital'
  | 'clothing';

export type StreetEconomyStatus =
  | 'applied'
  | 'duplicate'
  | 'invalid'
  | 'player-missing'
  | 'insufficient-funds'
  | 'balance-limit'
  | 'capacity-exceeded';

export interface StreetEconomyTransaction {
  id: string;
  playerId: string;
  direction: StreetEconomyDirection;
  reason: StreetEconomyReason;
  requestedAmount: number;
  amount: number;
  previousBalance: number;
  balance: number;
  tick: number;
  nowMs: number;
}

export interface StreetEconomyResult {
  status: StreetEconomyStatus;
  transaction?: StreetEconomyTransaction;
}

export interface StreetEconomyPort {
  credit(
    playerId: string,
    amount: number,
    reason: StreetEconomyReason,
    idempotencyKey: string,
    nowMs: number
  ): StreetEconomyResult;
  debit(
    playerId: string,
    amount: number,
    reason: StreetEconomyReason,
    idempotencyKey: string,
    nowMs: number
  ): StreetEconomyResult;
}

interface StreetEconomyControllerOptions {
  state: DistrictState;
  events: GameEventStream;
  clock: () => {tick: number};
  maximumBalance?: number;
  transactionCapacity?: number;
}

export class StreetEconomyController implements StreetEconomyPort {
  private readonly processed = new Map<string, StreetEconomyTransaction>();
  private readonly maximumBalance: number;
  private readonly transactionCapacity: number;

  constructor(private readonly options: StreetEconomyControllerOptions) {
    this.maximumBalance = positiveInteger(options.maximumBalance ?? 9_999_999, 'Maximum balance');
    this.transactionCapacity = positiveInteger(
      options.transactionCapacity ?? 8192,
      'Transaction capacity'
    );
  }

  get size(): number {
    return this.processed.size;
  }

  credit(
    playerId: string,
    amount: number,
    reason: StreetEconomyReason,
    idempotencyKey: string,
    nowMs: number
  ): StreetEconomyResult {
    return this.apply('credit', playerId, amount, reason, idempotencyKey, nowMs);
  }

  debit(
    playerId: string,
    amount: number,
    reason: StreetEconomyReason,
    idempotencyKey: string,
    nowMs: number
  ): StreetEconomyResult {
    return this.apply('debit', playerId, amount, reason, idempotencyKey, nowMs);
  }

  snapshot(limit = 32): StreetEconomyTransaction[] {
    if (!Number.isFinite(limit) || limit <= 0) return [];
    const boundedLimit = Math.max(0, Math.min(this.processed.size, Math.floor(limit)));
    return [...this.processed.values()].slice(-boundedLimit).map((transaction) => ({...transaction}));
  }

  private apply(
    direction: StreetEconomyDirection,
    playerId: string,
    amount: number,
    reason: StreetEconomyReason,
    idempotencyKey: string,
    nowMs: number
  ): StreetEconomyResult {
    const transactionId = idempotencyKey.trim();
    if (
      !transactionId ||
      transactionId.length > 160 ||
      !validAmount(amount) ||
      !Number.isFinite(nowMs) ||
      nowMs < 0
    ) {
      return {status: 'invalid'};
    }
    const duplicate = this.processed.get(transactionId);
    if (duplicate) return {status: 'duplicate', transaction: {...duplicate}};
    if (this.processed.size >= this.transactionCapacity) return {status: 'capacity-exceeded'};
    const player = this.options.state.players.get(playerId);
    if (!player) return {status: 'player-missing'};

    const previousBalance = normalizeBalance(player.cash, this.maximumBalance);
    if (direction === 'debit' && previousBalance < amount) return {status: 'insufficient-funds'};
    const requestedBalance = direction === 'credit'
      ? previousBalance + amount
      : previousBalance - amount;
    const balance = Math.max(0, Math.min(this.maximumBalance, requestedBalance));
    const appliedAmount = Math.abs(balance - previousBalance);
    if (direction === 'credit' && appliedAmount === 0) return {status: 'balance-limit'};

    const transaction: StreetEconomyTransaction = {
      id: transactionId,
      playerId,
      direction,
      reason,
      requestedAmount: amount,
      amount: appliedAmount,
      previousBalance,
      balance,
      tick: this.options.clock().tick,
      nowMs
    };
    this.options.events.publish({
      type: 'economy.changed',
      tick: transaction.tick,
      nowMs,
      transactionId,
      playerId,
      direction,
      reason,
      requestedAmount: amount,
      amount: appliedAmount,
      balance
    });
    player.cash = balance;
    this.processed.set(transactionId, transaction);
    return {status: 'applied', transaction: {...transaction}};
  }
}

function validAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0;
}

function normalizeBalance(balance: number, maximum: number): number {
  if (!Number.isFinite(balance)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(balance)));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  return value;
}
