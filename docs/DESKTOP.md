# Folevi for Mac (and Windows)

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
- **Open at login** (on by default, quietly: no window, ready for Quick Add). Closing the main window hides
  it; ⌘Q quits.
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

## Offline

The same as the web: the site's service worker serves the app and IndexedDB keeps notes and queued edits.
If nothing is cached yet (first launch offline), the shell shows its own offline page with Try again.

## Signing

Built for this Mac only: signed with the personal Apple Development certificate (team `558GMKM4KY`),
hardened runtime, no notarization, arm64. It isn't for sharing. Config: `apps/desktop/electron-builder.yml`
and `apps/desktop/build/entitlements.mac.plist`.

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
```

Every `pnpm release` bumps the version first (`scripts/bump-version.mjs`): 1.1.0, 1.2.0, 1.3.0 and so on,
the number after "1." going up by one. The app's version (About Folevi) comes from `package.json`; commit
the bump with the build.

`FOLEVI_URL` points the shell at another origin; `FOLEVI_USER_DATA` gives a run its own sign-in and
settings (used by tests). The end-to-end test drives the real shell with Playwright:
`apps/web/e2e/desktop-app.spec.ts` (build the shell first with `pnpm build`).

Icons: `packages/design-tokens/scripts/brand-icons.mjs` writes `apps/desktop/build/icon.icns` and the menu
bar template images (`apps/desktop/assets/trayTemplate.png`, `@2x`). `apps/desktop/scripts/windows-icons.mjs`
writes the Windows ones (below).

## Folevi for Windows

The same shell, built for Windows 10 and 11 on x64 and arm64 PCs. Not distributed yet (nothing on the site
mentions it): build it, install it on a PC, try it.

### What differs

Everything that differs is in `apps/desktop/src/platform.ts` (plain functions, tested in `shell.test.ts`);
`main.ts` and `preload.ts` branch on `process.platform === "win32"`.

- **Window**: still no title bar of its own, but Windows draws its minimize, maximize and close buttons
  (`titleBarOverlay`) at the top right, over the page, 56 px tall (down to the bottom of the tab strip),
  with no fill of their own and symbols that follow light and dark. There are no traffic lights to place,
  so `placeWindowButtons` isn't used. The preload marks `data-desktop="windows"`; the page then shows no
  `.ui-traffic-space` (the sidebar keeps the logo, as in a browser), keeps the same draggable top bars, and
  ends the tab strip before the buttons
  (`.ui-clear-window-controls`, `right: var(--ui-window-controls) - 4px`). `DesktopBridge` sets
  `--ui-window-controls` from `navigator.windowControlsOverlay.getTitlebarAreaRect()` and updates it on
  `geometrychange` (wider buttons with larger text or scaling); 138 px until then.
- **Menus**: no menu bar (Windows apps like this one have none), but a hidden application menu keeps the
  shortcuts: Ctrl+N new note, Ctrl+Shift+N new window, Ctrl+, Settings, Ctrl+R reload, Ctrl+Shift+I
  developer tools, zoom, F11 full screen, Alt+Left and Alt+Right back and forward. Help > About Folevi shows
  Windows' About box. The taskbar button's jump list has New Note and Quick Add Task.
- **Quick Add**: Ctrl+Alt+Space by default (Alt+Space opens every window's system menu on Windows). Only a
  first launch gets it: a saved shortcut is kept. Settings > Desktop app records and shows shortcuts the
  Windows way ("Ctrl+Alt+Space", the Windows key as "Win").
- **System tray** instead of the menu bar: the round mark in colour (`assets/tray.ico`). A click opens Folevi,
  a right click shows the same menu as on the Mac. With the tray icon on, closing the main window keeps Folevi
  running there; with it off, closing the main window quits (nothing would show it's still running).
- **Notifications**: Windows toasts. The app sets its AppUserModelID to `com.folevi.app` (the installer's
  Start menu shortcut carries the same id), which toasts need. Unpackaged development runs may not show them.
- **Unread count**: Windows has no number badge, so the taskbar button gets a small red dot while anything
  is unread (`setOverlayIcon`, drawn in code: `badgeDot`), with the count as its description for screen
  readers.
- **folevi:// links**: Windows passes them as an argument: to a running Folevi through `second-instance`, and
  to one starting up in `process.argv` (`linkFromArgv`). The installer registers the scheme, and the
  installed app registers itself again at launch (`setAsDefaultProtocolClient`).
- **Open at sign-in**: Windows can't tell a launch at sign-in from any other, so the login entry passes
  `--opened-at-login` and Folevi starts quietly when it sees it.
- **Recording a call** works the same way: Electron's `audio: "loopback"` captures everything the PC plays.
  Windows asks for no permission, so `screenAccess` says "granted", there's no System Settings button, and a
  failure says so plainly. The recorder says "this PC" instead of "this Mac".
- **Updates**: none yet. `src/updates.ts` only runs on macOS (Squirrel.Mac and a Developer ID check). A new
  version is installed over the old one; sign-in and settings (`%APPDATA%\Folevi`) are kept.
- Single instance, the offline page, window position, drag a note out (to File Explorer) and the security
  rules are the same code on both.

### Build

```bash
cd apps/desktop && pnpm install --ignore-workspace
pnpm package:win   # pnpm build, then electron-builder --win --x64 --arm64 --config electron-builder.win.yml
```

It builds on Windows, on a Mac (no Wine needed) and in CI. Out come two NSIS installers in
`apps/desktop/release-win/` (gitignored): `Folevi-<version>-x64-setup.exe` and
`Folevi-<version>-arm64-setup.exe`, about 106 to 112 MB each. The CI job `desktop-windows` (on
`windows-latest`) typechecks, runs the shell's tests and builds both, kept as the run's artifact for a week.

Config: `apps/desktop/electron-builder.win.yml` (app id `com.folevi.app`). The installer is a short wizard
(`oneClick: false`), installs for the current user by default with no administrator prompt
(`%LOCALAPPDATA%\Programs\Folevi`; installing for everyone is offered), and makes Start menu and desktop
shortcuts. Uninstalling keeps sign-in and settings.

Icons: `node scripts/windows-icons.mjs` (from `apps/desktop`) renders the round mark into `build/icon.ico`
(16 to 256 px: the app, installer and shortcuts), `assets/tray.ico` (16 to 48 px) and
`assets/icon-48.png` (the About box). The Mac builds leave those out.

### Signing

Not signed yet. Until it is, Windows SmartScreen stops the installer ("Windows protected your PC": More
info > Run anyway) and some antivirus tools are wary of it. To sign: buy a code signing certificate (an OV or
EV certificate from a certificate authority, or Azure Trusted Signing), then build with `CSC_LINK` and
`CSC_KEY_PASSWORD` set (or add `win.azureSignOptions`) and put the certificate's name in
`win.signtoolOptions.publisherName`. SmartScreen's warning fades as a signed installer builds reputation
(immediately with EV and Trusted Signing).

### Trying it

Only on a real Windows PC (or a Windows VM; on an Apple silicon Mac, Windows 11 on ARM runs the arm64
installer). Worth checking there: the window buttons sit at the top right and the tab strip ends before
them, in light and dark; Ctrl+Alt+Space; the tray icon's click and menu; a toast and the taskbar's red dot;
a folevi:// link with Folevi closed and open; open at sign-in; recording a call.
