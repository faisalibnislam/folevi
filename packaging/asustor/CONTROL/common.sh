#!/bin/sh
# Shared by the ASUSTOR scripts. ADM sets APKG_PKG_DIR (the install folder, /usr/local/AppCentral/folevi).
PKG_DIR="${APKG_PKG_DIR:-/usr/local/AppCentral/folevi}"
BUNDLE="$PKG_DIR/bundle"
FOLEVID="$BUNDLE/bin/folevid"
# The "Folevi" shared folder registered in config.json. ADM links shares under /share (unverified).
DATA="${FOLEVI_DATA:-/share/Folevi/server}"
RUN_USER=folevi
PID_FILE=/var/run/folevi.pid
LOG_FILE="$PKG_DIR/folevi-package.log"
plog() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"; }
# Create an unprivileged service user with BusyBox tools (unverified on ADM). When it cannot be made, nothing is
# started: Folevi Server never runs as root.
ensure_user() {
  id "$RUN_USER" >/dev/null 2>&1 && return 0
  addgroup -S "$RUN_USER" >/dev/null 2>&1 || true
  adduser -S -D -H -G "$RUN_USER" -s /bin/false "$RUN_USER" >/dev/null 2>&1 || true
  id "$RUN_USER" >/dev/null 2>&1
}
# Always as the service user, never as root (fails when the user does not exist).
as_user() { su -s /bin/sh "$RUN_USER" -c "$*"; }
