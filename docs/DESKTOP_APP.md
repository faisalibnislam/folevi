# Folevi for Windows and Linux

Folevi for Windows and Linux (`apps/desktop`) is a Tauri 2 app. It shows Folevi's own interface in the system's web
view, WebView2 on Windows and WebKitGTK on Linux, so it carries no browser of its own. It ships as native builds:

| System | Architectures | Packages |
| --- | --- | --- |
| Windows 10 22H2 and Windows 11 | ARM64, x64 | NSIS installer (ARM64 and x64), MSI (x64) |
| Linux | x86_64, aarch64 | AppImage, .deb (Ubuntu, Debian), .rpm (Fedora, openSUSE), Flatpak (Linux details: docs/LINUX.md) |

The interface is the export every Folevi app carries (`apps/web/scripts/build-shell.mjs --platform windows`, used
for Linux too), compiled into the app and served at `app://localhost` (`https://app.localhost` on Windows).

History: on 2026-11-24 the owner first chose Electron for Windows (PR 58, branch `claude/windows-electron-4ed862`,
kept), then "one web app everywhere" with the Mac app's approach: small, smooth and light. This Tauri app replaced
the Electron one the same day. The Mac keeps its own app; there is no Mac target here.

## The owner's decisions (2026-11-24)

| Question | Answer |
| --- | --- |
| Approach | Tauri 2 with the system web view (not Electron) |
| Architectures | Native builds for each, never x64 emulated on ARM |
| Code signing | Unsigned for now (SmartScreen warns on Windows). Azure Trusted Signing suggested |
| Distribution | A download from folevi.com with automatic updates (R2 bucket `folevi-updates`). Microsoft Store and Flathub maybe later |
| Windows versions | Windows 10 22H2 and Windows 11 |
| Title bar | Windows: Folevi's own top bar with Windows 11-style caption buttons. Linux: the window manager's title bar |
| Builds | On GitHub Actions' native Windows and Linux machines, kept 7 days as workflow artifacts |
| Releases | Paused. Nothing is uploaded, signed or published without the owner |

## How it fits together

- `src-tauri/src/lib.rs`: windows, the `app://` protocol, the tray, Quick Add, places, links, settings, and the two
  commands the page calls: `shell_call` (every `foleviShell` call, with the Mac's `ShellRouter.swift` method names)
  and `desktop_call` (`foleviDesktop`).
- `src-tauri/bridge/host.js`: injected into Folevi's pages. It wraps the shared `apps/ios/ios/App/Native/Shell/
  shell-bridge.js` (the same file the iPhone, iPad and Mac apps use) over Tauri's IPC, adds `window.foleviDesktop`,
  sets `data-desktop` ("windows" or "linux"), draws the caption buttons on Windows, moves the window by the page's
  `.ui-drag` bars, and handles the keys a browser keeps (Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+1 to 9, Alt+Left/Right,
  Ctrl+P, Ctrl+Shift+N, zoom, F11).
- Each page's place and mode are put first in its `<head>` by the protocol (`page_boot`), so switching places only
  loads the page again in the same window.
- Services, each a port of the Electron app's TypeScript (tested against the same vectors and contracts):
  `library/` (files, journal, FLV1 encryption, passphrase, moves, watcher, attachments, the Dropbox and Google
  Drive copy), `auth.rs` (Folevi Cloud sign-in, PKCE, straight to Google or Apple), `places.rs`, `e2ee.rs` (device
  keys), `ai.rs` (Foli AI with the person's own keys), `http.rs` (calendars, bookmark previews), `reminders.rs`.
- Secrets (sessions, AI keys, the unlocked library key, device keys) are sealed with AES-256-GCM under a key kept in
  the system's credential store (Windows Credential Manager, the Secret Service on Linux), or a private file where
  there is none (and always in test runs).

## What it does

- Folevi Cloud sign-in in the browser, the library on this computer ("This device only" in Documents, or any
  folder such as OneDrive's), several accounts and the library at once.
- Notification area icon (tray), Quick Add on **Ctrl+Alt+Space**, notifications that open the page they're about,
  the unread count on the taskbar button (Windows) or the dock (Linux desktops that show one).
- `folevi://` links, one copy at a time, window size and position remembered, open at sign-in (starts hidden in the
  tray), Folevi's own spelling (as on the website), Ctrl+P printing, Segoe UI Variable and the accent color on
  Windows, and the page's light or dark look on the caption buttons.

