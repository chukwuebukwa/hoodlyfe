#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEFAULT_OPENGTA2_REPO="$PROJECT_ROOT/opengta2"
if [ ! -f "$DEFAULT_OPENGTA2_REPO/src/OpenGta2.WebExporter/OpenGta2.WebExporter.csproj" ]; then
  DEFAULT_OPENGTA2_REPO="$PROJECT_ROOT/../opengta2"
fi

DEFAULT_OPENGTA2_PATH="$PROJECT_ROOT/GTA2_GAME/App_Executables"
if [ ! -f "$DEFAULT_OPENGTA2_PATH/data/bil.gmp" ]; then
  DEFAULT_OPENGTA2_PATH="$PROJECT_ROOT/../GTA2_GAME/App_Executables"
fi

OPENGTA2_REPO="${OPENGTA2_REPO:-$DEFAULT_OPENGTA2_REPO}"
OPENGTA2_PATH="${OPENGTA2_PATH:-$DEFAULT_OPENGTA2_PATH}"
GTA2_LEVEL="${GTA2_LEVEL:-bil}"
GTA2_CROP_SIZE="${GTA2_CROP_SIZE:-64}"
OUTPUT_ASSETS_DIR="${OUTPUT_ASSETS_DIR:-$PROJECT_ROOT/public/assets}"
DOTNET_ARTIFACTS_DIR="${DOTNET_ARTIFACTS_DIR:-$PROJECT_ROOT/.dotnet-artifacts}"
DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"
if [ ! -x "$DOTNET" ] && command -v dotnet >/dev/null 2>&1; then
  DOTNET="$(command -v dotnet)"
fi

if [ ! -x "$DOTNET" ]; then
  echo ".NET 10 was not found at $DOTNET" >&2
  exit 1
fi

if [ ! -f "$OPENGTA2_REPO/src/OpenGta2.WebExporter/OpenGta2.WebExporter.csproj" ]; then
  echo "OpenGTA2 web exporter was not found at $OPENGTA2_REPO" >&2
  exit 1
fi

if [ ! -f "$OPENGTA2_PATH/data/$GTA2_LEVEL.gmp" ] || [ ! -f "$OPENGTA2_PATH/data/$GTA2_LEVEL.sty" ]; then
  echo "GTA2 level data was not found at $OPENGTA2_PATH/data/$GTA2_LEVEL.{gmp,sty}" >&2
  exit 1
fi

"$DOTNET" run \
  --project "$OPENGTA2_REPO/src/OpenGta2.WebExporter/OpenGta2.WebExporter.csproj" \
  --configuration Release \
  --artifacts-path "$DOTNET_ARTIFACTS_DIR" \
  -- \
  "$OPENGTA2_PATH" \
  "$OUTPUT_ASSETS_DIR" \
  "$GTA2_LEVEL" \
  "$GTA2_CROP_SIZE"

echo "Generated local GTA2 browser assets in $OUTPUT_ASSETS_DIR from $GTA2_LEVEL at ${GTA2_CROP_SIZE}x${GTA2_CROP_SIZE} tiles."
