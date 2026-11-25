#!/bin/sh
# Folevi Server container entrypoint.
# - Started as a non-root user (the image default, uid 10001, or any uid the platform sets): runs folevid as is.
# - Started as root (compose "user: 0:0", needed when the host creates the data folder as root): makes /data
#   owned by FOLEVI_UID:FOLEVI_GID (default 10001:10001) and drops to that user before starting folevid.
#   folevid itself never runs as root.
set -eu
if [ "$(id -u)" = "0" ]; then
  uid="${FOLEVI_UID:-10001}" gid="${FOLEVI_GID:-10001}"
  [ "$uid" != "0" ] || { echo "FOLEVI_UID must not be 0" >&2; exit 2; }
  mkdir -p "${FOLEVI_DATA:-/data}"
  if [ "$(stat -c %u "${FOLEVI_DATA:-/data}")" != "$uid" ]; then
    chown -R "$uid:$gid" "${FOLEVI_DATA:-/data}"
  fi
  exec setpriv --reuid="$uid" --regid="$gid" --clear-groups --inh-caps=-all /opt/folevi/bin/folevid "$@"
fi
exec /opt/folevi/bin/folevid "$@"
