# Folevi for Windows and Linux

> **Paused (2026-11-28, owner decision):** the Windows, Linux and Android apps are paused. folevi.com shows them as
> coming soon, with no download links. Folevi is available on the Mac, iPhone and iPad (iPhone Duo too), the web and
> Folevi Server. The technical notes below are kept as they are for when the work picks up again.

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
- Library writes with an etag (`ifMatch`) are compare-and-swap: of writers holding one etag, at most one wins,
  whether they are threads, two Folevi windows, or two Folevi copies on one folder. Each write gets its own
  never-repeating modification time (Linux reuses inode numbers and has a coarse file clock, which once let a
  stale etag match), and the final check and rename happen under an OS file lock, `.folevi-tmp/write.lock`. A
  sync app that ignores the lock can still slip in during that microsecond window; drives that can't lock files
  (some network shares) get the in-process guarantee only. Details in `src-tauri/src/library/fs.rs`.
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

## Your own server

A Folevi Server is a place like a Folevi Cloud account (`src/server.rs`, a port of the Mac's ShellServer.swift; keep
the two in step). The page's "Your own server" sign-in calls:
- `placesAddServer { origin }`: the app checks the address (https anywhere; http only for localhost, `.local`,
  names with no dot and private, link-local or 100.64/10 addresses) and fetches the server's
  `/.well-known/folevi.json` itself (10 s, no redirects, 64 KB at most). It refuses with `bad_address`,
  `unreachable`, `not_folevi`, `folevi_cloud`, `server_outdated`, `app_outdated` or `needs_setup`, else every main
  window opens that server's sign-in screen. An account signed in there lives on that server (places.json `server`).
- `placesLocalServers`: Folevi servers on the home network (`_folevi._tcp`, the mdns-sd crate, 2 s).

A server account's session, Convex token and `/api/auth/*` calls go to its server's website; its pages are told the
server's addresses (`places.server`) and may reach only that server's names (page policy, `protocol::shell_csp`).
Every two minutes Folevi checks which of a server's names answers, home names first (Folevi Connect), and moves the
place there without signing anyone out.

An http server on the home network (Windows, `src/lan_bridge.rs`): Windows serves the page from
`https://app.localhost`, so WebView2 blocks http and ws to a LAN address as mixed content. The owner chose the shell
carrying that traffic, so the place keeps its origin and storage. For each plain http address other than this
computer, the app listens on `127.0.0.1` (a port picked from the address, the same each launch). It relays every
request and WebSocket to that one address, with the server's own `Host`. The page is given
`http://127.0.0.1:<port>` for Convex and Convex site, and the page policy allows it. The website address (links,
shared addresses) keeps the server's name. The sign-in screen's own look at an http LAN address still fails on
Windows ("A browser can't always check a server on your home network"), and "Open it anyway" lets the app check it.
`lan_bridge::needed()` is Windows only; turn it on for Linux if WebKitGTK blocks the same traffic.

## Updates

