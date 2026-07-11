#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENGTA2_REPO="${OPENGTA2_REPO:-$PROJECT_ROOT/../opengta2}"
OPENGTA2_PATH="${OPENGTA2_PATH:-$PROJECT_ROOT/../GTA2_GAME/App_Executables}"
DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"

if [ ! -x "$DOTNET" ]; then
  echo ".NET 10 was not found at $DOTNET" >&2
  exit 1
fi

if [ ! -f "$OPENGTA2_PATH/data/bil.gmp" ] || [ ! -f "$OPENGTA2_PATH/data/bil.sty" ]; then
  echo "GTA2 data was not found at $OPENGTA2_PATH" >&2
  exit 1
fi

"$DOTNET" run \
  --project "$OPENGTA2_REPO/src/OpenGta2.WebExporter/OpenGta2.WebExporter.csproj" \
  --configuration Release \
  -- \
  "$OPENGTA2_PATH" \
  "$PROJECT_ROOT/public/assets" \
  bil \
  64

echo "Generated local GTA2 browser assets in public/assets."
