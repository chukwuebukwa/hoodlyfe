# NOCK0

NOCK0 is a custom browser-based, top-down multiplayer crime sandbox. It uses Three.js for the browser client, Colyseus for the authoritative game server, and the bundled OpenGTA2 converter source only as an offline converter for locally owned GTA2 data.

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
- Optional spatial proximity voice with desktop and touch push-to-talk.

## Requirements

- Node.js 20 or newer
- npm
- .NET 10 SDK/runtime
- A local GTA2 installation containing `data/bil.gmp` and `data/bil.sty`

The repository includes the OpenGTA2 converter source under `opengta2/`. The GTA2 game files are not included and must stay local/private.

The default local development layout is:

```text
nock0-action/
  opengta2/        # bundled converter source, committed
  GTA2_GAME/       # local GTA2 install, ignored by git
    App_Executables/
      data/
        bil.gmp
        bil.sty
```

If your GTA2 install lives somewhere else, set `OPENGTA2_PATH` to the directory that contains the `data/` folder. You can also override `OPENGTA2_REPO`, `DOTNET`, `GTA2_LEVEL`, or `GTA2_CROP_SIZE`.

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
| Proximity voice | Enable VOICE, then hold V | Hold PTT |

## Proximity Voice

Voice chat uses LiveKit for WebRTC media transport and Colyseus for authoritative
same-space proximity. It stays disabled when the LiveKit variables are omitted.

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-key
LIVEKIT_API_SECRET=your-secret
```

The API secret must remain server-side. Players subscribe before entering audible
range, fade smoothly to silence at 700 world units, and unsubscribe beyond 950 units.

## Architecture

- `src/` contains the browser client, action HUD, interpolation, prediction, and touch input.
- `server/` contains the Colyseus room, collision map, NPC AI, police response, combat, and vehicle simulation.
- `test/` boots an isolated server and verifies two-client movement, driving, combat, death, and respawn.
- `opengta2/` contains the converter source used by `npm run assets:export`.
- `scripts/export-gta2-assets.sh` runs the OpenGTA2 web exporter into ignored local asset paths.

## GTA2 Asset Export

The export command reads the local GTA2 install and writes generated browser assets into `public/assets/`. These outputs are ignored by git because they are derived from GTA2 data.

Fresh clone setup:

```bash
git pull
npm install --legacy-peer-deps
mkdir -p GTA2_GAME
```

Then place a local GTA2 install at:

```text
nock0-action/GTA2_GAME/App_Executables/data/bil.gmp
nock0-action/GTA2_GAME/App_Executables/data/bil.sty
```

The `GTA2_GAME/` directory is local-only and must not be committed.

Default export:

```bash
npm run assets:export
```

This generates or refreshes:

```text
public/assets/maps/district-map.json
public/assets/maps/district-map.metadata.json
public/assets/maps/district-preview.png
public/assets/maps/district-overlay.png
public/assets/maps/district-tiles.png
public/assets/maps/three/prototype.json
public/assets/maps/three/tiles.png
```

Increase the map crop:

```bash
GTA2_CROP_SIZE=96 npm run assets:export
GTA2_CROP_SIZE=128 npm run assets:export
```

The crop size is in GTA2 tiles. Each tile is `64` world pixels, so `96` produces a `6144 x 6144` world and `128` produces an `8192 x 8192` world. The converter currently accepts crop sizes from `16` through `128`.

Export another GTA2 level if the matching `.gmp` and `.sty` files exist:

```bash
GTA2_LEVEL=wil npm run assets:export
GTA2_LEVEL=ste GTA2_CROP_SIZE=96 npm run assets:export
```

Use a custom install location:

```bash
OPENGTA2_PATH=/path/to/GTA2/App_Executables npm run assets:export
```

After changing crop size or level, run:

```bash
npm test
npm run dev
```

See [`docs/ENGINEERING_REPORT.md`](docs/ENGINEERING_REPORT.md) for the implementation report and staged production-scaling plan. See [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) for the domain organization and extraction blueprint for pedestrian AI, driving AI, police, missions, economy, and other GTA-like systems. See [`docs/ONCHAIN_INTEGRATION.md`](docs/ONCHAIN_INTEGRATION.md) for the Robinhood Chain settlement-layer design, wallet identity plan, and the gates that precede any real-value mechanic.

## Asset Boundary

All files generated from GTA2 are ignored by git. The pedestrian and vehicle sheets under `public/assets/original` are original replacements. The repository does not grant permission to redistribute the remaining Rockstar-derived map assets. See `docs/ASSETS.md` before publishing or deploying the project.
