#!/bin/sh
# Stop the service on removal (not on upgrade: deb passes "upgrade", rpm passes 1 when a newer copy stays).
set -eu
case "${1:-}" in
  remove|purge|0)
    if [ -d /run/systemd/system ]; then
      systemctl disable --now folevi-server.service >/dev/null 2>&1 || true
    fi
    ;;
esac
exit 0
