# Folevi for Linux

Folevi for Linux is the shared Tauri 2 desktop shell (the same one Folevi for Windows uses) around the Folevi web
app, shown in the system's own web view, WebKitGTK. Small download, low memory, no bundled browser.

Owner's direction (2026-11-24): one web app everywhere with system web views; one session per platform. The
shared shell comes from the Windows session (`claude/desktop-tauri`); Linux adds only Linux config, a Linux
module and packaging, so the shell isn't forked.

Status: **not released.** Test builds only. Nothing is published to Flathub, the Snap Store, folevi.com or any
repository without the owner's OK. Native app releases are paused.

## Where things are

| What | Where |
| --- | --- |
| Linux-only Rust (dark mode, Quick Add on Wayland, update gating, NVIDIA fix, AppImage links) | `src-tauri/src/linux.rs` in the shared shell, behind `#[cfg(target_os = "linux")]` |
| Linux bundle config (Tauri merges it on Linux only) | `src-tauri/tauri.linux.conf.json` (staged in `packaging/linux/`) |
| Desktop entry template | `packaging/linux/folevi.desktop.hbs` |
| AppStream metadata (software centers, Flathub) | `packaging/linux/com.folevi.Folevi.metainfo.xml` |
| Flatpak manifest | `packaging/linux/flatpak/com.folevi.Folevi.yml` |
| Snap | `packaging/linux/snap/snapcraft.yaml` |
| apt and dnf/zypper repositories | `packaging/linux/repo/` |
| Build machine setup, smoke test | `packaging/linux/scripts/` |

App id: `com.folevi.Folevi` (Flatpak, AppStream, the desktop file in the Flatpak). The program is `folevi`.

## Packages and how each installs and updates

| Package | For | Install | Updates |
| --- | --- | --- | --- |
| AppImage | Any distribution | Download, mark executable (or double-click in most file managers), run | In the app (Tauri updater, signed, from folevi.com) |
| .deb | Ubuntu, Debian, Mint, Pop!_OS, elementary, Zorin | Double-click: opens in App Center / Software Install | apt repository once it's live (Software Updater) |
| .rpm | Fedora, RHEL/Alma/Rocky 9+, openSUSE | Double-click: opens in GNOME Software / Discover / YaST | dnf/zypper repository once it's live |
| Flatpak | Any distribution with Flathub (Fedora, Mint and Pop!_OS have it built in) | One click in the software center, once on Flathub | Flathub |
| Snap (optional) | Ubuntu | One click in App Center, once in the Snap Store | Snap Store |

Every package is built for **x86_64** and **aarch64** (ARM laptops such as Snapdragon X, Raspberry Pi 5, Asahi).

Only the AppImage updates itself (`linux::self_update_allowed`). A .deb or .rpm needs root to replace and has a
package manager that owns it; Flatpak and Snap have their stores. Running the in-app updater there would fight
them, so the shell checks the install kind first.

## Requirements

- **WebKitGTK 4.1** (the GTK 3 WebKit Tauri 2 uses), 2.40 or newer recommended. Distributions update WebKitGTK
  with security fixes, so even Ubuntu 22.04 has 2.50 today.
- glibc 2.35 or newer. Builds are made on Ubuntu 22.04, so they run there and on everything newer.
- Supported: Ubuntu 22.04+, Debian 12+, Linux Mint 21+, Fedora 40+, openSUSE Leap 15.6 and Tumbleweed,
  RHEL/Alma/Rocky 9+, Arch (AppImage or Flatpak). Older ones may work with the AppImage but aren't supported.
- **The GTK 3 WebKit is ending.** GNOME 51 is the last GNOME runtime carrying WebKitGTK 4.1 (supported until
  about September 2027), so the Flatpak must move before then. Tauri 3 (alpha in November 2026) makes GTK 4 a
  build option; we follow it when it's stable. Distributions themselves still ship WebKitGTK 4.1 for years.

## Desktop integration

- **Desktop entry and icons.** The .deb and .rpm install `Folevi.desktop` and hicolor icons (32 to 512 px)
  from `folevi.desktop.hbs`, with right-click actions New Note, Quick Add and Today's Tasks (each opens a
  `folevi://` link). The Flatpak renames them to `com.folevi.Folevi`.
- **folevi:// links.** The desktop file declares `MimeType=x-scheme-handler/folevi`, so the desktop sends links
  to Folevi; the single-instance plugin hands a link from a second launch to the running app. The AppImage isn't
  installed, so it registers itself on first run (`linux::register_deep_links`).
- **Tray.** Through libayatana-appindicator (StatusNotifierItem). On Linux a tray icon shows a menu but can't
  react to a plain click, so Open Folevi is the menu's first item. GNOME shows tray icons only with the
  AppIndicator extension, which Ubuntu, Fedora's KDE spin and most others include; stock GNOME on Fedora
  Workstation needs the extension. KDE, Cinnamon, XFCE, Budgie show it without help.
