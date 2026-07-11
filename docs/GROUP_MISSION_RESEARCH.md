# GTA Online Group Mission Research

Date: 2026-07-10

## Two Production Models

GTA Online does not use one universal multiplayer mission structure. It has at least two materially different models that NOCK0 should preserve.

### Instanced Jobs and Heists

Heists use a leader-owned progression strand and a rostered job session:

- the leader meets prerequisites, owns the planning property, and pays setup costs;
- players without leader prerequisites can still join through invites or Quick Job;
- setup missions unlock a finale for the leader's strand;
- the leader assigns roles and final payout cuts, with a platform-enforced minimum share;
- missions can keep the team together or split players into simultaneous specialized roles;
- team composition, difficulty, life loss, order, and disconnection matter to challenge continuity;
- first-time, all-in-order, loyalty, and no-death awards are tracked per participant across sessions;
- replay and cooldown policy distinguishes hosting from joining.

Official references:

- [Setting Up for GTA Online Heists](https://www.rockstargames.com/newswire/article/51974aa3a7k193/setting-up-for-gta-online-heists)
- [GTA Online Heists Now Available](https://www.rockstargames.com/newswire/article/ak14o883847k5o/gta-online-heists-now-available)
- [How to Access Heists](https://support.rockstargames.com/articles/5enLtosoA4nuxfZ8Y03Fo9/how-to-access-heists-in-gta-online)
- [Heist completion bonuses](https://support.rockstargames.com/articles/1knqB39UwZUkFUNwTQktbh/how-to-track-special-heist-completion-bonuses-in-gta-online)
- [Team/difficulty/disconnect continuity](https://support.rockstargames.com/articles/1VSGf6FVCkRRHPnjt1FPRH/progress-will-be-reset-message-in-gta-online-the-doomsday-heist)
- [Group payout minimums and cooldowns](https://www.rockstargames.com/newswire/article/3974k2848172a2/upcoming-improvements-to-the-gta-online-experience)

### Freemode Organization Work

VIP/CEO work stays in the shared city:

- a leader forms an organization and recruits willing players;
- the leader launches work for current members;
- members are notified regardless of proximity;
- the key organization shares the objective while rival organizations can interfere or steal the outcome;
- completion, rival-steal, and participation rewards are separate;
- participation has a time threshold, preventing drive-by reward claims;
- organization members have an employment relationship and receive salaries/role benefits outside individual jobs;
- radar-hiding, public-session risk, and organization affiliation alter the mission's information layer.

Official references:

- [Executive guide](https://www.rockstargames.com/gta-online/guides/995k)
- [Putting in VIP Work](https://www.rockstargames.com/newswire/article/k49a58878a85k7/gta-online-game-tips-putting-in-vip-work)
- [Executives and Other Criminals](https://www.rockstargames.com/newswire/article/k49a58878ak354/gta-online-executives-and-other-criminals-now-available)

## NOCK0 Decision

The first **Boost and Deliver** job is Freemode crew work. It happens in the active district with normal traffic, police, unrelated players, and rival interference. It must not create a private room or pretend to be a heist.

First-slice group contract:

1. A leader opens a short forming window at the contact.
2. Up to four willing nearby players join explicitly; nobody is auto-enrolled.
3. The roster locks when the leader starts or the forming timer expires.
4. The target is reserved once for the group.
5. Any roster member can steal, drive, defend, or deliver the target.
6. Wanted heat is evaluated across active participants for delivery safety.
7. Individual death does not fail shared Freemode work; the participant respawns and can rejoin the action.
8. Target destruction, total team disconnect, timeout, or explicit abandonment fail the job.
9. If the leader disconnects, leadership transfers deterministically to the earliest connected participant; the physical objective continues.
10. Players joining after roster lock may help physically but do not become payout participants.
11. Every locked, connected participant receives an explicit server-computed payout record with an individual idempotency key.
12. Later contribution thresholds can reduce or remove payouts for participants who never approached, carried, defended, drove, or remained active in the work.

The initial payout is equal per eligible participant because NOCK0 does not yet have setup costs, leader investment, or a payout-cut negotiation UI. Heist-style leader cuts belong to later instanced multi-stage jobs, not this street job.

## Required Data Model

Mission:

- leader ID and immutable roster version;
- forming/locked state and maximum participants;
- participant records with join time, role, connected state, deaths, contribution time, and payout eligibility;
- target reservation and mission entity scope;
- shared phase, objective, timer, target condition, and failure state;
- deterministic leadership transfer order;
- per-participant payout amount and idempotency key;
- terminal retention for UI and reconnect reconciliation.

Participant role vocabulary starts small:

- **leader**: starts/abandons the job and owns contact progression;
- **driver**: current target driver, assigned dynamically rather than permanently;
- **support**: every other roster member; can defend, navigate, distract police, or take over driving.

## Later Heist Boundary

A future heist domain adds a lobby/ready state, property prerequisite, setup graph, host-owned strand, immutable difficulty, explicit role slots, team lives, checkpoints/restart voting, negotiated finale cuts, challenge continuity, and separate mission-room transfer. Those rules should not burden the first Freemode job.
