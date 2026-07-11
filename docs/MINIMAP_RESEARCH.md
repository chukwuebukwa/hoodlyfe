# Minimap and Online Blip Research

Date: 2026-07-10

Primary code reference: `daynz/GTAviceCity` commit `3233ffe1c4b99e8efb4c41c6794b4fce880cf503`

## Production Radar Behaviors

The GTA III/Vice City radar implementation provides several behaviors that a basic "draw dots on a map" implementation misses:

- radar range is small on foot and expands continuously with vehicle speed;
- world points are transformed relative to a radar origin and orientation;
- out-of-range points are normalized onto the radar edge rather than simply disappearing;
- distance outside the active range reduces blip alpha;
- the local player uses a directional center marker while north remains legible;
- map imagery is tiled and only nearby sections are streamed;
- entity blips, coordinate blips, world markers, and combined marker/blip display modes are separate concepts;
- a character blip follows the character's vehicle position while occupied;
- blips have stable handles, colors, brightness, scale, display mode, and optional sprites;
- special destinations and ordinary entity traces use separate drawing passes and priorities;
- the full map and the moment-to-moment radar reuse data but have different clipping and visibility rules.

Reference: [`Radar.cpp`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Radar.cpp) and [`Radar.h`](https://github.com/daynz/GTAviceCity/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Radar.h).

## GTA Online Visibility Semantics

GTA Online turns radar visibility into a multiplayer rule rather than a renderer decision:

- normal remote players are session information;
- organization/crew/team membership changes color and priority;
- Off the Radar and Ghost Organization hide players from unaffiliated rivals;
- some competitive events prohibit hiding because it would undermine the objective;
- mission cargo can remain private initially and become globally blipped after a delay;
- contacts, properties, shops, series, jobs, and social spaces are filterable map categories;
- personal and mission vehicles matter, while ambient traffic is normally not a field of vehicle dots;
- destroyed personal vehicles transition into an insurance/replacement flow rather than silently respawning as the same room entity.

Official references:

- [GTA Online Freemode Basics](https://www.rockstargames.com/gta-online/guides/7772)
- [Executive organizations](https://www.rockstargames.com/gta-online/guides/995k)
- [Special Cargo visibility and Ghost Organization](https://www.rockstargames.com/newswire/article/51974aa3a54k9k/further-adventures-in-finance-and-felony-how-to-become-a)
- [Freemode event visibility restrictions](https://support.rockstargames.com/articles/1Wgw74PudBdSjUrRC6tCKW/freemode-events-information-for-gta-online-on-ps4-xbox-one-and-pc)

## NOCK0 Minimap Policy

The first implementation will:

1. Use the real exported district image as a cropped north-up background.
2. Center on the local player or their occupied vehicle.
3. Expand world range based on absolute vehicle speed.
4. Always show a directional local-player marker.
5. Show remote player markers once, at their effective player/vehicle position.
6. Show police only while the local player is wanted, with threat emphasis inside active range.
7. Hide civilians and ambient vehicles.
8. Support static and mission marker inputs even before those systems exist.
9. Clamp high-priority out-of-range players, police, and objectives to the edge with reduced alpha.
10. Keep marker selection and visibility in a pure policy module, separate from canvas rendering.

Future server privacy requirements:

- `DistrictState` currently replicates all entities, so client filtering is presentation only.
- Off-radar, interiors, crew-only markers, stealth missions, and large districts require server-side per-client visibility or `StateView` filtering.
- The server must never replicate a hidden player's exact position and expect the minimap to conceal it.

## Acceptance Tests

- Local marker is always present and never duplicated as a remote player.
- A player in a vehicle appears at the effective vehicle position.
- Ambient cars and civilians never become normal markers.
- Police markers require local wanted heat.
- Range grows with speed but stays within configured bounds.
- High-priority remote markers clamp to the edge; low-priority entities can be omitted.
- Marker order is deterministic and objective/team markers outrank ambient threat markers.
- Rendering remains readable at desktop and touch layouts without obscuring controls.
