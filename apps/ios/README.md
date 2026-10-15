# Folevi for iPhone and iPad

The web app (https://app.folevi.com) in a Capacitor shell, the way the Mac app (`apps/desktop`) is the web app in
an Electron window. The native parts are small and in Swift: a Face ID lock, links that open in an in-app Safari
view, `folevi://` links, haptics, and the bridge the page talks to (`window.foleviNative`). Architecture, App
Review notes and what's left for the Developer Program: [docs/IOS.md](../../docs/IOS.md).

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
pnpm build                         # node scripts/simulator.mjs build ["iPhone 18 Pro"]
pnpm start                         # node scripts/simulator.mjs run ["iPad Pro 13-inch (M5)"]

# Debug builds in the Simulator: run JavaScript in the app's web view (handy for checking things)
node scripts/simulator.mjs eval 'return document.documentElement.dataset.native'

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
- Dark mode: `xcrun simctl ui booted appearance dark`.
- Screenshots: `xcrun simctl io booted screenshot shot.png`.
- A folevi:// link: `xcrun simctl openurl booted folevi://tasks/today`.
- Offline: open the app once while the server is up, then stop the dev server (or turn off the Mac's network)
  and open it again; the service worker serves the app. Without a cached copy it shows `www/offline.html`.
