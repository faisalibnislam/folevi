#!/usr/bin/env bash
# Installs what building Folevi for Linux needs on Ubuntu 22.04 (x86_64 or aarch64): the Tauri 2 libraries
# (WebKitGTK 4.1, GTK 3, AppIndicator, librsvg), D-Bus for the Secret Service, Rust and Node.
#
# We build on Ubuntu 22.04 on purpose: glibc 2.35 is the oldest we support, so the AppImage, .deb and .rpm
# made here also run on Debian 12, Fedora 40+, openSUSE Leap 15.6 and everything newer.
#
# Usage: sudo -E bash packaging/linux/scripts/install-build-deps.sh [--test-tools]
#   --test-tools   also installs Xvfb, a D-Bus session, gnome-keyring, Weston and flatpak-builder, for the smoke
#                  tests in packaging/linux/scripts/smoke-test.sh and a local Flatpak build.
set -euo pipefail

TEST_TOOLS=0
[[ "${1:-}" == "--test-tools" ]] && TEST_TOOLS=1

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  build-essential curl wget file ca-certificates git pkg-config xz-utils unzip \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev \
  librsvg2-bin patchelf desktop-file-utils appstream rpm

if [[ $TEST_TOOLS == 1 ]]; then
  apt-get install -y -qq --no-install-recommends \
    xvfb xauth x11-utils xdotool imagemagick dbus-x11 dbus-user-session gnome-keyring libsecret-tools \
    weston at-spi2-core xdg-desktop-portal xdg-desktop-portal-gtk libnotify-bin \
    flatpak flatpak-builder fuse3 libfuse2
fi

# Node (the version in the repo's .nvmrc) for building the web interface the app ships with.
NODE_MAJOR="${NODE_MAJOR:-24}"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]]; then
  arch="$(uname -m)"; case "$arch" in x86_64) narch=x64 ;; aarch64) narch=arm64 ;; *) echo "unsupported $arch"; exit 1 ;; esac
  ver="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" | awk '/linux-'"$narch"'.tar.xz/{print $2}' | sed -E 's/node-(v[0-9.]+)-.*/\1/')"
  curl -fsSL "https://nodejs.org/dist/${ver}/node-${ver}-linux-${narch}.tar.xz" -o /tmp/node.tar.xz
  curl -fsSL "https://nodejs.org/dist/${ver}/SHASUMS256.txt" \
    | awk -v f="node-${ver}-linux-${narch}.tar.xz" '$2 == f { print $1 "  /tmp/node.tar.xz" }' | sha256sum -c -
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
fi
corepack enable

# Rust (stable) for the person running the build, not root.
TARGET_USER="${SUDO_USER:-$USER}"
if ! sudo -u "$TARGET_USER" bash -lc 'command -v cargo' >/dev/null 2>&1; then
  sudo -u "$TARGET_USER" bash -lc 'curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal'
fi

echo "Build tools ready: $(node --version), $(sudo -u "$TARGET_USER" bash -lc 'cargo --version'), WebKitGTK $(pkg-config --modversion webkit2gtk-4.1)"
