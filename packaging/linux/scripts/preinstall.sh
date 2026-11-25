#!/bin/sh
# Create the folevi system user and group before files land. Works on Debian, Ubuntu, Fedora, RHEL and clones.
set -eu
if ! getent group folevi >/dev/null 2>&1; then
  groupadd --system folevi
fi
if ! getent passwd folevi >/dev/null 2>&1; then
  useradd --system --gid folevi --home-dir /var/lib/folevi --no-create-home \
    --shell /usr/sbin/nologin --comment "Folevi Server" folevi
fi
# An upgrade: take a pre-update backup while the old version's files are still in place.
# deb passes "upgrade <old-version>", rpm passes the count of installed copies (2 on upgrade).
if { [ "${1:-}" = "upgrade" ] || [ "${1:-0}" = "2" ]; } && [ -x /opt/folevi/bin/folevid ] && [ -d /var/lib/folevi ]; then
  echo "Folevi Server: taking a backup before the update..."
  if command -v runuser >/dev/null 2>&1; then
    runuser -u folevi -- /opt/folevi/bin/folevid backup --data /var/lib/folevi --bundle /opt/folevi \
      || echo "Folevi Server: the pre-update backup did not finish; folevid takes one itself on start." >&2
  fi
fi
exit 0
