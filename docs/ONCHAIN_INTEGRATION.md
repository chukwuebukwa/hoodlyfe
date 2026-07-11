# NOCK0 Onchain Integration Plan

Date: 2026-07-10

## Executive Summary

This document specifies how NOCK0 integrates with Robinhood Chain (an Arbitrum-built Ethereum L2, chain ID 4663, ETH gas, RPC `rpc.mainnet.chain.robinhood.com`) without compromising the game loop, the authoritative-server contract, or the phased plan in [`ENGINEERING_REPORT.md`](ENGINEERING_REPORT.md) and [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md).

The design rests on one principle: **the blockchain is a settlement layer behind the persistence boundary the docs already define — it is never a gameplay system.** Rooms propose; a transactional layer settles; an outbox worker mirrors selected entries onchain. No simulation code awaits a chain RPC, ever.

Four hard gates precede any real-value mechanic, in order:

1. **Asset replacement.** The map and vehicle sheets are GTA2-derived and non-redistributable ([`ASSETS.md`](ASSETS.md)). Attaching real value to a publicly served build of Rockstar-derived assets combines copyright infringement with commercial exploitation. Original map and vehicle art is the launch gate for everything below.
2. **Identity and persistence** (existing Phase 1): accounts, `onAuth`, PostgreSQL ledger, reconnection. The Phase 1 exit gate — economic state cannot duplicate or disappear under reconnect and restart — is exactly the bar real-value mechanics must clear.
3. **Anti-abuse minimums**: server-side rate limiting, aim-rotation caps, sybil and collusion controls on reward flows, per-client state filtering.
4. **Regulatory review** of any mechanic that moves real value (exchange frontend, prize pools, bounties) before it ships.

## Current State (What the Integration Builds Against)

- **Value today** is a single `PlayerState.cash` number (`server/state.ts:11`) minted at exactly two sites — `server/district-room.ts:806` (+100 per player kill) and `:824` (+200 police / +50 civilian NPC kill) — with zero sinks. NPCs respawn in 5.5 s and players respawn free in 3 s with refilled ammunition, so the faucet is infinite and collusion-farmable. Cash evaporates in `onLeave` (`district-room.ts:127-132`) and on restart.
- **Identity today** is a client-chosen guest name in localStorage (`src/main.ts:45-53`). There is no `onAuth`, no reconnection, no account concept, and CORS reflects any origin (`server/index.ts:10`).
- **Unwired foundation** under `server/game/` (tested in `test/simulation-foundation.test.ts`, imported by nothing else): `GameEventStream` with typed `damage.applied` / `entity.killed` / `crime.committed` / `player.respawned` events, `DeferredCommandQueue` (keyed idempotent batching), `FixedStepClock`, `DeterministicRandom`, `SpatialIndex`. These are the intended seams for the settlement pipeline.
- **Interaction primitives**: the timed-action state machine (`PlayerState.action/actionUntil`, `district-room.ts:544-603`) generalizes from vehicle entry to any "stand here N ms" interaction. The Tiled map has no object/trigger layer yet (`server/world-map.ts` parses only `ground`/`collisions`/`roads`).
- **Client surface**: DOM-overlay HUD (`index.html`, `district-scene.ts:709-760`) accepts new panels without touching Phaser. The client is vanilla TS — no React — and any pointer-down on the canvas fires a weapon (`district-scene.ts:468`), so a UI-open input gate must precede any clickable panel.

## Economy Architecture: Three Layers

### Layer 1 — Street cash (closed, forever)

Kill bounties, pickups, and arcade score remain soft currency: printable, sinkable, balance-patchable, and **never redeemable for real value**. Rationale: any bridge from a mintable gameplay currency to real value converts every faucet into an exploit and every balance patch into a market event (the Axie Infinity failure mode). Street cash additionally needs sinks regardless of this plan (ammunition purchase, vehicle repair, hospital fees on death) to function as an economy at all.

### Layer 2 — Durable ledger (custodial, offchain)

The Phase 1 deliverable, unchanged: PostgreSQL, append-only economy ledger, idempotency keys for rewards and purchases, account/character identity distinct from session ID, room cash presentation separated from durable balances (`PROJECT_STRUCTURE.md`, Economy and Persistence Boundaries). Real-value balances (prize winnings, owned items) live here. Rooms never write it directly: gameplay systems publish to `GameEventStream`; a consumer drains the stream per tick and applies policy (caps, dedup, anti-abuse) before the ledger.

### Layer 3 — Robinhood Chain settlement (async, batched)

An outbox worker (the planned `server/persistence/outbox/`) submits transactions to chain 4663, tracks receipts, retries idempotently, and reconciles the ledger. Deposits and onchain events enter via an indexer/webhook receiver on the Express app (`server/index.ts`), not via the room. The 30 Hz `update()` loop (`district-room.ts:229-254`) stays synchronous; players see optimistic in-game display with "settling" status in the HUD where relevant.

Value representation rule: token amounts are bigint/string end to end and convert to display units only at the presentation edge. The float64 `cash` schema field is never reused for onchain-denominated balances.

## Identity: Embedded Wallets, Progressive Reveal

