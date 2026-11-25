#!/bin/sh
# On an upgrade (APKG_PKG_STATUS=upgrade), take a pre-update backup with the old version first.
. "$(dirname "$0")/common.sh"
if [ "${APKG_PKG_STATUS:-}" = "upgrade" ] && [ -x "$FOLEVID" ] && [ -d "$DATA" ]; then
  "$PKG_DIR/CONTROL/start-stop.sh" stop
  as_user "'$FOLEVID' backup --data '$DATA' --bundle '$BUNDLE'" >> "$LOG_FILE" 2>&1 \
    || plog "pre-update backup failed; folevid backs up again before migrating"
fi
exit 0
