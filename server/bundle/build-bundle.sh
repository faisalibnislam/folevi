#!/usr/bin/env bash
# Assembles the Folevi Server bundle (docs/self-hosting/CONTRACT.md §10):
#
#   folevi-server-<version>-linux-<x86_64|aarch64>/
#     VERSION  manifest.json  LICENSES/
#     bin/folevid  bin/convex-backend
#     runtime/node/bin/node  runtime/lib/ (optional)
#     web/  functions/
#
# Inputs (environment variables). Nothing is downloaded unless an input is an https:// URL.
#   VERSION          required, for example 1.7.0
#   ARCH             required, x86_64 or aarch64
#   CONVEX_BACKEND   convex-local-backend-<arch>-unknown-linux-gnu.zip, the unzipped program, or a URL to the zip
#   NODE_DIST        node-v<ver>-linux-<x64|arm64>.tar.xz/.tar.gz, an unpacked Node folder, or a URL
#   WEB_STANDALONE   the Next.js standalone output (apps/web/.next/standalone) of the server-edition build
#   WEB_STATIC       optional, apps/web/.next/static (copied next to server.js as .next/static)
#   WEB_PUBLIC       optional, apps/web/public
#   FUNCTIONS_DIR    a folder with convex/ (including convex/_generated), package.json, convex.json and the
#                    node_modules the Convex CLI needs to bundle it (symlinks are followed)
#   FOLEVID          optional, a prebuilt linux folevid for ARCH (default: built here with go)
#   RUNTIME_LIB      optional, a folder with a private glibc and libstdc++ and its ld-linux-* loader
#   EXTRA_LICENSES   optional, a folder of license files to add to LICENSES/
#   OUT              output folder (default: ./dist)
#   TARBALL=1        also write <bundle>.tar.gz and its .sha256
#   *_SHA256         optional expected SHA-256 for CONVEX_BACKEND and NODE_DIST
#
# Arguments (override the variables of the same name): --version V --arch A --out DIR. The bundle is written
# to DIR/folevi-server-V-linux-A/.
set -euo pipefail

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; shift ;;
    --arch=*) ARCH="${1#*=}"; shift ;;
    --out=*) OUT="${1#*=}"; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "build-bundle: unknown argument $1" >&2; exit 2 ;;
  esac
done

die() { echo "build-bundle: $*" >&2; exit 1; }
: "${VERSION:?set VERSION}"
: "${ARCH:?set ARCH (x86_64 or aarch64)}"
: "${CONVEX_BACKEND:?set CONVEX_BACKEND}"
: "${NODE_DIST:?set NODE_DIST}"
: "${WEB_STANDALONE:?set WEB_STANDALONE}"
: "${FUNCTIONS_DIR:?set FUNCTIONS_DIR}"
case "$ARCH" in
  x86_64|amd64|x64) ARCH=x86_64; GOARCH=amd64; NODE_ARCH=x64 ;;
  aarch64|arm64) ARCH=aarch64; GOARCH=arm64; NODE_ARCH=arm64 ;;
  *) die "ARCH must be x86_64 or aarch64" ;;
esac
case "$VERSION" in *[!A-Za-z0-9.+-]*) die "VERSION has odd characters" ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-$PWD/dist}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
NAME="folevi-server-$VERSION-linux-$ARCH"
DEST="$OUT/$NAME"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sha256() { if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

# fetch <value> <expected sha or empty>: prints a local path. Downloads only https:// URLs.
fetch() {
  local src="$1" want="$2" dst
  case "$src" in
    https://*)
      dst="$WORK/dl-$(basename "${src%%\?*}")"
      echo "downloading $src" >&2
      curl -fsSL --retry 3 -o "$dst" "$src"
      ;;
    http://*) die "refusing plain http download: $src" ;;
    *) [ -e "$src" ] || die "not found: $src"; dst="$src" ;;
  esac
  if [ -n "$want" ] && [ -f "$dst" ]; then
    [ "$(sha256 "$dst")" = "$want" ] || die "SHA-256 mismatch for $src"
  fi
  printf '%s\n' "$dst"
}

