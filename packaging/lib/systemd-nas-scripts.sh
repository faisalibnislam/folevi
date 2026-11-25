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
      { cat "$(dirname "$0")/pre-update-backup.sh"
        printf 'folevi_pre_update_backup "%s" "%s" "%s"\n' "$app/bundle/bin/folevid" "$FOLEVI_DATA" "$app/bundle"
      } | runuser -u folevi -- sh -s \
        || echo "Folevi Server: pre-update backup did not finish; folevid protects its own migrations."
      systemctl stop folevi.service 2>/dev/null || true
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
