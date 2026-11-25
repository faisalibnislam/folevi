# Folevi for Linux

Folevi for Linux is the shared Tauri 2 desktop shell (the same one Folevi for Windows uses) around the Folevi web
app, shown in the system's own web view, WebKitGTK. Small download, low memory, no bundled browser.

Owner's direction (2026-11-24): one web app everywhere with system web views; one session per platform. The
shared shell is `apps/desktop` (docs/DESKTOP_APP.md, from the Windows session's `claude/desktop-tauri`); Linux adds
only Linux config, a Linux module, a few `#[cfg(target_os = "linux")]` lines and packaging, so the shell isn't
forked.

Status: **1.5.75 published 2026-11-24** as downloads at `https://folevi.com/download/linux/` (owner's OK in chat):
AppImage, .deb and .rpm for x86_64 and aarch64, stable latest links and SHA256 lists. Repositories live and the Snap
Store under way since 2026-11-25; Flathub blocked by its AI policy (see those sections). No in-app updates yet (no update signing key).

## Where things are

| What | Where |
| --- | --- |
| Linux-only Rust (dark mode, Quick Add on Wayland, update gating, NVIDIA fix, AppImage links) | `apps/desktop/src-tauri/src/linux.rs`, called from `lib.rs`, `main.rs`, `notify.rs` behind `#[cfg(target_os = "linux")]` |
| Linux bundle config (Tauri merges it over `tauri.conf.json` on Linux only) | `apps/desktop/src-tauri/tauri.linux.conf.json` |
| Linux file dialogs (portal backend) and portals | `apps/desktop/src-tauri/Cargo.toml`, the `cfg(target_os = "linux")` dependencies |
| CI builds (x86_64, aarch64, Flatpak) | `.github/workflows/desktop.yml` (shared with Windows) |
| Desktop entry template | `packaging/linux/folevi.desktop.hbs` |
| AppStream metadata (software centers, Flathub) | `packaging/linux/com.folevi.Folevi.metainfo.xml` |
| Flatpak manifest | `packaging/linux/flatpak/com.folevi.Folevi.yml` |
| Snap | `packaging/linux/snap/snapcraft.yaml` |
| apt and dnf/zypper repositories | `packaging/linux/repo/` |
| Build machine setup, Lima VM build, Flatpak bundle, smoke test | `packaging/linux/scripts/` |

App id: `com.folevi.Folevi` (Tauri's identifier on Linux, Flatpak, AppStream). The program is `folevi`. Windows
keeps `com.folevi.desktop` and `Folevi.exe`.

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
  installed, so it registers itself at run time (`linux::should_register_links`); the others don't, so there's
  no second handler entry.
- **Tray.** Through libayatana-appindicator (StatusNotifierItem). On Linux a tray icon shows a menu but can't
  react to a plain click, so Open Folevi is the menu's first item. GNOME shows tray icons only with the
  AppIndicator extension, which Ubuntu, Fedora's KDE spin and most others include; stock GNOME on Fedora
  Workstation needs the extension. KDE, Cinnamon, XFCE, Budgie show it without help.
- **Notifications.** Through `org.freedesktop.Notifications` (libnotify's protocol), which every desktop
  provides, and the Flatpak is allowed to talk to.
- **Sign-in storage.** The shell keeps a random data key in the desktop's keyring through the Secret Service
  (GNOME Keyring, KWallet 5.97+, KeePassXC) and seals the sign-in and other secrets with it (`secrets.rs`). With
  no keyring running it keeps the key in a private file (0600) in the app's data folder instead.
- **Quick Add shortcut** (Ctrl+Alt+Space by default), honestly:
  - **X11** (Ubuntu with "Xorg", Mint Cinnamon, XFCE, MATE): works like on Windows.
  - **Wayland** (default on Ubuntu, Fedora, Debian GNOME, KDE Plasma 6): apps can't grab keys there. Folevi asks
    the desktop through the GlobalShortcuts portal, which exists on **KDE Plasma 5.27+**, **GNOME 48+** (Ubuntu
    25.04+, Fedora 42+) and Hyprland; the desktop asks the person once to confirm the keys.
  - **Wayland without the portal** (Ubuntu 22.04 and 24.04 GNOME, older Debian): add a system shortcut that runs
    `folevi folevi://quick-add` (Flatpak: `flatpak run com.folevi.Folevi folevi://quick-add`). GNOME: Settings >
    Keyboard > Keyboard Shortcuts > Custom Shortcuts. Settings > Desktop app shows this command (`linux::system_shortcut_hint`) when the
    portal isn't there.
- **File dialogs.** Through the XDG file chooser portal (tauri-plugin-dialog's `xdg-portal` backend), so they're
  the desktop's own on GNOME and KDE, and work inside the Flatpak. Needs `xdg-desktop-portal` with a backend,
  which every mainstream desktop installs (the .deb recommends it).
- **Files in the Flatpak.** Notes "on this computer" are files in a folder Folevi watches for outside changes
  (Documents/Folevi Library, or one chosen anywhere in home). The document portal can't pass those change events,
  so the Flatpak has `--filesystem=home`, as other notes apps that keep files do on Flathub.
- **Dark mode.** The desktop's light/dark setting comes through the portal's `color-scheme`. WebKitGTK 2.50
  already follows it for the page (checked in the VM: the page turned dark with and without the shell's hook), so
  Folevi's "System" appearance matches the desktop. GTK 3's own parts (title bar, menus, dialogs) don't read it,
  so the shell also reads it and sets the app's theme live (`linux::follow_color_scheme`).
- **NVIDIA.** With NVIDIA's own driver WebKitGTK can show a blank window; the shell sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` there (and only there) before the window opens.

## Memory (2026-11-24)

Measured in the Ubuntu 22.04 arm64 VM with `apps/desktop/scripts/measure.mjs` (first-launch screen, 30 s, PSS
summed over every process), the same way CI measures:

| Build | Total PSS | Folevi | Page's web process | Quick Add's web process | Network |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1.5.75 as published | 446 MB | 119 | 199 | 111 | 17 |
| With Quick Add made on first use (e75ac156) | 369 MB | 120 | 230 | none | 19 |
| And the interface installed as files beside the program (6269a7ff) | 355 MB | 101 | 235 | none | 19 |

CI measured Electron at 348 MB on Linux x86_64 (run 45418586764). Inside Folevi's own process: 27 MB is the program
file itself (90 MB, most of it the web export compiled in), 23 MB is Mesa's software renderer (libLLVM, swrast),
present because the VM and CI have no GPU, about 20 MB WebKit and GTK libraries, the rest its own heap. Ideas not
tried: WebKitGTK's memory-pressure settings. Since 6269a7ff the interface is installed as files beside the program
(`/usr/lib/Folevi/web` for .deb and .rpm, inside the AppImage, `/app/lib/Folevi/web` in the Flatpak), checked in
the VM for all three.
The page itself (the web process) is most of the total and is the same web app Electron runs.

## Building

Linux builds need Linux (WebKitGTK and GTK can't be cross-built from a Mac). Two ways:

1. **On a Mac, in a Lima VM** (what this session used): Ubuntu 22.04 arm64 VM with Rosetta. aarch64 builds
   natively; x86_64 builds in an Ubuntu 22.04 amd64 root inside the VM that runs through Rosetta.
   `packaging/linux/scripts/install-build-deps.sh` installs everything.
2. **CI**: `.github/workflows/desktop.yml` builds Linux x86_64 and aarch64 on GitHub's `ubuntu-22.04` and
   `ubuntu-22.04-arm` machines, checks the packages, measures memory, and makes a Flatpak bundle for each
   (`packaging/linux/scripts/flatpak-bundle.sh`). Artifacts only, kept 7 days.

Then, from `apps/desktop`: `pnpm exec tauri build --bundles appimage,deb,rpm` (or `cargo tauri build` in
`src-tauri`). Updater files are off until the owner approves an update signing key; then the build needs
`TAURI_SIGNING_PRIVATE_KEY` (kept in the owner's password manager, never in the repo). `packaging/linux/scripts/smoke-test.sh` launches a build headless and screenshots it.

## Releasing

1. Stamp the version: `apps/desktop/RELEASE_VERSION` (until version.json records it), then
   `node apps/desktop/scripts/version.mjs`.
2. Build: `packaging/linux/scripts/build-in-lima.sh <out>` on the Mac (or the CI artifacts), with the web export
   built for that version (`build-shell.mjs --platform windows --production --app-version <v>`).
3. Smoke-test each architecture's .deb and AppImage in the VM (`smoke-test.sh`; x86_64 inside `/srv/jammy-amd64`).
4. With the owner's OK: `packaging/linux/scripts/upload-release.sh <v> <out>` (R2 `folevi-updates/linux/`).

| Latest link | File |
| --- | --- |
| https://folevi.com/download/linux/Folevi-x86_64.AppImage | AppImage, Intel/AMD |
| https://folevi.com/download/linux/Folevi-aarch64.AppImage | AppImage, ARM |
| https://folevi.com/download/linux/Folevi-amd64.deb | .deb, Intel/AMD |
| https://folevi.com/download/linux/Folevi-arm64.deb | .deb, ARM |
| https://folevi.com/download/linux/Folevi-x86_64.rpm | .rpm, Intel/AMD |
| https://folevi.com/download/linux/Folevi-aarch64.rpm | .rpm, ARM |
| https://folevi.com/download/linux/SHA256SUMS.txt | checksums |

Versioned copies stay beside them (`Folevi_1.5.75_amd64.AppImage`, `Folevi_1.5.75_arm64.deb`,
`Folevi-1.5.75-1.x86_64.rpm`, `SHA256SUMS-1.5.75.txt`...).

## Repositories (apt, dnf, zypper)

Owner's OK 2026-11-25 ("go ahead with ... our own apt/dnf repository").

| | Where | People add it with |
| --- | --- | --- |
| apt (Ubuntu, Debian, Mint, Pop!_OS, elementary, Zorin) | `https://folevi.com/download/linux/apt`, suite `stable`, amd64 and arm64 | `/etc/apt/sources.list.d/folevi.sources` (`apt/folevi.sources`) and the key at `/usr/share/keyrings/folevi-archive-keyring.gpg` |
| dnf and zypper (Fedora, RHEL/Alma/Rocky 9+, openSUSE) | `https://folevi.com/download/linux/rpm/<x86_64\|aarch64>` | `rpm/folevi.repo` in `/etc/yum.repos.d/` or `/etc/zypp/repos.d/` |

Under `/download/` because that path already reaches the R2 bucket (`next.config.ts` rewrite), so the repositories
need no website deploy. Packages and hashed metadata are cached for a year; the indexes are no-cache, though the
site answers `/download/*` with `max-age=300`, so a new release can take up to 5 minutes to show in `apt update`.

**Signing key:** "Folevi Linux Packages <support@folevi.com>", RSA 4096, no expiry, fingerprint
`AEF1 4472 8549 A0B5 9ADC 3A77 67F3 C502 BF6A 5D42`, made 2026-11-25. Public halves in `packaging/linux/repo/keys/`
(shipped in the .deb and .rpm). The private key: the Lima VM `folevi-linux` keeps it in `~/.folevi-repo-gnupg` (no
passphrase, used for unattended signing there) and this Mac has a backup in `~/.folevi-linux-signing/` (0600); the
owner keeps a copy in their password manager. Never in the repository or CI.

**One click with updates:** from the first release after 1.5.77 the .deb and .rpm add the repository on install
(`deb-postinst.sh`, `rpm-postinst.sh`, wired in through `tauri.linux.conf.json`'s `postInstallScript`, the keys
installed under `/usr/lib/folevi/`), the way Chrome and VS Code do, so a double-clicked download keeps updating
through the Software Updater, dnf or zypper. Earlier installs can add the repository by hand (the table above).

**Each release** (after `upload-release.sh`, same OK): in the VM, with `GNUPGHOME=~/.folevi-repo-gnupg`
`FOLEVI_REPO_KEY=AEF144728549A0B59ADC3A7767F3C502BF6A5D42`, run `build-apt-repo.sh <dir with the .debs> ~/repo-out` <!-- gitleaks:allow (public key fingerprint) -->
and `build-rpm-repo.sh <dir with the .rpms> ~/repo-out` (keep `~/repo-out`: earlier versions stay listed), copy
`~/repo-out` to the Mac (`limactl copy -r`) and run `packaging/linux/repo/upload-repos.sh <copy>`.

Tested 2026-11-25 against a local copy of the repositories in the VM (ARM): install and signature checks pass on
Ubuntu 24.04 and Debian 12 (apt), Fedora 41 (dnf) and openSUSE Tumbleweed (zypper).

## Flathub (blocked by Flathub's AI policy)

Owner's OK 2026-11-25, but Flathub's rules stop it as prepared: its Generative AI policy
(https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy, and `AGENTS.md` in
`flathub/flathub`) says Flathub manifests must not contain AI-generated or AI-assisted content even when disclosed,
AI agents must not open or automate submission pull requests or write their text or review replies, and submitters
must disclose AI-generated material in the app and its packaging. `packaging/linux/flatpak/com.folevi.Folevi.yml`
was written by Claude sessions, so it can't be submitted. A Flathub listing needs the owner (or another person) to
write the manifest and the pull request by hand, disclose the AI-generated parts of Folevi, and attach a video of the
Flatpak running on Linux. Claude must not draft, edit or submit any of it.

Our own manifest still builds the test Flatpak bundles in CI (`flatpak-bundle.sh`); it is not for Flathub.
Prepared before the policy was found: the manifest points at the published 1.5.75 .debs, real-app screenshots are
online at `https://folevi.com/download/linux/screenshots/` (also in `packaging/linux/screenshots/`, made by
`scripts/screenshots.sh`), and the metainfo file passes `flatpak-builder-lint appstream`.

## Snap Store

Owner's OK 2026-11-25. The name `folevi` is registered to the owner's account (faisalibnislam), login kept in the
Lima VM (`snapcraft login`, file storage, expires 2027-11-25). `packaging/linux/snap/snapcraft.yaml` repackages the
.deb with the gnome extension (core24); `packaging/linux/scripts/snap-build.sh <.deb> <out>` builds arm64 in the VM
with LXD. amd64: `snapcraft remote-build --build-for amd64 --launchpad-accept-public-upload` from a git folder holding
`snap/snapcraft.yaml`, `icons/` and the amd64 .deb as `folevi.deb` (built on Launchpad; its access is approved in the
browser for a day at a time). Upload: `snapcraft upload --release=stable <snap>`.

- No D-Bus slot (owner's pick 2026-11-25): a `dbus` slot needs a manual Store review (revision 1 was held for it).
  Without it the single-instance plugin can't own `com.folevi.Folevi.SingleInstance` and launches normally, so in
  the snap a second launch or a `folevi://` link opens a second window. The yaml says how to bring it back.
- `password-manager-service` (the keyring) doesn't connect on its own; until the Store grants auto-connection the
  sign-in falls back to the app's data folder. People can run `snap connect folevi:password-manager-service`.
- The launcher and Store icon is the snap's own `meta/gui/icon.png` (from `packaging/linux/icons/512x512.png`).

## App icons

Every Linux package uses `packaging/linux/icons/` (16 to 512 px), made by `apps/desktop/scripts/icons.mjs` from
`apps/desktop/build/icon-1024.png` (the iPhone, iPad and Mac artwork as GNOME's rounded square with a margin), the
same icon as Windows. Until 2026-11-25 they were the web app's `icon-512.png` (full bleed, stray coloured edge
pixels); the published 1.5.75 .deb, .rpm and AppImage still carry that one until the next Linux release.

## Testing

`docs/LINUX-TESTING.md` is the owner's checklist for Ubuntu, Fedora and a Flatpak install.
