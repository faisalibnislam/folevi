#!/bin/sh
# Enable and start the service, then print the setup address.
set -eu
install -d -o folevi -g folevi -m 0750 /var/lib/folevi
if [ ! -e /etc/default/folevi-server ]; then
  install -m 0644 /usr/share/folevi-server/folevi-server.default /etc/default/folevi-server
fi
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable folevi-server.service >/dev/null 2>&1 || true
  systemctl restart folevi-server.service || echo "Folevi Server: could not start the service; see: journalctl -u folevi-server" >&2
fi

url=""
i=0
while [ $i -lt 15 ]; do
  url="$(runuser -u folevi -- /opt/folevi/bin/folevid setup-url --data /var/lib/folevi --bundle /opt/folevi 2>/dev/null || true)"
  [ -n "$url" ] && break
  i=$((i + 1)); sleep 1
done
echo
echo "Folevi Server is installed."
if [ -n "$url" ]; then
  echo "Open this address in a browser to set it up:"
  echo "  $url"
else
  echo "Get the setup address with: sudo -u folevi /opt/folevi/bin/folevid setup-url --data /var/lib/folevi --bundle /opt/folevi"
fi
echo
exit 0
