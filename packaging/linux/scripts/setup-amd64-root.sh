#!/usr/bin/env bash
# Inside an arm64 Ubuntu VM with Rosetta (Lima on Apple silicon, docs/LINUX.md "Building"): makes an Ubuntu 22.04
# amd64 root at /srv/jammy-amd64 whose programs run through Rosetta, with Folevi's build tools, so x86_64 packages
# build at close to native speed without cross-compiling GTK.
#
# Usage (in the VM): sudo bash packaging/linux/scripts/setup-amd64-root.sh
set -euo pipefail
ROOT=/srv/jammy-amd64
HERE="$(cd "$(dirname "$0")" && pwd)"

grep -q enabled /proc/sys/fs/binfmt_misc/rosetta 2>/dev/null || { echo "Rosetta isn't registered for x86_64 programs"; exit 1; }
mount_all() {
  for m in proc sys dev dev/pts; do
    mkdir -p "$ROOT/$m"
    mountpoint -q "$ROOT/$m" || mount --bind "/$m" "$ROOT/$m"
  done
}
if [[ ! -x "$ROOT/usr/bin/apt-get" ]]; then
  apt-get install -y -qq debootstrap
  # Two stages: Rosetta needs /proc inside the root before any x86_64 program there can run, and a one-stage
  # debootstrap runs one before it mounts /proc ("rosetta error: Unable to open /proc/self/exe").
  debootstrap --foreign --arch=amd64 --variant=buildd --include=ca-certificates,curl,sudo jammy "$ROOT" http://archive.ubuntu.com/ubuntu
  mount_all
  chroot "$ROOT" /debootstrap/debootstrap --second-stage
fi
mount_all
cat > "$ROOT/etc/apt/sources.list" <<'EOF'
deb http://archive.ubuntu.com/ubuntu jammy main universe
deb http://archive.ubuntu.com/ubuntu jammy-updates main universe
deb http://security.ubuntu.com/ubuntu jammy-security main universe
EOF
cp /etc/resolv.conf "$ROOT/etc/resolv.conf"
cp "$HERE/install-build-deps.sh" "$ROOT/tmp/"
chroot "$ROOT" bash /tmp/install-build-deps.sh
chroot "$ROOT" bash -lc 'command -v cargo-tauri >/dev/null || cargo install tauri-cli --version "^2" --locked'
echo "amd64 build root ready at $ROOT"
