#!/usr/bin/env bash
# Point node and convex-backend at the private glibc in runtime/lib (QNAP only; other platforms use the system's).
#   patch-private-glibc.sh --bundle <staged copy of the bundle>
# Sets each binary's ELF interpreter to /usr/local/lib/folevi-rt/ld.so (the QNAP service script links that to
# runtime/lib/ld-linux-*.so.* on every start, since QTS rebuilds / at boot) and its RPATH (DT_RPATH, which beats
# LD_LIBRARY_PATH and the system cache) to $ORIGIN-relative runtime/lib. Unlike running "ld.so --library-path
# node", this keeps process.execPath pointing at node, so node can start child node processes, and every program
# they start through /bin/sh keeps using the NAS's own libraries. Needs patchelf (apt install patchelf).
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"
LOG_PREFIX=patch-glibc
bundle=""
INTERP="${FOLEVI_RT_INTERP:-/usr/local/lib/folevi-rt/ld.so}"
while [ $# -gt 0 ]; do case "$1" in --bundle) bundle="$2"; shift 2 ;; *) die "unknown flag $1" ;; esac; done
[ -d "$bundle/runtime/lib" ] || die "$bundle/runtime/lib is missing; run populate-runtime-lib.sh first"
command -v patchelf >/dev/null || die "patchelf not found (apt install patchelf)"
patch_one() {
  local f="$1" rpath="$2"
  if ! head -c 4 "$f" | grep -q 'ELF'; then log "skip $f (not ELF: a fake bundle?)"; return 0; fi
  if ! patchelf --print-interpreter "$f" >/dev/null 2>&1; then log "skip $f (static, no interpreter)"; return 0; fi
  patchelf --set-interpreter "$INTERP" --force-rpath --set-rpath "$rpath" "$f"
  log "patched $f -> interpreter $INTERP, rpath $rpath"
}
patch_one "$bundle/runtime/node/bin/node" '$ORIGIN/../../lib'
patch_one "$bundle/bin/convex-backend" '$ORIGIN/../runtime/lib'
