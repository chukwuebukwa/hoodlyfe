# Street Economy Boundary Research

Date: 2026-07-10

Primary gameplay reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference couples visible service state to explicit eligibility and payment checks, not to arbitrary cash mutations inside combat or vehicle code.

- Shop pickups validate available money before deducting a configured price and granting a weapon/ammunition bundle. Failed purchases preserve the pickup and show a reason.
- Shop pickup availability and world respawn timing are separate from player inventory state.
- Respray garages validate the entire vehicle footprint, static position, supported vehicle type, nearby interference, service price/free policy, and control state before closing.
- Garage service is staged over time. Completion repairs vehicle health and components, clears active fire/explosion state, restores orientation, changes appearance where allowed, applies wanted policy, and only then reopens/releases control.
- Crusher rewards depend on model monetary value and remaining condition, then remove the car and its occupants through owned lifecycle logic.
- GTA2 service shops require enough cash before adding vehicle equipment, reinforcing services as explicit world interactions and currency sinks.

References:

- [`Pickups.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Pickups.cpp)
- [`Garages.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Garages.cpp)
- [GTA2 PC manual](https://gtamp.com/GTA2/gta2manual.pdf)

The references inform ownership, staging, validation, and failure behavior. NOCK0 uses original transaction policy, prices, formulas, events, and tests.

## Current Currency Policy

The current `PlayerState.cash` is temporary street cash:

- session-local;
- server-authoritative;
- integer-denominated;
- bounded to a configured maximum;
- non-redeemable forever;
- not an account balance, token amount, wallet value, or durable ownership record.

`ONCHAIN_INTEGRATION.md` remains controlling for future durable or real-value layers: a database ledger, transactional application service, and async outbox must sit behind room simulation. No chain or database call belongs in a district tick.

## Street Economy Contract

`StreetEconomyController` is the only current owner allowed to change street cash.

- Callers request a credit or debit with player ID, positive safe-integer amount, reason, globally stable idempotency key, and simulation time.
- Successful keys are retained for the room lifetime. A duplicate returns the original transaction and cannot apply twice.
- Invalid, missing-player, insufficient-funds, and balance-limit attempts do not consume the key, allowing a corrected/retried request.
- The registry is bounded and fails closed when full. It never evicts an old key and silently permits replay.
- Credits clamp to the maximum balance and report the actual applied amount.
- Every successful mutation publishes `economy.changed` before applying state, with requested/applied amount, direction, reason, transaction ID, tick, and resulting balance.
- Snapshot output is bounded and copied for future debug/persistence adapters.

Current reasons cover player/civilian/police kills, mission payouts, ammunition, repair, hospital, and clothing. Only kill rewards and mission payouts are wired in this checkpoint.

## Refactored Producers

- `DamageController` requests player, civilian, and police kill credits using victim ID plus authoritative tick keys. It no longer finds an attacker and mutates cash.
- `FreemodeMissionController` requests each participant payout using the mission system's existing participant-specific idempotency key. It emits `mission.payout` and success UI only after the economy mutation applies.
- F3 recent-event summaries expose economy direction, amount, reason, and resulting balance.

Combat and missions still decide why a reward exists. Economy decides whether and how cash changes. Future services decide eligibility and inventory/vehicle effects but must use the same debit port.

## Persistence Replacement

This controller is a deliberate in-memory adapter, not the final durable ledger. The later application layer must preserve the port semantics while adding:

- account/character identity rather than session ID;
- PostgreSQL append-only entries and transactional balance projection;
- durable globally unique idempotency keys;
- reconnect/restart consistency;
- reward caps, kill-trading/collusion detection, and audit metadata;
- outbox publication for selected asynchronous settlement;
- bigint/string representation for any separately denominated onchain value.

Street cash remains isolated even after persistence. It is never bridged or redeemed.

## Acceptance Coverage

- Credits and debits mutate a player's cash once and publish one auditable event each.
- A duplicate successful key cannot mutate twice.
- Failed insufficient-funds debit can retry with the same key after a later credit.
- Missing players, invalid amounts/times/keys, balance limit, and registry capacity fail explicitly.
- Balance caps report actual applied value.
- Zero/non-finite snapshot limits return no records and snapshots are copied.
- Mission participants still receive one payout each and repeated mission updates cannot duplicate it.
- Player/NPC kill rewards still drive HUD cash through authoritative schema state.
- Real two-client combat, mission, vehicle, death, and respawn behavior remains green.
