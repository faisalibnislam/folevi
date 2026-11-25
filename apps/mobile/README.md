# Folevi for iPhone, iPad and Android (Capacitor)

One app for phones and tablets: the web app's built-in interface in the system web view, with small native plugins.
Architecture, layouts and what's left: [docs/MOBILE.md](../../docs/MOBILE.md).

```bash
CI=true pnpm install --ignore-workspace   # this folder has its own lockfile
pnpm shell                                # apps/web's shell export into web/ (git-ignored)
pnpm sync                                 # bridge kit + `npx cap sync` (web/ into both apps, configs, plugins)
```

| | iOS | Android |
| --- | --- | --- |
| Project | `ios/App/App.xcodeproj` (from `ios/App/project.yml`, run `xcodegen` there after editing it) | `android/` (Gradle) |
| App id | `com.folevi.ios`, share extension `com.folevi.ios.share` | `com.folevi.android` |
| Page bridge | `bridge/mobile-bridge.js` | `android/app/src/main/assets/folevi-bridge.js` |
| Native code | `ios/App/App` and the shared services in `apps/ios/ios/App/Native/Shell` (built in place) | `android/app/src/main/java/com/folevi/android` |

Debug helpers: `node scripts/sim.mjs eval '<js>' <simulator udid>` and `node scripts/android-eval.mjs '<js>' <adb serial>`
run JavaScript in the app's page.

Releases (TestFlight, Play) are paused by the owner (2026-11-24); none of this uploads anything.
