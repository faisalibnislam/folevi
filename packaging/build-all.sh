#!/usr/bin/env bash
# Build every package format from one bundle.
#   build-all.sh --bundle <dir> --version <ver> --arch <x86_64|aarch64> --out <dir> [--only a,b,c] [--keep-going]
# Formats: synology qnap asustor terramaster ugreen unraid linux docker. Each lands in <out>/<format>/.
# Unraid is x86_64 only. Docker here only prepares the build context (CI runs buildx).
LOG_PREFIX=build-all
source "$(dirname "$0")/lib/common.sh"
parse_common_args "$@"
set -- "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
only="synology,qnap,asustor,terramaster,ugreen,unraid,linux,docker" keep=0
while [ $# -gt 0 ]; do
  case "$1" in --only) only="$2"; shift 2 ;; --keep-going) keep=1; shift ;; *) die "unknown flag $1" ;; esac
done
failed=()
IFS=, read -ra list <<< "$only"
for fmt in "${list[@]}"; do
  log "== $fmt ($ARCH)"
  if ! "$PACKAGING_DIR/$fmt/build.sh" --bundle "$BUNDLE" --version "$VERSION" --arch "$ARCH" --out "$OUT/$fmt"; then
    failed+=("$fmt")
    [ "$keep" = 1 ] || die "$fmt failed"
  fi
done
[ ${#failed[@]} -eq 0 ] || die "failed: ${failed[*]}"
log "all done: $OUT"
