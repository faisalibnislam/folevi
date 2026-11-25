#!/bin/bash
# Cleanup before the snapshot, following digitalocean/marketplace-partners scripts/90-cleanup.sh conventions:
# no SSH keys, no shell history, no logs, no machine id, no cloud-init state, apt caches emptied.
set -o errexit
apt-get -y autoremove
apt-get -y autoclean
rm -rf /tmp/* /var/tmp/*
history -c || true
cat /dev/null > /root/.bash_history
unset HISTFILE
find /var/log -mtime -1 -type f -exec truncate -s 0 {} \;
rm -rf /var/log/*.gz /var/log/*.[0-9] /var/log/*-????????
rm -rf /var/lib/cloud/instances/*
rm -f /root/.ssh/authorized_keys /etc/ssh/*key*
touch /etc/ssh/revoked_keys
chmod 600 /etc/ssh/revoked_keys
truncate -s 0 /etc/machine-id
dd if=/dev/zero of=/zerofile bs=4096 || true
rm -f /zerofile
sync
