# Mission System Research and First Job Contract

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Behaviors Found

### Missions Are Isolated Runtime Programs

The GTA script runtime launches missions as separately flagged scripts with local variables, timers, wake times, condition state, and death/arrest behavior. Mission completion is explicit; it is not inferred from a global quest list.

Reference: [`Script.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script.h) and [`Script.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/control/Script.cpp).

### Entity Ownership and Cleanup Are First-Class

Mission-created cars, characters, and objects are added to a bounded cleanup registry. Finishing a mission resets temporary world, camera, weather, HUD, wanted, safety, audio, streaming, upside-down, and stuck-car overrides, then cleans every owned entity. Ambient or parked vehicles promoted into mission scope can later be released back to ambient ownership.

This is the most important transferable behavior: a mission must know everything it owns or temporarily changes.

### Objectives Use Reusable Primitives

The script command surface exposes:

- entity and coordinate blips with color, scale, sprite, and display policy;
- onscreen timers and counters;
- target vehicles and mission garages;
- predicates for whether the target car reached its garage;
- stuck/upside-down checks;
- explicit mission pass/fail and mission statistics;
- a control-state check before a mission can start.

The mission script composes these primitives into phases instead of embedding every mission directly in engine code.

### Vehicle Cargo Rewards Condition

Rockstar's GTA Online Executive guidance explicitly makes minimal vehicle damage central to Vehicle Cargo work. Public-session cargo loops add exposure and rival-player risk, while organizations let multiple players participate in complementary roles.

Reference: [GTA Online Executive guide](https://www.rockstargames.com/gta-online/guides/995k).

## NOCK0 Mission Architecture

The server mission domain will own plain runtime records and transitions. It will not import Colyseus, Phaser, persistence, wallet, or chain code.

Every mission record includes:

- stable mission and template IDs;
- owner and participant IDs;
- explicit phase and terminal status;
- start, deadline, and terminal timestamps;
- target and objective entity IDs;
- objective coordinates;
- base reward and projected/final reward;
- failure reason;
- an idempotency key for terminal reward processing.

Every mission-owned or promoted entity is tracked in a mission scope registry with a cleanup disposition. Room adapters project mission state, apply authoritative rewards, and execute cleanup commands.

## First Playable Job: Boost and Deliver

This is shared-district Freemode organization work, not an instanced heist. See `docs/GROUP_MISSION_RESEARCH.md` for the leader, roster, participation, disconnect, and payout model.

Phases:

1. **Form crew**: a leader opens a short opt-in window for up to three nearby players.
2. **Steal**: the locked group locates the reserved traffic vehicle.
3. **Lose heat**: hijacking creates a witnessed vehicle-theft incident; the group escapes until active participant heat reaches zero.
4. **Deliver**: any roster member drives the exact target into the marked delivery zone at low speed.
5. **Completed**: pay each eligible roster member protected street cash once using individual idempotency keys.

Failure conditions:

- every participant disconnects;
- target vehicle is destroyed;
- timer expires;
- mission is explicitly abandoned later.

Reward policy:

```text
condition = target health / target maximum health
reward = base reward * (35% floor + 65% condition)
```

The floor prevents a difficult delivery from becoming worthless, while the condition share makes skilled driving economically meaningful. This is street cash only and never redeemable or settled onchain.

## Multiplayer and Persistence Constraints

- One active mission per participant for the first slice.
- One mission reservation per target vehicle.
- Other players can interfere with or assist the physical target, but only the locked roster is payout-eligible.
- Leader disconnect transfers leadership if another roster member remains; total team disconnect fails.
- Individual death does not fail Freemode work.
- Future account reconnection should preserve roster membership through a grace period.
- Completion publishes a typed event; a future durable economy consumer applies deduplication and anti-collusion policy before persistence.
- Mission state is replicated publicly for development, but private/crew jobs require per-client views.

## Acceptance Tests

- Invalid leaders, duplicate participants, and reserved targets cannot start duplicate missions.
- Crew formation locks an immutable payout roster.
- Any roster member stealing the exact target advances phase; entering another car does not.
- Wanted heat gates delivery and can move a delivery mission back to lose-heat.
- Delivery requires target occupancy, location radius, low speed, and zero wanted heat.
- Destroyed target, total crew disconnect, timeout, and explicit abandonment produce distinct failures.
- Individual death preserves the job, and leader disconnect transfers authority to the earliest joined connected member.
- Completion computes condition payout once per eligible participant and emits stable individual idempotency keys.
- Terminal updates cannot pay twice.
- Cleanup releases the target reservation and every registered scope entity.
