# Folevi for Linux (`apps/desktop`, Tauri; `packaging/linux`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Released: 1.8.78 (build 108, 2026-11-26). AppImage, .deb and .rpm for x86_64 and aarch64 on folevi.com, apt and rpm repositories (`folevi.com/download/linux/apt` and `/rpm`, signed with the Folevi Linux key), Snap Store revisions 9 (arm64) and 10 (amd64) on stable, update feeds `desktop/linux-*/latest.json` at 1.8.78.
- The Mac's features for Linux shipped in 1.7.78 (PRs 115, 128, 113; `docs/DESKTOP_PARITY.md`): automatic updates (AppImage only, `linux::self_update_allowed`; the .deb, .rpm, Snap and Flatpak update through their package manager), Your own server with mDNS, a passphrase app lock, background sync, Dropbox and Google Drive, notification buttons over D-Bus (no typed replies), and the launcher's actions. 1.8.78 adds the lost-writes fix in the library folder (PR 133).
- Built in the Lima VM `folevi-linux` (`packaging/linux/scripts/build-in-lima.sh`, which now stamps the version from version.json first); the snap build needs `sg lxd -c ...`; the amd64 snap builds on Launchpad (`snapcraft remote-build`, about an hour; start it with `PYTHONUNBUFFERED=1` so the Launchpad authorization link shows at once, then approve it in a browser).
- The x86_64 AppImage smoke test runs in the VM's `/srv/jammy-amd64` root: bind-mount proc, sys, dev and dev/pts, extract the AppImage with `unsquashfs -o <offset>` (try each `hsqs` offset; the first can be a false match) and pass `AppRun` to `smoke-test.sh`.
- `packaging/linux/repo/build-apt-repo.sh` and `build-rpm-repo.sh` are the desktop app's; Folevi Server's are `build-server-apt-repo.sh` and `build-server-rpm-repo.sh`.
- Flathub needs a person: its rules bar AI-written manifests and AI-opened submissions (`docs/LINUX.md`).

## Next steps

- The first automatic AppImage update (1.7.78 to 1.8.78) and the new features on a real Linux desktop; no session has run one.
- Dropbox and Google Drive need the owner's app key and Desktop client id (repository variables `FOLEVI_DROPBOX_APP_KEY`, `FOLEVI_GOOGLE_DESKTOP_CLIENT_ID`) and the loopback redirects registered.
- The owner: copy `~/.folevi-linux-signing/folevi-repo-secret.asc` and `~/.folevi-desktop-signing/folevi-updater.key` to the password manager.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
