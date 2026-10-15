# Folevi for iPhone and iPad

Folevi for iPhone and iPad is the web app in an app of its own, the way Folevi for Mac is (`docs/DESKTOP.md`):
a small Capacitor shell (`apps/ios`) whose web view loads https://app.folevi.com. Features, layout and fixes
come from the site, so the app matches the web the moment a web change ships. The shell adds what a browser
tab can't do, in a few hundred lines of Swift and one script.

- Universal (iPhone and iPad), iOS 17 and later, bundle id `com.folevi.ios`, display name "Folevi".
- Capacitor 8 with Swift Package Manager (no CocoaPods), pinned exact versions, outside the pnpm workspace
  (Vercel builds only `apps/web`).
- Commands: `apps/ios/README.md`.

## How it fits together

```
apps/ios/
  capacitor.config.ts          server.url (app.folevi.com/documents, or FOLEVI_URL), App-Bound Domains, plugins
  www/offline.html             the only page in the app: shown when nothing can load (first launch offline)
  scripts/simulator.mjs        build, run and (Debug) eval in the Simulator
  scripts/app-icon.mjs         the 1024 px icon for iOS 17 to 25
  ios/App/App/
    AppDelegate.swift          one scene; links and activities to Capacitor
    SceneDelegate.swift        the window, and the Face ID lock following the scene
    FoleviViewController.swift Capacitor's view controller: swipe back, no page bounce, bridge.js, NavigationGuard
    FoleviNativePlugin.swift   "FoleviNative": lock settings, links out, the offline page's retry
    AppLock.swift              the Face ID lock and its cover
    bridge.js                  window.foleviNative, data-native="ios", viewport-fit=cover
    SimulatorEval.swift        Debug Simulator builds only: run JavaScript from a script
    AppIcon.icon               the Mac app's Icon Composer file (iOS 26 and later)
    Assets.xcassets            AppIcon (1024 px PNG, iOS 17 to 25), Mark (the lock screen's F)
```

Plugins: `@capacitor/app` (folevi:// links), `@capacitor/haptics`, `@capacitor/keyboard` (the web view
shrinks above the keyboard), `@capacitor/status-bar`. Links out use `SFSafariViewController` directly from
FoleviNativePlugin (it sees every navigation, so the page needs no changes for it); settings live in
`UserDefaults`. So `@capacitor/browser` and `@capacitor/preferences` aren't needed.

### Loading the site, and offline

The web view loads `https://app.folevi.com/documents` (the site's `/` is only a server redirect, which the
service worker doesn't keep). `WKAppBoundDomains` in Info.plist lists `app.folevi.com` (and `localhost`,
Capacitor's own scheme for the offline page), with `limitsNavigationsToAppBoundDomains`: that's what lets the
site's service worker (`apps/web/public/sw.js`) run in WKWebView, and it also keeps injected scripts and
message handlers to Folevi's own pages.

- First launch needs the network. After that the service worker serves the app shell and its scripts, and
  the app opens offline with what this device has (the same as the installed web app).
- Checked in the Simulator: the service worker registers and controls the page, caches the shell and the
  static files, and serves `/documents` with the server stopped. With the server unreachable but the device
  online (`navigator.onLine` true), the web app then takes "no answer" for "signed out" and heads to sign in;
  in real airplane mode `navigator.onLine` is false and the web app opens its offline snapshot instead. Worth
  a look on a device (and in the web app: `useFoleviAuth` in `lib/convex/provider.tsx`).
- When neither the network nor the cache has the page, Capacitor shows `www/offline.html` ("Folevi can't
  connect", Try again).

The local dev server for the Simulator: `pnpm sync:dev` (FOLEVI_URL=http://app.localhost:3002). A build phase
adds `app.localhost` to the app-bound domains and allows plain http to it, in Debug builds only; Release
builds keep Info.plist as written (https to app.folevi.com only). The Simulator resolves `app.localhost` to
the Mac.

### The bridge

`bridge.js` runs before the page's own scripts, in the main frame, and only when the page's origin is the one
the app loads (FoleviViewController fills it in). It defines a frozen `window.foleviNative` on top of
Capacitor's bridge, marks `<html data-native="ios">`, and adds `viewport-fit=cover, maximum-scale=1` to the
viewport tag (so the page can lay out under the status bar, and focusing a small field doesn't zoom).

```ts
window.foleviNative = {
  platform: "ios",
  version: "1.0",
  haptic(kind: "light" | "medium" | "heavy" | "success" | "warning" | "error"): void,
  setStatusBar(theme: "light" | "dark"): void,          // the page's theme; light text on a dark page
  openExternal(url: string): Promise<boolean>,           // in-app Safari view (mail and phone: the system)
  getSettings(): Promise<{ lock: boolean; lockAfter: 0 | 60 | 300 | 900; method: "faceID" | "touchID" | "opticID" | "passcode" | "none" } | null>,
  setSettings(patch: { lock?: boolean; lockAfter?: 0 | 60 | 300 | 900 }): Promise<Settings>,
  onCommand(listener: (c: { type: "link"; url: string }) => void): () => void,   // folevi:// links
};
```

The page's typed view is `apps/web/src/lib/nativeApp.ts` (`nativeApp()`, `inIosApp()`, `canPurchaseHere()`,
`withoutPurchaseHints()`, `haptic()`), next to `lib/desktop.ts` for the Mac app. Every FoleviNative call checks
that the web view is showing the app's own origin (the offline page, for one, can't read or change the lock).

### Links

FoleviNativePlugin decides where every navigation goes:

- Folevi's own pages stay in the web view; one opened as a new window (`target=_blank`, `window.open`) loads
  there too, since the app has one window.
- Other sites open in an in-app Safari view over the app. Embeds (a video in a note) load in their frame.
  Folevi's pricing page (folevi.com/pricing, reachable only through the app host's redirect of /pricing) is
  never opened.
- A navigation called off on purpose (a redirect sent to the Safari view) doesn't end on the offline page:
  `NavigationGuard` in FoleviViewController.swift sits in front of Capacitor's navigation delegate and drops
  those cancellations, which Capacitor would otherwise treat as a network failure.
- `mailto:`, `tel:`, `sms:` and `folevi:` go to the system. `javascript:`, `file:` and other apps' schemes
  never load.
- `folevi://` links from other apps reach the page through the App plugin; the page reads them with
  `apps/web/src/lib/deepLink.ts`, which accepts exactly what the Mac app's `parseDeepLink` accepts (a test
  checks the two agree). folevi://new and folevi://quick-add make a new note.

