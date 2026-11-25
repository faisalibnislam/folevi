#!/usr/bin/env bash
# Shared builder for the TerraMaster .tpk and UGREEN .upk (both unverified formats). Sourced by their build.sh
# after parse_common_args, with PLATFORM, APP_DIR, DATA_DEFAULT, EXT, MANIFEST_TEMPLATE, MANIFEST_NAME set.
# Output: a gzip tar with
#   <MANIFEST_NAME>   package metadata (rendered from MANIFEST_TEMPLATE)
#   icon.png          256x256 placeholder
#   scripts/          preinst, postinst, prerm, postrm (call systemd-nas-scripts.sh)
#   app/              installed to APP_DIR: bundle/, folevi.service, systemd-nas-scripts.sh
build_systemd_nas() {
  local work pkg name
  work="$(mktemp -d)"; pkg="$work/pkg"
  mkdir -p "$pkg/app" "$pkg/scripts"
  copy_bundle "$BUNDLE" "$pkg/app/bundle"
  export_template_vars; export PLATFORM APP_DIR DATA_DEFAULT
  render "$PACKAGING_DIR/lib/folevi-systemd.service.in" "$pkg/app/folevi.service"
  cp "$PACKAGING_DIR/lib/systemd-nas-scripts.sh" "$pkg/app/systemd-nas-scripts.sh"
  cp "$PACKAGING_DIR/lib/pre-update-backup.sh" "$pkg/app/pre-update-backup.sh"
  for a in preinst postinst prerm postrm; do
    printf '#!/bin/sh\n# Unverified hook name: see README.md.\nexec sh "$(dirname "$0")/../app/systemd-nas-scripts.sh" %s "%s" "%s"\n' \
      "$a" "$APP_DIR" "$DATA_DEFAULT" > "$pkg/scripts/$a"
    chmod 755 "$pkg/scripts/$a"
  done
  cp "$(icon 256)" "$pkg/icon.png"
  render "$MANIFEST_TEMPLATE" "$pkg/$MANIFEST_NAME"
  case "$MANIFEST_NAME" in *.json) jq -e . "$pkg/$MANIFEST_NAME" >/dev/null || die "$MANIFEST_NAME is not valid JSON" ;; esac
  name="folevi-server-${VERSION}-${PLATFORM}-${ARCH}.${EXT}"
  (cd "$pkg" && tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$OUT/$name" .)
  rm -rf "$work"
  log "built $OUT/$name (UNVERIFIED format: test on real hardware)"
}
