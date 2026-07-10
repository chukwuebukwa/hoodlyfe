#!/usr/bin/env bash
set -euo pipefail

RELDENS_REPO="https://github.com/damian-pastorini/reldens.git"
RELDENS_REF="4.0.0-beta.39.8"
TARGET_DIR="vendor/reldens"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required; found $(node --version)" >&2
  exit 1
fi

mkdir -p vendor

if [ ! -d "$TARGET_DIR/.git" ]; then
  git clone "$RELDENS_REPO" "$TARGET_DIR"
fi

git -C "$TARGET_DIR" fetch --tags --prune
if git -C "$TARGET_DIR" rev-parse "$RELDENS_REF" >/dev/null 2>&1; then
  git -C "$TARGET_DIR" checkout "$RELDENS_REF"
else
  echo "Pinned tag $RELDENS_REF was not found; using upstream master." >&2
  git -C "$TARGET_DIR" checkout master
  git -C "$TARGET_DIR" pull --ff-only
fi

npm --prefix "$TARGET_DIR" install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

cat <<'EOF'

Bootstrap complete.

Next steps:
1. Start MySQL: docker compose up -d db
2. Follow the Reldens installer instructions in vendor/reldens.
3. Keep custom Nock0 modules in game/ rather than editing upstream directly.
EOF