### Face ID lock

Off by default. Settings > This device (shown only in the app, like Settings > Desktop app in the Mac app)
turns it on, which asks for Face ID once, and picks when to ask again: immediately, or after 1, 5 or 15
minutes in the background. The choice is kept on the device (`UserDefaults`), never on Folevi's servers.

While it's on, a cover (the F, "Folevi is locked", Unlock with Face ID) hides the app whenever it leaves the
screen, so the app switcher's snapshot shows the cover. Coming back after the chosen time asks for Face ID,
falling back to the device passcode (`LAPolicy.deviceOwnerAuthentication`). Canceling leaves the cover and its
button; it doesn't ask again by itself. A device with no passcode can't turn the lock on; if the passcode is
removed later, the lock steps aside rather than shut the person out.

### What the web app does inside the iOS app

All of it hangs on `data-native="ios"` (CSS) or `nativeApp()`/`canPurchaseHere()` (scripts); browsers and the
Mac app are unchanged.

- **Safe areas** (`globals.css`): the app's frame (`.ui-shell`) keeps clear of the status bar, the home
  indicator and the landscape camera housing, with the canvas colour showing behind the status bar. Full-page
  canvases (sign in) get a clear border instead, pages without one (onboarding) pad the body; the sidebar
  drawer, toasts, and the Ask Foli AI button and chat move in by the same insets. Long presses open Folevi's
  own menus, not iOS link previews.
- **Layout**: iPhone gets the phone layout (sidebar drawer, page dock above the keyboard); iPad gets the
  tablet and desktop layout, with tabs, and hardware keyboard shortcuts reach the page as in Safari. There's
  one tab strip (the web app's own); iOS adds no chrome.
- **Keyboard**: the web view shrinks above the keyboard (Keyboard plugin, `resize: native`), so the editor
  and its page dock (Foli AI, Insert, Format, Style: the existing phone toolbar) sit above it.
- **Status bar** follows the app's theme (light or dark), not only the system's.
- **Haptics**: a light tap when a task is checked off (editor and Tasks), a medium one for a new note, light
  and medium when something is dragged and dropped, medium when a long press opens a menu.
- **Swipe back**: the edge swipe steps back through the router's history (it uses `pushState`). Pull to
  refresh doesn't exist and the page doesn't rubber-band; views scroll on their own.
- **Recording**: the existing recorder, microphone only. iOS lets an app record in the background only with
  a background audio mode, which the app doesn't have, so the recording pauses when Folevi leaves the screen
  and carries on when it's back (with a note saying so).
- **No passkeys yet**: WebAuthn in the app's web view needs Associated Domains (below). Sign in with a passkey
  and Add a passkey are hidden in the app until then.
- **No buying** (App Store Review Guideline 3.1.1): see below.

## No purchases in the app

Plans are sold on folevi.com. Inside the app nothing shows a price or offers to buy, upgrade or change plans:

- Settings > Plan & billing shows the plan as it is (trial days left, renewal date, storage, AI credits,
  devices) and says "Plans and billing are managed on folevi.com, not in this app." No plan cards, credit
  packs, billing portal, cancel or billing history. The workspace Plan & billing shows the plan's name and
  state only.
- The sidebar's trial pill shows the days left and isn't a button; the Free "Upgrade to Pro" pill isn't shown.
- Foli AI's "Buy more" and "Upgrade" buttons, "See plans" links (Settings > AI, Account, routines, the graph,
  "Foli AI isn't part of your plan"), "Get unlimited devices", the device limit screen's upgrade buttons and
  seat prices (Members, Invite) are hidden.
