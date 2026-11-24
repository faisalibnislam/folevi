#!/usr/bin/env bash
# Builds Folevi for Linux test packages on a Mac, in the Lima VM "folevi-linux" (Ubuntu 22.04 arm64 with Rosetta;
# docs/LINUX.md, "Building"): AppImage, .deb and .rpm for aarch64 (natively) and x86_64 (in an Ubuntu 22.04 amd64
# root that runs through Rosetta), then the Flatpak bundles. Results land in <out dir>.
#
# Usage (from the repo root, on the Mac): packaging/linux/scripts/build-in-lima.sh <out dir> [--skip-web] [--arch aarch64|x86_64]
#   The web export (apps/desktop/web) is platform-neutral, so it's built here on the Mac with Node, in production
#   mode (build-shell.mjs --platform windows --production: the desktop export; the shell sets the Linux look).
#   TAURI_SIGNING_PRIVATE_KEY, when set, signs the AppImage for the updater; without it no updater files are made.
#
# Nothing is uploaded anywhere.
set -euo pipefail
OUT="$(mkdir -p "${1:?out dir}" && cd "$1" && pwd)"; shift
SKIP_WEB=0; ARCHES="aarch64 x86_64"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-web) SKIP_WEB=1 ;;
    --arch) ARCHES="$2"; shift ;;
  esac
  shift
done
REPO="$(git rev-parse --show-toplevel)"
VM=folevi-linux
VM_SRC=/home/$USER.linux/folevi
VM_ROOT64=/srv/jammy-amd64

if [[ $SKIP_WEB == 0 ]]; then
  (cd "$REPO/apps/web" && node scripts/build-shell.mjs --platform windows --production)
fi
[[ -f "$REPO/apps/desktop/web/index.html" ]] || { echo "no web export in apps/desktop/web"; exit 1; }

# The sources the build needs, onto the VM's own disk (much faster than the shared folder).
limactl shell "$VM" -- mkdir -p "$VM_SRC"
(cd "$REPO" && { git ls-files apps/desktop packaging version.json; find apps/desktop/web -type f; } | grep -v '^apps/desktop/src-tauri/target/') \
  | (cd "$REPO" && tar -cf - -T -) | limactl shell "$VM" -- tar -xf - -C "$VM_SRC"

CONFIG_ARGS=()
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  CONFIG_ARGS=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
fi
CFG="${CONFIG_ARGS[*]:-}"

for arch in $ARCHES; do
  echo "== $arch"
  if [[ $arch == aarch64 ]]; then
    limactl shell "$VM" -- env TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-}" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
      bash -lc "cd '$VM_SRC/apps/desktop/src-tauri' && APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build --bundles appimage,deb,rpm ${CFG:+--config '{\"bundle\":{\"createUpdaterArtifacts\":false}}'}"
    BUNDLE="$VM_SRC/apps/desktop/src-tauri/target/release/bundle"
  else
    # The x86_64 root shares the source through a bind mount (set up by setup-amd64-root.sh).
    limactl shell "$VM" -- sudo mkdir -p "$VM_ROOT64/build"
    limactl shell "$VM" -- bash -lc "mountpoint -q $VM_ROOT64/build || sudo mount --bind '$VM_SRC' $VM_ROOT64/build"
    limactl shell "$VM" -- sudo chroot "$VM_ROOT64" env TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-}" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
      bash -lc "cd /build/apps/desktop/src-tauri && CARGO_TARGET_DIR=/build/target-x86_64 APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build --bundles appimage,deb,rpm ${CFG:+--config '{\"bundle\":{\"createUpdaterArtifacts\":false}}'}"
    BUNDLE="$VM_SRC/target-x86_64/release/bundle"
  fi
  mkdir -p "$OUT/$arch"
  limactl shell "$VM" -- bash -lc "cd '$BUNDLE' && tar -cf - appimage/*.AppImage* deb/*.deb rpm/*.rpm 2>/dev/null" | tar -xf - -C "$OUT/$arch"
done
echo "Linux packages in $OUT"
