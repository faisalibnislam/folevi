#!/usr/bin/env bash
# Publishes Folevi for Linux downloads to folevi.com/download/linux/ (R2 bucket folevi-updates, prefix linux/), the
# way Folevi for Windows publishes windows/. ONLY with the owner's OK for that release (docs/LINUX.md, "Releasing").
#
#   versioned:  Folevi_<v>_amd64.AppImage  Folevi_<v>_aarch64.AppImage   (cached, never replaced)
#               Folevi_<v>_amd64.deb       Folevi_<v>_arm64.deb
#               Folevi-<v>-1.x86_64.rpm    Folevi-<v>-1.aarch64.rpm
#               SHA256SUMS-<v>.txt
#   latest:     Folevi-x86_64.AppImage  Folevi-aarch64.AppImage  Folevi-amd64.deb  Folevi-arm64.deb
#               Folevi-x86_64.rpm  Folevi-aarch64.rpm  SHA256SUMS.txt   (no-cache, replaced each release)
#
# Usage: packaging/linux/scripts/upload-release.sh <version> <dir from build-in-lima.sh> [--dry-run]
# Needs `npx wrangler` logged in to the account that owns folevi-updates. Uploads with --remote (wrangler's default
# is a local bucket).
set -euo pipefail
V="${1:?version}"; DIR="$(cd "${2:?build dir}" && pwd)"; DRY="${3:-}"
BUCKET=folevi-updates/linux

declare -a FILES=(
  "x86_64/appimage/Folevi_${V}_amd64.AppImage|Folevi-x86_64.AppImage|application/vnd.appimage"
  "aarch64/appimage/Folevi_${V}_aarch64.AppImage|Folevi-aarch64.AppImage|application/vnd.appimage"
  "x86_64/deb/Folevi_${V}_amd64.deb|Folevi-amd64.deb|application/vnd.debian.binary-package"
  "aarch64/deb/Folevi_${V}_arm64.deb|Folevi-arm64.deb|application/vnd.debian.binary-package"
  "x86_64/rpm/Folevi-${V}-1.x86_64.rpm|Folevi-x86_64.rpm|application/x-rpm"
  "aarch64/rpm/Folevi-${V}-1.aarch64.rpm|Folevi-aarch64.rpm|application/x-rpm"
)

for f in "${FILES[@]}"; do
  [[ -f "$DIR/${f%%|*}" ]] || { echo "missing $DIR/${f%%|*}"; exit 1; }
done

SUMS="$(mktemp -d)"; trap 'rm -rf "$SUMS"' EXIT
(cd "$DIR" && for f in "${FILES[@]}"; do p="${f%%|*}"; (cd "$(dirname "$p")" && shasum -a 256 "$(basename "$p")"); done) > "$SUMS/SHA256SUMS-$V.txt"
# The latest list names both the versioned and the latest files, so `sha256sum -c --ignore-missing` works on either.
cp "$SUMS/SHA256SUMS-$V.txt" "$SUMS/SHA256SUMS.txt"
for f in "${FILES[@]}"; do
  IFS='|' read -r path latest type <<<"$f"
  echo "$(awk -v n="$(basename "$path")" '$2 == n { print $1 }' "$SUMS/SHA256SUMS-$V.txt")  $latest" >> "$SUMS/SHA256SUMS.txt"
done
cat "$SUMS/SHA256SUMS.txt"

put() { # <file> <key> <type> <cache-control>
  echo "put $BUCKET/$2"
  [[ "$DRY" == "--dry-run" ]] && return
  npx --yes wrangler r2 object put "$BUCKET/$2" --file "$1" --content-type "$3" --cache-control "$4" --remote >/dev/null
}

for f in "${FILES[@]}"; do
  IFS='|' read -r path latest type <<<"$f"
  put "$DIR/$path" "$(basename "$path")" "$type" "public, max-age=31536000, immutable"
done
put "$SUMS/SHA256SUMS-$V.txt" "SHA256SUMS-$V.txt" "text/plain; charset=utf-8" "public, max-age=31536000, immutable"
for f in "${FILES[@]}"; do
  IFS='|' read -r path latest type <<<"$f"
  put "$DIR/$path" "$latest" "$type" "no-cache"
done
put "$SUMS/SHA256SUMS.txt" "SHA256SUMS.txt" "text/plain; charset=utf-8" "no-cache"
echo "Published Folevi for Linux $V at https://folevi.com/download/linux/"