- Server messages that end with where to buy ("Buy more in Settings → Plan & billing.") lose that sentence
  (`withoutPurchaseHints`, applied in `errorMessage` and the toasts).
- The sign-in page's logo, which links to the marketing site, isn't a link in the app.
- The app never opens folevi.com/pricing, even in its Safari view.

Tests: `apps/web/test/native-app.test.tsx` (Plan & billing, AI panels and server messages in and out of the
app) and `apps/web/e2e/ios-app.spec.ts` (the whole app with a stand-in bridge).

Still on the marketing host from inside the app: Help's "Folevi docs" and the Terms and Privacy links on sign
up open there in the in-app Safari view, and the site's header has a Pricing link. That's ordinary reader-app
territory, but if App Review objects, give the site a way to hide pricing for the app (a query parameter set
by those links).

## App Review notes

- **More than a website (4.2)**: Face ID lock with a covered app switcher snapshot, offline use of everything
  on the device (service worker and the app's own storage), haptics, folevi:// links from Shortcuts and other
  apps, in-app Safari for links, native keyboard handling, iPad layout with keyboard shortcuts. Stage 2 ideas
  that add more: share extension, widgets, push notifications, Spotlight.
- **Payments (3.1.1, 3.1.3)**: no purchases, prices or links to buying in the app (above). Accounts made on
  the web keep their plan. Account creation is in the app (sign up), and account deletion is in Settings >
  Security (Delete account), as 5.1.1(v) requires.
- **Privacy strings**: `NSMicrophoneUsageDescription` (recording audio in a note),
  `NSCameraUsageDescription` (the file picker's Take Photo or Video, adding to a note),
  `NSFaceIDUsageDescription` (the optional lock). No tracking; choosing photos uses the system picker, which
  needs no photo library string. `ITSAppUsesNonExemptEncryption` is false (HTTPS only).
- **Privacy labels**: the same data the web app handles (account, notes, usage for AI credits).
- **Demo account** for the reviewer: a Pro account without two-step verification, or with a code shared in
  the review notes.
- **server.url**: Capacitor documents a remote URL as meant for development. The app loads the live site on
  purpose, like the Mac app; App-Bound Domains, the origin checks and the offline page are the parts that make
  that safe and usable.

## After joining the Apple Developer Program

What's needed to go from the Simulator to devices, TestFlight and the App Store:

1. **Signing**: set the team on the App target (Signing & Capabilities, automatic signing), keep the bundle id
   `com.folevi.ios`, then archive (Product > Archive) and upload.
2. **Associated Domains** (`webcredentials:app.folevi.com`, `applinks:app.folevi.com`) and an
   `apple-app-site-association` file served by the web app at `/.well-known/`. That turns on passkeys in the
   app (then drop the `foleviNative` check in `lib/auth/passkeys.ts`) and universal links
   (https://app.folevi.com/d/... opening in the app; handle them like folevi:// links).
3. **App Group** (`group.com.folevi`) once there's a share extension or widgets, so they can reach the app's
   data.
4. **Push notifications**: an APNs key (.p8) in the developer account, the Push Notifications capability,
   `@capacitor/push-notifications`, a device token table and a sender on the backend.
5. **TestFlight**: internal testers first; the review notes above and a demo account for external testing.
6. App Store Connect: screenshots (6.9" iPhone and 13" iPad), privacy labels, age rating, the support URL
   (folevi.com/support) and the privacy policy URL (folevi.com/privacy).

Also worth doing then: check the iOS 17 behaviour on a device (the Simulator here only had iOS 27), real
airplane mode, Face ID on a device, and the background recording behaviour.

## iOS versions

The app targets iOS 17. Nothing in the Swift code needs a newer iOS: `UIButton.Configuration` and the async
`LAContext.evaluatePolicy` are iOS 15, `LABiometryType.opticID` is iOS 17. Capacitor 8 itself supports iOS 15
and up. The app icon: `AppIcon.icon` (Icon Composer, drawn by iOS 26 and later) and `AppIcon.appiconset` with
one 1024 px PNG for iOS 17 to 25. Only iOS 27 Simulators were installed when this was built, so it was
compiled against 17.0 and run on 27.
