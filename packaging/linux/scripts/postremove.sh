#!/bin/sh
# Never deletes /var/lib/folevi: the owner's notes live there. "apt purge" removes only the settings file.
set -eu
if [ -d /run/systemd/system ]; then systemctl daemon-reload >/dev/null 2>&1 || true; fi
case "${1:-}" in
  purge) rm -f /etc/default/folevi-server
         echo "Folevi Server removed. Your data is still in /var/lib/folevi; delete it yourself if you are sure." ;;
  upgrade|1) # an upgrade (deb: old package after upgrade; rpm: 1 copy remains): restart into the new version
    if [ -d /run/systemd/system ]; then systemctl try-restart folevi-server.service >/dev/null 2>&1 || true; fi ;;
esac
exit 0
