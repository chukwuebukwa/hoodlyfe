# Nock0 MVP

## Goal

Deliver a small, browser-playable multiplayer city sandbox based on Reldens. Two players must be able to join the same city block, walk, chat, use one ranged weapon, attract police attention, and escape until their wanted level decays.

## Included

- One compact city block made with original or permissively licensed tiles.
- Guest login for rapid testing.
- Multiplayer movement and room chat.
- One projectile weapon with server-authoritative damage.
- One civilian NPC archetype.
- One police NPC archetype.
- Wanted levels from 0 through 5.
- Police aggression based on wanted level.
- Wanted decay while the player remains outside police awareness.
- Death, respawn, and a basic cash score.

## Excluded from the first slice

- Vehicles.
- Large persistent world.
- Property ownership.
- Complex missions.
- Voice chat.
- Real-money systems.
- Copied GTA assets, names, maps, characters, audio, or branding.

## Acceptance tests

1. Two browser clients can connect simultaneously and see each other move.
2. Both clients can send and receive room chat.
3. Firing the test weapon creates a server-approved projectile and damage event.
4. Attacking a civilian raises the attacker to wanted level 1.
5. Attacking police raises wanted level by at least 2.
6. Police select wanted players as targets and stop targeting players at level 0.
7. Wanted level decays only after the configured cooldown without a new offense.
8. Reconnecting does not allow a player to duplicate cash or inventory.
9. The server rejects impossible fire rates and damage values sent by clients.

## Implementation sequence

### Phase 1 — upstream boot

Run the pinned Reldens release with MySQL and verify its stock demo in two browser windows.

### Phase 2 — city conversion

Create one Tiled map with roads, sidewalks, collision, spawn points, a police spawn region, and an interior transition.

### Phase 3 — combat conversion

Configure one bullet-type skill and one weapon item. Damage, cooldown, projectile speed, range, and ammunition are server-owned.

### Phase 4 — wanted system

Attach `game/server/wanted/WantedService.js` to authoritative combat/NPC events. Broadcast only the resulting wanted state to clients.

### Phase 5 — police behavior

Use wanted level to set target priority, pursuit duration, spawn pressure, and disengagement.

### Phase 6 — vehicles

Only begin vehicles after pedestrian movement, combat, and police pursuit pass the acceptance tests.
