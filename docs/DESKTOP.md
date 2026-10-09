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
  the clipboard, full screen and notifications. Everything else is refused.

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
pnpm release    # build, sign, replace /Applications/Folevi.app and relaunch it
```

`FOLEVI_URL` points the shell at another origin; `FOLEVI_USER_DATA` gives a run its own sign-in and
settings (used by tests). The end-to-end test drives the real shell with Playwright:
`apps/web/e2e/desktop-app.spec.ts` (build the shell first with `pnpm build`).

Icons: `packages/design-tokens/scripts/brand-icons.mjs` writes `apps/desktop/build/icon.icns` and the menu
bar template images (`apps/desktop/assets/trayTemplate.png`, `@2x`).
