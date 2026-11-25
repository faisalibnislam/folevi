#!/usr/bin/env bash
# Build the Synology DSM 7.2+ package (.spk).
#   build.sh --bundle <dir> --version <ver> --arch <x86_64|aarch64> --out <dir> [--revision N] [--beta]
#            [--with-webservice]
# An .spk is an uncompressed tar of: INFO, package.tgz (installed to /var/packages/folevi/target), scripts/,
# conf/, WIZARD_UIFILES/, PACKAGE_ICON.PNG, PACKAGE_ICON_256.PNG, LICENSE. See README.md.
# --with-webservice adds DSM's webservice/portal resource (a reverse-proxy portal at /folevi). It is unverified
# (DSM may reject an unknown service type), so it is off by default. Test on real DSM before turning it on.
LOG_PREFIX=synology
source "$(dirname "$0")/../lib/common.sh"
parse_common_args "$@"
set -- "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
revision=1 beta=no webservice=0
while [ $# -gt 0 ]; do
  case "$1" in
    --revision) revision="$2"; shift 2 ;;
    --beta) beta=yes; shift ;;
    --with-webservice) webservice=1; shift ;;
    *) die "unknown flag $1" ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
# DSM 7 "arch" lists: the family plus the platform names Package Center reports, so a source or manual install
# matches on every model. aarch64 is first class: the owner's test NAS is a DS223 (rtd1619b).
# Unverified against Synology's current toolkit list: check "uname -a" / /etc.defaults/synoinfo.conf on new models.
case "$ARCH" in
  x86_64) SPK_ARCH="x86_64 apollolake avoton braswell broadwell broadwellnk broadwellnkv2 broadwellntbap bromolow cedarview denverton epyc7002 geminilake geminilakenk grantley kvmx64 purley r1000 r1000nk v1000 v1000nk"; ARCH_TAG=x86_64 ;;
  aarch64) SPK_ARCH="armv8 rtd1619b rtd1296 armada37xx"; ARCH_TAG=armv8 ;;
esac

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
target="$work/target" spk="$work/spk"
mkdir -p "$target/ui/images" "$target/app" "$spk/conf" "$spk/scripts" "$spk/WIZARD_UIFILES"

copy_bundle "$BUNDLE" "$target/bundle"
cp "$HERE/ui/config" "$target/ui/config"
for s in 16 24 32 48 64 72 256; do cp "$(icon $s)" "$target/ui/images/icon_${s}.png"; done
cp "$HERE/app/folevi.sc" "$target/app/folevi.sc"

(cd "$target" && tar --sort=name --owner=0 --group=0 --numeric-owner -cf - .) | gzip -n -6 > "$spk/package.tgz"

cp "$HERE"/scripts/* "$spk/scripts/"
cp "$PACKAGING_DIR/lib/pre-update-backup.sh" "$spk/scripts/pre-update-backup"
chmod 755 "$spk"/scripts/*
cp "$HERE"/WIZARD_UIFILES/* "$spk/WIZARD_UIFILES/"
cp "$HERE/conf/privilege" "$spk/conf/privilege"
if [ "$webservice" = 1 ]; then
  jq -s '.[0] * .[1]' "$HERE/conf/resource.json" "$HERE/conf/resource.webservice.json" > "$spk/conf/resource"
  log "webservice resource included (unverified)"
else
  cp "$HERE/conf/resource.json" "$spk/conf/resource"
fi
cp "$(icon 64)" "$spk/PACKAGE_ICON.PNG"
cp "$(icon 256)" "$spk/PACKAGE_ICON_256.PNG"
if [ -f "$BUNDLE/LICENSES/LICENSE" ]; then cp "$BUNDLE/LICENSES/LICENSE" "$spk/LICENSE"
else printf 'Folevi Server. Third-party licenses are in the bundle LICENSES folder.\n' > "$spk/LICENSE"; fi

export_template_vars
export SPK_VERSION="${VERSION}-$(printf '%04d' "$revision")" SPK_ARCH SPK_BETA="$beta"
export SPK_EXTRACTSIZE="$(du -sk "$target" | cut -f1)"
export SPK_CHECKSUM="$(md5sum "$spk/package.tgz" | cut -d' ' -f1)"
export SPK_CREATE_TIME="$(date -u ${SOURCE_DATE_EPOCH:+-d @$SOURCE_DATE_EPOCH} '+%Y%m%d-%H:%M:%S')"
render "$HERE/INFO.in" "$spk/INFO"

name="folevi-server-${VERSION}-dsm7-${ARCH_TAG}.spk"
(cd "$spk" && tar --format=gnu --sort=name --owner=0 --group=0 --numeric-owner -cf "$OUT/$name" \
  INFO package.tgz scripts conf WIZARD_UIFILES PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG LICENSE)
log "built $OUT/$name"
