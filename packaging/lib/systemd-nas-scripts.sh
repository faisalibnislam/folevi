#!/bin/sh
# Install hooks shared by the TerraMaster and UGREEN packages (systemd NAS systems). Called as:
#   systemd-nas-scripts.sh <preinst|postinst|prerm|postrm> <app dir> <default data dir>
# Unverified on real TOS 6 and UGOS Pro hardware: the stores' real hook names and arguments may differ.
set -eu
action="$1" app="$2" data_default="$3"
unit=/etc/systemd/system/folevi.service
envf="$app/folevi.env"
case "$action" in
  preinst)
    if [ -x "$app/bundle/bin/folevid" ] && [ -f "$envf" ]; then
      . "$envf"
      systemctl stop folevi.service 2>/dev/null || true
      runuser -u folevi -- "$app/bundle/bin/folevid" backup --data "$FOLEVI_DATA" --bundle "$app/bundle" \
        || echo "Folevi Server: pre-update backup did not finish; folevid backs up again before migrating."
    fi
    ;;
  postinst)
    getent group folevi >/dev/null 2>&1 || groupadd --system folevi
    getent passwd folevi >/dev/null 2>&1 || useradd --system --gid folevi --no-create-home --shell /usr/sbin/nologin folevi
    [ -f "$envf" ] || echo "FOLEVI_DATA=$data_default" > "$envf"
    . "$envf"
    install -d -o folevi -g folevi -m 0750 "$FOLEVI_DATA"
    install -m 0644 "$app/folevi.service" "$unit"
    systemctl daemon-reload
    systemctl enable --now folevi.service
    ;;
  prerm)
    systemctl disable --now folevi.service 2>/dev/null || true
    ;;
  postrm)
    rm -f "$unit"; systemctl daemon-reload 2>/dev/null || true
    echo "Folevi Server removed. The data folder is kept."
    ;;
esac
