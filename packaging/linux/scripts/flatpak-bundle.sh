#!/usr/bin/env bash
# Builds a Folevi Flatpak bundle (a single .flatpak file people can install) from a local .deb, with the Flathub
# manifest (packaging/linux/flatpak/com.folevi.Folevi.yml) but its download sources pointed at that .deb. For test
# builds in CI (.github/workflows/desktop.yml) and on a Linux machine; nothing is uploaded.
#
# Usage: packaging/linux/scripts/flatpak-bundle.sh <folevi .deb> <out .flatpak>
# Needs flatpak and flatpak-builder (install-build-deps.sh --test-tools); installs the GNOME runtime per user.
set -euo pipefail
DEB="$(readlink -f "${1:?.deb}")"; OUT="$(readlink -f "$(dirname "${2:?out .flatpak}")")/$(basename "$2")"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

RUNTIME="$(awk -F"'" '/^runtime-version:/ { print $2 }' "$HERE/flatpak/com.folevi.Folevi.yml")"
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y --noninteractive flathub "org.gnome.Platform//$RUNTIME" "org.gnome.Sdk//$RUNTIME"

mkdir -p "$WORK/flatpak"
cp "$HERE/com.folevi.Folevi.metainfo.xml" "$HERE/folevi.desktop.hbs" "$WORK/"
cp "$DEB" "$WORK/flatpak/folevi.deb"
cp -R "$HERE/flatpak/patches" "$WORK/flatpak/"
# The manifest with both architecture-specific downloads replaced by the local .deb.
python3 - "$HERE/flatpak/com.folevi.Folevi.yml" "$WORK/flatpak/com.folevi.Folevi.yml" <<'EOF'
import re, sys
text = open(sys.argv[1]).read()
block = re.compile(r"      - type: file\n        only-arches: \[\w+\]\n        url: [^\n]+\n        sha256: [^\n]+\n        dest-filename: folevi.deb\n")
text, n = block.subn("", text)
assert n == 2, f"expected two .deb sources, found {n}"
at = text.index("  - name: folevi\n")
text = text[:at] + text[at:].replace("    sources:\n", "    sources:\n      - type: file\n        path: folevi.deb\n", 1)
open(sys.argv[2], "w").write(text)
EOF

cd "$WORK/flatpak"
flatpak-builder --user --force-clean --disable-rofiles-fuse --repo=repo build com.folevi.Folevi.yml
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo repo "$OUT" com.folevi.Folevi
echo "Flatpak bundle: $OUT ($(du -m "$OUT" | cut -f1) MB)"
