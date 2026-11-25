#!/usr/bin/env bash
# Builds the Folevi snap for this machine's architecture from a release .deb (packaging/linux/snap/snapcraft.yaml),
# with the snap's version set from the .deb. Nothing is uploaded: the Snap Store upload needs the owner's OK
# (docs/LINUX.md, "Snap").
#
# Usage: packaging/linux/scripts/snap-build.sh <Folevi .deb> <out dir>
# Needs snapcraft (snap install snapcraft --classic) and LXD (snap install lxd; lxd init --auto; user in group lxd).
set -euo pipefail
DEB="$(readlink -f "${1:?.deb}")"; OUT="$(mkdir -p "${2:?out dir}" && cd "$2" && pwd)"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HOME/.cache"; WORK="$(mktemp -d "$HOME/.cache/folevi-snap.XXXXXX")"; trap 'rm -rf "$WORK"' EXIT
V="$(dpkg-deb -f "$DEB" Version)"
cp "$DEB" "$WORK/folevi.deb"
mkdir -p "$WORK/icons" && cp "$HERE/icons/512x512.png" "$WORK/icons/"
mkdir -p "$WORK/snap"
sed -e "s/^version: .*/version: '$V'/" -e 's|^icon: \.\./icons/|icon: icons/|' "$HERE/snap/snapcraft.yaml" > "$WORK/snap/snapcraft.yaml"
cd "$WORK"
# snapcraft only writes inside the project folder.
snapcraft pack --use-lxd
mv "$WORK"/*.snap "$OUT/"
ls -la "$OUT"/*.snap
