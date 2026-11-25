#!/usr/bin/env bash
# Make a FAKE Folevi Server bundle with the layout from CONTRACT.md section 10, for packaging tests only.
# Every program is a tiny placeholder. Nothing here is the real server.
#   make-fake-bundle.sh <out-dir> <version> <x86_64|aarch64> [--native]
# --native compiles bin/convex-backend and runtime/node/bin/node as small dynamically linked C programs (needs a C
# compiler for that arch) so the private-glibc test has real ELF files to run through runtime/lib's loader.
set -euo pipefail
out="$1" version="$2" arch="$3" native="${4:-}"
name="folevi-server-${version}-linux-${arch}"
b="$out/$name"
rm -rf "$b"
mkdir -p "$b"/{bin,runtime/node/bin,runtime/lib,web/.next/static,web/public,functions/convex,LICENSES}

echo "$version" > "$b/VERSION"
cat > "$b/manifest.json" <<JSON
{"name":"folevi-server","version":"$version","arch":"$arch","fake":true,
 "components":{"convexBackend":"fake","node":"fake"}}
JSON
echo "Fake license placeholder" > "$b/LICENSES/README.txt"
echo "// fake Next.js standalone server" > "$b/web/server.js"
echo "fake" > "$b/web/public/robots.txt"
echo "// fake bundled functions" > "$b/functions/convex/index.js"

cat > "$b/bin/folevid" <<'SH'
#!/bin/sh
# FAKE folevid for packaging tests. Accepts the commands from CONTRACT.md section 10.
cmd="${1:-}"; shift 2>/dev/null || true
data="" bundle=""
while [ $# -gt 0 ]; do
  case "$1" in --data) data="$2"; shift 2 ;; --bundle) bundle="$2"; shift 2 ;; *) shift ;; esac
done
case "$cmd" in
  version) echo "folevid fake $(cat "$(dirname "$0")/../VERSION")" ;;
  setup-url) echo "http://127.0.0.1:${FOLEVI_PORT:-8460}/setup?token=FAKE" ;;
  run) [ -n "$data" ] || { echo "folevid: --data is required" >&2; exit 2; }
       mkdir -p "$data/logs"; echo "fake run" >> "$data/logs/folevid.log"; : > "$data/.fake-running"
       trap 'rm -f "$data/.fake-running"; exit 0' TERM INT; while :; do sleep 1; done ;;
  backup) [ -n "$data" ] || exit 2; mkdir -p "$data/backups"; : > "$data/backups/fake.zip"; echo fake ;;
  restore) exit 0 ;;
  healthcheck) [ -n "$data" ] && [ -f "$data/.fake-running" ] ;;
  *) echo "usage: folevid run|version|setup-url|backup|restore|healthcheck" >&2; exit 2 ;;
esac
SH
chmod 755 "$b/bin/folevid"

if [ "$native" = "--native" ]; then
  cc="${CC:-cc}"
  tmp="$(mktemp -d)"
  cat > "$tmp/node.c" <<'C'
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <pthread.h>
static void *t(void *a) { return a; }
int main(int c, char **v) {
  pthread_t th; pthread_create(&th, 0, t, 0); pthread_join(th, 0);
  if (c > 1 && !strcmp(v[1], "--version")) { printf("v0.0.0-fake (sqrt2=%.3f)\n", sqrt(2.0)); return 0; }
  printf("fake node\n"); return 0;
}
C
  cat > "$tmp/backend.cc" <<'C'
#include <iostream>
#include <string>
int main(int c, char **v) {
  std::string a = c > 1 ? v[1] : "";
  if (a == "--help") { std::cout << "convex-local-backend (fake) Usage: convex-local-backend [OPTIONS]" << std::endl; return 0; }
  std::cout << "fake backend" << std::endl; return 0;
}
C
  "$cc" -O1 -o "$b/runtime/node/bin/node" "$tmp/node.c" -lm -lpthread
  "${CXX:-c++}" -O1 -o "$b/bin/convex-backend" "$tmp/backend.cc"
  rm -rf "$tmp"
else
  printf '#!/bin/sh\n[ "$1" = --version ] && echo v0.0.0-fake && exit 0\necho fake node\n' > "$b/runtime/node/bin/node"
  printf '#!/bin/sh\n[ "$1" = --help ] && echo "convex-local-backend (fake) Usage" && exit 0\necho fake backend\n' > "$b/bin/convex-backend"
fi
chmod 755 "$b/runtime/node/bin/node" "$b/bin/convex-backend"
rmdir "$b/runtime/lib" 2>/dev/null || true
echo "$b"
