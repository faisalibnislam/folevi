#!/usr/bin/env bash
# Prepare the container build context and, when Docker is available, build the image (never pushes).
#   build.sh --bundle <amd64-bundle> [--bundle-arm64 <arm64-bundle>] --version <ver> --arch <arch> --out <dir>
#            [--build] [--platforms linux/amd64,linux/arm64]
# Without --build it only writes <out>/docker-context (Dockerfile + bundles/<arch>/), which CI feeds to
# docker buildx. With --build it runs "docker buildx build" and writes an OCI archive to <out>, no push.
LOG_PREFIX=docker
source "$(dirname "$0")/../lib/common.sh"
parse_common_args "$@"
set -- "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
do_build=0 second="" platforms=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) do_build=1; shift ;;
    --bundle-arm64|--bundle-amd64|--bundle-other) second="$2"; shift 2 ;;
    --platforms) platforms="$2"; shift 2 ;;
    *) die "unknown flag $1" ;;
  esac
done
ctx="$OUT/docker-context"
rm -rf "$ctx"; mkdir -p "$ctx/bundles"
cp "$(dirname "$0")/Dockerfile" "$(dirname "$0")/docker-entrypoint.sh" "$ctx/"
printf '*\n!Dockerfile\n!docker-entrypoint.sh\n!bundles/\n' > "$ctx/.dockerignore"
copy_bundle "$BUNDLE" "$ctx/bundles/$(deb_arch "$ARCH")"
have="linux/$(deb_arch "$ARCH")"
if [ -n "$second" ]; then
  validate_bundle "$second"
  other=$([ "$ARCH" = x86_64 ] && echo aarch64 || echo x86_64)
  copy_bundle "$second" "$ctx/bundles/$(deb_arch "$other")"
  have="linux/amd64,linux/arm64"
fi
log "context ready: $ctx ($have)"
if [ "$do_build" = 1 ]; then
  command -v docker >/dev/null || die "docker not found"
  docker buildx build --platform "${platforms:-$have}" --build-arg FOLEVI_VERSION="$VERSION" \
    -t "$FOLEVI_IMAGE:$VERSION" --output "type=oci,dest=$OUT/folevi-server-$VERSION-image.oci.tar" "$ctx"
  log "image archive: $OUT/folevi-server-$VERSION-image.oci.tar (not pushed)"
fi
