#!/usr/bin/env bash
# Writes a minimal FUNCTIONS_DIR for build-bundle.sh: what `convex deploy` needs to bundle and push convex/,
# and nothing else (no next, typescript, playwright or other web/dev packages).
#
#   server/bundle/prepare-functions.sh [--arch x86_64|aarch64] [--out DIR]
#
#   OUT/
#     convex/            the repo's convex/ including convex/_generated (committed; the deploy runs --codegen=disable)
#     convex.json  package.json
#     packages/...       files convex/ imports by relative path (design-tokens covers JSON), at the same place
#     node_modules/      convex (the CLI), esbuild + @esbuild/linux-<arch>, prettier, ws, and every package the
#                        functions bundle reads (better-auth and its deps, @better-auth/*, @convex-dev/better-auth,
#                        @folevi/* workspace sources, fflate, web-push, ts-fsrs, ...)
#
# Needs a `pnpm install`ed checkout and node. The package list comes from running esbuild the way the Convex
# CLI does (see prepare-functions.mjs). When --arch is not this machine's, the target's @esbuild/linux-<arch>
# binary is fetched from the npm registry (npm pack, version pinned to the installed esbuild).
# Defaults: --arch this machine, --out ./dist/functions.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ARCH="$(uname -m)"
OUT="$PWD/dist/functions"
while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --arch=*) ARCH="${1#*=}"; shift ;;
    --out=*) OUT="${1#*=}"; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "prepare-functions: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$ARCH" in
  x86_64|amd64|x64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) echo "prepare-functions: --arch must be x86_64 or aarch64" >&2; exit 2 ;;
esac
[ -f "$REPO/node_modules/convex/package.json" ] || { echo "prepare-functions: run pnpm install first" >&2; exit 1; }
[ -f "$REPO/convex/_generated/api.js" ] || { echo "prepare-functions: convex/_generated is missing" >&2; exit 1; }

node "$HERE/prepare-functions.mjs" "$REPO" "$OUT"

# esbuild's native binary for the target chip.
NM="$OUT/node_modules"
if [ ! -d "$NM/@esbuild/linux-$NODE_ARCH" ]; then
  ver="$(node -p 'require(process.argv[1]).version' "$NM/esbuild/package.json")"
  echo "prepare-functions: fetching @esbuild/linux-$NODE_ARCH@$ver" >&2
  tmp="$(mktemp -d)"
  (cd "$tmp" && npm pack --silent "@esbuild/linux-$NODE_ARCH@$ver" > /dev/null)
  mkdir -p "$NM/@esbuild/linux-$NODE_ARCH"
  tar -xzf "$tmp"/*.tgz -C "$NM/@esbuild/linux-$NODE_ARCH" --strip-components=1
  rm -rf "$tmp"
fi
# Only the target's esbuild binary.
for d in "$NM"/@esbuild/*; do
  [ "$(basename "$d")" = "linux-$NODE_ARCH" ] || rm -rf "$d"
done
# esbuild's postinstall may have copied the host binary over bin/esbuild; the JS shim finds the platform
# package by itself, so drop a native copy that does not match the target.
if [ -f "$NM/esbuild/bin/esbuild" ] && ! head -c 2 "$NM/esbuild/bin/esbuild" | grep -q '#!'; then
  rm -f "$NM/esbuild/bin/esbuild"
fi
echo "prepare-functions: wrote $OUT ($(du -sh "$OUT" | cut -f1))" >&2
