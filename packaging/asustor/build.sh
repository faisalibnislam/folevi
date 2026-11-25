#!/usr/bin/env bash
# Build the ASUSTOR ADM 4.x/5.x App Central package (.apk, ASUSTOR's own "apkg" format, not Android's).
#   build.sh --bundle <dir> --version <ver> --arch <x86_64|aarch64> --out <dir>
# Format (from ASUSTOR's developer guide and apkg-tools.py): a zip holding
#   apkg-version      the text "2.0"
#   control.tar.gz    CONTROL/: config.json, icon.png, description.txt, changelog.txt, license.txt, scripts
#   data.tar.gz       everything else, installed to /usr/local/AppCentral/folevi
# Unverified on real hardware. ASUSTOR's own apkg-tools.py is the reference: when APKG_TOOLS=<path to
# apkg-tools.py> is set, it builds the package instead.
LOG_PREFIX=asustor
source "$(dirname "$0")/../lib/common.sh"
parse_common_args "$@"
HERE="$(cd "$(dirname "$0")" && pwd)"
case "$ARCH" in x86_64) APK_ARCH="x86-64" ;; aarch64) APK_ARCH="arm64" ;; esac
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
app="$work/folevi"; mkdir -p "$app/CONTROL"
copy_bundle "$BUNDLE" "$app/bundle"
cp "$HERE"/CONTROL/*.sh "$HERE/CONTROL/description.txt" "$HERE/CONTROL/changelog.txt" "$app/CONTROL/"
embed_backup_helper "$HERE/CONTROL/pre-install.sh" "$app/CONTROL/pre-install.sh"
chmod 755 "$app"/CONTROL/*.sh
cp "$(icon 90)" "$app/CONTROL/icon.png"
if [ -f "$BUNDLE/LICENSES/LICENSE" ]; then cp "$BUNDLE/LICENSES/LICENSE" "$app/CONTROL/license.txt"
else echo "Folevi Server. Third-party licenses are in bundle/LICENSES." > "$app/CONTROL/license.txt"; fi
export_template_vars; export APK_ARCH
render "$HERE/CONTROL/config.json.in" "$app/CONTROL/config.json"
jq -e . "$app/CONTROL/config.json" >/dev/null || die "config.json is not valid JSON"
name="folevi_${VERSION}_${APK_ARCH}.apk"

if [ -n "${APKG_TOOLS:-}" ]; then
  (cd "$work" && python2 "$APKG_TOOLS" create folevi --destination "$OUT")
  log "built with apkg-tools in $OUT"; exit 0
fi
pkg="$work/pkg"; mkdir -p "$pkg"
printf '2.0\n' > "$pkg/apkg-version"
(cd "$app/CONTROL" && tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$pkg/control.tar.gz" .)
(cd "$app" && tar --sort=name --owner=0 --group=0 --numeric-owner --exclude=./CONTROL -czf "$pkg/data.tar.gz" .)
rm -f "$OUT/$name"
python3 - "$pkg" "$OUT/$name" <<'PY'
import sys, zipfile, os
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_STORED) as z:
    for n in ("apkg-version", "control.tar.gz", "data.tar.gz"):
        z.write(os.path.join(src, n), n)
PY
log "built $OUT/$name (unverified format)"
