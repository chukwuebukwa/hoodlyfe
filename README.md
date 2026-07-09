# Nock0

A browser-based, top-down multiplayer crime-game prototype built from the open-source [Reldens](https://github.com/damian-pastorini/reldens) MMORPG platform.

## Current milestone

This repository boots a local Reldens development workspace and provides a controlled place for GTA-style changes without modifying upstream.

Reldens already supplies browser rendering, authoritative multiplayer rooms, movement, maps, chat, accounts, NPCs, combat, inventory, projectiles, physics, pathfinding, and an administration panel. The first game slice will turn those systems into one small city block with a ranged weapon, police NPC, and wanted level.

## Requirements

- Git
- Node.js 20 or newer
- npm
- MySQL 8 (or Docker)

## Start

```bash
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh
```

The script clones the pinned Reldens source into `vendor/reldens` and installs its dependencies. Continue through the Reldens web installer using the database values in `.env.example`.

To start only the database:

```bash
docker compose up -d db
```

## Development order

1. Boot upstream unchanged and confirm two browser clients can walk and chat.
2. Replace a sample map with a compact city block.
3. Configure a projectile weapon through Reldens skills/items.
4. Convert an enemy NPC into a police unit.
5. Add a server-owned wanted-state service.
6. Add enterable vehicles after pedestrian combat is stable.

## Repository layout

- `scripts/bootstrap.sh` — downloads and installs the pinned upstream engine.
- `docker-compose.yml` — local MySQL service.
- `.env.example` — local development database settings.
- `docs/MVP.md` — implementation boundary and acceptance tests.
- `game/` — Nock0-specific modules and assets, kept separate from upstream.

## Licensing

Reldens is MIT licensed. New code in this repository is also MIT licensed unless a file states otherwise. Do not copy proprietary GTA names, maps, characters, audio, logos, or art. This project targets the game structure only: a top-down multiplayer city sandbox using original assets.
