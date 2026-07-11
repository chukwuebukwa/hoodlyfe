export const CASH_PICKUP_POLICY = Object.freeze({
  minimumBalance: 50,
  lossRatio: 0.2,
  maximumDrop: 500,
  collectionRadius: 34,
  collectionDelayMs: 1_000,
  lifetimeMs: 60_000,
  capacity: 48
});

export function deathCashDrop(balance: number): number {
  if (!Number.isFinite(balance) || balance < CASH_PICKUP_POLICY.minimumBalance) return 0;
  return Math.min(
    CASH_PICKUP_POLICY.maximumDrop,
    Math.max(1, Math.floor(balance * CASH_PICKUP_POLICY.lossRatio))
  );
}
