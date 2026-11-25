#!/usr/bin/env bash
# Build folevi-server .deb and .rpm with nfpm (github.com/goreleaser/nfpm).
#   build.sh --bundle <dir> --version <ver> --arch <x86_64|aarch64> --out <dir> [--formats deb,rpm]
# Optional signing, never printed: FOLEVI_RPM_SIGNING_KEY_FILE (armored GPG private key file) and
# NFPM_RPM_PASSPHRASE. The apt repository is signed separately by repo/build-apt-repo.sh.
LOG_PREFIX=linux
source "$(dirname "$0")/../lib/common.sh"
parse_common_args "$@"
formats="deb,rpm"
set -- "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
while [ $# -gt 0 ]; do case "$1" in --formats) formats="$2"; shift 2 ;; *) die "unknown flag $1" ;; esac; done

NFPM="${NFPM:-$(command -v nfpm || echo "$HOME/go/bin/nfpm")}"
[ -x "$NFPM" ] || die "nfpm not found (go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.43.0)"

export_template_vars
export NFPM_ARCH="$(deb_arch "$ARCH")" FOLEVI_BUNDLE="$BUNDLE" LINUX_DIR="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/scripts"
cp "$LINUX_DIR"/scripts/*.sh "$work/scripts/"
embed_backup_helper "$LINUX_DIR/scripts/preinstall.sh" "$work/scripts/preinstall.sh"
export SCRIPTS_DIR="$work/scripts"
render "$LINUX_DIR/nfpm.yaml" "$work/nfpm.yaml"
if [ -n "${FOLEVI_RPM_SIGNING_KEY_FILE:-}" ]; then
  [ -f "$FOLEVI_RPM_SIGNING_KEY_FILE" ] || die "FOLEVI_RPM_SIGNING_KEY_FILE does not point at a file"
  printf '  signature:\n    key_file: %s\n' "$FOLEVI_RPM_SIGNING_KEY_FILE" > "$work/sig"
  sed -i "/^rpm:/r $work/sig" "$work/nfpm.yaml"
  log "rpm will be signed (key file given; passphrase from NFPM_RPM_PASSPHRASE)"
fi
IFS=, read -ra fmts <<< "$formats"
for f in "${fmts[@]}"; do
  case "$f" in
    deb) target="$OUT/folevi-server_${VERSION}-1_${NFPM_ARCH}.deb" ;;
    rpm) target="$OUT/folevi-server-${VERSION}-1.${ARCH}.rpm" ;;
    *) die "unknown format $f" ;;
  esac
  "$NFPM" package --config "$work/nfpm.yaml" --packager "$f" --target "$target" >&2
  log "built $target"
done
