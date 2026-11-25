#!/usr/bin/env bash
# Prove the QNAP private-glibc approach without a QNAP: run the bundle's programs through runtime/lib inside
# Linux images whose glibc is older than QTS 5's 2.21 floor or close to it.
#   test-private-glibc.sh --bundle <dir> --arch <x86_64|aarch64> [--images "ubuntu:16.04 centos:7"] [--require-docker]
# ubuntu:16.04 has glibc 2.23 (QTS 5.x reports 2.21); centos:7 has 2.17 (older than any QTS 5).
# Checks, in each image:
#   1. the plain binaries FAIL there (proves the image really is too old; informative)
#   2. "ld.so --library-path runtime/lib <program>" works: node --version, convex-backend --help
#   3. the QNAP way works: binaries patched by packaging/qnap/patch-private-glibc.sh, loader linked at
#      /usr/local/lib/folevi-rt/ld.so, run directly; for a real node also a child process via process.execPath
# A real bundle gets runtime/lib from Ubuntu 22.04 (packaging/qnap/populate-runtime-lib.sh). A fake bundle made
# with "make-fake-bundle.sh ... --native" was compiled on this machine, so its runtime/lib comes from "/" here.
# Docker is needed for steps 1 to 3; without it only host checks run (CI runs the full test: see
# .github/workflows/server-packages.yml, job "glibc-test"). To run it yourself: any Linux with Docker, or
# Docker Desktop on a Mac with "--arch aarch64" and an arm64 bundle.
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"
LOG_PREFIX=glibc-test
bundle="" arch="" images="ubuntu:16.04 centos:7" require_docker=0
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) bundle="$(cd "$2" && pwd)"; shift 2 ;; --arch) arch="$(normalize_arch "$2")"; shift 2 ;;
    --images) images="$2"; shift 2 ;; --require-docker) require_docker=1; shift ;;
    *) die "unknown flag $1" ;;
  esac
done
[ -n "$bundle" ] && [ -n "$arch" ] || die "usage: $0 --bundle <dir> --arch <arch>"
QNAP="$PACKAGING_DIR/qnap"
case "$arch" in x86_64) loader=ld-linux-x86-64.so.2 ;; aarch64) loader=ld-linux-aarch64.so.1 ;; esac
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
fake=0; grep -q '"fake":true' "$bundle/manifest.json" 2>/dev/null && fake=1

stage="$work/plain"
copy_bundle "$bundle" "$stage"
if [ ! -e "$stage/runtime/lib/$loader" ]; then
  if [ "$fake" = 1 ]; then "$QNAP/populate-runtime-lib.sh" --bundle "$stage" --arch "$arch" --from-rootfs /
  else "$QNAP/populate-runtime-lib.sh" --bundle "$stage" --arch "$arch"; fi
fi
head -c 4 "$stage/bin/convex-backend" | grep -q ELF || die "bin/convex-backend is not an ELF file (make the fake bundle with --native)"

# Host check: the explicit loader form.
"$stage/runtime/lib/$loader" --library-path "$stage/runtime/lib" "$stage/runtime/node/bin/node" --version
"$stage/runtime/lib/$loader" --library-path "$stage/runtime/lib" "$stage/bin/convex-backend" --help | head -n 1

# Host check: the patched form, with the interpreter at a test path.
if command -v patchelf >/dev/null; then
  hp="$work/hostpatched"; copy_bundle "$stage" "$hp"
  mkdir -p "$work/rt"; ln -s "$hp/runtime/lib/$loader" "$work/rt/ld.so"
  FOLEVI_RT_INTERP="$work/rt/ld.so" "$QNAP/patch-private-glibc.sh" --bundle "$hp" >/dev/null 2>&1
  "$hp/runtime/node/bin/node" --version
  "$hp/bin/convex-backend" --help | head -n 1
  log "host checks passed (loader and patched forms)"
else
  log "patchelf missing: skipped the patched form (apt install patchelf, or pip install patchelf)"
fi

command -v patchelf >/dev/null || die "patchelf is needed for the old-glibc checks (apt install patchelf)"
patched="$work/patched"; copy_bundle "$stage" "$patched"
"$QNAP/patch-private-glibc.sh" --bundle "$patched"
chmod -R a+rX "$work"
node_child=""
[ "$fake" = 0 ] && node_child="/p/runtime/node/bin/node -e \"console.log('child', require('child_process').execFileSync(process.execPath, ['--version']).toString().trim())\""
checks() { # $1: label. Runs inside the old system, with the plain bundle at /b and the patched one at /p.
  cat <<SCRIPT
    echo "system glibc: \$(ldd --version 2>&1 | head -n 1)"
    if /b/bin/convex-backend --help >/dev/null 2>&1; then echo 'note: plain convex-backend ran without the private glibc'; else echo 'ok: plain convex-backend fails here, as expected'; fi
    /b/runtime/lib/$loader --library-path /b/runtime/lib /b/runtime/node/bin/node --version
    /b/runtime/lib/$loader --library-path /b/runtime/lib /b/bin/convex-backend --help | head -n 1
    mkdir -p /usr/local/lib/folevi-rt
    ln -sfn /p/runtime/lib/$loader /usr/local/lib/folevi-rt/ld.so
    /p/runtime/node/bin/node --version
    /p/bin/convex-backend --help | head -n 1
    $node_child
    echo 'ok: private glibc works in $1'
SCRIPT
}

if docker info >/dev/null 2>&1; then
  platform="linux/$(deb_arch "$arch")"
  for image in $images; do
    log "image $image ($platform)"
    docker run --rm --platform "$platform" -v "$stage:/b:ro" -v "$patched:/p:ro" "$image" sh -ec "$(checks "$image")"
  done
  log "all container checks passed: $images"
  exit 0
fi
[ "$require_docker" = 1 ] && die "Docker is not available"

# No Docker: as root, use Ubuntu's official 16.04 base root filesystem (glibc 2.23) in a chroot instead.
if [ "$(id -u)" = 0 ] && command -v chroot >/dev/null; then
  case "$arch" in
    x86_64) tarball=ubuntu-base-16.04.6-base-amd64.tar.gz sum=9c160b522568c0c3f2c396cfe7c966f1a63aa1a5e9f6f966a74fdf3571ad49a0 ;;
    aarch64) tarball=ubuntu-base-16.04.6-base-arm64.tar.gz sum=3e1ed4a7e5ba750e2ce3556a3de1f4735b5571d8edb3c90a4ba36b6697d783d6 ;;
  esac
  curl -fsSL "https://cdimage.ubuntu.com/ubuntu-base/releases/16.04/release/$tarball" -o "$work/base.tgz"
  echo "$sum  $work/base.tgz" | sha256sum -c --quiet - || die "ubuntu-base checksum mismatch"
  root="$work/xenial"; mkdir -p "$root"
  tar -xzf "$work/base.tgz" -C "$root" --exclude='./dev/*'
  copy_bundle "$stage" "$root/b"; copy_bundle "$patched" "$root/p"
  # $ORIGIN in RPATH is resolved through /proc/self/exe, so the chroot needs /proc (Docker and QTS have it).
  mount -t proc proc "$root/proc" || die "cannot mount /proc in the chroot"
  trap 'umount "$root/proc" 2>/dev/null || true; rm -rf "$work"' EXIT
  log "chroot ubuntu-base 16.04 ($arch)"
  chroot "$root" /bin/sh -ec "$(checks "ubuntu-base 16.04 chroot")"
  log "chroot checks passed (the Docker images, including centos:7, run in CI)"
  exit 0
fi
log "neither Docker nor root here: old-glibc checks skipped (CI runs them)"
