# Folevi for Mac

Folevi for Mac (`apps/mac`) is a native AppKit app that shows Folevi's own interface in the system's web view
(`WKWebView`). The interface is the web app's built-in export (`apps/web/scripts/build-shell.mjs`), served from
inside the app at `app://folevi`, so every screen is the same web code that runs on the website and on iPhone and
iPad. The app adds what a browser tab can't do, and reuses the iPhone and iPad app's Swift services (library,
Keychain, E2EE keys, sign-in, Foli AI on the device, places, reminders, cloud) by path.

The design and the reasons are in `docs/MAC_WEBKIT_PLAN.md`. Signing, updates, downloads, the move from the
Electron app and the release steps are in `docs/MAC_RELEASE.md`.

History: from 2026-10-09 to 2026-10-23 Folevi for Mac was an Electron app (`apps/desktop`, last version 1.21.0).
It was removed from the repository when the native app shipped; the native app takes over an Electron install in
place (same bundle id, team and support folder, `docs/MAC_RELEASE.md` section 1). The Electron code is in the git
history before the commit that removed it. An earlier native Swift app is archived on the tag
`native-mac-archive`.

## What the app adds

- **Quick Add** from any app: ⌥Space by default, changeable (or off) in Settings > Desktop app. A floating panel
  (`Chrome/QuickAddPanel.swift`) shows the web's Quick add task form (`/quick-add`).
- **Menu bar icon** (can be turned off, `Chrome/StatusItem.swift`): Quick Add Task, New Note, recent notes, the save
  state, Open Folevi, Settings and Quit.
- **Open at login** (`Services/LoginItem.swift`), **Mac notifications** and the **Dock badge**
  (`Services/Notifications.swift`).
- **Menus** (`Chrome/MenuModel.swift`, `MainMenu.swift`): the full Mac menu bar; page commands go to the page as
  `foleviDesktop` commands and the page says which are on (`setMenuState`).
- **The title bar**: none of its own. The page keeps an empty `.ui-traffic-space` in its top bar and reports where
  it is, so the window buttons sit there and follow it (`Chrome/TitleBar.swift`).
- **Several places at once** (`docs/MULTI_ACCOUNT_PLAN.md`, `App/Places.swift`): the library on this Mac and any
  number of accounts, each window bound to one place, hidden runners keeping the others syncing.
- **Settings window** (`Chrome/SettingsWindow.swift`), **window restore**, **Touch ID app lock**
  (`Services/MacAppLock.swift`), **call recording** (`Services/CallRecorder.swift`), **text in images**
  (`Services/TextRecognition.swift`, Vision in process), drag out, printing, sharing, Services, Spotlight and
  Shortcuts (`Services/`).
- **Updates** with Sparkle 2 (`Updates/Updater.swift`), from `https://folevi.com/download/mac/appcast.xml`.

## The bridge

The page gets the same two objects it gets in every native app: `window.foleviShell` (the built-in interface's
host: library, sign-in, keys, Foli AI, places; `apps/web/src/lib/shell/types.ts`) and `window.foleviDesktop` (the
Mac's chrome: badge, notifications, menus, Quick Add, settings, window buttons; `apps/web/src/lib/desktop.ts`).
`Bridge/mac-bridge.js` sets both up before the first paint, with `data-desktop="mac"` and
`data-mac-engine="webkit"` on `<html>`. `Bridge/MessageRouter.swift` accepts calls only from the app's own main
frame and checks every value; `ShellRouter.swift` and `DesktopRouter.swift` answer them.

On the web side: `apps/web/src/lib/desktop.ts`, `components/app/DesktopBridge.tsx`, `DesktopQuickAdd.tsx`, and
Settings > Desktop app (`components/views/settings/DesktopSection.tsx`). Those settings live on the Mac.

## Builds

| Build | Bundle id | Support folder | URL scheme | Installed |
| --- | --- | --- | --- | --- |
| Debug (`node apps/mac/scripts/build.mjs`) | `com.folevi.mac.dev` ("Folevi Dev") | `~/Library/Application Support/Folevi Dev`, or `FOLEVI_USER_DATA` | `folevi-dev://` | never; runs from `apps/mac/build/` |
| Release (`release.mjs`, `publish.mjs`) | `com.folevi.mac` | `~/Library/Application Support/Folevi` | `folevi://` | only by the owner |

`App/Paths.swift` is the only place that knows these. `FOLEVI_URL` points a run at another website (the dev
server), `FOLEVI_USER_DATA` gives it a folder of its own, `FOLEVI_SHELL_DIR` another export.

The Debug build reads the built-in interface from `apps/mac/web` (git-ignored), which
`node apps/web/scripts/build-shell.mjs` fills; a release carries the production export in `Resources/web`.

## Commands

```bash
node apps/web/scripts/build-shell.mjs          # the built-in interface, into apps/mac/web
node apps/mac/scripts/build.mjs                # the Debug app (XcodeGen project, then xcodebuild)
node apps/mac/scripts/build.mjs --test         # and the XCTests (FoleviTests)
node apps/mac/scripts/mac.mjs launch           # opens the Debug app on its own data folder
node apps/mac/scripts/mac.mjs eval "return location.pathname"
```

`mac.mjs` drives the Debug app from scripts (eval, screenshots, menus, Quick Add, Settings, places: see its header
and `Chrome/ChromeEval.swift`). The end-to-end tests use it: `apps/web/e2e/mac-app.spec.ts`
(`E2E_MAC_APP=<path to Folevi Dev.app>` for another build):

```bash
cd apps/web && E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/mac-app.spec.ts --project account --workers=1
```

A test host launched by xcodebuild can't open files in `~/Documents` until macOS has been told it may; until then
run the XCTests with derived data and a copy of the fixtures outside `~/Documents` (`docs/MAC_RELEASE.md`,
"Testing on this Mac").

Icons: `packages/design-tokens/scripts/app-icon.mjs` writes the Icon Composer document the iPhone, iPad and Mac
apps share (`apps/ios/ios/App/App/AppIcon.icon`); `brand-icons.mjs` writes the menu bar template images
(`apps/mac/Folevi/Chrome/StatusItemTemplate.png`, `@2x`).
