#!/usr/bin/env bash
# Builds Folevi for Linux test packages on a Mac, in the Lima VM "folevi-linux" (Ubuntu 22.04 arm64 with Rosetta;
# docs/LINUX.md, "Building"): AppImage, .deb and .rpm for aarch64 (natively) and x86_64 (in the Ubuntu 22.04 amd64
# root that setup-amd64-root.sh made, through Rosetta). Results land in <out dir>/<arch>/.
#
# Usage (from the repo root, on the Mac): packaging/linux/scripts/build-in-lima.sh <out dir> [--skip-web] [--arch aarch64|x86_64]
#   The web export (apps/desktop/web) is the same for every desktop, so it's built here on the Mac:
#   build-shell.mjs --platform windows --production (the shell gives the page the Linux look at run time).
#   Updater files are off in tauri.conf.json until the owner approves an update signing key.
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
VM_HOME="$(limactl shell "$VM" -- sh -c 'echo $HOME')"
VM_SRC="$VM_HOME/folevi"
ROOT64=/srv/jammy-amd64

if [[ $SKIP_WEB == 0 ]]; then
  (cd "$REPO/apps/web" && node scripts/build-shell.mjs --platform windows --production)
  # Dropbox and Google Drive's shared code, put in the page by lib.rs (offered when FOLEVI_DROPBOX_APP_KEY and
  # FOLEVI_GOOGLE_DESKTOP_CLIENT_ID are set for the build).
  node "$REPO/apps/ios/scripts/bundle-cloud.mjs"
fi
[[ -f "$REPO/apps/desktop/web/index.html" ]] || { echo "no web export in apps/desktop/web"; exit 1; }
# The app takes Folevi's one version from version.json (apps/desktop/package.json, which tauri.conf.json reads), as
# the Desktop workflow does; without this the packages carry whatever version package.json last had.
(cd "$REPO/apps/desktop" && node scripts/version.mjs)

# The sources the build needs, onto the VM's own disk (much faster than a shared folder): the desktop app, the
# packaging, and what build.rs and the tests read from elsewhere. COPYFILE_DISABLE and --no-xattrs keep macOS's
# "._" files out: tauri-build reads every file in capabilities/ and fails on them.
limactl shell "$VM" -- bash -c "rm -rf '$VM_SRC/apps/desktop/web' && mkdir -p '$VM_SRC'"
(cd "$REPO" && {
  git ls-files apps/desktop packaging version.json apps/ios/ios/App/Native/Shell/shell-bridge.js packages/local-store/fixtures
  find apps/desktop/web -type f
  [[ -f apps/ios/ios/App/Native/Shell/folevi-cloud.js ]] && echo apps/ios/ios/App/Native/Shell/folevi-cloud.js
} | grep -v '^apps/desktop/src-tauri/target/' | COPYFILE_DISABLE=1 tar --no-xattrs -cf - -T -) \
  | limactl shell "$VM" -- tar -xf - -C "$VM_SRC"

# Dropbox and Google Drive's public client ids, when set here, go into the build (cloud.rs, option_env!).
IDS="FOLEVI_DROPBOX_APP_KEY='${FOLEVI_DROPBOX_APP_KEY:-}' FOLEVI_GOOGLE_DESKTOP_CLIENT_ID='${FOLEVI_GOOGLE_DESKTOP_CLIENT_ID:-}'"

for arch in $ARCHES; do
  echo "== $arch"
  # Old bundles would be copied out with the new ones.
  limactl shell "$VM" -- sudo rm -rf "$VM_SRC/apps/desktop/src-tauri/target/release/bundle" "$ROOT64/root/target-x86/release/bundle"
  if [[ $arch == aarch64 ]]; then
    limactl shell "$VM" -- bash -lc "cd '$VM_SRC/apps/desktop/src-tauri' && $IDS APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build --bundles appimage,deb,rpm"
    BUNDLE="$VM_SRC/apps/desktop/src-tauri/target/release/bundle"
  else
    limactl shell "$VM" -- sudo bash "$VM_SRC/packaging/linux/scripts/setup-amd64-root.sh" --prepare
    limactl shell "$VM" -- sudo bash -c "mkdir -p $ROOT64/build && { mountpoint -q $ROOT64/build || mount --bind '$VM_SRC' $ROOT64/build; }"
    limactl shell "$VM" -- sudo chroot "$ROOT64" env -u SUDO_USER bash -lc \
      "cd /build/apps/desktop/src-tauri && $IDS CARGO_TARGET_DIR=/root/target-x86 APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build --bundles appimage,deb,rpm"
    BUNDLE="$ROOT64/root/target-x86/release/bundle"
  fi
  mkdir -p "$OUT/$arch"
  limactl shell "$VM" -- sudo bash -c "cd '$BUNDLE' && tar -cf - appimage/*.AppImage deb/*.deb rpm/*.rpm" | tar -xf - -C "$OUT/$arch"
done
echo "Linux packages in $OUT"
