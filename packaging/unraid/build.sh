#!/usr/bin/env bash
# Build the Unraid native plugin: folevi.plg, the plugin package (Slackware .txz with the settings page and
# control script) and the bundle tarball the plugin downloads. Unraid is x86_64 only.
#   build.sh --bundle <dir> --version <ver> --arch x86_64 --out <dir> [--base-url https://pkg.folevi.com/unraid]
# Upload all three files to --base-url. The Community Apps container template is ca/folevi.xml (not built).
LOG_PREFIX=unraid
source "$(dirname "$0")/../lib/common.sh"
parse_common_args "$@"
set -- "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
UNRAID_BASE_URL="https://pkg.folevi.com/unraid"
while [ $# -gt 0 ]; do case "$1" in --base-url) UNRAID_BASE_URL="${2%/}"; shift 2 ;; *) die "unknown flag $1" ;; esac; done
[ "$ARCH" = x86_64 ] || { log "Unraid is x86_64 only: nothing to build for $ARCH"; exit 0; }
HERE="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# 1. Plugin package (.txz, Slackware layout).
copy_bundle "$HERE/src" "$work/txz"
cp "$PACKAGING_DIR/lib/pre-update-backup.sh" "$work/txz/usr/local/emhttp/plugins/folevi/scripts/pre-update-backup.sh"
(cd "$work/txz" && tar --sort=name --owner=0 --group=0 --numeric-owner -cJf "$OUT/folevi-plugin-${VERSION}-x86_64-1.txz" .)
# 2. Bundle tarball, one top-level folder.
top="folevi-server-${VERSION}-linux-x86_64"
mkdir -p "$work/b"; copy_bundle "$BUNDLE" "$work/b/$top"
(cd "$work/b" && tar --sort=name --owner=0 --group=0 --numeric-owner -cJf "$OUT/folevi-server-${VERSION}-x86_64.tar.xz" "$top")
# 3. The .plg with checksums.
export_template_vars
export UNRAID_BASE_URL
export UI_MD5="$(md5sum "$OUT/folevi-plugin-${VERSION}-x86_64-1.txz" | cut -d' ' -f1)"
export BUNDLE_MD5="$(md5sum "$OUT/folevi-server-${VERSION}-x86_64.tar.xz" | cut -d' ' -f1)"
render "$HERE/folevi.plg.in" "$OUT/folevi.plg"
xmllint --noout "$OUT/folevi.plg" 2>/dev/null || die "folevi.plg is not well-formed XML"
log "built $OUT/folevi.plg, the plugin .txz and the bundle tarball"