## Build and test

```bash
cd apps/desktop && CI=true pnpm install --ignore-workspace
node ../web/scripts/build-shell.mjs --platform windows --production --required   # the interface, into web/
cd src-tauri && cargo test && cd ..                                              # Rust tests
pnpm exec vitest run                                                             # the bridge script's tests
(cd src-tauri && cargo build) && node scripts/smoke.mjs                          # a scripted run through local mode
```

`scripts/smoke.mjs` runs the development build on a scratch folder with `FOLEVI_PROBE` and the walk in
`scripts/smoke-flow.js` (works on a Mac too, with the Windows look). Development switches: `FOLEVI_USER_DATA` (a
data folder of its own; it also keeps "On this computer" inside it and skips the credential store),
`FOLEVI_SHELL_DIR` (the export from a folder), `FOLEVI_LOOK=windows|linux`, `FOLEVI_URL`, `FOLEVI_PROBE`,
`FOLEVI_PROBE_SCRIPT`.

Installers are built by `.github/workflows/desktop.yml` on GitHub's machines (Windows x64, Windows 11 ARM64, Ubuntu
22.04 x64 and ARM64, plus a Flatpak bundle), on every push to a `claude/desktop-*` branch and on pull requests that
touch the app. Each run also measures memory against the Electron build of PR 58 on the same machine
(`scripts/measure.mjs`) and lists installer sizes in the run summary.

## Size and memory against Electron (CI run 45443908032, 2026-11-24)

Same machines, same interface, 30 seconds after start on the first-launch screen (`scripts/measure.mjs`). Each Tauri
figure counts only if the app said its page started (`--expect-ready`, "FOLEVI READY"); an earlier run measured a
page that never loaded and looked lighter than it was. Windows: Task Manager's figures (private bytes; the working
set counts shared libraries in every process). Linux: PSS.

| Build | Installer | Private memory | Working set |
| --- | ---: | ---: | ---: |
| Tauri, Windows x64 | 77 MB (MSI 80 MB) | 151 MB | 375 MB |
| Electron, Windows x64 | 182 MB | 207 MB | 433 MB |
| Tauri, Windows ARM64 | 78 MB | 149 MB | 402 MB |
| Electron, Windows ARM64 | 176 MB | (not measured) | |
| Tauri, Linux x86_64 | (Linux session) | 365 MB PSS | |
| Electron, Linux x86_64 | | 349 MB PSS | |

How it got there: Quick Add's window is made on first use (Electron loads it at launch, which is part of its
figure), and the interface is installed as files beside the app instead of compiled into it. With both pages
loaded the two were about even on Windows (214 vs 207 MB private). The installer is less than half Electron's.

## Versions

Folevi's one version (`version.json`): `scripts/version.mjs` copies it into `package.json` (`foleviVersion`, shown
in the app; `version`, its semver form for the installers). Tauri reads `package.json`. It never changes the
version.

## Test download (published 2026-11-24, the owner's OK)

Folevi for Windows 1.5.73, unsigned (Windows warns about an unknown publisher), no automatic updates. The files were
replaced the same day with a fixed build (the first upload opened a blank window):
- Windows on ARM: https://folevi.com/download/windows/Folevi_1.5.73_arm64-setup.exe
  (SHA-256 4a651ed19485222980a790e8393e700a7f5d5d091fd9947cd76e3bfda3d9afa0)
- Intel and AMD: https://folevi.com/download/windows/Folevi_1.5.73_x64-setup.exe
  (SHA-256 326d03bacd9ba24805a6206c53a4c7d64553f21199342e52e47ddd4adddbf5c7)

Stable links that always point at the latest build (cache `no-cache`, like the Mac's `Folevi.dmg`):
https://folevi.com/download/windows/Folevi-arm64-setup.exe and https://folevi.com/download/windows/Folevi-x64-setup.exe.

Uploaded with `npx wrangler r2 object put folevi-updates/windows/<file> --remote` from CI run 45418586764 (the fixed build). The
version came from `apps/desktop/RELEASE_VERSION` (1.5.73) because this branch's version.json predates 1.5.72.

## App lock

As on the Mac (Settings > Library > App lock, `src/applock.rs`): Folevi covers its main windows when it opens, when
you come back after the chosen time away ("Ask again when you come back") and after the computer slept, until you
show it's you. Quick Add stays usable, as on the Mac. The cover is drawn by the shell (`bridge/host.js`, a closed
shadow root, the page under it inert).
- Windows: Windows Hello (a face, a fingerprint or the PIN; `src/hello.rs`), which also confirms turning the lock on
  or off. A PC without Windows Hello can't turn it on, and a lock whose Windows Hello went away is dropped.
