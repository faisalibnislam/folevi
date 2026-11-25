#!/bin/sh
# On an upgrade (APKG_PKG_STATUS=upgrade), take a pre-update backup with the old version first.
. "$(dirname "$0")/common.sh"
# @@PRE_UPDATE_BACKUP_HELPER@@
if [ "${APKG_PKG_STATUS:-}" = "upgrade" ] && [ -x "$FOLEVID" ] && [ -d "$DATA" ]; then
  printf '%s\nfolevi_pre_update_backup "%s" "%s" "%s"\n' "$FOLEVI_BACKUP_HELPER" "$FOLEVID" "$DATA" "$BUNDLE" \
    | as_user "sh -s" >> "$LOG_FILE" 2>&1 \
    || plog "pre-update backup failed; folevid protects its own migrations"
  "$PKG_DIR/CONTROL/start-stop.sh" stop
fi
exit 0
