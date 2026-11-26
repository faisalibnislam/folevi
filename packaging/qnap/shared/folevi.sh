#!/bin/sh
# QTS service script for Folevi Server: start, stop, restart, status, backup, setup-url.
# QTS runs it as root at boot and from App Center. It runs folevid as the unprivileged "folevi" user, and refuses
# to start when that user cannot be made: Folevi Server never runs as root (admin).
CONF=/etc/config/qpkg.conf
QPKG_NAME="folevi"
QPKG_ROOT="$(/sbin/getcfg $QPKG_NAME Install_Path -f $CONF)"
[ -n "$QPKG_ROOT" ] || QPKG_ROOT="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$QPKG_ROOT/bundle"
FOLEVID="$BUNDLE/bin/folevid"
PID_FILE=/var/run/folevi.pid
RUN_USER=folevi
export QNAP_QPKG=$QPKG_NAME

log() { /bin/echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$QPKG_ROOT/folevi-package.log"; }

# Data: the "Folevi" shared folder when the owner made one (so HBS 3 and snapshots cover it), otherwise a folder
# on the package's volume. Override with: setcfg folevi Data_Path /share/<folder> -f /etc/config/qpkg.conf
data_dir() {
  d="$(/sbin/getcfg $QPKG_NAME Data_Path -f $CONF)"
  [ -n "$d" ] || d="$(/sbin/getcfg Folevi path -f /etc/config/smb.conf)"
  [ -n "$d" ] || d="$QPKG_ROOT/data"
  echo "$d"
}

# A dedicated unprivileged user. QTS user management is not documented for packages; busybox adduser is
# tried. When that fails nothing is started (see prepare). Unverified on real QTS.
ensure_user() {
  /usr/bin/id "$RUN_USER" >/dev/null 2>&1 && return 0
  if command -v adduser >/dev/null 2>&1; then
    adduser -S -D -H -h "$QPKG_ROOT" -s /bin/false "$RUN_USER" >/dev/null 2>&1 || true
  fi
  /usr/bin/id "$RUN_USER" >/dev/null 2>&1
}

# Private glibc (docs: packaging/qnap/README.md). build.sh patched node and convex-backend to use the loader at
# /usr/local/lib/folevi-rt/ld.so with RPATH $ORIGIN/../runtime/lib. QTS rebuilds / at boot, so link it each start.
link_runtime() {
  [ -d "$BUNDLE/runtime/lib" ] || return 0
  loader="$(ls "$BUNDLE"/runtime/lib/ld-linux-*.so.* 2>/dev/null | head -n 1)"
  [ -n "$loader" ] || return 0
  /bin/mkdir -p /usr/local/lib/folevi-rt
  /bin/ln -sfn "$loader" /usr/local/lib/folevi-rt/ld.so
}

# Always as the service user, never as root.
as_user() { /bin/su -s /bin/sh "$RUN_USER" -c "$*"; }

running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

# Gets the data folder, the runtime link and the service user ready. Returns 1 (and says why) when folevid
# could not run as the service user: the caller then stops instead of running it as root.
prepare() {
  DATA="$(data_dir)"
  /bin/mkdir -p "$DATA"
  link_runtime
  if ! ensure_user; then
    refuse "could not create the '$RUN_USER' user, and Folevi Server does not run as root (admin). Create a user named '$RUN_USER' (Control Panel > Users), then start Folevi Server again."
    return 1
  fi
  # -h: change a symbolic link itself, never what it points at (the folder is writable by the service user).
  if ! /bin/chown -hR "$RUN_USER" "$DATA" 2>/dev/null; then
    refuse "could not give the data folder $DATA to the '$RUN_USER' user, and Folevi Server does not run as root (admin)."
    return 1
  fi
  # folevid's own output file sits in the package folder (root's); the service user gets this one file.
  : >> "$QPKG_ROOT/folevid.out"
  /bin/chown -h "$RUN_USER" "$QPKG_ROOT/folevid.out" 2>/dev/null
  /bin/chmod 600 "$QPKG_ROOT/folevid.out" 2>/dev/null
  return 0
}
refuse() { log "not started: $*"; echo "Folevi Server: $*" >&2; }

case "$1" in
  start)
    ENABLED=$(/sbin/getcfg $QPKG_NAME Enable -u -d FALSE -f $CONF)
    if [ "$ENABLED" != "TRUE" ]; then echo "$QPKG_NAME is disabled."; exit 1; fi
    running && exit 0
    prepare || exit 1
    log "starting, data in $DATA"
    as_user "FOLEVI_PACKAGE=qnap FOLEVI_MANAGED_BY=store exec '$FOLEVID' run --data '$DATA' --bundle '$BUNDLE' >> '$QPKG_ROOT/folevid.out' 2>&1" &
    echo $! > "$PID_FILE"
    sleep 2
    running || { log "folevid exited right away; see $DATA/logs/folevid.log"; exit 1; }
    ;;
  stop)
    if running; then
      pid="$(cat "$PID_FILE")"
      kill -TERM "$pid" 2>/dev/null
      i=0
      while kill -0 "$pid" 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
      kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
    fi
    rm -f "$PID_FILE"
    log "stopped"
    ;;
  restart)
    $0 stop
    $0 start
    ;;
  status)
    running && { echo "running"; exit 0; }
    echo "stopped"; exit 1
    ;;
  backup)
    prepare || exit 1
    as_user "'$FOLEVID' backup --data '$DATA' --bundle '$BUNDLE'"
    ;;
  setup-url)
    prepare || exit 1
    as_user "'$FOLEVID' setup-url --data '$DATA' --bundle '$BUNDLE'"
    ;;
  remove)
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|backup|setup-url}"
    exit 1
    ;;
esac
exit 0