- **Notifications.** Through `org.freedesktop.Notifications` (libnotify's protocol), which every desktop
  provides, and the Flatpak is allowed to talk to.
- **Sign-in storage.** The sign-in is kept in the desktop's keyring through the Secret Service (GNOME Keyring,
  KWallet 5.97+, KeePassXC). If there's no keyring running, the shell keeps it in the app's own data folder and
  Settings says so.
- **Quick Add shortcut** (Ctrl+Alt+Space by default), honestly:
  - **X11** (Ubuntu with "Xorg", Mint Cinnamon, XFCE, MATE): works like on Windows.
  - **Wayland** (default on Ubuntu, Fedora, Debian GNOME, KDE Plasma 6): apps can't grab keys there. Folevi asks
    the desktop through the GlobalShortcuts portal, which exists on **KDE Plasma 5.27+**, **GNOME 48+** (Ubuntu
    25.04+, Fedora 42+) and Hyprland; the desktop asks the person once to confirm the keys.
  - **Wayland without the portal** (Ubuntu 22.04 and 24.04 GNOME, older Debian): add a system shortcut that runs
    `folevi folevi://quick-add` (Flatpak: `flatpak run com.folevi.Folevi folevi://quick-add`). GNOME: Settings >
    Keyboard > Keyboard Shortcuts > Custom Shortcuts. Settings > Desktop app shows these steps there.
- **File dialogs.** Through the XDG file chooser portal (tauri-plugin-dialog's `xdg-portal` backend), so the
  Flatpak sees exactly the files someone picks, with no filesystem permission, and it looks native on GNOME and
  KDE. Needs `xdg-desktop-portal` with a backend, which every mainstream desktop installs.
- **Dark mode.** GTK 3 (and so WebKitGTK) doesn't read the desktop's modern light/dark setting, so the shell reads
  the portal's `color-scheme` and follows it live (`linux::follow_color_scheme`); Folevi's "System" appearance
  then matches the desktop.
- **NVIDIA.** With NVIDIA's own driver WebKitGTK can show a blank window; the shell sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` there (and only there) before the window opens.

## Building

Linux builds need Linux (WebKitGTK and GTK can't be cross-built from a Mac). Two ways:

1. **On a Mac, in a Lima VM** (what this session used): Ubuntu 22.04 arm64 VM with Rosetta. aarch64 builds
   natively; x86_64 builds in an Ubuntu 22.04 amd64 root inside the VM that runs through Rosetta.
   `packaging/linux/scripts/install-build-deps.sh` installs everything.
2. **CI** (for releases): GitHub's `ubuntu-22.04` and `ubuntu-22.04-arm` runners, the same script.

Then, from the shell's folder: `cargo tauri build --bundles appimage,deb,rpm` (with
`TAURI_SIGNING_PRIVATE_KEY` for the updater signature: the key lives in the owner's password manager, never in
the repo). `packaging/linux/scripts/smoke-test.sh` launches a build headless and screenshots it.

## Repositories (plan, not live)

- **apt** at `https://folevi.com/linux/apt` (R2, beside the Mac and Windows downloads): `build-apt-repo.sh` makes
  a signed `stable` suite for amd64 and arm64. People add it with the `folevi.sources` file and the key in
  `/usr/share/keyrings/folevi-archive-keyring.gpg`.
- **dnf and zypper** at `https://folevi.com/linux/rpm/<arch>`: `build-rpm-repo.sh` signs each package and the
  metadata; `folevi.repo` works for both.
- **One click with updates:** once the repositories are live, the .deb and .rpm add them on install
  (`deb-postinst.sh`, `rpm-postinst.sh`, the way Chrome and VS Code do), so a double-clicked download keeps
  updating through the system's updater. They aren't wired into the packages yet: a repository that doesn't
  exist would make `apt update` fail.
- Needs from the owner first: a new GPG signing key for Linux packages (kept in the password manager), and an OK
  to upload to R2.

## Flathub (ready, not submitted)

1. Publish the release .deb files at the URLs in the manifest; fill in their sha256.
2. Put the two screenshots at the URLs in the metainfo file.
3. Verify the app id: Flathub checks that we own folevi.com (a token at
   `https://folevi.com/.well-known/org.flathub.VerifiedApps.txt`).
4. Open a pull request to `flathub/flathub` with the manifest and `flathub.json` (owner's OK first).

## Snap (optional)

`packaging/linux/snap/snapcraft.yaml` repackages the .deb with the gnome extension. Registering the name
`folevi` and uploading need the owner's OK. `password-manager-service` (the keyring) needs a manual Snap Store
review before it connects automatically; until then the sign-in falls back to the app's data folder.

## Testing

`docs/LINUX-TESTING.md` is the owner's checklist for Ubuntu, Fedora and a Flatpak install.
