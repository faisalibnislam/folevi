#!/bin/sh
# ADM calls this with start or stop (and at boot, in the order from config.json).
. "$(dirname "$0")/common.sh"
running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }
case "$1" in
  start)
    running && exit 0
    mkdir -p "$DATA"
    ensure_user && chown -R "$RUN_USER" "$DATA" 2>/dev/null
    plog "starting, data in $DATA"
    as_user "FOLEVI_PACKAGE=asustor exec '$FOLEVID' run --data '$DATA' --bundle '$BUNDLE' >> '$PKG_DIR/folevid.out' 2>&1" &
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
