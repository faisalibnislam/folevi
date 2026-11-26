#!/bin/sh
# ADM calls this with start or stop (and at boot, in the order from config.json).
. "$(dirname "$0")/common.sh"
running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }
case "$1" in
  start)
    running && exit 0
    mkdir -p "$DATA"
    if ! ensure_user; then
      plog "not started: could not create the '$RUN_USER' user, and Folevi Server does not run as root. Create a user named '$RUN_USER' in ADM (Access Control > Local Users), then start Folevi Server again."
      echo "Folevi Server: could not create the '$RUN_USER' user; not started (it does not run as root)" >&2
      exit 1
    fi
    # -h: change a symbolic link itself, never what it points at (the folder is writable by the service user).
    if ! chown -hR "$RUN_USER" "$DATA" 2>/dev/null; then
      plog "not started: could not give the data folder $DATA to the '$RUN_USER' user, and Folevi Server does not run as root."
      echo "Folevi Server: could not give $DATA to the '$RUN_USER' user; not started" >&2
      exit 1
    fi
    # folevid's own output file sits in the package folder (root's); the service user gets this one file.
    : >> "$PKG_DIR/folevid.out"
    chown -h "$RUN_USER" "$PKG_DIR/folevid.out" 2>/dev/null
    chmod 600 "$PKG_DIR/folevid.out" 2>/dev/null
    plog "starting, data in $DATA"
    as_user "FOLEVI_PACKAGE=asustor FOLEVI_MANAGED_BY=store exec '$FOLEVID' run --data '$DATA' --bundle '$BUNDLE' >> '$PKG_DIR/folevid.out' 2>&1" &
    echo $! > "$PID_FILE"
    ;;
  stop)
    if running; then
      pid="$(cat "$PID_FILE")"; kill -TERM "$pid" 2>/dev/null
      i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
      kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
    fi
    rm -f "$PID_FILE"; plog "stopped"
    ;;
  restart) "$0" stop; "$0" start ;;
  *) echo "usage: $0 {start|stop|restart}"; exit 1 ;;
esac
exit 0
