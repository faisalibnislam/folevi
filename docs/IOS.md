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
  scripts/simulator.mjs        build, run, test, and (Debug) eval and native hooks in the Simulator
  ios/App/App/
    AppDelegate.swift          one scene; links and activities to Capacitor
    SceneDelegate.swift        the window, and the Face ID lock following the scene
    FoleviViewController.swift Capacitor's view controller: swipe back, no page bounce, bridge.js, NavigationGuard
    FoleviNativePlugin.swift   "FoleviNative": lock settings, links out, the offline page's retry
    AppLock.swift              the Face ID lock and its cover
    bridge.js                  window.foleviNative, data-native="ios", viewport-fit=cover
    SimulatorEval.swift        Debug Simulator builds only: run JavaScript from a script
    AppIcon.icon               the Mac app's Icon Composer file (iOS 26 and later); both icons come from
                               packages/design-tokens/scripts/app-icon.mjs
    Assets.xcassets            AppIcon (1024 px PNG, iOS 17 to 25), Mark (the lock screen's F)
    App.entitlements           the App Group and the Keychain group (below)
  ios/App/Shared/              in the app and both extensions: the REST API client, the device token in the
                               Keychain, the App Group, the share queue and saver, folevi:// links, the look
  ios/App/AppAndWidgets/       in the app and the widgets: the widgets' copy of tasks and notes and their
                               timeline, what the widgets draw (and the F they show), the App Intents
  ios/App/Native/              the app only: FoleviNativePlugin's stage 2 and 3 calls, AppServices, DeepLinkRouter,
                               SpotlightIndex, DocumentScanner, the Siri phrases, PushNotifications (stage 3),
                               DebugHooks and WidgetSnapshots (Debug Simulator)
  ios/App/ShareExtension/      "Save to Folevi" in the share sheet
  ios/App/Widgets/             the widgets and the Control Center control
  ios/App/Tests/               unit tests (XCTest, run in the app)
  ios/App/UITests/             the share sheet from Safari and the widget gallery, driven like a person would
```

The folders under `ios/App` other than `App` are Xcode synchronized folders: a new file in one is part of
its targets with no project edit.

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
  static files, and serves `/documents` with the server stopped. The session check
  (`authPhaseOf` in `lib/convex/provider.tsx`) only signs anyone out on a definite answer from the auth server
  (no session in a successful reply, or 401/403). No answer, a gateway or server error, a rate limit, a check
  that hangs for six seconds, or the device offline are all "offline": the app opens from this device's copy
  and the sync status says Offline, whether or not `navigator.onLine` knows. `AccountGate` checks once more
  before it goes to sign in and stays offline when that check has no definite answer either (e2e
  `offline.spec.ts`, unit `test/auth-phase.test.ts`).
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
  // stage 2: device, setCredential, clearCredential, takeShares, finishShare, scanDocument (below)
  // stage 3, notifications:
  pushStatus(): Promise<{ permission: "notDetermined" | "denied" | "granted"; enabled: boolean; asked: boolean;
                          token: string | null; environment: "sandbox" | "production"; bundleId: string }>,
  enablePush(): Promise<PushStatus>,                    // asks iOS the first time, then Apple's device token
  disablePush(): Promise<void>,
  setBadge(count: number): void,                        // the bell's unread count on the app icon
  openNotificationSettings(): Promise<void>,            // Folevi's page in iOS Settings > Notifications
};
```

bridge.js also asks the app (`FoleviNative.accessibility`, `Native/SystemSettings.swift`) for what iOS knows and
a web view can't read, and asks again whenever it changes (the `folevi:accessibility` window event): it marks
`<html data-reduce-transparency>`, `data-increase-contrast` and `data-bold-text`, and sets `--ios-text-scale`
(Dynamic Type, below). A tap on the status bar reaches the page as `folevi:status-bar-tap` (below).

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
  checks the two agree). folevi://new makes a new note; folevi://quick-add opens Quick add task.

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
- **Layout**: iPhone gets its own interface (below, "iPhone interface"); iPad gets the tablet and desktop
  layout, with tabs, except in a compact window (below, "iPad"). There's one tab strip on iPad (the web app's
  own); iOS adds no chrome.
- **Keyboard**: the web view shrinks above the keyboard (Keyboard plugin, `resize: native`), so the editor
  and what floats at the bottom of the page (on iPhone the bar of writing tools) sit above it.
- **Status bar** follows the app's theme (light or dark), not only the system's. Tapping it scrolls the
  screen back to its top, as in any iOS app: the page scrolls inside its views, so the web view's own scroll
  view has nothing to scroll. A scroll view of the app's own behind the web view (`StatusBarTapProxy`) is the
  one iOS asks; the page is told (`folevi:status-bar-tap`) and bridge.js scrolls whatever scrolls under the
  middle of the screen (a list, a note, a sheet) to its top. A page can take it first (`folevi:scroll-to-top`,
  cancelable).
- **Dynamic Type**: the text follows iOS's text size, from the smallest size up to 150% (past that the screens
  don't have the room, and iOS's Zoom is there for more): `--ios-text-scale` is applied as
  `-webkit-text-size-adjust` on `body`, not the root, so only text grows and rem-based spacing and the layout
  keep their size (rows grow with their text). Checked at the largest standard size (135%) on iPhone and iPad.
