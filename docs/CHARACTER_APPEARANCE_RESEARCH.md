# Character Appearance and Outfit Research

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Findings

The reference treats player appearance as selected presentation content with explicit preview, load, fallback, persistence, and resource lifecycle.

- `CPlayerSkin` owns texture lookup and falls back to the default skin when a selected resource cannot load.
- Frontend skin editing has explicit begin/render/end phases rather than changing world physics or player-state logic.
- The frontend enumerates finite skin content, stores stable original/display names, bounds copied names, previews selection before confirmation, and persists the selected preference.
- `CPlayerInfo` owns only the selected skin name and loaded texture pointer; applying or deleting the resource is separate from movement, weapons, health, wanted, and mission state.
- GTA Online distinguishes character appearance and apparel from immutable/deletion-gated identity traits, and applies access/fee policy through the Style surface rather than coupling cosmetics to combat statistics.

References:

- [`PlayerSkin.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/renderer/PlayerSkin.cpp)
- [`PlayerInfo.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/PlayerInfo.cpp)
- [`Frontend.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Frontend.cpp)
- [Rockstar Support: Appearance and Gender Changes in GTA Online](https://support.rockstargames.com/articles/6vinToa2yR1WxY2tEgwRTd/appearance-and-gender-changes-in-gta-online)

NOCK0 uses original catalog IDs, palette rules, UI, network protocol, renderer, and tests. The reference informs ownership and lifecycle only.

## Current Appearance Contract

`shared/content/appearance-catalog.ts` is the finite public content boundary. A complete look contains:

- outfit display name;
- standard, slim, or broad visual body presentation;
- six skin tones;
- cropped, fade, or curls hair plus hair color;
- no headwear, cap, or beanie;
- tee, jacket, or hoodie plus top/accent colors;
- jeans, cargos, or track bottoms plus color;
- runners or boots plus color.

Every field is a stable ID from an immutable list. Clients cannot submit filenames, URLs, CSS colors, shader source, dimensions, or arbitrary asset keys. Outfit names are canonicalized and bounded to 24 safe display characters.

`PlayerAppearanceController` validates the entire update before mutation, falls back to one default at join, rate-limits valid changes, and clears private rate state on disconnect. Appearance is a nested replicated schema visible to every client. Join-time saved appearance goes through the same validation as live updates.

No appearance field changes hitbox, collision radius, movement speed, vehicle handling, health, wanted behavior, aim, weapon damage, ammunition, payout, economy, or police perception. Body types change only rendered horizontal scale.

## Rendering and Cache Boundary

The current compatibility sprite is converted into a cached nine-frame appearance sheet in the browser.

1. One shared canvas renderer classifies opaque source pixels into skin, hair, top, bottom, and shoe zones.
2. It preserves source shading, applies catalog palette values, and adds small pixel-readable style/headwear details.
3. The same renderer powers the creator preview and the Phaser world texture.
4. Each texture identity excludes outfit display name but includes every visual field.
5. A matching walk animation is generated per cached sheet and used by local, remote, on-foot, and passenger sprites.
6. The cache prunes inactive generated textures above 96 entries so repeated valid updates cannot grow GPU memory without bound.

This is a compatibility renderer for the current base art. Original production art should become authored layer sheets with identical frame/anchor contracts; the replicated appearance IDs and server validation do not need to change.

## Creator Interaction

The `LOOK` command opens a modal creator with:

- one pixel preview using the world renderer;
- menus for body, skin, hair, headwear, top, bottoms, and shoes;
- a tabbed color target and ten actual color swatches;
- outfit naming, randomize, cancel, close, and apply;
- desktop and mobile layouts.

Opening sends an immediate zero-movement command and blocks movement, aim, fire, weapon cycling, interaction, and mission input at the client-input boundary. Apply sends one complete validated appearance and stores a local development preference. Cancel changes neither server state nor local storage.

## Persistence and Monetization Boundary

Local storage is only a development convenience and carries no ownership authority. The later account system must store character appearance and named outfit records behind account/character IDs, transactional inventory ownership, wardrobe slots, entitlement checks, and reconnect-safe updates.

All current options remain free and unlocked. A later clothing store may charge non-redeemable street cash for original apparel or saved outfit slots through `StreetServiceController` and `StreetEconomyController`. Cosmetic access policy must not enter player rendering or gameplay formulas. Any future onchain cosmetic record remains an asynchronous ownership/settlement adapter after original assets, persistence, security, and legal review.

## Deferred Production Nuance

- Authored original body, skin, hair, headwear, top, bottom, and shoe layer sheets for every walk/run/aim/fire/hit/death/enter/hijack/passenger frame.
- Layer compatibility rules, clipping masks, palette channels, animation anchor metadata, and content validation tooling.
- Saved outfit slots, wardrobe/store locations, item inventory, unlock/price policy, preview-before-purchase, and equipped-versus-owned state.
- Gender/identity/body-vocabulary design owned by original character art and product requirements rather than inherited assumptions from the reference.
- Per-client private ownership views; only equipped public appearance should replicate to nearby players.
- Moderation/localization rules for outfit names and accessible color/pattern labeling.

## Acceptance Coverage

- Catalog IDs, color IDs, option counts, name canonicalization, invalid input, clone isolation, and texture identity are tested.
- Server join fallback, valid update, rate limiting, hostile-value rejection, no partial mutation, and disconnect cleanup are tested.
- Palette policy separates skin/top/bottom/shoe zones and body scale remains presentation-only.
- Real two-client integration proves join-time appearance and a live remote appearance update replicate while all existing gameplay remains green.
- Full suite passes 111/111 and the production build passes.
- Live browser QA proves nonblank world/preview rendering, distinct multi-part customization, server apply, reopen, reload persistence, desktop layout, corrected modal isolation, 390x844 layout, and zero new warning/error.