Folevi for Windows and the Linux AppImage update themselves the way Sparkle updates the Mac app (`src/updates.rs`):
a check a minute after launch and every 12 hours, and Check for Updates… in the notification area icon's menu. When
there's a newer version Folevi asks; Install and Restart downloads it, saves notes and reminders, installs and opens
again (Windows's installer runs in passive mode). Later skips that version until the next launch. A .deb, .rpm,
Snap or Flatpak updates through the system (`linux::self_update_allowed`), so it has no menu item and never checks.

- Feed: `https://folevi.com/download/desktop/<target>-<arch>/latest.json` (`windows-x86_64`, `windows-aarch64`,
  `linux-x86_64`, `linux-aarch64`), R2 `folevi-updates/desktop/`, `no-cache`. Each points at the release's versioned
  installer that's already published (`windows/Folevi_<v>_x64-setup.exe`, `linux/Folevi_<v>_amd64.AppImage`...).
- Signing: every update is signed with Folevi's update key (minisign, Ed25519). The private key is at
  `~/.folevi-desktop-signing/folevi-updater.key` on the owner's Mac, outside the repository, with no password; its
  public key is `plugins.updater.pubkey` in `tauri.conf.json`. The app refuses an update whose signature doesn't
  match. Losing the key means shipping the next version as a fresh download, so keep a copy in the password manager.
- Publishing (with the owner's OK, after the installers are on folevi.com):
  `packaging/desktop/publish-update-feed.sh <v> <dir with the release files> [--notes "..."] [--dry-run]`. It checks
  the hosted installer is byte for byte the local one, signs it and uploads each `latest.json`. Nothing is in CI: the
  key never leaves the Mac.
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
## Background sync

As on the Mac (`src/backsync.rs`, a port of BackgroundSync.swift): every place no window shows (each account but the
open one, and the library when another place is open) syncs in a hidden "runner" window (`runner-<place>`, the page
at `/place-sync?place=<id>`, `places.background` true). Runners are woken only for a reason and closed once nothing
waits, so many accounts don't keep many pages open:
- the place left the screen; the library's folder changed (3 s debounce); its unread count went up; or a catch-up
  every 10 minutes, one place at a time, the one synced longest ago;
- a woken page stays at least 15 s, goes when it says nothing waits, after 2 minutes if it never says, and after
  10 minutes with work still waiting (`FOLEVI_BACKGROUND_*` change these, as on the Mac).

The unread count of each background account is asked natively every minute (every three while no Folevi window is
in front): `POST <convex>/api/query notifications:unreadCount` with the account's Convex token. It feeds the place
switcher's dots and the taskbar badge, and wakes the page to show the notification. Runners are off in test runs
(`FOLEVI_USER_DATA`) unless `FOLEVI_RUNNERS=1`. A Folevi Server account's count comes from its own server's Convex.
Not yet: closing idle runners on low memory.
## Jump List and launcher actions

Right-click Folevi in the Windows taskbar or Start menu: New Note, Quick Add Task and Today's Tasks
(`src/jumplist.rs`, set once per launch). Linux's launchers show the same three from the .desktop file's actions
(`packaging/linux/folevi.desktop.hbs`, in the .deb, .rpm, AppImage, Snap and Flatpak). Each opens a folevi:// link,
which a running Folevi receives through the single-instance plugin.
## Dropbox and Google Drive

The library can sync through Dropbox or Google Drive as on the Mac (`src/cloud.rs`, a port of ShellCloud.swift).
The syncing is the shared code in the page (packages/cloud-folders, bundled by `apps/ios/scripts/bundle-cloud.mjs`
and put in every page by lib.rs). The shell signs in, keeps the tokens sealed in the secret store
(`cloud.dropbox`, `cloud.googleDrive`; never readable by the page), refreshes them, and makes the page's requests
only to the provider's own hosts.

Sign-in is OAuth with PKCE in the browser, ending on a loopback address Folevi listens on (no secret):
- Dropbox: `http://127.0.0.1:41753/` (or `:41754/`, `:41755/`). The Dropbox app needs those three redirect URIs and
  "Allow public clients (Implicit Grant & PKCE)" (docs/LOCAL_MODE.md has the checklist).
- Google: a "Desktop app" OAuth client (any `http://127.0.0.1:<port>/` works; the Mac's iOS client doesn't).

Owner step before it shows up: set the public client ids as repository variables `FOLEVI_DROPBOX_APP_KEY` and
`FOLEVI_GOOGLE_DESKTOP_CLIENT_ID` (and for local builds, the same names in the environment of
`packaging/linux/scripts/build-in-lima.sh`). Without them Dropbox and Google Drive aren't offered.
## Notification actions

As on the Mac (`src/notify.rs`): a comment or mention has Reply (typed in the toast, Windows only: Linux's
notification protocol has no typed replies) and Mark as Read; an assigned task Open and Complete; a task's
reminder Complete, Snooze 1 Hour, Snooze Until This Evening and Snooze Until Tomorrow; anything else Mark as Read.
Windows groups a note's toasts together in Action Center. A button reaches the open place's page as the command
`{ type: "notification", action, id, kind, path, text?, thread? }` (DesktopBridge.tsx useNotificationActions,
which now does Complete and Snooze too, for the Mac as well); a place with no page open hears nothing, as on the Mac.
## Recording a call (Windows)

The recorder's "Record a call" (the microphone and everything the PC plays) works in Folevi for Windows the way it
did in the Electron app: WebView2's screen picker offers "Share system audio", the recorder keeps only the sound
and mixes it with the microphone (apps/web/src/lib/callCapture.ts; `foleviDesktop.callCapture`). If no sound comes
with the capture, Folevi says to choose the screen and turn on Share system audio. Linux records the microphone
only (WebKitGTK's screen capture has no system sound). Not tried on a real PC yet.
## Shortcuts and opening attachments

Beyond the tab, window and zoom keys, Folevi for Windows and Linux has the Mac's menu shortcuts with Ctrl (host.js
keyAction): Ctrl+N New Note, Ctrl+Alt+Shift+N New from Template, Ctrl+Shift+F Search, Ctrl+/ Keyboard Shortcuts,
Ctrl+Shift+] and [ next and previous tab, Ctrl+Alt+C Calendar, Ctrl+Alt+\ Focus, and on Linux Ctrl+Q Quit. Ctrl+Alt
keys are left alone when they're AltGr. Formatting keys are the editor's own.

An attachment's Open button (the Mac's Quick Look) opens a copy in the app that opens its kind: the copy goes to
`<temp>/Folevi Open/`, emptied at the next launch.
## Windows open again where they were

As on the Mac (WindowRestore.swift): Folevi keeps the main windows it has open and the page each shows in
`windows.json` (`[{ label, path }]`, saved when focus leaves a window, when one closes and at Quit) and opens them
again at launch; the window-state plugin puts each back at its size and position by label. Quick Add, background
pages and internal pages open at /documents instead. Tabs come back from the page's own storage, as before.
## Share and text in images (Windows)

The note's Share dialog has Share… beside Copy link in Folevi for Windows: Windows' Share sheet with the note's link
(`src/winshare.rs`, DataTransferManager in front of Folevi's window). Text in images (search in files) is read with
Windows.Media.Ocr when a recognition language is installed (`foleviDesktop.recognizeText`; 25 MB, the engine's
largest size, 30 s and 100,000 characters at most). Linux has neither (no standard share sheet, no text recognition
built in), so the page doesn't offer them there.

## Not done yet

- Signing (Windows), uploading to R2, a download page, Flathub submission (`packaging/linux/flatpak/com.folevi.Folevi.yml`
  needs the release's .deb addresses and checksums; docs/LINUX.md), the Microsoft Store.
- Dropbox and Google Drive sign-in on this platform (the library's cloud copy is ported; the sign-in flow isn't).
- Notification actions, call recording, text in images.
- An app lock, notification actions, call recording, text in images.
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
