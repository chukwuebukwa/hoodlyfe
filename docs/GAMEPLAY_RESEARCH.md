# NOCK0 Gameplay Research and Ranked Roadmap

Date: 2026-07-10

## Product Direction

NOCK0 should feel like an active shared city before it feels like a collection of menus. The core loop is:

```text
enter the district
  -> notice an opportunity or another player
  -> steal, fight, drive, cooperate, or compete
  -> create consequences and police attention
  -> escape, cash out, repair, resupply, or take another job
  -> improve access, identity, vehicles, and social standing
```

Long-term systems such as property, clans, clothing, garages, and businesses should unlock or amplify street activity. They should not replace it with passive dashboards.

## GTA2 Findings

The original GTA2 manual describes two multiplayer modes:

- Deathmatch, won by a target score or player-kill count.
- Tag, with many hunters and one hunted player; killing the hunted transfers that role.

The same manual documents direct player messaging and a weapon set including pistol, shotgun, machine guns, flamethrower, rocket launcher, stun weapon, Molotov cocktails, and grenades. GTA2 also makes vehicles part of the weapon/economy loop through service shops that install bombs, mines, oil slicks, and machine guns.

Transferable NOCK0 ideas:

- opt-in district events for Deathmatch and Tag without leaving freemode;
- rotating weapon pickups and high-risk weapon locations;
- vehicle service shops as clear currency sinks;
- gangs that unlock missions, weapons, and territory benefits through reputation;
- a compact chat scope system for nearby, crew, team, and district messages;
- quick match scoring that does not affect the durable street economy.

