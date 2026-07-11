# NOCK0

NOCK0 is a custom browser-based, top-down multiplayer crime sandbox. It uses Phaser for the browser client, Colyseus for the authoritative game server, and the sibling OpenGTA2 project only as an offline converter for locally owned GTA2 data.

The client, HUD, movement, combat, AI, wanted system, and vehicle handling are purpose-built for an action game.

## Playable Slice

- A converted 64-by-64 GTA2 Industrial District crop with layered roofs, roads, and collision.
- Original player, civilian, and police idle/walk sprite sheets.
- Automatic guest sessions with up to 32 players in one district.
- Server-authoritative walking, aiming, weapon cycling, ammunition, bullets, damage, cash, death, recoverable death drops, and respawn.
- Five opt-in Freemode jobs, including cooperative vehicle work, checkpoint racing, wave defense, and a roster-scaled marked-target contract.
- Pistol, SMG, and shotgun slots with distinct held models, fire rates, spread, range, and projectile visuals.
- Nameplates over every connected human player.
- Wandering civilians that flee when attacked.
- Police that pursue and shoot players with wanted heat.
- Three original vehicle sprites: a civilian sedan, police cruiser, and taxi.
- Eight road-following civilian traffic cars that can strike pedestrians and be stolen.
- Four-seat multiplayer cars with occupant nameplates, automatic driver promotion, and passenger shooting.
- Passengers visibly lean out with their equipped weapon and recoil when firing.
- Timed car entry and carjacking with door-side animation and a fleeing ejected driver.
- Acceleration, reversing, steering, wall collision, exiting, and vehicle impact damage.
- Desktop controls and responsive dual-stick touch controls.

## Requirements

- Node.js 20 or newer
- npm
- .NET 10 SDK/runtime
- The `ikkentim/opengta2` repository next to this repository
- A local GTA2 installation containing `data/bil.gmp` and `data/bil.sty`

The default paths match this workspace. Override them with `OPENGTA2_REPO`, `OPENGTA2_PATH`, or `DOTNET` when needed.

## Run

```bash
npm install --legacy-peer-deps
npm run assets:export
npm test
npm run dev
```

Open `http://127.0.0.1:5173`. The WebSocket game server listens on port `2567`.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move / drive | WASD or arrow keys | Left stick |
| Aim | Mouse | Right stick |
| Fire | Hold primary mouse button | Hold right stick |
| Previous / next weapon | Q / E, mouse wheel, or HUD arrows | HUD arrows |
| Enter / exit / hijack vehicle | F or the vehicle action button | CAR button |

## Architecture

- `src/` contains the Phaser client, action HUD, interpolation, prediction, and touch input.
- `server/` contains the Colyseus room, collision map, NPC AI, police response, combat, and vehicle simulation.
- `test/` boots an isolated server and verifies two-client movement, driving, combat, death, and respawn.
- `scripts/export-gta2-assets.sh` runs the OpenGTA2 web exporter into ignored local asset paths.

See [`docs/ENGINEERING_REPORT.md`](docs/ENGINEERING_REPORT.md) for the implementation report and staged production-scaling plan. See [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) for the domain organization and extraction blueprint for pedestrian AI, driving AI, police, missions, economy, and other GTA-like systems. See [`docs/ONCHAIN_INTEGRATION.md`](docs/ONCHAIN_INTEGRATION.md) for the Robinhood Chain settlement-layer design, wallet identity plan, and the gates that precede any real-value mechanic.

## Asset Boundary

All files generated from GTA2 are ignored by git. The pedestrian and vehicle sheets under `public/assets/original` are original replacements. The repository does not grant permission to redistribute the remaining Rockstar-derived map assets. See `docs/ASSETS.md` before publishing or deploying the project.
