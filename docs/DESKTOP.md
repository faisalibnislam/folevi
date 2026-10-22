# Folevi for Mac

Folevi for Mac is the web app in a window of its own: a small Electron shell (`apps/desktop`) that loads
https://app.folevi.com. Every feature, behaviour and pixel comes from the site, so the Mac app matches the
web 100% the moment a web change ships, with no second client to port to. The shell only adds what a browser
tab can't do.

The native Swift app it replaces is archived on the git tag `native-mac-archive` (and the branch
`native-mac-wip`). It is no longer on `main`.

## What the shell adds

- **Quick Add** from any app: ⌥Space by default, changeable (or off) in Settings > Desktop app. A small
  floating window shows the web's Quick add task form (`/quick-add`); clicking elsewhere or Escape puts it
  away, and a task added says where it went with a Mac notification.
- **Menu bar icon** (can be turned off): Quick Add Task, New Note, recent notes, the save state ("All
  changes saved", "Offline: changes are kept on this Mac"...), Open Folevi, Settings and Quit.
- **Open at login** (on by default). The main window opens as on any launch: macOS can only say a launch was
  at login through the login item service, which can hang the app on recent macOS, so the shell never asks
  it at startup and only applies the setting when it changes. A folevi:// link that opens Folevi shows just
  what it names. Closing the main window hides it; ⌘Q quits. Opening Folevi again brings the running one
  forward.
- **Mac notifications** for comments, mentions and reminders while Folevi isn't the app in front, and the
  **Dock badge** with the unread count. Clicking a notification opens the page it's about.
- **Seamless title bar**: no title bar of its own. The page keeps an empty `.ui-traffic-space` in the
  sidebar's top bar (or the tab strip when the sidebar is hidden) and reports where it is, so the window
  buttons sit there and move with the sidebar.
- **Menus**: File > New Note (⌘N), Quick Add Task, New Window (⇧⌘N); a Go menu (Back ⌘[, Forward ⌘],
  Notes, Tasks, Calendar); Folevi > Settings (⌘,) opens Settings > Desktop app; Help opens Folevi Help.
- Links to anywhere but Folevi open in the default browser; Folevi's own "open in new tab" opens a new
  window. The window's size and position are remembered.
- **Record a call** (1.3): the audio recorder asks Microphone or Call (mic and Mac sound). A call answers the
  page's `getDisplayMedia` with the whole screen and this Mac's sound (`audio: "loopback"`, in
  `setDisplayMediaRequestHandler`); the page drops the picture at once and mixes the system sound with the
  microphone in an AudioContext (`apps/web/src/lib/callCapture.ts`), reminding the person to tell everyone on
  the call. macOS asks for Screen & System Audio Recording the first time (and may ask to reopen Folevi); without it,
  the recorder says so and offers to open that System Settings pane.

- **Search in images** (1.15): `folevi-text` (`native/recognize-text.swift`, built universal by
  `scripts/build-helper.mjs` into `native-build/`, copied into Resources and signed with the app) reads the
  words in an image with Vision. The page sends an image's bytes (`recognizeText`, `desktop:recognize-text`);
  the main process checks the origin and size, runs the helper for one image at a time with the bytes on
  stdin and a 30 second limit (`src/textRecognition.ts`), and answers with the text. Nothing is sent anywhere.

## The bridge

The page gets one object, `window.foleviDesktop` (`apps/desktop/src/preload.ts`): the Dock badge,
notifications, recent notes and save state for the menu bar, the desktop settings, where to put the window
buttons, the Quick Add window's size and close, and a listener for menu commands (New Note, navigate). The
preload also sets `data-desktop="mac"` on `<html>` before the first paint. The main process
(`apps/desktop/src/main.ts`) ignores any call that doesn't come from the app's origin and checks every
value it receives.

On the web side:

- `apps/web/src/lib/desktop.ts`: the bridge's types and `desktop()` (absent in a browser, so nothing runs).
- `apps/web/src/components/app/DesktopBridge.tsx`: feeds the badge, notifications, recent notes and save
  state; places the window buttons; runs the menus' commands.
- `apps/web/src/components/app/DesktopQuickAdd.tsx`: the Quick Add window (the `/quick-add` route).
- `apps/web/src/components/views/settings/DesktopSection.tsx`: Settings > Desktop app (shortcut, open at
  login, menu bar icon, notifications). These settings live on the Mac, not in the account.

## Security

- Sandboxed renderer with context isolation, no Node integration, no `<webview>`.
- Navigation to another origin is blocked in the window and handed to the browser (http, https and mailto
  only).
- Permissions are granted only to the app's origin, and only: the microphone (audio only, for audio notes),
  screen capture with system sound (only through the display media handler, for recording a call), the
  clipboard, full screen and notifications. Everything else is refused. The page can open one System Settings
  pane (Screen & System Audio Recording) by name, never a URL it supplies.

## End-to-end encryption

The Mac's device keys for end-to-end encryption (docs/E2EE_DESIGN.md §6.2, §6.11) live in the main process,
`apps/desktop/src/e2ee.ts`:

- An X25519 key pair (the account master key is sealed to it as an FLS1 box) and an Ed25519 key pair, made on
  the page's first ask. The private halves are sealed with `safeStorage` (a Keychain key for this app) in
  `userData/e2ee/device.bin`; the device id (`mac-<ulid>`) and the public halves are in
  `userData/e2ee/device.json`. Keys another Mac's Keychain can't open, or a `device.json` whose public keys
  don't match, are replaced (the page then asks to approve this Mac again), never trusted. Without
  `safeStorage` nothing is written and the calls fail with `unavailable`.
- The page reaches them as `foleviShell.e2ee` in the built-in interface and `foleviDesktop.e2ee` on the
  website the app shows (`preload.ts`, channels `shell:e2ee-*`, origin-checked with `fromFolevi` in
  `main.ts`): `deviceKeys()`, `open(box, context)` (FLS1 open; the one secret that crosses is the account
  master key, which the page imports as non-extractable keys and zeroes), `sign(kind, body)` (FST1),
  `reset()`, and `settings()` / `setTouchId(on)` for "Ask for Touch ID to unlock encrypted notes"
  (`userData/e2ee/prefs.json`; turning it on or off asks for Touch ID, and windows opening within 30 seconds
  of a yes don't ask again). Errors carry only a code and a fixed message, never anything about a key or a box.
- The web side is `apps/web/src/lib/e2ee/keys/macBridge.ts`. Passkeys aren't offered in the app (§14 Q2).

Checks after a build (§11.5): `cd apps/desktop && pnpm test` (`src/e2ee.test.ts` opens WP1's vector boxes and
checks the signed bytes against its vector signatures), then rebuild, install to /Applications, unlock, quit,
reopen (no prompt), remove the Mac in Settings > Devices on the web, and the Mac asks to unlock.

## Offline

The same as the web: the site's service worker serves the app and IndexedDB keeps notes and queued edits.
If nothing is cached yet (first launch offline), the shell shows its own offline page with Try again.

## Signing

Since 2026-10-22 the owner has the Apple Developer Program (team `7K32QQ2FX8`). `pnpm release` (this Mac
only) signs with "Developer ID Application: Abu Mohammad Faisal (7K32QQ2FX8)", hardened runtime, no
notarization, arm64. `pnpm publish` (for everyone: universal, notarized, stapled) uses the same certificate
and the notarization credentials saved once with
`xcrun notarytool store-credentials folevi-notary --apple-id <Apple ID> --team-id 7K32QQ2FX8`
(or `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`). Config: `apps/desktop/electron-builder.yml`,
`apps/desktop/electron-builder.dist.yml` and `apps/desktop/build/entitlements.mac.plist`.

## Commands

`apps/desktop` sits outside the pnpm workspace and has its own lockfile.

```bash
cd apps/desktop && pnpm install --ignore-workspace
```

```bash
pnpm dev        # against the local web app (FOLEVI_URL=http://app.localhost:3000)
pnpm typecheck
pnpm test       # settings, URLs and window state (no Electron needed)
pnpm release    # next version, build, sign, replace /Applications/Folevi.app and relaunch it
pnpm release:dry-run   # the same build, to a temporary folder: no bump, nothing installed or opened
```

`pnpm release` (`scripts/release.mjs`) builds the interface built into the app as the production build
(`apps/web/scripts/build-shell.mjs --production`: Folevi's production deployment and website, never
`.env.local`'s development values) into `web-release/`, packages the app with that as `Resources/web`
(`scripts/builder.mjs`), and checks the packaged `Resources/web/shell/build.json` says production and this
version before installing. `web/` keeps the development export (`pnpm shell`) for `pnpm start` and the e2e
specs. The dry run prints where everything went; `E2E_DESKTOP_APP=<that>/Applications/Folevi.app` runs
`apps/web/e2e/desktop-windows.spec.ts` against the packaged copy. `FOLEVI_OFFLINE=1` starts any build with no
network at all (a packaged app can't load the `electron -r` fixture the development runs use).

Every `pnpm release` bumps the version first (`scripts/bump-version.mjs`): 1.1.0, 1.2.0, 1.3.0 and so on,
the number after "1." going up by one. The app's version (About Folevi) comes from `package.json`; commit
the bump with the build.

`FOLEVI_URL` points the shell at another origin; `FOLEVI_USER_DATA` gives a run its own sign-in and
settings (used by tests). The end-to-end test drives the real shell with Playwright:
`apps/web/e2e/desktop-app.spec.ts` (build the shell first with `pnpm build`).

Icons: `packages/design-tokens/scripts/app-icon.mjs` writes `apps/desktop/build/Folevi.icon` (the Icon
Composer document the app is packaged with); `brand-icons.mjs` writes the menu bar template images (`apps/desktop/assets/trayTemplate.png`, `@2x`).
