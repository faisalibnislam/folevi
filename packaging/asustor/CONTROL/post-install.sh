#!/bin/sh
. "$(dirname "$0")/common.sh"
chmod 755 "$FOLEVID" 2>/dev/null
ensure_user || plog "could not create the folevi user; running as root (unverified on ADM)"
plog "installed (${APKG_PKG_STATUS:-install})"
exit 0
