# Archive: next steps (HANDOFF.md section 10)

> Frozen copy of `HANDOFF.md`'s "Next steps / open work" section as it stood on 2026-11-26, when the handoff became the `handoff/` folder.
> Nothing here is kept up to date: the current state is in `handoff/state/`, new entries go in `handoff/log/`.

## 10. Next steps / open work
- Native iPhone performance, left from the SwiftUI audit: `CardPicture` still reads `@Environment(\.self)` (any
  environment change runs its body; cheap while the picture is kept); the Mac's `PlaceholderCard` pulses each on its
  own animation (not used on the iPhone); nothing measured with Instruments before and after.
- Native iOS (`claude/ios-native-sync-signin`): check QR scanning and a server sign-in on a device; the sync sheet's
  "Notes waiting to sync" and "Other changes" lists need the outbox and pending notes in the bridge contract (not in
  `sync.status` yet); R5.7's page side (note.prepare waiting for the store); the iPhone's message-card gates
  (offline, update required) were drawn wider than the screen: fixed on `claude/ios-native-today-ui` (3dcf9dc1), not yet seen on screen.
- Native iPad/Duo (`claude/ios-native-ipad-duo`): check iPad landscape, Split View and Slide Over, and the Duo
  upright (669 pt: still the wide layout by the Duo decision; today's web rule would give it the phone's under
  700, owner's call); Foli AI's page is tight beside the sidebar in iPad portrait (conversations and chat side by
  side in about 500 pt).
- Float this note (PR from `claude/float-this-note`): CI's e2e, then merge; it ships in the next release of each app
  (Mac and Windows need new builds for the window; the web works on deploy). Then the owner tries it on the Mac
  (several panels, pin off and on, over a full-screen app), on a Windows PC and in Chrome. Possible follow-ups:
  reopen floating notes after a relaunch, and close a place's floating notes when that place is signed out.
- After 1.6.78 (2026-11-25), in order: the owner drags the Android bundle into Play internal testing; the
  hardware checks listed at the
  top of section 9; Folevi Server packages (the Folevi Server session). `migrations:narrowDocumentText` already ran on production (the owner,
  2026-11-25). Next free version: 1.6.79 (or 1.7.79 for a
  Big update). Mac deltas need `apps/mac/release-archive/Folevi-1.6.78.zip` (kept in the main checkout).
- Shell performance (2026-11-25): merge PRs 84, 85, 86 into their shell branches; check PR 85 on a Windows PC with two
  accounts and a library; Android launch time needs the SDK and an emulator (owner's OK).
- Apple performance: the Mac launch run (owner's OK, 2026-11-25) showed no measurable difference at a load average
  of 43; re-run `perf.mjs` (and `perf-scroll.mjs`) on a quiet Mac with a generated 5,000-note library (`--library`);
  confirm the iOS launch and memory numbers on a Release build on a device.
- Foli AI providers (PR from `claude/foli-ai-openai-anthropic-8112bb`): check CI's e2e and the admin page, then the
  owner merges. After deploy, the owner adds the OpenAI and Anthropic keys in Admin > Foli AI (or sets
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in Convex) and switches features. Possible follow-ups: a "Test key" button
  (one cheap call), a local-mode equivalent is already there (own keys), Anthropic's server-side refusal fallback
  (left out: the owner chose no fallback), and audio attachments in a chat routed to OpenAI or Claude are refused
  by the adapter rather than up front.
- Mac feedback branch (`claude/mac-feedback-8652d2`): the owner checks Home scrolling, folder corners and the new Show
  all tabs in the next Mac build (needs "release it"); a split-view tab in the overview was not drawn in the
  headless check (no split tab in the scratch library).
- Mac feedback round 2 (same branch): the owner's floating note request (float a note in an always-on-top window,
  from a tab or a folder's note list) waits on the owner's answers; not started.
- Android own server (`claude/android-own-server`, PR 103): merge after PR 69 and PR 100, then merge main into it.
  Still open: Android's other windows don't reload when a server is added (only the one that added it); reading a
  real QR code and a full sign-in on a server are untested.
- Android emulators: the android-36 image is still kernel-only (no `system.img`), and `Folevi_Phone` (the
  `phone` AVD in `apps/mobile/android/scripts/emulator.mjs`) uses it. Boot it on the 37.0 image with
  `-sysdir ~/Library/Android/sdk/system-images/android-37.0/google_apis_playstore/arm64-v8a -read-only -wipe-data`,
  or move the AVD to 37.0. Android 37 debug builds log "unable to find plugin : SplashScreen" for the page's
  `SplashScreen.hide` calls (`includePlugins: []`); harmless, but the page could skip that call on Android.
- iPhone/iPad Folevi Server (`claude/ios-server-signin`): not yet checked: QR scanning on a real device (the Simulator
  has no camera), switching names on a network change (the test server has no Connect hostnames), two server places in
  the switcher, the "found on your home network" list (bridge `listLocalServers` exists; no web UI uses it yet), an
  invite QR's token (reduced to the server's origin, not yet carried to its sign-up), and a per-place
  page policy header (the Capacitor app serves pages through Capacitor's own handler, so the meta policy applies alone).
  `apps/mobile` `pnpm sync` names `scripts/prepare-web.mjs`, which was never committed (run `pnpm bundle && npx cap sync`).
  Server side: the server's "Use another account" page in the sign-in sheet fails with "Invalid callbackURL", so a second
  account on the same server can't be added there yet. A pending server sign-in screen has no way back to the open
  place except `places.switchTo`.
- Folevi Server: DS223 install of the ARM64 `.spk` (owner gives SSH user and address), memory on 2 GB (the backend
  reached 1.9 GB RSS after seeding 5,000 notes on an 8 GB VM), Connect on Fly.io (owner's OK per deploy; Cloudflare
  DNS token for folevi.app; `connect.folevi.com` records at folevi.com's DNS), then each app session adds server
  sign-in to its shell (Mac, iPhone/iPad, Android, Windows, Linux). minAppVersion is 1.6.0.
- iOS feedback session (`claude/ios-feedback-b1307a`): 1.5.78 on TestFlight; the branch's PR into `main` carries PRs
  66, 79 and 80 too. Open: on a real iPhone, iPad and Duo, sign in, push, the widgets on the Home Screen, a Shortcut
  run and a Spotlight tap; the new sync sheet signed in; `BackgroundRefresh.swift` not carried over (needs
  Info.plist background task entries). Done here: widgets/Shortcuts/Spotlight, the memory re-run, Duo's fold marks,
  sync words, the starter note's shortcuts.
- Mobile app (`apps/mobile`, PR 66 from `claude/mobile-capacitor-f41734`): note covers stay bundled (owner, 2026-11-24) and styles sync from the server when they change (docs/MOBILE.md "Note styles and covers": signed-in offline caching to build in `apps/web` with the web session; local mode may check for new styles too (owner, 2026-11-24): iOS network rules allow `convex.site/note-styles` and Convex storage images only, copy updated; the endpoint and the page's fetch and cache are the web session's); the owner reviews and merges (merging
  deploys the web, which has the layout change in `lib/iphone.ts`); then check sign-in, push and iPhone Duo folding
  on real devices; carry over widgets, Siri/Shortcuts and Spotlight; one bridge script for both platforms; from the iOS review (docs/mobile/ios-review-2026-11-24.md), the web session's iPad touch targets and the note page's memory growth; release
  scripts for TestFlight and Play (only with the owner's OK).
- Android polish (owner asked 2026-11-25): PR 108 waits on PR 69; then check fold marks and predictive back on a real
  foldable, and a Play build only with the owner's OK.
- Folevi for Linux, changelog at the sync with `main` (main session's ask, 2026-11-25; PR 73 merges last, after PR 65):
  combine Linux into the existing 1.5.75 entry (iOS's, from `claude/mobile-capacitor-f41734` / tag v1.5.75, build
  90) in CHANGELOG.json and CHANGELOG.md rather than adding a second one. Proposed: summary "Folevi on iPhone uses
  less memory as you open and close notes, and Folevi for Linux is here."; added: "Folevi for Linux: AppImage,
  .deb and .rpm for Intel/AMD and ARM computers, at folevi.com/download/linux."; keep iOS's improved line. Tags
  already go to v1.5.76, so nothing new is cut for this.
- Folevi for Linux stores (PR 99 `claude/linux-stores`, owner's OK 2026-11-25; docs/LINUX.md): apt and rpm
  repositories LIVE at `folevi.com/download/linux/apt` and `/rpm` (1.5.75), checked by installing from the live
  addresses on Ubuntu 24.04, Debian 12, Fedora 41, openSUSE Tumbleweed (arm64 containers). Snap: LIVE at
  snapcraft.io/folevi, 1.5.75 stable for amd64 (revision 4, Launchpad remote-build) and arm64 (revision 3), new icon. Flathub: blocked, its AI policy forbids
  AI-written manifests and AI-opened submissions (docs/LINUX.md "Flathub"); only the owner can do it by hand. The
  owner should copy `~/.folevi-linux-signing/folevi-repo-secret.asc` into their password manager. From the next
  Linux release the .deb and .rpm add the repositories on install; each release also runs the repo scripts.
- Folevi for Linux (`claude/linux-tauri-02790e`, 1.5.75 published): the owner tries it on real Linux (docs/LINUX-TESTING.md, files in `~/Downloads/Folevi for Linux 1.5.75 test/`); PR 73 into `claude/desktop-tauri` waits on the owner's review and merge (it reaches `main` with PR 65); record 1.5.75 in version.json/CHANGELOG/tag at merge (main session); the blank-window fix reached Windows (c150ba78); Linux memory (docs/LINUX.md "Memory"): the web export as files beside the program landed (6269a7ff) and is merged here: Linux 355 MB PSS in the VM; later, each with an OK: Flathub, Snap, apt/dnf repositories, an update signing key. Earlier notes:
  check the Linux compile and tests of the merged shell in the VM, build AppImage/.deb/.rpm for x86_64 and
  aarch64 in the Lima VM `folevi-linux`, smoke-test, put test builds in `~/Downloads/Folevi for Linux <version> test/`.
  Owner decisions pending: Linux signing key and repositories on R2, Flathub/Snap submission (all need an OK).
- iPhone and iPad redesign (`claude/ios-native-redesign-f4a8be`): PR 56 into `main` waits on the owner's review
  and merge; the owner tries 1.5.67 from TestFlight. The `v1.5.65` and `v1.5.67` tags are local only (pushing them
  was not asked for). Open question: should the iPad inspector's Foli AI tab get back the web panel's ready-made
  actions (Summarize, Continue...) next to the Ask chat?
  Owner's calls from the 2026-11-23 HIG audit: Foli AI is a tab that opens a sheet (the HIG says tabs navigate,
  never act); section headings stay sentence case (Apple uses title case); dark mode keeps a pure black frame.
  Known gaps: the notifications sheet's rows are not on cards yet; screens borrowed from the iPad (Foli DNA,
  Reviews) keep their own white page under the system bar.
- Folevi for Windows and Linux (`claude/desktop-tauri`, Tauri): the owner tries the CI test builds (checklist in
  `docs/DESKTOP_APP.md`); the Web session adds Windows to folevi.com's download page (stable links above) and the main
  session records 1.5.73; when PR 65's turn comes (after PR 66), merge main and, if the Mac PR merged first,
  combine the two 1.5.73 CHANGELOG entries into one (version.json stays 1.5.73 / 88); fix what testers find; open the Tauri PR into `main` (supersedes PR 58, which the main session
  closes); then, each with the owner's OK: an update signing key (turns the updater on), Windows signing, uploads to
  R2, a download page entry, Flathub (manifest ready), Dropbox/Google Drive sign-in on this platform, a `windows`
  and `linux` minimum in `convex/lib/shellVersions.ts`. Mac keeps its own app (no Mac target here).
- Web everywhere: PRs #61 (platform model, `claude/web-everywhere-0e2975`), #62 (shortcut labels), #63 (Mac no-bounce,
  Android ripple) and #64 (one wording set) are open and wait on CI and the owner's merge (merging deploys). Next PRs: shortcut labels per OS (about 40 files still write ⌘ by hand; `lib/shortcuts.ts keyLabel` exists),
  Windows/Linux/Android accents behind `data-shell`, one motion/empty/loading style, mobile web view performance,
  the "Your own server" sign-in with the Synology session. The starter "Welcome to Folevi" note names Mac shortcuts.
- Folevi Server (`docs/SELF_HOSTING_PLAN.md` v2, `docs/self-hosting/CONTRACT.md`): built on branch
  `claude/sleepy-goodall-3cg4e7` (backend server edition, web server edition with setup and admin panel, `folevid`
  in `server/`, Folevi Connect in `services/connect/`, every package in `packaging/`, Mac/iOS server places, the
  folevi.com/server download page). Owner approved (2026-11-25) merging to main after CI passes and uploading
  packages to R2 (`folevi-updates`, `server/<version>/` and `server/latest.json`): Linux/container after the full
  server run passes, each NAS package after its first real install (Synology on the owner's DS223). Open: the
  Mac/iOS build check on the owner's Mac; Connect deploy (Fly.io, folevi.app DNS on Cloudflare, keys); store
  developer accounts; Convex license confirmation; real icons; email-to-note on servers; guests' limits; owner
  Google keys and covers on servers; dialog closing on resize in the admin panel; invite tokens in `next dev` logs.
- Folevi Server: DS223 install of the ARM64 `.spk` (owner gives SSH user and address), memory on 2 GB (the backend
  reached 1.9 GB RSS after seeding 5,000 notes on an 8 GB VM), Connect on Fly.io (owner's OK per deploy; Cloudflare
  DNS token for folevi.app; `connect.folevi.com` records at folevi.com's DNS), then each app session adds server
  sign-in to its shell (Mac, iPhone/iPad, Android, Windows, Linux). minAppVersion is 1.6.0.
- Folevi Server on the Mac, still to do with the owner: one run of the real sign-in sheet against the test server in
  a 1.6.0 Debug build on scratch data (GUI, needs the owner's OK), and a check with the real bundled export that a server place's data loads over
  `http://localhost:8460/convex` (the header policy and mixed content are covered; the export's own meta CSP must
  also allow `http:`/`ws:`). Optional: `places.scanCode()` on Macs with a camera (left out for now). Possible
  hardening: the Mac's Keychain items use the login keychain, which keeps no "this device only" class; moving
  them to the data protection keychain needs a migration of existing items.
- Backend performance pass, owner's OK needed for production: run `migrations:backfillListStats` (optional, speeds
  up existing folders) and `migrations:backfillDocumentText` (required before the note text switch PR merges).
- Backend performance pass, production: `migrations:backfillDocumentText` ran on 2026-11-25 (373 notes copied, 0
  failed). Next, with the owner's OK: merge #93 (the note text switch), let it deploy, then run
  `npx convex run --prod migrations:narrowDocumentText` from the main checkout. Optional at any time:
  `migrations:backfillListStats` (speeds up existing folders).
- Backend performance pass (`docs/perf/backend-results.md`): kept folder and Drafts counts, task rows that carry
  their note's title, a cheaper `changes.list`, then note text (`searchText`) split out of `documents`
  (widen, backfill, narrow; the owner approves each production backfill).
- Web everywhere (all landed 2026-11-25). Open: the iOS simulator `footprint` re-run of the iPhone memory fix (mobile
  session); there are four empty-state components; lists not yet given `LoadFailed` still load until a retry answers
  (settings lists, Calendar, Graph, pickers);
  splitting the phone interface out of every page's bundle (measure with a production build first); "Your own server"
  sign-in for the apps, planned in the shared notes (`web-everywhere-own-server-plan.md`), after the Synology branch
  lands; the starter "Welcome to Folevi" note names Mac shortcuts. Known failing e2e on `main` (not from this work):
  `iphone-local-settings` switch size, `local-mode` Insert panel, `iphone-chrome` theme bar colour (PR 77 fixes the
  three specs) and `multi-select-local` rubber band (fixed on `claude/project-thread-8numex`).
- Dependencies (2026-11-25 triage): tiptap 3.32 breaks the Markdown list shortcuts ("1. " and "- " stay text;
  `editor-core-edges` and `editor-core-keys` unit tests), so tiptap stays on 3.31.3 until that is understood; bump all
  four `@tiptap/*` together. @types/node stays on 24 to match `.nvmrc` (Dependabot now skips its majors). TypeScript 7
  (Dependabot PR 22, `apps/ios` only) waits for a whole-repo move. The Actions majors (checkout, setup-node,
  upload-artifact v7, pnpm/action-setup v6) are open as Dependabot PRs 19, 20, 21, 27: take them together, since runners
  already force the v4 actions onto Node 24.
- Folevi for Mac on the web view: 1.5.73 is live. PR 67 (`claude/mac-webview`) merges after PR 60. Watch for reports
  of signed-in Macs stuck on loading after updating (no signed-in Release run was observed); the fix path is
  `AppScheme.modeOf` / WebViewFactory. Push the `v1.5.69` to `v1.5.73` and `archive/mac-swiftui` tags if the owner asks. Ask the web session (through the main session) for the Mac's no-bounce motion when
  `inMacApp()`.
- Folevi for Mac 1.5.71 is live. Its PR 60 (`claude/mac-app-d228e2` into `main`, main at bda71bcd merged in) is merged by the main
  session when CI is green. Push the `v1.5.69` to `v1.5.71` tags only if the owner asks. Watch for reports of signed-in Macs
  stuck on loading after updating (see section 9).
- iPhone Duo: PR 55 (https://github.com/faisalibnislam/folevi/pull/55, `claude/iphone-duo-native-ipad` into
- Android native: PR 54 merged into `main` on 2026-11-24 (289b11af), after PR 51 as the owner asked. Native Android is paused (owner, 2026-11-24: one web app everywhere): no Play releases, no new Compose UI.
- Android tabs and polish (`claude/android-tabs`, PR 57 https://github.com/faisalibnislam/folevi/pull/57): web-style tabs on large screens and the
  android-skills audit fixes (`docs/ANDROID_POLISH_2026-11-24.md`). The owner reviews and merges. Its "Not done
  yet" list is the next Android work. Then the owner's Play steps (`apps/android/README.md` "Steps only the owner can do").
- Google Play (2026-11-24): app **Folevi** (`com.folevi.android`) in the Airly.io Play Console account. Internal
  testing is live with release 83 (1.5.68, built from `claude/android-tabs`), tester list "Involets testers"; join link
  https://play.google.com/apps/internaltest/4701659242250904528. Testers see the temporary name "com.folevi.android
  (unreviewed)" until the store listing and app content are done. Next uploads need a higher `build` in `version.json`;
  bundles over 10 MB must be dragged in by the owner (the browser tools can't attach them). No native debug symbols yet.
- iPhone Duo: PR 55 merged into `main` (3fd6cf52); it was PR 55 (https://github.com/faisalibnislam/folevi/pull/55, `claude/iphone-duo-native-ipad` into
  `main`, retargeted after PR 56 merged), replacing PR 53 (closed). 1.5.69 (build 84) from this branch is on TestFlight
  (owner's OK; the branch has 1.5.68's release line merged in). The owner tries it on TestFlight. PR 51 is in main;
  PR 56 (the iPad redesign) is merged into main (546f6aa4); PR 55 now targets main and is merged when its CI is green. Not checked: Split View
  halves, a real device. Next free version: 1.5.70.
- iPhone and iPad redesign (`claude/ios-native-redesign-f4a8be`): PR 56 merged into `main` (546f6aa4);
  the owner tries 1.5.67 from TestFlight. The `v1.5.65` and `v1.5.67` tags are local only (pushing them
  was not asked for). Open question: should the iPad inspector's Foli AI tab get back the web panel's ready-made
  actions (Summarize, Continue...) next to the Ask chat?
  Owner's calls from the 2026-11-23 HIG audit: Foli AI is a tab that opens a sheet (the HIG says tabs navigate,
  never act); section headings stay sentence case (Apple uses title case); dark mode keeps a pure black frame.
  Known gaps: the notifications sheet's rows are not on cards yet; screens borrowed from the iPad (Foli DNA,
  Reviews) keep their own white page under the system bar.
- Android **89 (1.5.74) is live on Play internal testing** (published 2026-11-24 21:51, owner: "release everything
  when ready"), replacing 87. Built from `b5b4b4a3` (this branch with the mobile release `e86fbbca` merged), upload
  key, Firebase push on; on an emulator it updated over the signed 1.5.72 release keeping the library. Testers
  update and report; the next Android upload needs a `build` above 89. Native debug symbols could go up later.
- Android as Capacitor (`claude/android-capacitor-197cf4`, `apps/mobile/android`, with the iOS session's
  `claude/mobile-capacitor-f41734` merged in): open a PR with the owner's OK; it and the iOS branch should land
  together (or this one alone, since it contains the other). Web session: "This Googlebook" device words for Android laptops (FEATURE_PC).
  No Play upload until the owner says so (native releases paused); the upload needs a versionCode above 83.
- Android native (PR 54, merged into `main` as 289b11af): superseded by the Capacitor app above. Its next steps were the owner's Play steps (`apps/android/README.md` "Steps only the owner can do"), and the
  plan's remaining phase 2 items (Credential Manager sign-in, onboarding, sharing sheet, templates).
- Folevi for Mac (native, `apps/mac`, branch `claude/folevi-core-529dbe`), the owner's order of 2026-11-23:
  1. Done 2026-11-23: the owner's Mac UI guide (`docs/design/macloving-mac-ui.md`) as the **full window
     redesign**:
     - hidden title bar
     - an always-visible sidebar (still a List)
     - an opaque rounded content card whose glass top bar is drawn from each screen's `.screenActions` /
       `.screenSearch` / `.screenSubtitle` (`Folevi/Views/Common/ScreenBar.swift`)
     - a flat rounded inspector panel and capsule choices
     - Folevi's ink kept
     - native window tabs kept (the content starts below macOS's tab bar when shown)

     The iPad already had this profile; its card margin is now 12 pt. Not yet looked at on the iPad itself; its
     layout tests pass.

     Superseded the same day: the owner set the guide aside and the window is now native (see "The window" in
     Current state; commit 4a2f2031).

     Then a HIG and Liquid Glass pass (2026-11-23, the owner's "/apple-hig /liquid-glass /liquid-glass-motion
     /axiom:axiom-design" ask): content scrolls under the glass bar (a `safeAreaBar` placeholder, with a soft fade
     drawn behind the bar because macOS draws its own scroll edge effect only under system toolbars); split screens
     (`Destination.isSplit`: Foli AI, Calendar, Vault) start below the bar since AppKit's split view drops SwiftUI's
     safe area; the tab bar state is re-read when a window's tab group changes (restored tabs had left content under
     the tab bar). Left for the owner: the HIG asks for a way to hide the sidebar, but the owner's rule is an
     always-visible sidebar, so none was added. Running `xcodebuild test` into `build/dd` relinks the Debug app with
     the engine twice and it no longer starts: delete `build/dd/Build/Products/Debug/Folevi Dev.app` and run
     `build.mjs` again.
  2. Done 2026-11-23: a signed, notarized, stapled, universal test DMG at
     `apps/mac/release-dist/test-1.5.64/Folevi-1.5.64.dmg` (git-ignored, in the Core worktree). It has the
     production web build and the same designated requirement as the installed Folevi. The owner tries it over
     the installed Folevi with real data. It says 1.5.64 like the live feed, so Sparkle offers no update; the
     next real release must be 1.5.65 or later.
  3. Publish to the `mac/` feed only with the owner's OK. That update reaches every Mac user.
  4. Merge into `main` (pushing `main` deploys the website).
  5. The Mac App Store build: not now.
- Folevi for Mac Debug with a fresh data folder (no places yet): the bundled dev web page fails at once with "The
  operation is insecure" from its Convex WebSocket (seen 2026-11-22), so the first-run gates can't be walked in
  Debug that way; a scratch "on this Mac" library never opens Convex and works. Check the dev bundle's Convex URL
  against the app:// page's content security rules before a real-account test. `app.mjs cmd fakegate` shows a
  gate screen from JSON instead.
- `claude/phone-all-folders-route`: review and merge with the next release (Debug-only bug; no user-visible change in
  Release builds).
- Liquid Glass motion branch (`claude/liquid-glass-animations-b1d70e`): the owner's look on a real Mac and iPhone, then
  merge with the next release. Known left: the Mac's Foli AI chat closes at once, with no exit animation (its host
  view shrinks before SwiftUI can animate the chat out; older than this branch).
0. On real devices: Back after Home's See all (Mac, iPad, web), Show All Tabs' Home picture, iPhone Home's folder
   and note strips (1.5.62).
1. On a real iPhone, iPad and Mac with the owner's library: the note bar swap (1.5.56), Offline & sync's Download
   everything now with an account (1.5.57), frosted folders' scrolling in long grids (1.5.58; on
   `claude/native-perf-pass` folder cards scroll from pictures, and on `claude/note-card-shadow-pictures` note cards'
   shadows: compare with `FOLEVI_CARD_PICTURES=0` on the phone).
2. iPad audit leftovers (found 2026-11-19, not fixed): the tab strip leaves a cut-off empty slot at its start once
   the tabs overflow; database table rows are far too tall on iPad (cause not found: inspect the note page); note
   text cuts off hard at the card's top on scroll. Unprofiled speed ideas: card line layout re-measured at every
   width, the route parsed on every read, the Debug tab-frame mirror.
3. The Foli AI chat's "Working on it…" row with Stop (the owner circled it on 2026-11-20 with the composer): not
   restyled yet.
4. Failed queries retry instead of reaching `app/global-error.tsx` (open PR from `claude/project-thread-u99yc5`); after it
   merges, give `LoadFailed` to the lists that don't have it yet, and check the e2e shard 8 timeout flake (Gotchas).
5. Paused work (Chrome extension) and `pricing-decisions`: only when the owner asks.
6. Mac App Store build (sandboxed, no Sparkle) doesn't exist; only Developer ID. Folevi keeps its `com.folevi.*`
   bundle IDs (the owner's choice, `folevi-keeps-com-bundle-ids.md`): don't rename.
7. Owner items carried from October (status unverified): SPF record for Sign in with Apple's email relay, export
   compliance and App Review, Dropbox app and Google iOS client, Sparkle key backup. Developer ID certificates expire
   2027-02-01: remind the owner in January 2027.
8. Clean up the leftover worktrees under `.claude/worktrees/` (owner's call) and the stale `phone-home*.failed.png`
   files in `apps/native-kit/Tests/FoleviScreensTests/__Snapshots__` (the tests pass; those are old diffs).
