#!/bin/sh
# Runs after the Folevi .rpm installs (bundle.linux.rpm.postInstallScript in tauri.linux.conf.json; the
# repository is live, docs/LINUX.md "Repositories"). It adds Folevi's repository for dnf (Fedora, RHEL) or zypper
# (openSUSE), so system updates keep Folevi current after a one-click install of the downloaded .rpm.
REPO_TEXT='[folevi]
name=Folevi
baseurl=https://folevi.com/download/linux/rpm/$basearch
enabled=1
autorefresh=1
type=rpm-md
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://folevi.com/download/linux/rpm/RPM-GPG-KEY-folevi'

if [ "$1" = "1" ]; then  # first install, not an upgrade
  if [ -d /etc/yum.repos.d ] && [ ! -e /etc/yum.repos.d/folevi.repo ]; then
    printf '%s\n' "$REPO_TEXT" > /etc/yum.repos.d/folevi.repo
  elif [ -d /etc/zypp/repos.d ] && [ ! -e /etc/zypp/repos.d/folevi.repo ]; then
    printf '%s\n' "$REPO_TEXT" > /etc/zypp/repos.d/folevi.repo
  fi
  if [ -f /usr/lib/folevi/RPM-GPG-KEY-folevi ]; then
    rpm --import /usr/lib/folevi/RPM-GPG-KEY-folevi || true
  fi
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
exit 0
