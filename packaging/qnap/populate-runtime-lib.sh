#!/usr/bin/env bash
# Fill <bundle>/runtime/lib with a private glibc, libstdc++ and libgcc_s from Ubuntu 22.04 (glibc 2.35, GCC 12's
# libstdc++ with GLIBCXX_3.4.30), the exact floor the Convex backend is built for (docs/self-hosting/PHASE0.md 6).
#   populate-runtime-lib.sh --bundle <dir> --arch <x86_64|aarch64> [--from-rootfs <dir>]
# Default source: the signed Ubuntu archive (jammy-updates). InRelease is checked with gpgv against
# /usr/share/keyrings/ubuntu-archive-keyring.gpg when that keyring exists (it does on Ubuntu CI runners), then the
# Packages index and each .deb by SHA256. --from-rootfs copies the same files from an unpacked system instead
# (for example a "docker export" of ubuntu:22.04, or "/" for the fake test bundle).
# Files: the loader (ld-linux-x86-64.so.2 or ld-linux-aarch64.so.1), libc.so.6, libm.so.6, libpthread.so.0,
# libdl.so.2, librt.so.1, libresolv.so.2, libutil.so.1, libstdc++.so.6, libgcc_s.so.1, plus their licenses.
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"
bundle="" arch="" rootfs=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) bundle="$2"; shift 2 ;; --arch) arch="$(normalize_arch "$2")"; shift 2 ;;
    --from-rootfs) rootfs="$2"; shift 2 ;; *) die "unknown flag $1" ;;
  esac
done
[ -d "$bundle" ] && [ -n "$arch" ] || die "usage: $0 --bundle <dir> --arch <arch> [--from-rootfs <dir>]"
LOG_PREFIX=runtime-lib
case "$arch" in
  x86_64) triple=x86_64-linux-gnu loader=ld-linux-x86-64.so.2 debarch=amd64 mirror=https://archive.ubuntu.com/ubuntu ;;
  aarch64) triple=aarch64-linux-gnu loader=ld-linux-aarch64.so.1 debarch=arm64 mirror=https://ports.ubuntu.com/ubuntu-ports ;;
esac
LIBS="$loader libc.so.6 libm.so.6 libpthread.so.0 libdl.so.2 librt.so.1 libresolv.so.2 libutil.so.1 libstdc++.so.6 libgcc_s.so.1"
dest="$bundle/runtime/lib"
mkdir -p "$dest" "$bundle/LICENSES/runtime-lib"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

if [ -z "$rootfs" ]; then
  suite=jammy-updates
  curl -fsSL "$mirror/dists/$suite/InRelease" -o "$work/InRelease"
  if [ -f /usr/share/keyrings/ubuntu-archive-keyring.gpg ] && command -v gpgv >/dev/null; then
    gpgv --keyring /usr/share/keyrings/ubuntu-archive-keyring.gpg "$work/InRelease" 2>/dev/null \
      || die "InRelease signature check failed"
    log "Ubuntu InRelease signature verified"
  else
    log "warning: no Ubuntu archive keyring here; relying on HTTPS only"
  fi
  curl -fsSL "$mirror/dists/$suite/main/binary-$debarch/Packages.gz" -o "$work/Packages.gz"
  python3 - "$work" "$debarch" "$mirror" <<'PY'
import gzip, hashlib, os, re, sys
work, debarch, mirror = sys.argv[1:4]
rel = open(os.path.join(work, "InRelease"), encoding="utf-8", errors="replace").read()
want = f"main/binary-{debarch}/Packages.gz"
m = re.search(r"^SHA256:\n((?: .*\n)+)", rel, re.M)
sums = {l.split()[2]: l.split()[0] for l in m.group(1).splitlines() if len(l.split()) == 3}
data = open(os.path.join(work, "Packages.gz"), "rb").read()
if hashlib.sha256(data).hexdigest() != sums.get(want):
    sys.exit("Packages.gz does not match InRelease")
pkgs = {}
for stanza in gzip.decompress(data).decode("utf-8", "replace").split("\n\n"):
    f = dict(re.findall(r"^([A-Za-z0-9-]+): (.*)$", stanza, re.M))
    if f.get("Package") in ("libc6", "libstdc++6", "libgcc-s1") and f.get("Architecture") == debarch:
        pkgs[f["Package"]] = f  # last stanza wins: the newest in the index
with open(os.path.join(work, "wanted"), "w") as out:
    for name in ("libc6", "libstdc++6", "libgcc-s1"):
        f = pkgs[name]
        out.write(f"{name} {f['SHA256']} {mirror}/{f['Filename']}\n")
        print(f"{name} {f['Version']}", file=sys.stderr)
PY
  while read -r name sum url; do
    curl -fsSL "$url" -o "$work/$name.deb"
    echo "$sum  $work/$name.deb" | sha256sum -c --quiet - || die "$name: checksum mismatch"
  done < "$work/wanted"
  rootfs="$work/root"
  for d in libc6 libstdc++6 libgcc-s1; do dpkg-deb -x "$work/$d.deb" "$rootfs"; done
fi

for lib in $LIBS; do
  found=""
  for dir in "lib/$triple" "usr/lib/$triple" lib64 lib usr/lib64 usr/lib; do
    if [ -e "$rootfs/$dir/$lib" ]; then found="$rootfs/$dir/$lib"; break; fi
  done
  [ -n "$found" ] || die "$lib not found in $rootfs"
  # Resolve symlinks inside the rootfs, not on this machine.
  while [ -L "$found" ]; do
    t="$(readlink "$found")"
    case "$t" in /*) found="$rootfs$t" ;; *) found="$(dirname "$found")/$t" ;; esac
  done
  cp -f "$found" "$dest/$lib"
  chmod 0755 "$dest/$lib"
done
for c in libc6 libstdc++6 libgcc-s1; do
  [ -f "$rootfs/usr/share/doc/$c/copyright" ] && cp "$rootfs/usr/share/doc/$c/copyright" "$bundle/LICENSES/runtime-lib/$c.copyright"
done
cat > "$bundle/LICENSES/runtime-lib/README" <<'TXT'
glibc: LGPL-2.1+ (libc6.copyright). libstdc++ and libgcc_s: GPL-3.0 with the GCC Runtime Library Exception 3.1
(Ubuntu package gcc-12-base, https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html).
TXT
cat > "$dest/README" <<TXT
Private C runtime for old NAS systems (QNAP QTS 5 has glibc 2.21). Source: ${rootfs#$work/}.
Used only by binaries whose ELF interpreter and RPATH point here (packaging/qnap/patch-private-glibc.sh), or
explicitly: $loader --library-path <this folder> <program>. Never put this folder in LD_LIBRARY_PATH.
TXT
log "runtime/lib filled for $arch: $(ls "$dest" | tr '\n' ' ')"