- Privy embedded wallets (email/passkey/social; no extension, no seed phrase) are created silently at first join. Players never see a wallet until the first moment it matters (for example, a prize payout), at which point it already exists and holds their funds.
- Client: a login/lobby step is inserted before the top-level `joinOrCreate` (`src/main.ts:16-17`); the Privy access token rides in the join options. Because the client has no React, use Privy's core JS SDK or mount an isolated React island solely for wallet UI.
- Server: a new `DistrictRoom.onAuth` (Colyseus 0.16 static hook, above `onJoin` at `district-room.ts:109`) verifies the Privy JWT, resolves the durable account, and binds the wallet address. Guest play remains allowed; guest-to-wallet upgrade preserves progress via the account record, not the session.
- Prerequisites at the same layer: `allowReconnection` in `onLeave`, a duplicate-login policy, pinned CORS origins, and a UI-open input gate on the client so wallet modals do not fire weapons.
- Schema note: nothing wallet- or balance-shaped enters `DistrictState` without per-client filtering (Colyseus `StateView`); today every field replicates to all 32 clients.

## Mechanics (Ranked by Fit and Sequenced)

### 1. The Exchange (in-world building, non-custodial frontend)

An exchange floor as an interior — a Tiled trigger zone at the door, the existing timed-action pattern for entry, and a separate Colyseus room for the interior per the interiors plan (`ENGINEERING_REPORT.md:190`). Inside, the UI is a **skin over non-custodial swaps**: every trade is the player's own embedded wallet signing a real Uniswap swap on chain 4663. The game never holds funds, never matches orders, and never touches the money — the regulatory posture of a DEX frontend, not an exchange operator. Live tickers can show Robinhood Chain memecoin pairs and the chain's canonical stock-token prices (TSLA, NVDA, SPCX) read from their Chainlink feeds. Trades tolerate seconds of latency, which is why this belongs in an interior room and not the street simulation.

### 2. Heists (real value as fixed prize pools, never faucets)

Real value enters gameplay only as **fixed, pre-funded pools**: a scheduled bank-job event whose vault holds a sponsored or fee-funded USDG pot; the winning crew splits it onchain via the settlement pipeline. Fixed pools are structurally collusion-resistant (colluders compete for the same pot; they cannot inflate it) and turn payouts into appointment events rather than grindable yield. Per-kill or per-action real-value minting is prohibited by design.

### 3. Owned vehicles and property as NFTs (durable records only)

The docs' line — "spawned vehicle versus owned vehicle record" — is the tokenization boundary: the durable garage record may be minted on chain 4663 and traded (an in-world chop shop as a second interior skin over onchain transfers); the room entity never is. Cosmetic-first (paint, liveries), utility-light to avoid pay-to-win pressure on the combat loop.

### 4. Token policy (if and when)

Any game token follows the chips-versus-stock rule: launched outside the game loop, never a gameplay currency, never buys advantage. Distribution via seasonal leaderboard rewards; demand via buyback from real revenue (exchange-frontend fees, cosmetics). Street cash is never payable in it. Public wording is "buyback/burn," never "revenue share" or yield language.

### 5. Bounty board (deferred)

Player-funded real-value bounties on other players are thematically ideal and legally adjacent to gambling; they remain points-denominated until counsel clears a real-value version.

## Anti-Abuse Requirements (Gate 3)

All of the following precede any real-value event, and most are already listed as gaps in `ENGINEERING_REPORT.md:277-291`:

- Server-side per-command rate limits and `maxMessagesPerSecond`; input sequence numbers; stale-command rejection.
- Aim-rotation rate cap (`district-room.ts:93-100` currently accepts any finite angle; aimbots are trivial and, with value attached, are theft).
- Replace `Date.now()`-seeded `pseudoRandom` gameplay rolls with the existing `DeterministicRandom`, per-room seeded, for auditable and replayable outcomes.
- Reward-flow policy in the event consumer: per-account caps, kill-trading detection (repeated mutual kills), new-account gating for real-value events, device/IP heuristics at the Privy layer.
- Economy audit events (who earned what, when, from which event) written to the ledger for dispute resolution.
- `StateView` filtering before any private field ships; open CORS pinned; TLS termination and secrets management defined before the relayer key exists.

## Sequencing (Aligned to the Existing Roadmap)

| Stage | Contents | Gate |
| --- | --- | --- |
| 0 | Original map and vehicle art; stop bundling GTA2-derived assets in any served build | Legal clearance to host publicly |
| 1 | Phase 0/1 work: wire `GameEventStream` into the two mint sites, `onAuth` + Privy binding, PostgreSQL ledger, reconnection, CORS pinned | Phase 1 exit gate: no duplicate/lost economic state |
| 2 | Anti-abuse minimums above; `StateView`; deterministic RNG | Internal red-team of reward flows |
| 3 | Exchange interior (non-custodial frontend) | Regulatory review of frontend posture |
| 4 | Heist events with fixed USDG pools | Review of prize-pool mechanics |
| 5 | Garage NFTs; token season if warranted | Counsel review of token language |

## Non-Goals

- No onchain calls inside the simulation tick, ever.
- No redeemability for street cash, ever.
- No custody of player funds by the game server (the exchange is a signing frontend; prize pools live in contracts or the audited ledger).
- No real-value mechanics on GTA2-derived assets, in any environment third parties can reach.
