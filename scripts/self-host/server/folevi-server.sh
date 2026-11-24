#!/bin/sh
# Folevi Server's launcher (bin/folevi-server in the server bundle). It checks how this system can run the
# bundle's Linux programs, then starts the supervisor:
#   system  as they are (DSM 7.2 and newer should be here)
#   cxx     with the bundle's own C++ runtime (libstdc++ from Ubuntu 22.04) when the system's is older
#   glibc   through the bundle's own C library and loader (Ubuntu 22.04's glibc 2.35) when the system's is older
# Needs FOLEVI_DATA (the data folder). Optional: FOLEVI_VAR, FOLEVI_PORT, FOLEVI_RUNTIME (skip the check).
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
export FOLEVI_HOME="$HERE"
: "${FOLEVI_DATA:?set FOLEVI_DATA to the data folder}"
mkdir -p "$FOLEVI_DATA/logs"
LOG="$FOLEVI_DATA/logs/launcher.log"
NODE="$HERE/node/bin/node"
BACKEND="$HERE/bin/convex-local-backend"
export FOLEVI_NODE="$NODE" FOLEVI_BACKEND_BIN="$BACKEND"

LOADER=""
for l in "$HERE/lib/glibc/ld-linux-x86-64.so.2" "$HERE/lib/glibc/ld-linux-aarch64.so.1"; do
  [ -e "$l" ] && LOADER="$l"
done
export FOLEVI_LOADER="$LOADER"

say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }

# Whether both programs start in a mode. Errors go to the launcher log for the diagnostics page.
works() {
  mode=$1
  case "$mode" in
    system) n=$("$NODE" -e 'process.stdout.write("ok")' 2>>"$LOG"); b=$("$BACKEND" --help 2>>"$LOG" | head -c 2) ;;
    cxx) n=$(LD_LIBRARY_PATH="$HERE/lib/cxx" "$NODE" -e 'process.stdout.write("ok")' 2>>"$LOG"); b=$(LD_LIBRARY_PATH="$HERE/lib/cxx" "$BACKEND" --help 2>>"$LOG" | head -c 2) ;;
    glibc)
      [ -n "$LOADER" ] || return 1
      n=$("$LOADER" --library-path "$HERE/lib/glibc" "$NODE" -e 'process.stdout.write("ok")' 2>>"$LOG")
      b=$("$LOADER" --library-path "$HERE/lib/glibc" "$BACKEND" --help 2>>"$LOG" | head -c 2) ;;
  esac
  [ "$n" = "ok" ] && [ -n "$b" ]
}

say "Folevi Server launcher: $(uname -srm), $(ldd --version 2>&1 | head -n 1)"
MODE="${FOLEVI_RUNTIME:-}"
if [ -z "$MODE" ]; then
  for m in system cxx glibc; do
    if works "$m"; then MODE=$m; break; fi
    say "runtime $m doesn't work here"
  done
fi
if [ -z "$MODE" ]; then
  say "no runtime works on this system; Folevi Server can't start (see the errors above)"
  exit 1
fi
say "using runtime $MODE"
export FOLEVI_RUNTIME="$MODE"

SUP="$HERE/supervisor/supervisor.mjs"
case "$MODE" in
  system) exec "$NODE" "$SUP" ;;
  cxx) LD_LIBRARY_PATH="$HERE/lib/cxx" exec "$NODE" "$SUP" ;;
  glibc) exec "$LOADER" --library-path "$HERE/lib/glibc" "$NODE" "$SUP" ;;
esac
