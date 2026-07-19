# Police Escalation and Marksmanship Balance

Date: 2026-07-18

Status: implemented playtest contract

## Reference Behavior

Pinned educational references:

- re3 commit [`3233ffe1c4b99e8efb4c41c6794b4fce880cf503`](https://github.com/hottabxp/re3/tree/3233ffe1c4b99e8efb4c41c6794b4fce880cf503)
- reVC commit [`b9eeb33efcd04a5b7a423921609baef11bf4719a`](https://github.com/mrxenginner/reVC/tree/b9eeb33efcd04a5b7a423921609baef11bf4719a)

Both references separate accumulated crime pressure, wanted-level bands, maximum active
officers, maximum law-enforcement vehicles, and roadblock pressure. Ordinary street cops
own a firearm but select unarmed or nightstick force at wanted level one, then select the
pistol above level one:

- [re3 wanted bands and response caps](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/Wanted.cpp#L284-L336)
- [re3 one-star unarmed and higher-tier pistol selection](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/peds/CopPed.cpp#L374-L384)
- [reVC wanted bands and response caps](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/core/Wanted.cpp#L311-L365)
- [reVC nightstick and pistol selection](https://github.com/mrxenginner/reVC/blob/b9eeb33efcd04a5b7a423921609baef11bf4719a/src/peds/CopPed.cpp#L408-L422)
- [re3 vehicle-theft reporting and immediate police-presence check](https://github.com/hottabxp/re3/blob/3233ffe1c4b99e8efb4c41c6794b4fce880cf503/src/core/EventList.cpp#L205-L236)

The reusable pattern is staged authorization and bounded response depth. Exact source
constants, data structures, symbols, and code are not copied.

## NOCK0 Escalation Contract

| Wanted | Heat | Foot cap | Cruiser cap | Force and tactics |
|---:|---:|---:|---:|---|
| 0 | 0-19 | 0 | 0 | no response |
| 1 | 20-54 | 1 | 0 | pursue, arrest, or melee; no firearms |
| 2 | 55-119 | 2 | 1 | pistol response, one primary ramming cruiser |
| 3 | 120-199 | 4 | 2 | coordinated pursuit, roadblocks, stingers |
| 4 | 200-299 | 5 | 2 | faster reinforcement and improved fire |
| 5 | 300+ | 5 | 3 | maximum district response |

Crime pressure remains witness-gated and server authoritative. Vehicle theft starts level
one only when a police officer directly sees it and reports it immediately; civilian-only,
heard-only, and unseen thefts create no wanted heat. A reported police murder reaches level
two but does not by itself reach level three. Repeated severe crimes are required to unlock
roadblocks and the first swarm tier.

## Marksmanship Contract

`police-marksmanship-policy.ts` is a pure policy that returns firearm authorization,
maximum range, shot cadence, and distance-scaled angular error. Level two has the slowest
cadence, shortest range, and widest error. Error narrows progressively through level five.
The pedestrian behavior layer samples a named deterministic random stream only when a shot
is authorized, then the existing fire-control controller creates the authoritative bullet.

This means misses are reproducible in tests and server replays without making clients the
owner of police aim. Navigation can detour the officer without changing the intended target
or the shot's server authority.

## Multiplayer Boundary

- Wanted heat, allocation, force authorization, aim error, and AI input remain server-only.
- Clients continue receiving ordinary NPC pose and projectile state through AOI replication.
- No prediction, interaction-island, rewind, snapshot, or shared vehicle-step code changed.
- Deterministic misses do not require client prediction and cannot be selected by a client.

## Acceptance

- One-star officers never request a bullet and can still arrest or melee at contact.
- Vehicle theft produces no wanted heat unless a police officer has direct line of sight.
- Two-star officers fire no faster than 1.25 seconds and have visibly imperfect aim.
- Two stars allocate at most two foot officers and one cruiser.
- Three stars allocate four foot officers and two cruisers and unlock existing roadblocks.
- Aim error narrows and cadence increases monotonically from levels two through five.
- Wanted pacing requires repeated serious crime to move from two to three stars.