- **Reduce Transparency** (a web view can't read it: the app marks `data-reduce-transparency`): glass becomes a
  solid surface with its rim (`.ui-liquid`, menus, the desktop layout's glass, the fade behind a screen's bar).
  **Increase Contrast** makes the glass nearly opaque with a visible edge and the app's lines and muted text
  stronger (WebKit's `prefers-contrast: more` too). **Reduce Motion**: WebKit reports it as
  `prefers-reduced-motion`, which turns off pushes and pops, sheet springs and the editor's motion.
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

### iPhone interface

On an iPhone the app doesn't look like the web app in a phone browser: it has the shape of an iOS app, built
in the web layer (`apps/web/src/components/iphone`), so it works from iOS 17 and ships with the site like
everything else.

**When it's on.** `isIphoneApp()` / `useIphoneApp()` (`lib/iphone.ts`): the page is in the iOS app
(`inIosApp()`) and the web view's user agent says iPhone (portrait and landscape), or it's the iPad app in a
window narrower than 700 px (below, "iPad"). The iPad app asks for the desktop site, so its web view reports a
Mac with a touch screen and keeps the sidebar layout when there's room; a phone's browser keeps the mobile web
layout; the Mac app and desktop browsers never see it. Shell marks `<html data-iphone>` while it's on;
the iPhone CSS in `globals.css` hangs on that mark, and the components check the hook. Nothing else changes
for any other surface (e2e `iphone-app.spec.ts` checks a phone browser too).

**The shell.** `Shell` renders `IphoneShell` instead of the sidebar, tab strip and drawer. One screen at a
time fills the display; each view's `ViewChrome` becomes an `IphoneScreen` (`Screen.tsx`):

- A large title (Spectral, 34pt) at the top of the content, which hands over to a small centred title in
  the bar once it scrolls under it, with a soft blur fading in behind the bar. Views pass their iPhone look
  as `ViewChrome`'s `iphone` option (title, subtitle, actions, a header under the title); a view that
  doesn't gets a large title and its usual facts and actions in a row under it.
- A round glass Back button whenever the screen isn't a tab's first one: it steps back through the tab's
  stack, or (opened from a link, with nothing behind it) goes to the screen's parent. The edge swipe goes
  back too (WebKit's own interactive swipe, `allowsBackForwardNavigationGestures`).
- The screen's actions in a glass pill on the right.
- **Each tab keeps its own stack** (`tabStacks.ts`), as iOS tab bars do: Home > a folder > a note, then Tasks,
  then Home again shows that note, scrolled where it was. The browser's history is always the current tab's
  stack (`rewriteHistory` in `lib/app/historyNav.ts` steps back to the first entry, heard by nobody, then
  replaces and pushes), so Back, the edge swipe and `canBack` stay inside the tab. Tapping the tab you're on
  pops to its first screen (sliding), or, already there, scrolls to the top. A link to another tab's first
  screen (Calendar from Tasks' More) switches to that tab; Home or Calendar opened from deeper in their own
  tab pops to its root; another place (Personal, a workspace) starts the other tabs again. Each screen's
  scroll position is kept as it scrolls and restored after Back and a tab switch (also when the screen is
  drawn again while it loads). The stacks live in sessionStorage, so a reload keeps them. The popstate
  listener is added when `historyNav.ts` loads, before Next's router, so the position is known before the
  page a Back leads to is drawn (Chromium calls window listeners in the order they were added).
- Push and pop: a new screen slides in from the right over the old one (which eases left and dims); Back
  slides the top screen away (`transitions.ts`: the leaving screen is a copy of its elements, taken the
  moment the router moves, `onHistoryMove` in `lib/app/historyNav.ts`). Switching tabs, the edge swipe and
  reduced motion don't animate.

**Liquid glass.** Floating chrome uses `.ui-liquid` / `.ui-liquid-strong` (a frosted fill, a fine bright rim
and a soft shadow, light and dark, `--liquid-*` in `globals.css`); only small floating things are blurred
(bars, pills, menus, sheets), never a scrolling page. `prefers-reduced-transparency` makes them solid. Two
corner tokens exist for this interface only: `sheet` (28) and `capsule` (fully round), and
`test/radius.test.ts` keeps them inside `components/iphone` and `globals.css`.

**The tab bar** (`TabBar.tsx`): a glass capsule with Home, Tasks and Calendar on the left (the current one on
a soft glass highlight), and one with Foli AI and + on the right, floating above the home indicator. It
steps away while the keyboard is up (Capacitor's `keyboardWillShow`/`Hide`, and focus in a text field), on a
note (which has its own bars), on the Foli AI page and in Select mode. + opens New note, From template, New
folder and Quick task; on Tasks it opens Quick task straight away.

**Screens.**

- **Home** (`IphoneHome.tsx`): the avatar (account and places sheet: Personal and workspaces with a check,
  the workspace's people and settings, Settings, Help, appearance, Sign out) and a pill with notifications
  (a sheet) and More; "Home" with the place under it; a search field that opens search; recent notes as a
  row of their cards; Catch me up (with Foli AI), All notes, Drafts, Shared with me, Changes and Reviews as
  rows with counts; Starred, Folders (rows with note counts; a folder's screen lists its subfolders) and
  Tags (folded) sections, empty ones as a quiet grey box; Templates, Archive and Trash.
- **Lists** (All notes, Drafts, a folder or tag, Starred, Archive, Trash, Templates; `NoteList.tsx`): a large
  title, a search field filtering what's loaded, Select (a bar of Move, Copy to, Star, Archive and Delete takes
  the tab bar's place), and a More menu with Cards or List and the sort. Rows swipe: right to star, left to
  archive or delete (a long swipe runs Delete). Every card and row has its long-press menu.
- **A note**: the page fills the screen under Back, the note's place (a glass chip: its parent page, folder
  or Drafts) and a pill with Share and the note's "…" menu; a note without artwork is a full-width sheet of
  paper. At the bottom, glass bars with Comments, Style and Format on the left and Foli AI and Insert on
  the right, each opening its tool as a sheet. While writing, a bar over the keyboard has to-do,
  bullets, a heading, outdent, indent, an image, undo, redo and a key that puts the keyboard away (its
  buttons never take focus, so the keyboard stays up). The line being written stays above that bar (the note
  scrolls inside its page, so `useCaretInView` in `chrome.tsx` scrolls it when the keyboard comes up, the web
  view settles at its new height, and the caret moves). Selecting text puts the formatting bar on the writing
  bar, in its place, so it never meets iOS's own edit menu over the selection; the slash, @ and [[ menus fit
  between the line and the writing bar (`visibleBottom()` counts the bar).
- **Wide blocks** (a table, a long formula) scroll sideways inside the note, with momentum, never the page
  (`.fb-hscroll`, `scrollEdges.ts`): a soft fade on an edge says there's more that way, and on the iPhone they
  run to the screen's edges, starting in line with the text. Code blocks wrap; images and embeds fit the width.
- **Moving blocks**: press and hold a line until its menu opens, then move the finger: the menu gives way and
  the block lifts and follows it (a medium tap when it lifts, a light one when it lands), as on iOS
  (`HOLD_MOVE_EVENT` in `lib/touchContextMenu.ts`; the view under the finger stays still while a held menu is
  up). Holding the grip lifts it too (280 ms), and moving it right away drags as before. On a touch screen the
  grip is slimmer and keeps a gap before the text.
- A note that starts with an image (or any media) opens with nothing selected (ProseMirror would select that
  block and its alt text tools would show), on every platform.
- **Tasks** (`Tasks.tsx`): the views as chips (the chosen one names itself), tasks grouped by note under
  headers that fold away (Upcoming by day), a tap opens a task's details, the box checks it off, a swipe
  right completes it and left moves it to tomorrow or opens its date.
- **Calendar** (`Agenda.tsx`): an agenda by default: today as the large title ("Oct 16", "Today · Friday"),
  overdue tasks first, then each day of the next month under its own header (Tomorrow named), with tasks and
  subscribed calendars' events; each day's "…" adds a task on that day. Week and Month are in More.
- **Foli AI**: a sheet (half the screen, pulled up for all of it) titled New chat, with suggestions and the
  composer as a card; the history button opens the Foli AI page. On a note, its Foli AI tool (the note's own
  panel) opens in the tool sheet.
- **Search**: the command palette as a full-screen sheet, the field at the top with Cancel and results as
  rows.
- **Settings**: a grouped list (inset sections, icons, chevrons) where each section is its own screen.

**Sheets** (`Sheet.tsx`): in the iPhone app every `Dialog` and `Popover` is a sheet from the bottom with a
grabber (dragged down to dismiss from the grabber or the header, or from the content once it's at its top;
medium sheets drag up to full height), or for short forms (`size="sm"`: confirmations, New folder, editing a
task) a glass card in the middle, which sits above the keyboard because the page shrinks for it. Both are
modal `<dialog>`s: the page behind is inert, Escape closes, focus returns. Menus keep their place next to
what opened them, with iOS-sized rows on glass, and stay below the status bar.

**Haptics**: light for a tab change and a task checked off, medium for a new note and a long press, warning
when confirming something destructive (a danger button, a menu's Delete, a swipe's Delete).

**Accessibility**: 44pt targets, every icon button named, the large title is the screen's heading, sheets
are labelled dialogs, swipe actions are also in the long-press menu; VoiceOver reads the bar (Back, the small
title, the actions), then the screen, then the tab bar. The text follows Dynamic Type, glass follows Reduce
Transparency and Increase Contrast, and motion follows Reduce Motion (above, "What the web app does").
`e2e/a11y.spec.ts` runs axe on the iPhone interface (Home, a list, Tasks, Calendar, Settings, a sheet) in light
and dark.

**Reviews** on touch: a tap on the card shows the answer; then a swipe right is Good and a swipe left Again
(the card follows the finger, a success or warning tap when it goes), or a rating button.

**Testing**: `e2e/iphone-app.spec.ts` (an iPhone-sized window with an iPhone user agent and a stand-in
bridge: tab bar, large titles, Back, the + menu, New folder, Quick task, a note's bars and sheets, Settings,
and a phone browser keeping the web layout). In the Simulator: `pnpm sync:dev`, then Debug builds show the
dev server; `node scripts/simulator.mjs eval '...'` drives it.

Not done yet: an interactive Back swipe drawn by the app itself (WebKit's own swipe shows its snapshot of the
page behind, which after a tab switch can be the screen shown just before it), Settings sections as native
grouped lists throughout (they're the web forms on grouped cards), and per-point pressure on the whiteboard.

### iPad

The iPad app keeps the web app's sidebar layout, with tabs, in portrait and landscape and in any window wide
enough for it. A window narrower than 700 px (Slide Over, a third of Split View, a small Stage Manager window)
has no room for the sidebar and a note, so it takes the iPhone's compact interface (tab bar, large titles,
sheets) as iPad apps do in a compact-width window, and goes back to the sidebar layout, in place, when the
window widens (`isIpadApp()`, `useIphoneApp()` follows the width; e2e `iphone-app.spec.ts`).

- **Multitasking**: all four orientations and no `UIRequiresFullScreen`, so Split View, Slide Over and Stage
  Manager's resizable windows work. One window: Capacitor has one scene
  (`UIApplicationSupportsMultipleScenes` false), so two Folevi windows side by side aren't possible.
- **Hardware keyboard** (`Native/KeyCommands.swift`): New Note (⌘N), Search (⌘K), Quick Add Task (⇧⌘A), Ask
  Foli AI (⌘J), Today's Tasks (⌥⌘T), Show or Hide Sidebar (⌘\), Back (⌘[) and Forward (⌘]) are UIKeyCommands,
  listed in the overlay iPadOS shows while ⌘ is held, and handed to the page as the same key press on what has
  focus, so the web app does what it does for them anywhere (plain ⌘N makes a note in the app; a browser keeps
  it for a new window). Editing keys (⌘B, ⌘I, ⌘Z, ⌘C) stay with the web view. `native '{"command":"key",
  "title":"Search"}'` presses one in a Debug build.
- **Pointer**: WebKit turns the trackpad and mouse into hover and mouse events, so the web app's hover states,
  cursors and right-click menus work as on a Mac.
- **Apple Pencil**: the whiteboard draws with a pen, a finger or a mouse; once a pen has drawn on a whiteboard,
  only the pen draws there (a resting palm doesn't) and a finger scrolls the note, as in iPad drawing apps.
  Strokes have a fixed width (the whiteboard's format has no pressure). Scribble works in the app's text fields
  as in any web view.
- **Drag and drop** from other apps: images and files dropped on a note are inserted where they land (the
  editor's drop handler, as in a browser); text and web pages too, cleaned up like a paste.
- Status bar taps, Dynamic Type, Reduce Transparency and the menus' and sheets' glass work as on the iPhone; the
  floating keyboard is a narrow window's keyboard to WebKit, so the page shrinks above it the same way.

## Widgets, the share sheet, Siri and Spotlight (stage 2)

Four targets: the app (`com.folevi.ios`), the share extension (`com.folevi.ios.share`), the widgets
(`com.folevi.ios.widgets`: WidgetKit and the iOS 18 control) and the unit tests. Everything outside the web view
talks to Folevi through the REST API (`/api/v1`) with a token made for the device; the web view stays the only
place that syncs, so anything with files goes through it.

### The device's token

- When someone is signed in inside the app (and online), the page asks the app which token it holds
  (`foleviNative.device()`: the install id, the model, the account and token ids it holds, never the token)
  and calls `apiTokens.ensureDevice` (convex/apiTokens.ts). The server keeps the token the app holds, or makes
  a new one (first launch, another account, revoked in Settings) and the page hands it to the app
  (`setCredential`), once (`lib/nativeDevice.ts`, from `components/app/NativeBridge.tsx`).
- The token is an ordinary personal access token named for the device ("Folevi for iPhone (iPhone 18 Pro)"),
  with notes:read, notes:write, tasks:read and tasks:write, never expiring. Its places follow the person:
  Personal and every workspace they're in at the time of each request, so joining or leaving a workspace
  needs no new token. One per device (its install id), up to ten devices (signing in on an eleventh replaces
  the one used longest ago); they don't count towards the 20 tokens a person makes. Settings > Connected apps
  lists it with the others, marked "This device" in the app, and Revoke works the same; the next launch then
  makes a new one. The REST API's rate limits apply to it like any token.
- The app keeps it in the Keychain (`DeviceCredential`): access group `<team prefix>com.folevi.shared`
  (`keychain-access-groups` in each target's entitlements; Info.plist's `FoleviKeychainGroup` carries the
  same expanded name to the code), readable after first unlock (`AfterFirstUnlockThisDeviceOnly`, so widgets
  refresh on a locked phone), never in iCloud, never logged. Keychain sharing works in the Simulator (the widgets
  and the share extension read the token there), so nothing falls back to the App Group for it. The account and token ids, the API's address
  (the site the app loads + `/api/v1`) and the install id live in the App Group's settings.
- Signing out (any way: the menu, the session ending) revokes it on the server while the session still can
  (`apiTokens.revokeDevice`), and the app deletes it with the widgets' copy, the share sheet's places and the
  Spotlight entries (`clearCredential`). A 401 anywhere native also forgets it.

### App Group

`group.com.folevi` (`com.apple.security.application-groups` in all three targets): the settings above, the
places for the share sheet, `widgets.json` (the widgets' copy of tasks and notes), `Shares/` (the share queue),
and a link an App Intent left for the app (`PendingLink`). Files are written with
`completeUntilFirstUserAuthentication`.

### Share extension: Save to Folevi

Takes links, text, images and PDFs from any app (an activation rule, so it isn't offered for other files).
A compact card in the app's neutral look: Cancel, "Save to Folevi" (Spectral), Save; the title (Safari's page
title, else the first line, else the link's host); a preview (the link, the text, the files with thumbnails);
"Save to" with "Inbox in Personal" and each workspace (from `GET /places`, cached, refreshed while the sheet is
open; the last choice is remembered). Images are kept as PNG, GIF, WebP or JPEG (HEIC from Photos becomes
JPEG), up to ten files of 20 MB, like the web's share page.

Saving (`ShareSaver`): text and links go straight to the Inbox through `POST /api/v1/notes` (`inInbox`, with
an Idempotency-Key) when there's a token and a connection; the sheet says "Saved to your Inbox". Anything
else (offline, signed out, a place that's gone, any refusal, and every share with images or PDFs, since the
REST API doesn't take files) is written to the App Group queue first and the sheet says "Saved, it will sync
when Folevi opens". When the app opens (and whenever it comes back), the page takes the queue
(`takeShares`), saves each one with the web app's own share flow (`lib/share/save.ts`, the same code as
`/share`: through the sync engine, files through the upload queue, offline too) into the Inbox chosen, says
"Saved what you shared to your Inbox", and only then lets the app delete it (`finishShare`). A file waits in
the upload queue until its new note has reached the server (`lib/sync/uploads.ts`), so a share saved offline
uploads its photos once the connection is back, and a failure that can pass never drops one. A share kept
for one account is never saved into another.

### Widgets

From the App Group's copy (`WidgetStore`), so they draw at once and offline. One timeline provider for all of
them: refreshed from the REST API when the copy is older than ten minutes (open tasks due today or before,
and the ten recent notes), next look in 20 minutes (or just after midnight). The app also refreshes the copy
and reloads every widget when it comes to the front (at most every five minutes) and when it goes to the
background.

- **Today** (small, medium, large, extra large on iPad): today's and overdue tasks, overdue first, then by time
  and priority; "Overdue · Yesterday" in red. The large and extra large ones put the date under the title, the
  overdue tasks in an Overdue group of their own, and, when today leaves room, tomorrow's tasks under
  Tomorrow and a "+ Add task" row that opens Quick add task (on the extra large one, Tomorrow and Add task take
  the second column). The copy is fetched through tomorrow (`due_before` the day after); everything else counts
  today's and overdue ones only (`openTasks`, `overdueTasks`, `todayTasks`, `tomorrowTasks`); a circle checks a task off right there (iOS 17 interactive
  widgets, `ToggleTaskIntent` → `PATCH /tasks/{id}`): it disappears at once, and a check made offline is sent
  with the next refresh. Tapping a task opens its note; the rest opens Tasks > Today. Empty: "Nothing due
  today".
- **Recent notes** (small to extra large): the last edited notes with their place and when; each opens its
  note (`folevi://d/<id>`, an Inbox page's `inbox-` id too).
- **Quick add** (small): opens Quick add task (`folevi://quick-add`). The F (`WidgetMark`) fills its frame at
  the title's height, there and on the signed-out widgets.
- **Lock Screen**: circular (how many tasks today), rectangular (the next task and when), inline ("3 tasks
  today").
- **Control Center / Lock Screen / Action button** (iOS 18 and later): "Quick add task", which opens the app on
  Quick add task.
- Rows are one line each, so no title can push a widget out of shape: just the text in small widgets, the due
  day (or the note's time) at the end of the row in medium ones, under it in large ones, and two columns
  in the iPad's extra large ones once there are more than five.
- Signed out: "Open Folevi to sign in". The look: white or near-black from the chrome tokens, Spectral
  SemiBold for titles (bundled in the extensions; the SIL Open Font License is in the font file's metadata),
  dark mode, the system's tinting on a tinted Home Screen.

### App Intents, Siri and Shortcuts

`AppAndWidgets/Intents.swift`, phrases in `Native/FoleviShortcuts.swift`:

- **Add a task** ("Add a task in Folevi"): text, an optional due date and an optional note (a `NoteEntity`);
  runs in the background through `POST /tasks` and refreshes the widgets.
- **New note** ("New note in Folevi"): opens a new note; with text, makes the note from it (Drafts: the first
  line is the title, each other line a paragraph) and opens it; offline, the text is kept like a share and
  reaches the Inbox when the page opens (the app opens on Home meanwhile).
- **Open note** ("Open a note in Folevi"): a `NoteEntity` found by searching Folevi (`GET /notes?q=`), the
  recent notes as suggestions.
- **Show today's tasks** ("Open my Folevi tasks"), **Quick add task**.

Intents that open the app hand it a folevi:// link (`PendingLink`): straight to the page when the app is
running, else kept in the App Group and opened when the app becomes active.

### Spotlight

`SpotlightIndex`: the 30 most recently edited and 30 starred notes (`GET /notes?starred=true`), each with its
title, the start of its text (Markdown taken out) and where it is (folder path, else the place), indexed when
the app comes and goes; a note's details are fetched only when it changed since it was indexed, and notes
that are neither recent nor starred any more are removed. Tapping a result opens the note (the activity's id
becomes `folevi://d/<id>`). Signing out removes them all.

### Links into the app

Widgets, intents, Spotlight, Handoff of a Folevi page and links from other apps all become folevi:// links and
go through the same path: Capacitor's App plugin (`appUrlOpen`) to the page's `lib/deepLink.ts`
(`DeepLinkRouter`). On a cold launch a link waits until the web view and its plugins exist, then the App plugin
keeps it until the page listens. `folevi://quick-add` now opens Quick add task (it used to make a new note);
`folevi://new` makes a new note. An Inbox page (its id is `inbox-` and a hash, not a note id) opens with
`folevi://d/inbox-<hash>`, which `lib/deepLink.ts`, the Mac app's `parseDeepLink` and `DeepLink.parse` all
accept (and nothing else under `d/`); `folevi://inbox` (the web's `/inbox`) opens the Inbox page of the place
the app is in, found by the server or, offline, by that same id.

### Document scanner

The editor's Insert panel (Media) and slash menu have "Scan document" (the camera's scanner, VisionKit, where
`VNDocumentCameraViewController.isSupported`) and "Scan from photos" (the system photo picker, up to ten
pages), only in the app. Each page comes back as a JPEG of at most 2200 px on its long side, with the text
read from all pages (Vision, accurate, with language correction). The page inserts the pages as image blocks
through the usual upload queue (works offline) and the text in a closed toggle "Text from the scan" under
them, so search finds it. The Simulator has no document camera, so only "Scan from photos" shows there.

### Testing it in the Simulator

- Unit tests: `pnpm test` (or `node scripts/simulator.mjs test "Folevi iPad Pro 13"`): the API client, folevi://
  links (the web's cases), the share content and queue, the saver's fallbacks, the Keychain group, the App
  Group, the widgets' copy and timeline, Spotlight's items, and notifications (the categories and buttons,
  where a tap or a button leads, Snooze's request).
- The share sheet and the widget gallery, driven through Safari and the Home Screen (needs a signed-in Debug
  build on the device): `TEST_RUNNER_FOLEVI_SHOTS=<dir> xcodebuild test -project ios/App/App.xcodeproj -scheme
  FoleviUITests -destination 'platform=iOS Simulator,name=Folevi iPhone 18 Pro'` (screenshots of each step go
  to the folder). The share sheet, the widgets (added from the gallery, a task checked off on the Home Screen)
  and Scan from photos pass; the Spotlight one often can't open Spotlight in the iOS 27 Simulator (its
  Search pill doesn't answer to a tap there), so Spotlight is checked with `native '{"command":"spotlight"}'`
  (what the index holds) and `"activity"` (a result tapped) instead.
- `node scripts/simulator.mjs widgets <folder>` draws every widget (each family, the empty and signed-out
  states, the Lock Screen's) from this device's copy, in light and dark, plus a sheet filled with long titles
  (`widgets-light.png`, `widgets-dark.png`, `widgets-full.png`): the same views as the widget extension at the
  iPhone 18 Pro's sizes (extra large: the 13-inch iPad's), with WidgetKit's margins and the Lock Screen's
  vibrancy approximated.
- `node scripts/simulator.mjs native '<json>'` runs the native parts in a Debug build: `{"command":"status"}`,
  `"refresh"` (the widgets' copy), `"timeline"`, `"spotlight"` (index, then search the index), `"share"` (the
  extension's save path with sample items, `"image": true` to queue one), `"intent"` (`"name": "addTask" |
  "newNote" | "openNote" | "showToday" | "quickAdd"`), `"complete"` (a widget's check-off), `"activity"` (a
  Spotlight result tapped), `"widgets"` (what the `widgets` command uses).
- The Lock Screen widgets and the Control Center control: long-press the Lock Screen > Customize, or Control
  Center > edit, and search for Folevi.

## Notifications (stage 3)

Reminders and @mentions reach the iPhone or iPad through Apple's push service (APNs), the way browsers get
them through web push (`convex/pushSend.ts`). Web push doesn't work inside WKWebView, so the app has its own.

### On the device

- **Asking**: never at launch. iOS asks when the person turns on "Notifications on this iPhone" (Settings >
  Notifications) or, the first time they set a reminder on a to-do in the app (`offerPushAfterReminder` in
  `lib/nativePush.ts`, from the task's Reminder field). Either way only once: after that the switch decides.
- **Settings > Notifications**: in the app the browser's web push card is replaced by "Notifications on this
  iPhone" (or iPad, `NativePushCard.tsx`): a switch, how many other devices get them, and "Open iOS Settings"
  when notifications are off for Folevi in iOS. The card only shows once the server can send them
  (`push.apnsAvailable`, false until the APNs key is set). What arrives follows the In app column above it.
- **Registering**: `enablePush` asks iOS, registers with Apple and hands the device token (hex) to the page,
  which sends it with the app's install id and the model to `push.registerApns`. On each launch (and each
  return to the front) a device with notifications on registers again, in case iOS changed the token; one
  whose notifications were turned off in iOS Settings is removed on the server (`syncPushRegistration`).
  Turning the switch off removes it (`push.unregisterApns`), and so does signing out (`forgetThisDevice`,
  which also turns notifications off in the app, clears what's in Notification Center and the badge).
- **The notifications**: a reminder shows "Reminder: <the to-do>" and "In <the note>", with **Done** (checks
  the task off through the REST API with the device's token, without opening the app; offline it waits like
  a widget's check and goes with the next refresh) and **Snooze 1 hour** (moves the reminder through
  `PATCH /tasks/{id}` with `remindAt`, so it rings again from the server; offline the app shows the same
  notification again in an hour itself). A mention shows who mentioned you and where, with **Open**. A
  note's notifications are grouped (`thread-id`).
- **Tapping one** opens what it's about through the same path as every folevi:// link (`DeepLinkRouter`):
  `/d/<note>#block-<to-do>` focuses the to-do. On a cold launch the link waits for the page. folevi:// links
  now keep `#block-<id>` and `#comment-<id>` (the web, the Mac app and `DeepLink.parse` agree).
- **In front**: still a banner (`willPresent`).
- **Badge**: the bell's unread count, set by the page whenever it changes (the same count as the Mac app's
  Dock badge), and sent with each notification.
- Tapping a notification opens its note with the app running (warm) and from not running (cold), on both
  Simulators (checked again on 2026-10-16: no crash, the note opens).
- `PushNotifications` is the notification center's delegate from `didFinishLaunching`, so a notification
  that launches the app, or a button pressed while it isn't running, is heard. Capacitor's own router is
  off (`ios.handleApplicationNotifications: false` in capacitor.config.ts). The delegate uses the
  completion-handler methods and calls them on the main thread: the async ones finish elsewhere, which
  UIKit stops the app for when a tap launches it.
- `aps-environment` is in App.entitlements (development; Xcode signs distribution builds with production).
  Debug builds register `sandbox` tokens, Release builds (TestFlight, App Store) `production` ones.

### On the server

- `apnsTokens` (one row per token, and per install id): `push.registerApns` (re-registering updates the row;
  a token or device that was someone else's moves to you; a device's new token replaces its old one; at most
  20 per person), `push.unregisterApns` (by token or install id, your own only), `push.apnsStatus`,
  `push.apnsAvailable`. Deleting an account removes them (and its web push subscriptions).
- `lib/push.ts` `schedulePush` is the one place reminders (`tasks.processReminders`), mentions
  (`lib/notify.ts`) and routines send push: web push as before, and `apnsSend.sendToProfile` when APNs is set
  up and the person has a device. The bell's choices decide as before (a reminder or mention turned off
  In app isn't pushed; a burst folded into one notification isn't pushed twice).
- `apnsSend.ts` ("use node"): HTTP/2 to `api.push.apple.com` or `api.sandbox.push.apple.com` (each token's
  own environment) with Node's `http2` (`lib/apnsHttp2.ts`), a provider JWT (ES256 with `node:crypto`, `kid`
  the key id, `iss` the team, kept 50 minutes: `lib/apnsJwt.ts`). Headers: `apns-push-type: alert`,
  `apns-topic` the bundle id, priority 10, an hour's expiration, `apns-collapse-id` (the same reminder
  replaces itself). Payload (`lib/apns.ts`): `aps.alert` title and body, `sound`, `badge`, `thread-id`,
  `category` (`REMINDER`, `MENTION`), `mutable-content`, and `kind`, `path`, `taskId` for the app.
- Apple's answers: 410, `Unregistered`, `BadDeviceToken` and `DeviceTokenNotForTopic` remove the token;
  429, 5xx and no answer are tried again after 1 and 4 seconds (three tries); `ExpiredProviderToken` gets a
  fresh JWT once; anything else is given up. The log line says how many were sent, gone or failed and
  Apple's reasons, never a token or what a notification says.
- Without `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY` and `APNS_BUNDLE_ID` nothing is scheduled or sent, and
  the app hides the option. A key that isn't a P-256 private key logs `apns.key_invalid` and sends nothing.
- No Notification Service Extension: nothing is fetched or decrypted on the device (no images), so it isn't
  needed. `mutable-content` is set so one can be added later.

### Testing it in the Simulator

The iOS 27 Simulator registers for remote notifications and gets a real (sandbox) device token, so the whole
path runs there except Apple delivering a server's push, which needs the Developer Program's key. In a Debug
Simulator build that can't reach Apple, the app uses a stand-in token made from its install id.

- A notification by hand: `xcrun simctl push "Folevi iPhone 18 Pro" com.folevi.ios payload.apns`, where the
  file is the server's payload (`lib/apns.ts`), for example
  `{"aps":{"alert":{"title":"Reminder: Take the bins out","body":"In Inbox"},"category":"REMINDER","thread-id":"<note>","badge":1},"kind":"reminder","path":"/d/<note>#block-<task>","taskId":"<task>"}`.
  Long-press the banner for Done and Snooze 1 hour.
- `node scripts/simulator.mjs native '{"command":"push"}'`: the permission, the switch, the start of the
  token, and what's in Notification Center from Folevi. `{"command":"respond","action":"folevi.done",
  "userInfo":{...}}` runs a button (or a tap, with no action) without the UI.
- The Debug log (`com.folevi.ios`, category `push`) says when Done was sent or kept, and when a Snooze moved
  the reminder on Folevi or stayed on the device.
- Against Apple from the dev deployment: with a made-up key in the dev Convex env, `npx convex run
  apnsSend:sendToProfile` reaches the sandbox host and Apple answers `InvalidProviderToken` (the request and
  JWT are well formed; the key just isn't registered). Never set APNS_* on production until the real key.

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
  apps, in-app Safari for links, native keyboard handling, iPad layout with keyboard shortcuts, and (stage 2)
  a share extension, interactive Home Screen and Lock Screen widgets, a Control Center control, Siri and
  Shortcuts actions, Spotlight search of notes and a document scanner with text recognition, and (stage 3)
  push notifications for reminders and mentions with Done and Snooze actions.
- **Payments (3.1.1, 3.1.3)**: no purchases, prices or links to buying in the app (above). Accounts made on
  the web keep their plan. Account creation is in the app (sign up), and account deletion is in Settings >
  Security (Delete account), as 5.1.1(v) requires.
- **Privacy strings**: `NSMicrophoneUsageDescription` (recording audio in a note),
  `NSCameraUsageDescription` (the file picker's Take Photo or Video, and scanning a document into a note),
  `NSPhotoLibraryUsageDescription` (scanning pages from photos; the system picker doesn't need it, but it says
  what the photos are for), `NSFaceIDUsageDescription` (the optional lock). No tracking.
  `ITSAppUsesNonExemptEncryption` is false (HTTPS only).
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
3. **App Group and Keychain sharing**: register the App Group `group.com.folevi` and turn on App Groups and
   Keychain Sharing (`com.folevi.shared`) for all three App IDs (`com.folevi.ios`, `com.folevi.ios.share`,
   `com.folevi.ios.widgets`), then set the team on the ShareExtension and FoleviWidgets targets too. The
   entitlements files are already in place; in the Simulator they work unsigned (Xcode embeds them, and used
   the free personal team's prefix for the Keychain group here). On a device without them the extensions
   can't see the token or the queue. Also App Intents' Siri phrases and the Control Center control need a
   device (and a signed build) to try with Siri and the Action button.
4. **Push notifications** (everything else is built; see Notifications above):
   1. Certificates, Identifiers & Profiles > Keys > +: name it "Folevi APNs", tick Apple Push Notifications
      service (APNs), choose Sandbox & Production, Continue, Register, then Download the `.p8` (it can be
      downloaded only once; keep it in the password manager). Note the Key ID, and the Team ID (top right of
      the developer account, or Membership).
   2. Identifiers > `com.folevi.ios`: tick Push Notifications (automatic signing does this when the team is
      set, since App.entitlements already has `aps-environment`).
   3. Convex, dev first (`npx convex env set ...`), then production when it's time:
      `APNS_KEY_ID` (the Key ID), `APNS_TEAM_ID`, `APNS_KEY` (the whole .p8 file, PEM; written out with `\n`
      for newlines also works), `APNS_BUNDLE_ID=com.folevi.ios`, `APNS_ENV=production` (on production; on a
      deployment only Debug builds use, `sandbox`). Settings > Notifications in the app then shows the switch.
      `scripts/check-prod-env.mjs` warns when only some of them are set.
   4. Sandbox and production: each device token is sent to the host of the environment it was registered
      from (Debug builds from Xcode: sandbox; TestFlight and the App Store: production), with the same key.
      A token sent to the wrong host comes back `BadDeviceToken` and is removed; the app registers it again
      on its next launch. `APNS_ENV` is only the default for a token registered without one.
   5. Try it on a device: a Debug build from Xcode (sandbox), turn notifications on, set a reminder a minute
      ahead, lock the phone; Done and Snooze from the Lock Screen; then the same from a TestFlight build
      (production).
5. **TestFlight**: internal testers first; the review notes above and a demo account for external testing.
6. App Store Connect: screenshots (6.9" iPhone and 13" iPad), privacy labels, age rating, the support URL
   (folevi.com/support) and the privacy policy URL (folevi.com/privacy).

Also worth doing then: notifications on a device (above; the Simulator gets a token but Apple never delivers
a server's push to it), check the iOS 17 behaviour on a device (the Simulator here only had iOS 27), real
airplane mode, Face ID on a device, the background recording behaviour, the camera's document scanner (the
Simulator has none), widgets refreshing on a locked phone (data protection doesn't exist in the Simulator),
and Siri speaking the phrases.

## iOS versions

The app targets iOS 17. Nothing in the Swift code needs a newer iOS: `UIButton.Configuration` and the async
`LAContext.evaluatePolicy` are iOS 15, `LABiometryType.opticID` is iOS 17. Interactive widgets and
`containerBackground` are iOS 17; the Control Center control (`ControlWidget`) is iOS 18 and only offered there
(`#available` in the widget bundle). Capacitor 8 itself supports iOS 15
and up. The app icon: `AppIcon.icon` (Icon Composer, drawn by iOS 26 and later) and `AppIcon.appiconset` with
one 1024 px PNG for iOS 17 to 25. Only iOS 27 Simulators were installed when this was built, so it was
compiled against 17.0 and run on 27.
