#!/bin/sh
# Install Folevi Server into the image but leave it stopped with an empty data folder, so every Droplet makes its
# own secrets on first boot (001_onboot starts it).
set -eu
apt-get -qq update
apt-get -qq -y upgrade
apt-get -qq -y install curl ca-certificates ufw
curl -fsSL https://get.folevi.com/server -o /tmp/folevi-install.sh
sh /tmp/folevi-install.sh
systemctl disable --now folevi-server.service
# No secrets or data may ship in the image.
rm -rf /var/lib/folevi/* /tmp/folevi-install.sh
cat > /etc/default/folevi-server <<'CONF'
FOLEVI_PORT=80
FOLEVI_HTTPS_PORT=443
CONF
ufw limit ssh
ufw allow http
ufw allow https
ufw --force enable
chmod +x /var/lib/cloud/scripts/per-instance/001_onboot /etc/update-motd.d/99-one-click
