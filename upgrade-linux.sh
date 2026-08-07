#!/usr/bin/env bash
set -euo pipefail

ZIP="${1:-$HOME/CinderQuest_v0.2.0.zip}"
TARGET="${2:-$HOME/songrequest}"
TEMP="$(mktemp -d)"
BACKUP="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP" "$BACKUP"
}
trap cleanup EXIT

test -f "$ZIP" || { echo "ZIP not found: $ZIP"; exit 1; }

if [ -f "$TARGET/.env" ]; then
  cp "$TARGET/.env" "$BACKUP/.env"
fi

if [ -d "$TARGET/data" ]; then
  cp -a "$TARGET/data" "$BACKUP/data"
fi

unzip -q -o "$ZIP" -d "$TEMP"
SOURCE="$TEMP/Cinder_Stream_Song_Requester"
test -d "$SOURCE" || { echo "Expected folder missing inside ZIP: $SOURCE"; exit 1; }

mkdir -p "$TARGET"
find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "$SOURCE/." "$TARGET/"

if [ -f "$BACKUP/.env" ]; then
  cp "$BACKUP/.env" "$TARGET/.env"
else
  cp "$TARGET/.env.example" "$TARGET/.env"
fi

if [ -d "$BACKUP/data" ]; then
  rm -rf "$TARGET/data"
  cp -a "$BACKUP/data" "$TARGET/data"
fi

cd "$TARGET"
npm install
echo
echo "Upgrade complete."
echo "Preserved: $TARGET/.env and $TARGET/data"
echo "Start with: cd $TARGET && npm start"
