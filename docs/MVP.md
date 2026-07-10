# NOCK0 Playable Slice

## Goal

Deliver a browser-first top-down crime sandbox that feels like an action game immediately: enter the city, move and aim freely, fight other players or NPCs, attract police, steal a car, escape, die, and respawn.

## Implemented

- Custom Phaser client with no MMORPG shell or account lobby.
- One authoritative Colyseus district for up to 32 connected players.
- Local GTA2 map and vehicle conversion with original pedestrian animation sheets.
- Server-owned movement, collision, weapon inventory, ammunition, shooting cadence, damage, and rewards.
- Pistol, SMG, and shotgun with distinct held models, spread, range, and projectile presentation.
- Replicated nameplates for connected human players.
- Elevated gantries, trusses, and utility wires render above the action without blocking movement or bullets.
- Civilian wandering and panic behavior.
- Police targeting, pursuit, line-of-sight firing, and disengagement at zero heat.
- Heat levels from zero through five with delayed decay outside police awareness.
- Player death, three-second respawn, and camera/damage feedback.
- Enterable vehicles with acceleration, reverse, steering, collision, and impact damage.
- Road-aware ambient traffic, four-player seating, occupant labels, driver promotion, and passenger gunfire.
- Passenger upper-body peek and recoil animation with seat-aware muzzle placement.
- Timed entry and carjacking with an animated player, braking traffic, and an ejected fleeing driver.
- Mouse/keyboard and dual-stick touch controls.

## Verified Acceptance Tests

1. Two WebSocket clients join the same room and receive the same population state.
2. One client moves and the second observes the authoritative position.
3. A player enters the starter vehicle, drives it, and exits.
4. Two players occupy separate seats in the same car and the passenger can aim, cycle weapons, and fire.
5. Eight traffic cars spawn on GTA2 road cells and move authoritatively.
6. Weapon selection, ammunition, fire rate, and projectile damage are server controlled.
7. Pistol, SMG, and shotgun slots cycle in both directions and consume the correct ammunition.
8. Four pistol hits kill a player and reward the shooter.
9. The dead player remains dead until the server respawn delay expires and returns with zero heat.
10. The generated spawn, nearby world points, road navigation, and elevated gantry cells respect collision.

## Next Production Milestones

- Account persistence and reconnect-safe economy state.
- Vehicle health, destruction effects, locked cars, and additional handling classes.
- Pedestrian traffic lanes and improved police pathfinding.
- Weapon pickups, reloads, and persistent inventory progression.
- Mission triggers, objectives, interiors, and a minimap.
- Interest management and load testing above 32 concurrent players.
- Original replacement art and audio for public distribution.
