#!/usr/bin/env bash
# Build the QNAP QTS 5 / QuTS hero package (.qpkg).
#   build.sh --bundle <dir> --version <ver> --arch <x86_64|aarch64> --out <dir> [--no-private-glibc] [--no-qdk]
# 1. Stages the bundle and, unless --no-private-glibc, fills runtime/lib from Ubuntu 22.04
#    (populate-runtime-lib.sh) and patches node and convex-backend to use it (patch-private-glibc.sh, needs
#    patchelf). QTS 5 has glibc 2.21; Convex needs 2.35 and Node 2.28 (docs/self-hosting/PHASE0.md section 6).
# 2. With QNAP's QDK installed (qbuild in PATH, or QDK_QBUILD=<path>), builds with qbuild: the release path,
#    which adds QNAP's checksum and, with QNAP's code-signing setup, the signature.
#    Without QDK (or with --no-qdk) it assembles the same file layout itself (README.md, "Package format"). That
#    file has no QDK checksum or signature, so QTS may call it invalid: for structure tests only. Unverified.
LOG_PREFIX=qnap
source "$(dirname "$0")/../lib/common.sh"
parse_common_args "$@"
set -- "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
private_glibc=1 use_qdk=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-private-glibc) private_glibc=0; shift ;;
    --no-qdk) use_qdk=0; shift ;;
    *) die "unknown flag $1" ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
case "$ARCH" in x86_64) QARCH=x86_64 ;; aarch64) QARCH=arm_64 ;; esac
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
proj="$work/folevi"
mkdir -p "$proj/shared" "$proj/icons" "$proj/$QARCH" "$proj/config"

copy_bundle "$BUNDLE" "$proj/shared/bundle"
if [ "$private_glibc" = 1 ]; then
  loader=$([ "$ARCH" = x86_64 ] && echo ld-linux-x86-64.so.2 || echo ld-linux-aarch64.so.1)
  if [ ! -e "$proj/shared/bundle/runtime/lib/$loader" ]; then
    if grep -q '"fake":true' "$BUNDLE/manifest.json" 2>/dev/null; then
      "$HERE/populate-runtime-lib.sh" --bundle "$proj/shared/bundle" --arch "$ARCH" --from-rootfs "${FOLEVI_RUNTIME_ROOTFS:-/}"
    else
      "$HERE/populate-runtime-lib.sh" --bundle "$proj/shared/bundle" --arch "$ARCH" ${FOLEVI_RUNTIME_ROOTFS:+--from-rootfs "$FOLEVI_RUNTIME_ROOTFS"}
    fi
  fi
  "$HERE/patch-private-glibc.sh" --bundle "$proj/shared/bundle"
fi
cp "$HERE/shared/folevi.sh" "$proj/shared/folevi.sh"; chmod 755 "$proj/shared/folevi.sh"
cp "$PACKAGING_DIR/icons/folevi-qnap-64.gif" "$proj/icons/folevi.gif"
cp "$PACKAGING_DIR/icons/folevi-qnap-80.gif" "$proj/icons/folevi_80.gif"
cp "$PACKAGING_DIR/icons/folevi-qnap-64-gray.gif" "$proj/icons/folevi_gray.gif"
embed_backup_helper "$HERE/package_routines" "$proj/package_routines"
export_template_vars
render "$HERE/qpkg.cfg.in" "$proj/qpkg.cfg"
name="folevi-server-${VERSION}-qts5-${QARCH}.qpkg"

QBUILD="${QDK_QBUILD:-$(command -v qbuild || true)}"
if [ "$use_qdk" = 1 ] && [ -n "$QBUILD" ]; then
  log "building with QDK: $QBUILD"
  (cd "$proj" && "$QBUILD" --build-arch "$QARCH" --compress-method gzip)
  built="$(ls "$proj"/build/*.qpkg | head -n 1)"
  cp "$built" "$OUT/$name"
  log "built $OUT/$name (QDK)"
  exit 0
fi

