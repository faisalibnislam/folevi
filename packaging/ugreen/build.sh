#!/usr/bin/env bash
# UGREEN UGOS Pro package (.upk). UNVERIFIED and pending UGREEN developer authorization: UGREEN's docs say a NAS
# must be authorized by UGREEN to install a .upk at all. Until then UGREEN owners use the container route
# (CONTAINER_GUIDE.md). The layout is a placeholder to be replaced with UGREEN's real schema.
#   build.sh --bundle <dir> --version <ver> --arch <x86_64|aarch64> --out <dir>
LOG_PREFIX=ugreen
source "$(dirname "$0")/../lib/common.sh"
source "$(dirname "$0")/../lib/build-systemd-nas.sh"
parse_common_args "$@"
PLATFORM=ugos EXT=upk APP_DIR=/opt/folevi DATA_DEFAULT=/volume1/folevi
MANIFEST_TEMPLATE="$(dirname "$0")/manifest.json.in" MANIFEST_NAME=manifest.json
build_systemd_nas