Primary reference: [GTA2 PC manual](https://gtamp.com/GTA2/gta2manual.pdf).

## GTA Online Findings

Rockstar's official guides consistently use four mutually reinforcing layers:

1. Freemode contains players, contacts, properties, businesses, spontaneous events, and social hubs.
2. Contacts and properties launch repeatable solo/cooperative jobs.
3. Jobs generate cash and unlock discounts, vehicles, equipment, or further jobs.
4. Organizations and motorcycle clubs let leaders recruit friends into shared work.

Properties are useful because they unlock gameplay, storage, customization, heist planning, businesses, and crew hangouts. Business loops frequently alternate between acquiring supplies or vehicles and completing a risky sale or delivery. Heists are multi-stage cooperative missions where different players have complementary roles.

Transferable NOCK0 ideas:

- a freemode minimap that prioritizes players, contacts, police, jobs, shops, and owned destinations;
- contact jobs that can be accepted while continuing to move through the district;
- solo jobs that scale up when friends join rather than requiring a full party;
- crew roles and shared payouts for drivers, shooters, lookouts, and couriers;
- properties that unlock mission boards, garages, wardrobes, and social spaces;
- vehicle cargo: identify, steal, lose heat, deliver, and optionally repair before payout;
- daily/rotating opportunities that reuse the city with different targets and constraints;
- passive mode or safe social interiors, while the street remains an active PvP space.

Primary references:

- [Freemode Basics](https://www.rockstargames.com/gta-online/guides/7772?section=8oo4)
- [Properties](https://www.rockstargames.com/gta-online/guides/k329?section=k272)
- [Executive organizations](https://www.rockstargames.com/gta-online/guides/995k)
- [Biker organizations](https://www.rockstargames.com/gta-online/guides/1242?section=o7kk&ssl=1)
- [Original heists update](https://support.rockstargames.com/articles/6hBJdQCmQ3YR7nqHIq9AGS/gtav-title-update-1-21-ps3-xbox-360-1-07-ps4-xbox-one)

## Stick RPG Findings

Stick RPG's durable appeal comes from converting a small city into a progression machine:

- strength, intelligence, charm, and karma gate opportunities;
- jobs provide reliable money and promotions after repeated shifts;
- training and education trade time or money for stats;
- banks separate carried cash from stored cash;
- property and assets become visible milestones;
- locations and jobs depend on time of day;
- quests and unusual NPCs interrupt the routine.

Transferable NOCK0 ideas:

- a small stat model that changes available dialogue, jobs, weapon handling, and driving;
- entry-level legal jobs alongside crime jobs, giving players recovery options after losing money;
- promotion tracks with visible requirements and better mission variants;
- carried street cash versus protected bank balance;
- hospital, repair, ammunition, clothing, education, and property as money sinks;
- time-of-day schedules for shops, traffic, pedestrians, and mission contacts;
- karma/reputation as content routing, not a simple good-versus-evil bar.

The multiplayer adaptation must avoid idle compounding and offline inflation. Jobs should involve short interactive tasks, and bank interest should not become a dominant faucet.

References:

- [XGen Studios](https://www.xgenstudios.com/)
- [Stick RPG jobs overview](https://stickrpg.fandom.com/wiki/Jobs)
- [Stick RPG 2 professions](https://stickrpg2.fandom.com/wiki/Professions)
- [Stick RPG 2 bank and property behavior](https://stickrpg.fandom.com/wiki/Dimension_Banks)

## OpenGTA2 and Local GTA2 Data Findings

The local OpenGTA2 web exporter currently emits:

- a cropped base map and transparent overlay;
- collision and road tile layers;
- map metadata and a spawn point;
- three selected vehicle sprites;
- selected pedestrian sheets.

The repository and installed GTA2 data expose more potential development-only inputs:

- a large vehicle model enumeration including buses, taxis, police, SWAT, ambulance, fire truck, tank, tanker, tow truck, vans, trucks, scooters, and special vehicles;
- parked-car and gang-car script commands;
- weapon-grant commands and vehicle proof/alarm flags;
- map zones such as bus stops;
- original single-player and two-to-six-player scripts;
- dedicated multiplayer maps and scripts.

Safe development-tool improvements:

1. export a complete vehicle atlas plus a JSON manifest mapping frame, model ID, and development label;
2. export map zones and map objects as Tiled object layers;
3. export road metadata with directional/lane information where it can be derived;
4. inspect multiplayer scripts for spawn, pickup, score, and mode-layout ideas;
5. keep every Rockstar-derived output ignored or local-only while original replacements are produced.

Do not bind gameplay code to GTA2 model numbers. The converter should produce NOCK0 content IDs through a development-only mapping file.

## Ranked Build Roadmap

### Tier 1: Street Loop and Trustworthy Simulation

These features fit the current district and improve every later system:

1. witnessed incidents, delayed reporting, wanted heat, dispatch limits, search, arrest, and escape;
2. vehicle-to-vehicle collision, vehicle health, destruction, ejection, and repair;
3. minimap with players, police, mission contacts, shops, and owned/party markers;
4. pickups and expanded weapon behavior, starting with melee, automatic fire, explosives, and fire as separate combat families;
5. one repeatable vehicle-theft delivery mission with solo and cooperative payouts;
6. ammunition, repair, hospital, and clothing-preview currency sinks;
7. short freemode Tag and Deathmatch events.

### Tier 2: Progression and Social Play

These require stable mission and economy boundaries but not a larger map:

1. contact mission board and objective framework;
2. banked versus carried cash;
3. character stats and interactive entry-level jobs;
4. crews/clans, crew chat, crew markers, and shared job payouts;
5. clothing slots and palette-based character variants;
6. garages and temporary personal-vehicle claims;
7. gang reputation and territory jobs.

### Tier 3: Persistence and World Expansion

These require accounts, a database, original map content, and district/interior transfers:

1. durable owned vehicles and garages;
2. apartments, businesses, clubhouses, and friend access;
3. wardrobe and saved character appearance;
4. persistent clans, ranks, permissions, and shared treasury;
5. property-launched mission chains and cooperative heists;
6. market listings and durable item ownership;
7. multiple districts, interiors, and safe social venues.

## Immediate Implementation Sequence

1. Finish the incident/witness/wanted/dispatch slice and make it visible in debug tools.
2. Add vehicle collision and health because traffic, hijacking, police chases, and delivery missions all depend on it.
3. Add the minimap as the navigation and opportunity surface.
4. Add a vehicle-theft delivery contact mission and basic mission-owned entity scope.
5. Add repair/ammunition sinks and banked-versus-carried cash policy.

This sequence creates a complete short session: find a job, steal a target car, attract police, escape using the minimap, damage the car, deliver it for a condition-adjusted payout, then spend or bank the reward.