echo "assembling $NAME in $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/runtime" "$DEST/web" "$DEST/functions" "$DEST/LICENSES"
printf '%s\n' "$VERSION" > "$DEST/VERSION"

# 1. folevid, static, for the target chip.
if [ -n "${FOLEVID:-}" ]; then
  [ -f "$FOLEVID" ] || die "FOLEVID not found: $FOLEVID"
  cp "$FOLEVID" "$DEST/bin/folevid"; chmod 755 "$DEST/bin/folevid"
else
  echo "building folevid for linux/$GOARCH"
  (cd "$REPO/server/folevid" && CGO_ENABLED=0 GOOS=linux GOARCH="$GOARCH" GOTOOLCHAIN="${GOTOOLCHAIN:-local}" \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$DEST/bin/folevid" .)
fi

# 2. The Convex backend.
backend="$(fetch "$CONVEX_BACKEND" "${CONVEX_BACKEND_SHA256:-}")"
if [ -d "$backend" ]; then die "CONVEX_BACKEND must be a zip or the program, not a folder"; fi
if unzip -tq "$backend" > /dev/null 2>&1; then
  unzip -q -o "$backend" -d "$WORK/backend"
  prog="$(find "$WORK/backend" -type f -name 'convex-local-backend*' ! -name '*.md' | head -1)"
  [ -n "$prog" ] || die "no convex-local-backend in $backend"
  cp "$prog" "$DEST/bin/convex-backend"
  lic="$(find "$WORK/backend" -type f -iname 'LICENSE*' | head -1)"
  [ -n "$lic" ] && cp "$lic" "$DEST/LICENSES/convex-backend-LICENSE.md"
else
  cp "$backend" "$DEST/bin/convex-backend"
fi
chmod 755 "$DEST/bin/convex-backend"

# 3. Node.js.
node_src="$(fetch "$NODE_DIST" "${NODE_DIST_SHA256:-}")"
if [ -d "$node_src" ]; then
  node_root="$node_src"
else
  mkdir -p "$WORK/node"
  tar -xf "$node_src" -C "$WORK/node"
  node_root="$(find "$WORK/node" -mindepth 1 -maxdepth 1 -type d | head -1)"
fi
[ -x "$node_root/bin/node" ] || die "no bin/node in $NODE_DIST"
mkdir -p "$DEST/runtime/node/bin"
cp "$node_root/bin/node" "$DEST/runtime/node/bin/node"
chmod 755 "$DEST/runtime/node/bin/node"
[ -f "$node_root/LICENSE" ] && cp "$node_root/LICENSE" "$DEST/LICENSES/node-LICENSE"

# 4. Optional private glibc and loader.
if [ -n "${RUNTIME_LIB:-}" ]; then
  [ -d "$RUNTIME_LIB" ] || die "RUNTIME_LIB is not a folder"
  ls "$RUNTIME_LIB"/ld-linux-* > /dev/null 2>&1 || die "RUNTIME_LIB has no ld-linux-* loader"
  cp -a "$RUNTIME_LIB" "$DEST/runtime/lib"
fi

# 5. The web app (Next.js standalone). In a monorepo, server.js sits under apps/web; a small entry point at
#    web/server.js starts it, so folevid always runs `node web/server.js`.
[ -d "$WEB_STANDALONE" ] || die "WEB_STANDALONE is not a folder"
cp -a "$WEB_STANDALONE/." "$DEST/web/"
if [ -f "$DEST/web/server.js" ]; then
  app_dir="$DEST/web"
else
  inner="$(cd "$DEST/web" && find . -maxdepth 4 -name server.js -not -path '*/node_modules/*' | head -1)"
  [ -n "$inner" ] || die "no server.js in WEB_STANDALONE"
  inner="${inner#./}"
  app_dir="$DEST/web/$(dirname "$inner")"
  cat > "$DEST/web/server.js" <<EOF
// Entry point written by build-bundle.sh: the standalone server lives in $(dirname "$inner").
process.chdir(require("path").join(__dirname, "$(dirname "$inner")"));
require("./$inner");
EOF
fi
if [ -n "${WEB_STATIC:-}" ]; then mkdir -p "$app_dir/.next"; cp -a "$WEB_STATIC" "$app_dir/.next/static"; fi
if [ -n "${WEB_PUBLIC:-}" ]; then cp -a "$WEB_PUBLIC" "$app_dir/public"; fi
rm -rf "$app_dir/.next/cache"
find "$DEST/web" -maxdepth 3 -name '.env*' -type f -delete

# 6. Functions: what `convex deploy` needs, symlinks followed, no local env files.
[ -d "$FUNCTIONS_DIR/convex" ] || die "FUNCTIONS_DIR has no convex/ folder"
[ -f "$FUNCTIONS_DIR/node_modules/convex/bin/main.js" ] || die "FUNCTIONS_DIR has no node_modules/convex"
[ -d "$FUNCTIONS_DIR/convex/_generated" ] || die "FUNCTIONS_DIR/convex/_generated is missing (run codegen first; the deploy runs with --codegen=disable)"
for f in convex packages package.json convex.json tsconfig.json node_modules; do
  [ -e "$FUNCTIONS_DIR/$f" ] && cp -RL "$FUNCTIONS_DIR/$f" "$DEST/functions/"
done
find "$DEST/functions" -maxdepth 1 -name '.env*' -delete
# esbuild ships per-platform binaries; warn when the target's is missing.
if [ -d "$DEST/functions/node_modules/@esbuild" ] && [ ! -d "$DEST/functions/node_modules/@esbuild/linux-$NODE_ARCH" ]; then
  echo "warning: functions/node_modules/@esbuild/linux-$NODE_ARCH is missing; the deploy will fail on $ARCH" >&2
fi

# 7. Licenses.
[ -f "$REPO/LICENSE" ] && cp "$REPO/LICENSE" "$DEST/LICENSES/folevi-LICENSE"
if [ -n "${EXTRA_LICENSES:-}" ]; then cp -a "$EXTRA_LICENSES/." "$DEST/LICENSES/"; fi
cat > "$DEST/LICENSES/README.txt" <<'EOF'
Folevi Server bundles third-party software under its own licenses:
- Convex backend (convex-backend): FSL-1.1-Apache-2.0, see convex-backend-LICENSE.md
- Node.js: MIT and others, see node-LICENSE
- The web app's and functions' npm dependencies: see the license files inside web/ and functions/node_modules
- folevid's Go dependencies: hashicorp/mdns and yamux (MPL-2.0), go-acme/lego (MIT), huin/goupnp (BSD-2),
  jackpal/go-nat-pmp and gateway (Apache-2.0, BSD-3), coder/websocket (ISC), minio-go (Apache-2.0)
EOF

# 8. Check the chips match (when `file` is available).
if command -v file > /dev/null; then
  want="x86-64"; [ "$ARCH" = aarch64 ] && want="aarch64"
  for b in bin/folevid bin/convex-backend runtime/node/bin/node; do
    file -L "$DEST/$b" | grep -q "$want" || echo "warning: $b does not look like $want: $(file -L "$DEST/$b" | cut -d: -f2)" >&2
  done
fi

# 9. manifest.json with SHA-256s.
functions_hash="$(cd "$DEST/functions/convex" && find . -type f -not -path './_generated/*' | LC_ALL=C sort | \
  while IFS= read -r f; do printf '%s %s\n' "${f#./}" "$(sha256 "$f")"; done | sha256sum | cut -d' ' -f1)"
{
  printf '{\n  "name": "folevi-server",\n  "version": "%s",\n  "arch": "%s",\n' "$VERSION" "$ARCH"
  printf '  "createdAt": "%s",\n  "functionsHash": "%s",\n  "files": {\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$functions_hash"
  first=1
  for f in bin/folevid bin/convex-backend runtime/node/bin/node web/server.js; do
    [ -f "$DEST/$f" ] || continue
    [ $first = 1 ] || printf ',\n'
    printf '    "%s": "%s"' "$f" "$(sha256 "$DEST/$f")"
    first=0
  done
  printf '\n  }\n}\n'
} > "$DEST/manifest.json"

if [ "${TARBALL:-}" = 1 ]; then
  tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" "$NAME"
  (cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
  echo "wrote $OUT/$NAME.tar.gz"
fi
echo "done: $DEST ($(du -sh "$DEST" | cut -f1))"
