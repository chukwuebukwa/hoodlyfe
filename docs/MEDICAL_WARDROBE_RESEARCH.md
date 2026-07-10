# Medical and Wardrobe Service Research

Date: 2026-07-10

This study defines the next service/economy slices without coupling death, appearance, inventory, and persistence into one controller.

## Production Medical References

Pinned local source: `/tmp/nock0-GTAviceCity` at `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`.

- `src/control/GameLogic.cpp` treats death as an explicit state with a delay, fade timing, one-time hospital charge/loadout consequence, vehicle detachment, event/world cleanup, nearest restart selection, time passage, resurrection, camera reset, and control restoration.
- `src/control/Restart.cpp` owns registered hospital points, nearest same-level selection, broader fallback, one-shot override, and path-node fallback independently from player death state.
- `src/core/PlayerInfo.cpp` owns the wasted state transition and a one-use free-hospital exemption rather than embedding it in rendering.

The browser adaptation keeps those ownership boundaries but changes the punitive single-player policy for a multiplayer sandbox:

- Public Ward is the automatic fallback, costs nothing, takes 4.2 seconds, and preserves remaining ammunition without granting a free refill.
- Trauma Care costs $250 once, completes after 2.2 seconds from death, and restores ammunition.
- Both clear wanted/vehicle/input/action state through existing owners and respawn at the nearest registered hospital.
- A living on-foot player can buy missing-health treatment at a hospital, but active wanted heat blocks service.
- Every debit has an admission- or service-scoped idempotency key; no billing occurs in the fixed-step loop.

This preserves a nonblocking default for disconnected or indecisive players and avoids making death a free ammunition exploit.

## Production Appearance References

- `src/renderer/PlayerSkin.cpp` has explicit begin/render/end preview lifecycle and restores rendering state on exit.
- `src/core/Frontend.cpp` enumerates a bounded catalog, previews selection separately, commits through a specific use action, persists only the committed preference, and restores the prior committed skin when leaving without apply.
- `src/core/PlayerInfo.cpp` resolves a requested skin through a validated default fallback and owns resource replacement/deletion.

NOCK0 already has the preview/draft/apply/cancel half of this boundary. The next wardrobe slice must add private owned-item state and server validation without making cosmetic ownership public replicated state. Equipped appearance remains public; ownership and prices are private account/session data.

During development, all current creator options stay granted and freely usable as requested. A clothing store may open the same creator and later sell original items, but it must not introduce a second appearance renderer or let cosmetics affect collision, combat, detection, vehicles, or payouts.

## Module Boundaries

- `MedicalCareController`: facilities, private admissions, care choice, nearest restart, living treatment, and economy coordination.
- `PlayerLifecycleController`: death/respawn state mutation and delegation to medical care; it does not price or select hospitals.
- `StreetServiceController`: service routing only; it delegates hospital effects.
- `MedicalCarePresentationController`: dead-player choice commands and selected/affordable UI state.
- Future `WardrobeInventory`: private grants/ownership and owned-item checks.
- Existing `PlayerAppearanceController`: equipped appearance validation and replication, with a future ownership port.
- Existing `AppearanceCreatorController`: one draft/preview/apply/cancel client surface, whether opened freely or from a store.

## QA Gate

Medical care requires deterministic nearest-hospital selection, safe fallback, duplicate debit protection, insufficient-funds behavior, public timeout, priority timing, ammunition policy, living treatment, wanted/vehicle rejection, schema/UI projection, real death/respawn flow, mobile layout, and clean browser logs.

Wardrobe ownership begins only after medical care is checkpointed. It needs private-state tests, development grants, invalid/unowned rejection, preview rollback, equipped-only replication, and a clothing-service open flow before any prices or monetization are enabled.

## Medical Checkpoint Result

- Two deterministic collision-safe hospitals are registered as authoritative street services and projected to world/minimap presentation.
- Public Ward and Trauma Care use private admission records, one-time economy keys, explicit ammunition policies, nearest-facility completion, and safe fallback.
- Living treatment is authoritative and rejects full health, wanted players, vehicle occupants, and insufficient funds without partial mutation.
- A three-second spawn shield closes the live spawn-kill loop; damage is server-gated, firing cancels it, expiry is explicit, and a cyan world ring plus F3 `SHIELD` label expose the state.
- Automated coverage includes facility selection, duplicate debit protection, insufficient funds, treatment gates, public ammo preservation, trauma refill, damage immunity, firing cancellation, service projection, real two-client regression, and production build.
- Live Holdout QA reproduced death, showed the two care choices, respawned at full health, and allowed attackers to kill again only after the bounded protection period. A settled reload produced no fresh warning/error logs.
- Desktop controls measured 232 px wide with no overflow. The in-app viewport override reported 1280x720 after a requested 390x844 pass, so a true mobile breakpoint measurement remains a QA follow-up rather than a claimed pass; the fixed 232 px control width is below the target viewport.
