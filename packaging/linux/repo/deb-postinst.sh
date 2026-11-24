#!/bin/sh
# Runs after the Folevi .deb installs (bundle.linux.deb.postInstallScript, wired in only once the apt repository is
# live: docs/LINUX.md, "Repositories"). It adds Folevi's apt repository, the way Chrome and VS Code do, so the
# Software Updater keeps Folevi current after a one-click install of the downloaded .deb.
# Someone who removed the source on purpose (by leaving an empty folevi.sources) keeps it removed.
set -e
SOURCES=/etc/apt/sources.list.d/folevi.sources
KEYRING=/usr/share/keyrings/folevi-archive-keyring.gpg

if [ "$1" = "configure" ] && [ ! -e "$SOURCES" ]; then
  if [ -f /usr/lib/folevi/folevi-archive-keyring.gpg ]; then
    install -m 0644 /usr/lib/folevi/folevi-archive-keyring.gpg "$KEYRING"
  fi
  cat > "$SOURCES" <<'EOF'
Types: deb
URIs: https://folevi.com/linux/apt
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: /usr/share/keyrings/folevi-archive-keyring.gpg
EOF
fi
# Folevi opens folevi:// links: refresh the desktop's list of handlers.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
exit 0
