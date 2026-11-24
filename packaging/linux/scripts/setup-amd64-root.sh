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
  # Ubuntu's own minimal 22.04 root (checked against its SHA256SUMS). Not debootstrap: its second stage unmounts
  # /proc while it runs ldconfig, and Rosetta can't start an x86_64 program without /proc.
  base=https://cdimage.ubuntu.com/ubuntu-base/releases/22.04/release
  file="$(curl -fsSL "$base/SHA256SUMS" | awk '/base-amd64.tar.gz/ { gsub(/\*/, "", $2); print $2 }' | tail -1)"
  curl -fsSL "$base/$file" -o /tmp/ubuntu-base.tgz
  curl -fsSL "$base/SHA256SUMS" | awk -v f="$file" '{ n = $2; gsub(/\*/, "", n) } n == f { print $1 "  /tmp/ubuntu-base.tgz" }' | sha256sum -c -
  mkdir -p "$ROOT"
  tar -xzf /tmp/ubuntu-base.tgz -C "$ROOT"
  rm -f /tmp/ubuntu-base.tgz
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
