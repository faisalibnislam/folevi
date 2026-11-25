#!/usr/bin/env bash
# TerraMaster TOS 6 package (.tpk). UNVERIFIED: built from public descriptions only (TOS 6 is systemd-based;
# TerraMaster's TOS Developer Platform opened 2026-10-30 and its package schema was not available to us).
# Treat the output as a structure placeholder until checked against TerraMaster's docs and a real TOS 6 NAS.
#   build.sh --bundle <dir> --version <ver> --arch <x86_64|aarch64> --out <dir>
LOG_PREFIX=terramaster
source "$(dirname "$0")/../lib/common.sh"
source "$(dirname "$0")/../lib/build-systemd-nas.sh"
parse_common_args "$@"
PLATFORM=tos6 EXT=tpk APP_DIR=/usr/local/folevi DATA_DEFAULT=/Volume1/folevi
MANIFEST_TEMPLATE="$(dirname "$0")/manifest.json.in" MANIFEST_NAME=manifest.json
build_systemd_nas
