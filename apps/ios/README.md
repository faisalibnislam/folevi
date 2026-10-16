# Folevi for iPhone and iPad

The web app (https://app.folevi.com) in a Capacitor shell, the way the Mac app (`apps/desktop`) is the web app in
an Electron window. The native parts are in Swift: a Face ID lock, links that open in an in-app Safari view,
`folevi://` links, haptics, the bridge the page talks to (`window.foleviNative`), and (stage 2) a share
extension, widgets and a Control Center control, App Intents for Siri and Shortcuts, Spotlight and a document
scanner, which reach Folevi through the REST API with a token made for the device, and (stage 3) push
notifications for reminders and mentions through APNs, with Done and Snooze 1 hour. Architecture, App Review
notes and what's left for the Developer Program: [docs/IOS.md](../../docs/IOS.md).

## Targets

| Target | Bundle id | Sources |
| --- | --- | --- |
| App | `com.folevi.ios` | `ios/App/App`, `Shared`, `AppAndWidgets`, `Native` |
| ShareExtension ("Save to Folevi") | `com.folevi.ios.share` | `Shared`, `ShareExtension` |
| FoleviWidgets (widgets, the iOS 18 control) | `com.folevi.ios.widgets` | `Shared`, `AppAndWidgets`, `Widgets` |
| FoleviTests (unit tests, hosted by the app) | `com.folevi.ios.tests` | `Tests` |
| FoleviUITests (share sheet and widget gallery) | `com.folevi.ios.uitests` | `UITests` |

All three products share the App Group `group.com.folevi` and the Keychain group
`$(AppIdentifierPrefix)com.folevi.shared` (each target's `.entitlements`; Info.plist's `FoleviKeychainGroup`
gives the code the expanded name). Simulator builds need no team for either. New files in those folders join
their targets by themselves (Xcode synchronized folders).

This folder is outside the pnpm workspace (like `apps/desktop` and `apps/clipper`), so Vercel's build of
`apps/web` never sees it. The Xcode project uses Swift Package Manager (no CocoaPods).

Needs Xcode 27 (or 26) and Node 22. iOS 17 or later; iPhone and iPad.

## Commands

```sh
cd apps/ios
pnpm install --ignore-workspace

# Point the app at production (https://app.folevi.com) and copy the config and offline page into Xcode
pnpm sync

# Or at the local dev server (Debug builds allow its plain http; the dev server must be on port 3002)
pnpm sync:dev                      # FOLEVI_URL=http://app.localhost:3002 cap sync ios

# Build for the Simulator, or build, install and open it there
pnpm build                         # node scripts/simulator.mjs build ["Folevi iPhone 18 Pro"]
pnpm start                         # node scripts/simulator.mjs run ["iPad Pro 13-inch (M5)"]

# Debug builds in the Simulator: run JavaScript in the app's web view (handy for checking things)
node scripts/simulator.mjs eval 'return document.documentElement.dataset.native'

# ... or the native parts: status, refresh (the widgets' copy), timeline, spotlight, share, intent, complete, activity
node scripts/simulator.mjs native '{"command":"status"}'
node scripts/simulator.mjs native '{"command":"intent","name":"addTask","text":"Call Sam","due":"today"}'
node scripts/simulator.mjs native '{"command":"key","title":"Search"}'   # a hardware keyboard shortcut (KeyCommands.swift)

# ... or every widget drawn to PNGs (light, dark, and one filled with long titles), from this device's copy
node scripts/simulator.mjs widgets /tmp/widgets

# Unit tests (XCTest, in the app on a Simulator)
pnpm test                          # node scripts/simulator.mjs test ["Folevi iPad Pro 13"]

# The share sheet from Safari and the widget gallery (a signed-in Debug build on the device; screenshots to a folder)
TEST_RUNNER_FOLEVI_SHOTS=/tmp/shots xcodebuild test -project ios/App/App.xcodeproj -scheme FoleviUITests -destination 'platform=iOS Simulator,name=Folevi iPhone 18 Pro'

# Or by hand
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath ios/App/build/DerivedData build
xcrun simctl install booted ios/App/build/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.folevi.ios

# Open in Xcode
open ios/App/App.xcodeproj
```

Run `pnpm sync` again after changing `capacitor.config.ts`, `www/` or the Capacitor plugins. The generated
`capacitor.config.json`, `config.xml` and `public/` in `ios/App/App` aren't committed.

The app icon: `ios/App/App/AppIcon.icon` (the Mac app's Icon Composer file) for iOS 26 and later, and a 1024 px
PNG for iOS 17 to 25 (`pnpm icon` renders it from the same glyph).

## Testing in the Simulator

- Face ID: Features > Face ID > Enrolled in the Simulator menu, or
  `xcrun simctl spawn booted notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 && xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit.enrollmentChanged`.
  A matching face: `xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit_Sim.pearl.match`
  (`pearl.nomatch` for one that doesn't).
- Dark mode: `xcrun simctl ui booted appearance dark`. Text size: `xcrun simctl ui booted content_size
  extra-extra-extra-large` (the page follows it). Increase Contrast: `xcrun simctl ui booted increase_contrast
  enabled`. Reduce Transparency: `xcrun simctl spawn booted defaults write com.apple.Accessibility
  EnhancedBackgroundContrastEnabled -bool YES`, then open Folevi again.
- Screenshots: `xcrun simctl io booted screenshot shot.png`.
- A folevi:// link: `xcrun simctl openurl booted folevi://tasks/today`.
- Offline: open the app once while the server is up, then stop the dev server (or turn off the Mac's network)
  and open it again; the service worker serves the app. Without a cached copy it shows `www/offline.html`.
- Sign in inside the app (and finish onboarding) first: the page then hands the app this device's token, and
  the extensions work. `native '{"command":"status"}'` says whether it's there.
- Save to Folevi: in Safari, the page menu > Share > Folevi. Text and links reach the Inbox at once; with images
  or PDFs, or offline, the share waits in the App Group until Folevi opens (the page saves it then).
- Widgets: long-press the Home Screen > Edit > Add Widget > search Folevi. Lock Screen: long-press the Lock
  Screen > Customize. The control: Control Center > edit > Add a Control > Folevi.
- Siri and Shortcuts: the Shortcuts app lists Folevi's actions; `native '{"command":"intent",...}'` runs them.
- Spotlight: swipe down on the Home Screen and search a note's title; `native '{"command":"spotlight"}'` lists
  what's indexed.
- Scanner: the Simulator has no document camera, so the editor offers only "Scan from photos" (add photos with
  `xcrun simctl addmedia booted page.jpg`).
- Debug builds allow plain http to `app.localhost` in the app and both extensions (a build phase), so the
  extensions reach the dev server too.
- Notifications: turn them on in Settings > Notifications (the switch shows once the dev Convex has the
  APNS_* variables), then `xcrun simctl push "Folevi iPhone 18 Pro" com.folevi.ios payload.apns` with a
  payload like the server's (docs/IOS.md, Notifications). Long-press the banner for Done and Snooze 1 hour;
  `node scripts/simulator.mjs native '{"command":"push"}'` shows what the app knows.
