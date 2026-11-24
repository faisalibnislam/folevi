# Folevi for Windows

Folevi for Windows (`apps/desktop`) is an Electron app for Windows 11 and Windows 10 22H2. It ships as two native
builds, one for Windows on ARM (arm64) and one for Intel and AMD PCs (x64). Neither runs under emulation. It
shows Folevi's own interface, the same export the Mac, iPhone and Android apps carry
(`apps/web/scripts/build-shell.mjs --platform windows`), served from inside the app at `app://folevi`.

It was revived on 2026-11-24 from the Electron Mac app (last version 1.21.0, removed in `7cb6ddda`). The Mac-only
parts stayed behind: the handover to the native Mac app, the Swift helpers (iCloud file coordination, Vision,
Apple's on-device model) and Touch ID.

## The owner's decisions (2026-11-24)

| Question | Answer |
| --- | --- |
| Framework | Electron |
| Architectures | Native arm64 and x64 builds, never x64 on ARM |
| Code signing | Unsigned for now (SmartScreen warns on install). Azure Trusted Signing is the suggested next step |
| Distribution | A download from folevi.com with automatic updates, from the same R2 bucket as the Mac (`folevi-updates`). Microsoft Store maybe later |
| Windows versions | Windows 10 22H2 and Windows 11 |
| Title bar | Folevi's own top bar with Windows' real caption buttons (minimize, maximize with Snap layouts, close) |
| Tabs | Exactly like the web app (it is the web app's tab strip) |

## What it does

- **Folevi Cloud sign-in** in the browser: `/connect`, or straight to Google or Apple through `/app-google`,
  ending on `folevi://auth/callback` (PKCE, `src/authBridge.ts`). The session token is kept with Electron
  `safeStorage` (Windows DPAPI) and never reaches the page.
- **The library on this PC** (local mode): "This device only" in `Documents\Folevi Library`, any folder (a OneDrive
  folder works), or Dropbox and Google Drive once the build has their client ids (`scripts/cloud-config.mjs`). No
  iCloud choice on Windows.
- **Several places at once**: the library and any number of accounts, switched from the account menu (`src/places.ts`).
- **End-to-end encryption** device keys, sealed with DPAPI (`src/e2ee.ts`).
- **Foli AI** with the person's own OpenAI, Anthropic or Google key in local mode (no on-device model on Windows).
- **Notification area icon** (by the clock): click opens Folevi; right-click has Quick Add Task, New Note, recent
  notes, the save state, Settings, updates and Quit. While it's on, closing the window keeps Folevi running there.
- **Quick Add** from any app: **Ctrl+Alt+Space** by default (Alt+Space is Windows' window menu), changeable or off
  in Settings > Desktop app.
- **Windows notifications** for comments, mentions and reminders, and the unread count as a red badge on the
  taskbar button (`src/badge.ts` draws it).
- **folevi:// links**, **one copy at a time** (a second start brings the first forward), **window size and
  position** remembered, **open when you sign in** (starts hidden in the notification area).
- **Spelling**: Folevi's own checker, as on the website (the export keeps its dictionaries).
- **Printing**: Ctrl+P prints the open note's clean page, or the page as it is.
- **Keys** a browser keeps for itself (`src/keys.ts`): Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+1 to 9 for
  tabs; Alt+Left and Alt+Right (and the mouse's side buttons) for Back and Forward; Ctrl+Shift+N new window;
  Ctrl+P; Ctrl+plus, minus and 0 for zoom; F11 full screen; Ctrl+comma Settings.
- **Windows look**: Segoe UI Variable, the page's light or dark look on the caption buttons, Windows' accent
  color on focus rings and selected text (`apps/web/src/app/globals.css`, `:root[data-desktop="windows"]`).
- **Updates** (installed copies only): electron-updater reads
  `https://folevi.com/download/windows/<arch>/latest.yml`, checks a minute after launch and every six hours, and
  installs on quit or from "Restart to update" in the icon's menu.

## How the page knows

The preload (`src/preload.ts`) sets `<html data-desktop="windows">` before the first paint, adds
`window.foleviDesktop` (platform `"windows"`) and, for the built-in interface, `window.foleviShell` (platform
`"windows"`). The web side reads them in `lib/desktop.ts`, `lib/shell/words.ts` ("this PC"),
`components/views/settings/DesktopSection.tsx`, `lib/spelling/web.ts` and `globals.css`.

## Build and test

Everything builds on a Mac (electron-builder cross-builds Windows targets; NSIS 3.12 runs natively on Apple
silicon). `apps/desktop` has its own lockfile, outside the pnpm workspace, with a flat `node_modules`
(`.npmrc`: NSIS crashes on the long paths of pnpm's nested layout).

```bash
cd apps/desktop && CI=true pnpm install --ignore-workspace
pnpm test                                                          # unit tests (vitest)
pnpm typecheck
node ../web/scripts/build-shell.mjs --platform windows --production --required   # the interface, into web/
node scripts/dist.mjs                                              # both architectures, into release/<arch>/
node node_modules/electron/install.js && pnpm build && node scripts/smoke.mjs --out /tmp/folevi-smoke
```

`scripts/dist.mjs` writes, per architecture, what `folevi.com/download/windows/<arch>/` would hold:
`Folevi-Setup-<version>-<arch>.exe` (per-user, one-click, no admin rights), its `.blockmap`, `latest.yml`, and
`Folevi-<version>-<arch>.zip` (portable, for testing: it never registers `folevi://`, opens at sign-in or
updates). `--arch arm64|x64` builds one, `--dir` only the unpacked folders.

`scripts/smoke.mjs` runs the app from source on a scratch data folder (never the person's library), walks the
first launch into "This device only" and checks the Windows bridge, the tab strip, the font and Settings >
Desktop app. Test runs set `FOLEVI_USER_DATA`, which also keeps "On this PC" inside that folder.

Environment switches: `FOLEVI_USER_DATA` (a data folder of its own), `FOLEVI_SHELL=1` (the built-in interface in a
development run), `FOLEVI_LOOK=windows` (the Windows look on a Mac), `FOLEVI_URL` (another website),
`FOLEVI_UPDATE_URL` (another update feed), `FOLEVI_UPDATES=off`, `FOLEVI_SNAPSHOT=<png>` (a picture of the first
window, then quit), `FOLEVI_DEVTOOLS=1` (F12 in a packaged build).

## Versions

Folevi's one version (`version.json`, `scripts/version.mjs`). `apps/desktop/scripts/version.mjs` copies it into
`package.json` as `foleviVersion` ("1.5.68", what the app shows) and `version` (its semver form, "2.0.00" becomes
"2.0.0", which Windows, the installer and electron-updater need). It never changes the version.

## Releasing (not done yet; every step needs the owner's OK)

1. Signing: set up Azure Trusted Signing (or a certificate) and add it to `electron-builder.yml` (`win.azureSignOptions`).
2. Build with `node scripts/dist.mjs` on a clean checkout of the release commit.
3. Upload each `release/<arch>/` folder's installer, blockmap and `latest.yml` to the R2 bucket `folevi-updates`
   under `windows/<arch>/` (served at `folevi.com/download/windows/<arch>/`), installers before `latest.yml`.
4. Add Windows to the download page, and a `windows` minimum to `convex/lib/shellVersions.ts` when one is needed
   (the page has no update gate on Windows until then, `ShellUpdateGate.tsx`).

## Not on Windows yet

- An app lock (the Mac's was Touch ID; Windows Hello would need a native module).
- Bookmark previews in local mode (`foleviShell.http.preview`).
- Reply and Mark as Read buttons on notifications, call recording, text in images, and a Windows Search index.
- Dropbox and Google Drive sync until the build is given their client ids.
- A Microsoft Store (MSIX) package: it has to be built on Windows.

## Testing checklist for the owner

On each PC (one Windows on ARM, one Intel or AMD), with the installer for that PC (`arm64` on ARM, `x64` on Intel
or AMD):

1. Run the installer. SmartScreen says "Windows protected your PC": choose **More info**, then **Run anyway**. Folevi
   should open by itself, with a Folevi shortcut on the desktop and in Start.
2. Check it's native: open Task Manager > Details, right-click a column header > Select columns > **Architecture**.
   Folevi.exe should say ARM64 on the ARM PC and x64 on the other.
3. The window: Folevi's top bar at the top, the three Windows buttons at the top right, not covering the tabs or
   New note. Hover the maximize button: Snap layouts appear. Drag the window by its top bar. Switch Windows
   between light and dark (Settings > Personalization > Colors): the buttons follow.
4. Sign in to Folevi Cloud: your browser opens, sign in, choose Continue; Windows may ask to open Folevi. Your notes
   appear. Try Continue with Google too.
5. Add the library on this PC from the account menu (bottom left): "This device only". Make a note in each place.
6. Tabs: open a note from Home, then another; Ctrl+Tab between them, Ctrl+W closes one, Ctrl+Shift+T brings it
   back. Back (Alt+Left) on a tab you opened from another returns to it, as on the web.
7. Quick Add: from another app press **Ctrl+Alt+Space**, type a task, press Enter. It should be in your Inbox.
8. Close the window with X: Folevi stays by the clock. Click the icon to bring it back; right-click it for the menu.
9. Notifications: have someone mention you or set a reminder; a Windows notification appears and the taskbar
   button shows a red count.
10. Spelling: type "teh" in a note: it gets underlined; right-click it for suggestions.
11. Ctrl+P on a note: Windows' print dialog with the clean page.
12. Restart Windows with "Open when you sign in" on (Settings > Desktop app): Folevi starts in the notification area.
13. Open `folevi://new` from the Run box (Windows+R): a new note.
14. Uninstall from Settings > Apps: your notes in Documents\Folevi Library and in your account stay.

Tell me anything that looks off, with a screenshot (Windows+Shift+S) if you can.
