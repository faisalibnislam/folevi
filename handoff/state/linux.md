# Folevi for Linux (`apps/desktop`, Tauri; `packaging/linux`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Released: 1.9.80 (build 111, 2026-11-28, from `7b16a128`). AppImage, .deb and .rpm for x86_64 and aarch64 on folevi.com, apt and rpm repositories (`folevi.com/download/linux/apt` and `/rpm`, signed with the Folevi Linux key), update feeds `desktop/linux-*/latest.json` at 1.9.80. Snap Store: arm64 revision 11 (1.9.80) on stable; amd64 is still revision 10 (1.8.78), because Launchpad answered 503 to every remote-build on 2026-11-28.
- Automatic AppImage updates tested in the VM (aarch64, own Xvfb display): 1.7.78 to 1.8.78 and 1.8.78 to 1.9.80 both downloaded, verified, replaced the file and restarted on the new version. Two problems found: message dialogs need `zenity` (below), and Vercel's CDN had cached a 100-byte range response for a versioned file (fixed in PR 187: `CDN-Cache-Control: no-store` on `/download/*`).
- The Mac's features for Linux shipped in 1.7.78 (PRs 115, 128, 113; `docs/DESKTOP_PARITY.md`): automatic updates (AppImage only, `linux::self_update_allowed`; the .deb, .rpm, Snap and Flatpak update through their package manager), Your own server with mDNS, a passphrase app lock, background sync, Dropbox and Google Drive, notification buttons over D-Bus (no typed replies), and the launcher's actions. 1.8.78 adds the lost-writes fix in the library folder (PR 133).
- Built in the Lima VM `folevi-linux` (`packaging/linux/scripts/build-in-lima.sh`, which now stamps the version from version.json first); the snap build needs `sg lxd -c ...`; the amd64 snap builds on Launchpad (`snapcraft remote-build`, about an hour; start it with `PYTHONUNBUFFERED=1` so the Launchpad authorization link shows at once, then approve it in a browser).
- The x86_64 AppImage smoke test runs in the VM's `/srv/jammy-amd64` root: bind-mount proc, sys, dev and dev/pts, extract the AppImage with `unsquashfs -o <offset>` (try each `hsqs` offset; the first can be a false match) and pass `AppRun` to `smoke-test.sh`.
- `packaging/linux/repo/build-apt-repo.sh` and `build-rpm-repo.sh` are the desktop app's; Folevi Server's are `build-server-apt-repo.sh` and `build-server-rpm-repo.sh`.
- Flathub needs a person: its rules bar AI-written manifests and AI-opened submissions (`docs/LINUX.md`).

## Next steps

- Message dialogs need `zenity`: the Linux build uses rfd's portal backend (`apps/desktop/src-tauri/Cargo.toml`, for the file chooser), which runs zenity for every message dialog, so without it (KDE, minimal installs) the update offer and every other message never appear and nothing is logged. Fix: draw message dialogs with GTK on Linux (gtk is already linked), keep the portal for files.
- The amd64 snap at 1.9.80: rerun `snapcraft remote-build --build-for amd64` from `~/snap-remote-1980` in the VM once Launchpad answers, then `snapcraft upload --release=stable`.
- The new features on a real Linux desktop (the update test ran in a VM).
- Dropbox and Google Drive need the owner's app key and Desktop client id (repository variables `FOLEVI_DROPBOX_APP_KEY`, `FOLEVI_GOOGLE_DESKTOP_CLIENT_ID`) and the loopback redirects registered.
- The owner: copy `~/.folevi-linux-signing/folevi-repo-secret.asc` and `~/.folevi-desktop-signing/folevi-updater.key` to the password manager.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
