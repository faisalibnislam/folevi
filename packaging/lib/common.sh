#!/usr/bin/env bash
# Shared helpers for every packaging/<platform>/build.sh.
# Source it; do not run it. Every build script takes the same three inputs:
#   --bundle <dir>   a bundle made by server/bundle/build-bundle.sh (CONTRACT.md section 10)
#   --version <ver>  the unified Folevi version, for example 1.5.73
#   --arch <arch>    x86_64 or aarch64 (amd64 and arm64 are accepted too)
#   --out <dir>      where the finished package goes

set -euo pipefail

PACKAGING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PACKAGING_DIR

FOLEVI_NAME="Folevi Server"
FOLEVI_MAINTAINER="Folevi"
FOLEVI_EMAIL="support@folevi.com"
FOLEVI_WEBSITE="https://folevi.com"
FOLEVI_PORT_DEFAULT=8460
FOLEVI_HTTPS_PORT_DEFAULT=8443
# The container image every catalog entry points at. The owner picks the real registry before release.
FOLEVI_IMAGE="${FOLEVI_IMAGE:-ghcr.io/folevi/folevi-server}"
FOLEVI_DESCRIPTION="Your own Folevi server: notes, tasks and files for your family or team, on your own hardware."

log() { printf '[%s] %s\n' "${LOG_PREFIX:-packaging}" "$*" >&2; }
die() { log "error: $*"; exit 1; }

# Parse the common flags into BUNDLE, VERSION, ARCH, OUT. Extra flags are left in EXTRA_ARGS.
parse_common_args() {
  BUNDLE="" VERSION="" ARCH="" OUT="" EXTRA_ARGS=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --bundle) BUNDLE="$2"; shift 2 ;;
      --version) VERSION="$2"; shift 2 ;;
      --arch) ARCH="$2"; shift 2 ;;
      --out) OUT="$2"; shift 2 ;;
      -h|--help) usage_common; exit 0 ;;
      *) EXTRA_ARGS+=("$1"); shift ;;
    esac
  done
  [ -n "$BUNDLE" ] || die "--bundle is required"
  [ -n "$VERSION" ] || die "--version is required"
  [ -n "$ARCH" ] || die "--arch is required"
  [ -n "$OUT" ] || die "--out is required"
  ARCH="$(normalize_arch "$ARCH")"
  BUNDLE="$(cd "$BUNDLE" && pwd)"
  mkdir -p "$OUT"
  OUT="$(cd "$OUT" && pwd)"
  validate_version "$VERSION"
  validate_bundle "$BUNDLE"
}

usage_common() {
  echo "usage: $0 --bundle <dir> --version <x.y.zz> --arch <x86_64|aarch64> --out <dir>"
}

normalize_arch() {
  case "$1" in
    x86_64|amd64|x64) echo x86_64 ;;
    aarch64|arm64|armv8) echo aarch64 ;;
    *) die "unsupported arch '$1' (Folevi Server is 64-bit only: x86_64 or aarch64)" ;;
  esac
}

# Debian-style names (deb, docker, nfpm).
deb_arch() { case "$1" in x86_64) echo amd64 ;; aarch64) echo arm64 ;; esac; }

validate_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.~+-][0-9A-Za-z.]+)?$ ]] || die "version '$1' is not like 1.5.73"
}

# The bundle layout from CONTRACT.md section 10. runtime/lib is optional.
validate_bundle() {
  local b="$1" f
  for f in VERSION manifest.json bin/folevid bin/convex-backend runtime/node/bin/node web/server.js; do
    [ -e "$b/$f" ] || die "bundle $b is missing $f (see docs/self-hosting/CONTRACT.md section 10)"
  done
  for f in LICENSES functions; do
    [ -d "$b/$f" ] || die "bundle $b is missing the $f/ folder"
  done
  [ -x "$b/bin/folevid" ] || die "bundle $b: bin/folevid is not executable"
}

# Copy a bundle into a staging folder, keeping modes and symlinks.
copy_bundle() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  (cd "$src" && tar -cf - .) | (cd "$dst" && tar -xpf -)
}

# Deterministic-ish tar: sorted, numeric owner 0, fixed mtime from SOURCE_DATE_EPOCH when set.
det_tar() {
  local out="$1" dir="$2"; shift 2
  local mtime_args=()
  if [ -n "${SOURCE_DATE_EPOCH:-}" ]; then mtime_args=(--mtime="@${SOURCE_DATE_EPOCH}"); fi
  tar --sort=name --owner=0 --group=0 --numeric-owner "${mtime_args[@]}" -C "$dir" "$@" -cf "$out" .
}

# Fill @KEY@ placeholders from the environment, for templates.
render() {
  local src="$1" dst="$2"
  python3 - "$src" "$dst" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
def sub(m):
    key = m.group(1)
    if key not in os.environ:
        sys.exit(f"render: {src}: no value for @{key}@")
    return os.environ[key]
text = re.sub(r"@([A-Z][A-Z0-9_]*)@", sub, text)
open(dst, "w", encoding="utf-8").write(text)
PY
}

export_template_vars() {
  export VERSION ARCH FOLEVI_NAME FOLEVI_MAINTAINER FOLEVI_EMAIL FOLEVI_WEBSITE FOLEVI_IMAGE \
    FOLEVI_PORT_DEFAULT FOLEVI_HTTPS_PORT_DEFAULT FOLEVI_DESCRIPTION
}

icon() { echo "$PACKAGING_DIR/icons/folevi-$1.png"; }

# Copy <src> to <dst>, replacing the line "# @@PRE_UPDATE_BACKUP_HELPER@@" with a shell variable that holds
# lib/pre-update-backup.sh, so a root script can run it as the service user: printf ... | su ... sh -s
embed_backup_helper() {
  python3 - "$1" "$2" "$PACKAGING_DIR/lib/pre-update-backup.sh" <<'PY'
import sys
src, dst, helper = sys.argv[1:4]
text = open(src).read()
marker = "# @@PRE_UPDATE_BACKUP_HELPER@@"
if marker not in text:
    sys.exit(f"{src}: no {marker} line")
block = "FOLEVI_BACKUP_HELPER=$(cat <<'FOLEVI_HELPER'\n" + open(helper).read() + "FOLEVI_HELPER\n)"
open(dst, "w").write(text.replace(marker, block))
PY
  chmod --reference="$1" "$2"
}