log "QDK not used: assembling the .qpkg by script (unverified, no QNAP checksum; see README.md)"
# Data archive: what lands in the install folder (shared/ plus the icons QTS shows).
data="$work/data"; mkdir -p "$data"
copy_bundle "$proj/shared" "$data"
cp "$proj/icons/folevi.gif" "$data/.qpkg_icon.gif"
cp "$proj/icons/folevi_80.gif" "$data/.qpkg_icon_80.gif"
cp "$proj/icons/folevi_gray.gif" "$data/.qpkg_icon_gray.gif"
(cd "$data" && tar --sort=name --owner=0 --group=0 --numeric-owner -cf - .) | gzip -n -6 > "$work/data.tar.gz"
# Control archive: installer, routines, config. QDK wraps control.tar.gz in an outer plain tar.
ctl="$work/ctl"; mkdir -p "$ctl"
cp "$HERE/qinstall-minimal.sh" "$ctl/qinstall.sh"; chmod 755 "$ctl/qinstall.sh"
cp "$proj/package_routines" "$proj/qpkg.cfg" "$ctl/"
echo "$VERSION" > "$ctl/built_version"
(cd "$ctl" && tar --sort=name --owner=0 --group=0 --numeric-owner -czf "$work/control.tar.gz" .)
(cd "$work" && tar --owner=0 --group=0 --numeric-owner -cf control.tar control.tar.gz)
ctrl_len=$(stat -c %s "$work/control.tar")
data_len=$(stat -c %s "$work/data.tar.gz")
case "$QARCH" in x86_64) cpu=x86_64 ;; arm_64) cpu=aarch64 ;; esac

hdr="$work/header.sh"
cat > "$hdr" <<HDR
#!/bin/sh
# Folevi Server QPKG ($QARCH). Self-extracting: header, control tar, data.tar.gz, QNAP tail.
/bin/echo "Install QNAP package on TS-NAS..."
/bin/grep "/mnt/HDA_ROOT" /proc/mounts >/dev/null 2>&1 || exit 1
[ "\$(/bin/uname -m)" = "$cpu" ] || { /bin/echo "Installation Abort. This package is for $cpu NAS models."; exit 1; }
public=\`/sbin/getcfg Public path -f /etc/config/smb.conf\`
[ -n "\$public" ] || { /bin/echo "The Public share not found."; exit 1; }
_EXTRACT_DIR="\$(dirname "\$public")/.qpkg/.tmp-folevi"
/bin/mkdir -p \$_EXTRACT_DIR || exit 1
script_len=SCRIPT_LEN
/bin/dd if="\${0}" bs=\$script_len skip=1 | /bin/tar -xO | /bin/tar -xzv -C \$_EXTRACT_DIR || exit 1
offset=\$(/usr/bin/expr \$script_len + $ctrl_len)
/bin/dd if="\${0}" bs=\$offset skip=1 | /bin/dd bs=1024 count=$(( (data_len + 1023) / 1024 )) of=\$_EXTRACT_DIR/data.tar.gz || exit 1
( cd \$_EXTRACT_DIR && /bin/sh qinstall.sh || echo "Installation Abort." )
/bin/rm -fr \$_EXTRACT_DIR && exit 10
exit 1
HDR
# Same length trick as QDK's qbuild: the header states its own size (the 10-character placeholder is replaced).
base=$(( $(stat -c %s "$hdr") - 10 ))
len=$(( base + ${#base} ))
[ "${#len}" -eq "${#base}" ] || len=$(( base + ${#len} ))
sed -i "s/SCRIPT_LEN/$len/" "$hdr"
[ "$(stat -c %s "$hdr")" = "$len" ] || die "header length mismatch"

pad() { local s="$1" n="$2"; printf '%s' "$s"; printf '%*s' $(( n - ${#s} )) ''; }
q="$OUT/$name"
cat "$hdr" "$work/control.tar" "$work/data.tar.gz" > "$q"
{ pad "" 10; printf '%50s' ''; pad "folevi" 20; pad "$VERSION" 10; printf 'QNAPQPKG  '; } >> "$q"
log "built $q (script-assembled, unverified)"
