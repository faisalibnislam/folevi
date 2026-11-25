#!/usr/bin/env bash
# Publishes the automatic-update feed for Folevi for Windows and the Linux AppImage (docs/DESKTOP_APP.md, "Updates").
# ONLY with the owner's OK for that release, and only after the release's installers are published
# (folevi.com/download/windows/ and packaging/linux/scripts/upload-release.sh).
#
#   packaging/desktop/publish-update-feed.sh <version> <dir> [--notes "text"] [--dry-run]
#
# <dir> holds any of the release's files (CI artifacts, or build-in-lima.sh's output; searched recursively):
#   Folevi_<v>_x64-setup.exe     -> windows-x86_64    Folevi_<v>_amd64.AppImage    -> linux-x86_64
#   Folevi_<v>_arm64-setup.exe   -> windows-aarch64   Folevi_<v>_aarch64.AppImage  -> linux-aarch64
#
# For each one it checks that the copy at folevi.com/download/ is byte for byte the same file (the signature is of
# those bytes), signs it with Folevi's update key and writes desktop/<target>-<arch>/latest.json, which the app reads
# (tauri.conf.json, plugins.updater.endpoints). Never uploads an installer itself.
#
# The key: ~/.folevi-desktop-signing/folevi-updater.key (no password), or FOLEVI_UPDATER_KEY=<path>. Never commit or
# print it. Needs `npx wrangler` logged in to the account that owns the folevi-updates bucket.
set -euo pipefail
V="${1:?version}"; DIR="$(cd "${2:?dir with the release files}" && pwd)"; shift 2
NOTES=""; DRY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) NOTES="${2:?notes}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done
KEY="${FOLEVI_UPDATER_KEY:-$HOME/.folevi-desktop-signing/folevi-updater.key}"
[[ -f "$KEY" ]] || { echo "No update key at $KEY"; exit 1; }
BUCKET=folevi-updates
SITE=https://folevi.com/download
HERE="$(cd "$(dirname "$0")" && pwd)"
TAURI="npx --yes @tauri-apps/cli@$(node -p "require('$HERE/../../apps/desktop/package.json').devDependencies['@tauri-apps/cli']")"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# file | platform | published path
declare -a FILES=(
  "Folevi_${V}_x64-setup.exe|windows-x86_64|windows/Folevi_${V}_x64-setup.exe"
  "Folevi_${V}_arm64-setup.exe|windows-aarch64|windows/Folevi_${V}_arm64-setup.exe"
  "Folevi_${V}_amd64.AppImage|linux-x86_64|linux/Folevi_${V}_amd64.AppImage"
  "Folevi_${V}_aarch64.AppImage|linux-aarch64|linux/Folevi_${V}_aarch64.AppImage"
)

done_any=""
for f in "${FILES[@]}"; do
  IFS='|' read -r name platform published <<<"$f"
  local_file="$(find "$DIR" -type f -name "$name" | head -1)"
  [[ -n "$local_file" ]] || { echo "skip $platform: no $name in $DIR"; continue; }
  url="$SITE/$published"
  echo "$platform: checking $url"
  curl -sfL "$url" -o "$WORK/hosted" || { echo "  $url isn't published; publish the installers first"; exit 1; }
  [[ "$(shasum -a 256 < "$WORK/hosted")" == "$(shasum -a 256 < "$local_file")" ]] \
    || { echo "  the published $name differs from $local_file"; exit 1; }
  cp "$local_file" "$WORK/$name"
  $TAURI signer sign -f "$KEY" -p "" "$WORK/$name" >/dev/null 2>&1 || { echo "  signing failed"; exit 1; }
  mkdir -p "$WORK/feed/$platform"
  SIG="$(cat "$WORK/$name.sig")" V="$V" NOTES="$NOTES" PUB_DATE="$PUB_DATE" URL="$url" PLATFORM="$platform" node -e '
    const e = process.env;
    const feed = { version: e.V, notes: e.NOTES, pub_date: e.PUB_DATE, platforms: { [e.PLATFORM]: { signature: e.SIG, url: e.URL } } };
    process.stdout.write(JSON.stringify(feed, null, 2) + "\n");' > "$WORK/feed/$platform/latest.json"
  echo "  signed; desktop/$platform/latest.json -> $V"
  done_any=1
done
[[ -n "$done_any" ]] || { echo "Nothing to publish"; exit 1; }

for feed in "$WORK"/feed/*/latest.json; do
  platform="$(basename "$(dirname "$feed")")"
  if [[ -n "$DRY" ]]; then
    echo "--dry-run: would put $BUCKET/desktop/$platform/latest.json:"; cat "$feed"
  else
    npx --yes wrangler r2 object put "$BUCKET/desktop/$platform/latest.json" --file "$feed" \
      --content-type "application/json" --cache-control "no-cache" --remote >/dev/null
    echo "put $BUCKET/desktop/$platform/latest.json"
  fi
done
