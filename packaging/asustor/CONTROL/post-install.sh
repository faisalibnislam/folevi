#!/bin/sh
. "$(dirname "$0")/common.sh"
chmod 755 "$FOLEVID" 2>/dev/null
ensure_user || plog "could not create the '$RUN_USER' user: Folevi Server will not start until it exists (it does not run as root)"
plog "installed (${APKG_PKG_STATUS:-install})"
exit 0