- Linux: a passphrase chosen for Folevi's lock when it's turned on, and typed to unlock or to turn it off. lock.json
  keeps its PBKDF2-SHA256 hash, never the passphrase. Forgotten: quit Folevi and delete
  `~/.local/share/com.folevi.Folevi/lock.json` (the lock covers the screen; it encrypts nothing).

"Ask for Windows Hello to unlock encrypted notes" (Settings > Desktop app) asks before the device keys open a box;
a yes counts for 30 seconds (the Mac's Touch ID rule). The choice is kept in the keys' `prefs.json` (`touchId`).
Linux has nothing to ask with, so the switch isn't shown there.

Not covered: Windows locking the screen without sleeping or leaving Folevi (the Mac also watches the screen lock).

## Not done yet

- Updates: the Tauri updater is in the app and points at `folevi.com/download/desktop/<target>-<arch>/latest.json`,
  but stays off until the owner approves an update signing key (it signs every update) and its public key is put in
  `tauri.conf.json`.
- Signing (Windows), uploading to R2, a download page, Flathub submission (`packaging/linux/flatpak/com.folevi.Folevi.yml`
  needs the release's .deb addresses and checksums; docs/LINUX.md), the Microsoft Store.
- Dropbox and Google Drive sign-in on this platform (the library's cloud copy is ported; the sign-in flow isn't).
- Notification actions, call recording, text in images.
- Snap layouts when hovering the maximize button (Windows+Z still works).

## Testing checklist for the owner

Take the build for your PC from the GitHub Actions run (or the copy in Downloads):
- **Windows on ARM:** `Folevi_<version>_arm64-setup.exe`
- **Windows on Intel or AMD:** `Folevi_<version>_x64-setup.exe` (or the `.msi`)
- **Linux:** the `.AppImage`, `.deb` or `.rpm` for x86_64 or aarch64, or the `.flatpak`

1. **Install.** Run the installer. On Windows, SmartScreen says "Windows protected your PC": choose **More info**,
   then **Run anyway**. On Linux, make the AppImage executable (Properties > Executable) or open the .deb or .rpm
   with your software app. Folevi should open.
2. **Check it's native (Windows).** Open Task Manager > Details, right-click a column header, Select columns >
   **Architecture**. Folevi.exe should say ARM64 on the ARM PC and x64 on the other.
3. **Window (Windows).** Folevi's top bar fills the top, with minimize, maximize and close at the top right, not
   covering the tabs or New note. Drag the window by its top bar; double-click it to maximize. Switch Windows
   between light and dark: the buttons follow.
4. **Memory.** In Task Manager, Folevi plus its "WebView2" processes should be far lighter than the Electron test
   build was. Tell me the number you see after a minute of use.
5. **Sign in.** Choose Sign in to Folevi: your browser opens; sign in and choose Continue. Windows or Linux may ask
   to open Folevi; allow it. Your notes appear. Try Continue with Google too.
6. **Library on this computer.** From the account menu (bottom left), add "This device only" and make a note there.
7. **Tabs.** Open two notes from Home; Ctrl+Tab between them, Ctrl+W closes one, Ctrl+Shift+T brings it back,
   Alt+Left goes back.
8. **Quick Add.** From another app press **Ctrl+Alt+Space**, type a task, press Enter. It lands in your Inbox.
9. **Tray.** Close the window: Folevi stays by the clock (Windows) or in the panel (Linux, where your desktop has a
   tray). Click the icon to bring it back; right-click for its menu.
10. **Notifications.** A mention or a reminder shows a notification; clicking it opens the note. The taskbar
    button shows a red count (Windows).
11. **Spelling and printing.** Type "teh" in a note: it's underlined; right-click for suggestions. Ctrl+P prints the
    note.
12. **Links.** Open `folevi://new` from the Run box (Windows+R) or a terminal (`xdg-open folevi://new`): a new note.
13. **Open at sign-in.** With "Open when you sign in" on (Settings > Desktop app), restart: Folevi starts in the tray.
14. **Uninstall.** Your notes in Documents\Folevi Library and in your account stay.

Tell me anything that looks off, with a screenshot if you can.
