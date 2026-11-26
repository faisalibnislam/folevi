# Archive: change log (HANDOFF.md section 12)

> Frozen copy of `HANDOFF.md`'s "Change log" section as it stood on 2026-11-26, when the handoff became the `handoff/` folder.
> Nothing here is kept up to date: the current state is in `handoff/state/`, new entries go in `handoff/log/`.

## 12. Change log
- 2026-11-26: Signed-in feel pass, web and Mac (`claude/perf-web-mac-1126`, `docs/perf/feel-results.md`): optimistic
  task check-off, bookmark, archive, trash, restore and delete; workspaces asked with `me`; no blur on `.ui-content`;
  Convex JWT kept by the Mac/iOS host for the next page; waiting-edits count debounced before it reaches the host;
  runner start 3 s after a place switch; Quick Add page kept 10 minutes; `perf/feel.spec.ts` and
  `perf/latency-proxy.mjs` to measure account mode near and far.
- 2026-11-26: **PR 132 (`claude/integration-2026-11-26`, merge `135a99af`) landed PRs 117, 130 and 129 together**
  (the owner: "resolve all merging conflict please"). All three edit this file, so they went in as one branch with
  one CI run; checked first with CI's steps, the Mac Debug build and the iOS Simulator build. PR 112 (Android native,
  draft) has main merged in and stays a draft. When several PRs are open again, do the same: one integration branch.
- 2026-11-26: Native iOS 1.7.78 (build 107) on internal TestFlight from `claude/ios-native-today-ui` (delivery
  2c71915f): the SwiftUI refactors and the bar menu fix. Same bundle ID as the Capacitor 1.7.78 (build 103) the Mac
  session uploaded, so testers get the native app as the newer build.
- 2026-11-25: **Windows: home servers over plain http** (branch `claude/windows-server-bridge`, on top of
  `claude/desktop-server-places`): `src/lan_bridge.rs` relays a server place's http and ws traffic to a LAN address
  through `127.0.0.1` (WebView2 blocks it from `https://app.localhost` as mixed content), with the server's own Host.
  The page gets the relay for Convex and Convex site only; links keep the server's name. 5 Rust tests (requests,
  WebSocket, 502, stable port); not yet run against a real server on a real Windows PC.
- 2026-11-25: **Folevi Server keeps every account when its address changes** (branch `claude/server-stable-issuer`,
  server lead). The Better Auth Convex plugin signs tokens with the server's public address as issuer, so turning
  Folevi Connect on or adding a domain made every account read "Finish setting up". In the server edition only,
  `findProfile` (convex/lib/auth.ts) now also finds the profile by the Better Auth user id (only this server's keys
  sign tokens) and a mutation moves it to the new issuer; Folevi Cloud is unchanged. Also merges
  `claude/server-connect`, which never had its own PR: folevid builds on macOS, folevid gives the backend every name
  it answers on (`FOLEVI_TRUSTED_ORIGINS`, Connect names), the Synology package refuses to start on another
  install's leftover files with a clear log line, NAS icons from the app icon, and Connect's Fly config (live at
  connect.folevi.com; services/connect/OPS.md). The owner's DS223 runs Folevi Server on Connect as
  `6ge2xhr4kl.folevi.app` (owner: keep it on).
- 2026-11-26: Native iPhone: a bar's "…" menu (All notes' View as and Sort by, Tags' Sort by, every iOS menu with
  checkable rows) opened greyed out and took no taps. Cause: the frame's switch style (`NativeSwitchStyle`, set by
  `phoneNativeChrome`) reached the menu's Toggles and iOS can't draw a custom style as a menu checkmark. Fix:
  `PhoneMenuRow` gives its Toggle `.toggleStyle(.automatic)`. Checked on the iPhone Simulator.
- 2026-11-26: **Main (1.7.78) merged into `claude/ios-native-today-ui` (PR 129) to clear its conflicts.** The branch
  had released 1.6.79 (builds 103 to 106, TestFlight only) while main released 1.7.78 (build 103): both follow 1.6.78,
  and the version script refuses a Big update after 1.6.79, so the two histories can't both stand. Resolved as:
  version.json, CHANGELOG.json, CHANGELOG.md and every project say main's 1.7.78 (build 103); the iOS projects keep
  this branch's iOS 26 deployment target; the 1.6.79 changelog entry is NOT in CHANGELOG.json any more. Its notes, for
  the next release that carries the native iPhone and iPad app (1.7.79, or 1.7.78 uploaded again): summary "Folevi
  for iPhone and iPad is native again, with the look you know: Liquid Glass bars, faster launch, smoother writing
  and a native Foli AI."; added "Sign in to your own server from the iPhone and iPad sign-in screen"; improved
  "iPhone and iPad screens are native SwiftUI with Liquid Glass, matching today's look", "Home and lists appear at
  once when Folevi opens", "The writing bar rides the keyboard up and down", "Foli AI chat is native, with its
  message box on the keyboard"; fixed "A note opened right after launch no longer shows a blank page", "Stop in Foli
  AI works without an account". **Builds 104 to 106 are used on TestFlight (as 1.6.79): the next iOS upload needs a
  build above 106** (`setBuild` in `scripts/version.mjs`; `version.mjs build` alone would give 104). Also merged
  main into PR 117 and PR 112 (HANDOFF.md only, both sides kept); PR 130 was brought up to date by its own session.
- 2026-11-25: Native iOS SwiftUI refactors (not released): each tab's stack is its own observed box
  (`PhoneTabStack`) drawn by its own view (`PhoneTabStackView`), so a push in one tab doesn't draw the others or the
  tab bar; frames kept for menus are boxes (`PhoneFrameBox`, `PhoneFrameBoxes`), not `@State` written on every scroll
  frame (Foli AI history, Move places, task sheet, notifications, Vault, search chips, folders, bars); notes list
  cards and rows are `PhoneSkipCell`s keyed on what they show, so a window of rows loading doesn't run every card's
  body; `CardPictures` counts changes per card, not one global count; `RebuildFrame` keeps which layout shows
  (phone or wide) as state from `onGeometryChange` instead of a root `GeometryReader` (launch time unchanged:
  Home at about 1.5 s on the Simulator both ways). PhoneScreen's scroll offset turned out to be the web drawing
  only; the iPhone uses the native bar. Tests: tab stacks, card pictures, phone and design suites pass; checked on
  the iPhone Simulator (Home, All notes, Tasks, a note and back, menus).
- 2026-11-25: Native iOS 1.6.79 (build 106) on TestFlight (delivery 8c768201; build 105's upload was cut off by the app quitting): + in the top bar before the sync and the bell with iOS's own menu; performance pass (energy, memory and SwiftUI audits): per-card line slots in WebLineLayout, cached card title lines, cached Foli AI flower, shared calendar/formatters, background refresh at most once a minute, LibraryWatcher's timer paused in the background, PhoneModel.start once, cover colours trimmed. Open from the SwiftUI audit (bigger refactors, not done): PhoneFrameView reading every tab's stack, PhoneScreen's scroll offset re-running the whole screen, per-row frame @State in PhoneRows/Notifications/Vault/FoliAI history/MovePlaces, NotesListModel rebuilding all slots per window load, CardPicture's @Environment(\.self) and global change counter, the root GeometryReader in RebuildFrame, per-card placeholder pulses.
- 2026-11-25: Native iOS 1.6.79 (build 104) on TestFlight (delivery efdcbcd1): Foli AI's sheet slides up and down as iOS's own and its tab is never selected (owner's video: the zoom from the middle of the screen and the blank page looked weird).
- 2026-11-25: Native iOS 1.6.79 (build 103) uploaded to TestFlight from `claude/ios-native-today-ui` (delivery fd1a648b).
- 2026-11-25: Native iOS sync sheet redesign, Your own server sign-in, R5.6 and R5.7 (native) on `claude/ios-native-sync-signin`.
- 2026-11-25: Native Foli AI on iPhone finished on `claude/ios-native-foli-ai` (glass composer on the keyboard, Stop, follow-ups crash, local message ids).
- 2026-11-25: Native iPad and iPhone Duo matched to today's tablet layout on `claude/ios-native-ipad-duo` (49c8757b, 7347a057).
- 2026-11-25: Native iOS restarted on `claude/ios-native-today-ui` to match today's UI (owner's decision); step 1 committed (ae912d75).
- 2026-11-26: Windows/Linux app, library writes: a conditional write (`ifMatch` etag) could lose an update on
  Linux (CI run 45649696992, `two_folder_fs_on_one_folder_never_lose_increments` ended at 34, not 40). Cause: an
  ABA etag. ext4 reuses a freed inode at once and stamps files with a coarse clock, so two same-size rewrites in one
  tick brought back the etag a stale reader held. Fix in `apps/desktop/src-tauri/src/library/fs.rs`: every write
  stamps its own microsecond, never-repeating mtime (`unique_mtime`), and every Folevi writer (other processes too)
  holds an OS file lock, `.folevi-tmp/write.lock`, across the final etag check and the rename (and removes).
  `rust-version` goes to 1.89 for `File::lock`. New tests for both; the race test passed 250 runs in a loop.
- 2026-11-26: **Float this note, edge to edge** (owner's feedback on 1.7.78): the note's colour reaches every edge
  of the floating window (no white at the sides, under the bar or at the foot) and the bar wears the note's colour
  and ink (FloatNote reads them off the page). One web change covers the Mac, Windows and Linux windows and Chrome's
  floating window. Checked: `e2e/float-note.spec.ts` in Chromium and WebKit, with a plain note and an Irises note
  (edges 0 px, bar colour = note colour). Not checked in a Mac build; ships in the next release.
- 2026-11-26: **1.7.78 released** (Big update, build 103) from PR 131's merge (`b11f3256`): web and Convex
  deployed; Mac published; iPhone and iPad on TestFlight (delivery 1ce1048f); Windows installers, Linux packages,
  apt and rpm repositories and the four desktop update feeds published; Snap revisions 7 (arm64) and 8 (amd64) on stable; the Android
  bundle left for the owner's Play drag-in. Two things that needed working around: `apps/mobile` is outside the pnpm
  workspace, so run `pnpm install --ignore-workspace --frozen-lockfile` there before `npx cap sync`; and the x86_64
  AppImage smoke test in the VM's `/srv/jammy-amd64` chroot needs proc, sys, dev and dev/pts bind-mounted, and the
  AppImage's squashfs extracted (`unsquashfs -o <offset of "hsqs">`) and `AppRun` run, since Rosetta's binfmt rule
  doesn't match the AppImage header.
- 2026-11-25: Mac feedback round 2: New note's even 6 px inset; one note in two joined tabs stays in the tab on
  screen (`shownId`/`pick` in `lib/app/tabs.tsx`); hovered tab's pin clear of the title; table cells wrap alike
  edited or not. Checked: typecheck, lint, unit suite (2247), WebKit probes (inset 6/6/6, pin fade 48 px). The table
  wrap and the joined tabs were not checked in a Mac build.
- 2026-11-25: **Float this note** on the Mac app, Windows and Linux app and the web (Chrome and Edge's Document
  Picture-in-Picture): right-click a note tab or a listed note; one window per note on the desktop apps (pinned on
  top until turned off, size and place remembered); full editing in the main window's editor, compact. Branch
  `claude/float-this-note`, nothing released.
- 2026-11-25: **Parity table brought up to date** (docs/DESKTOP_PARITY.md): items 1 to 9 marked done with their PRs,
  `serverPlaces: false` taken out of bridge/host.js (lib.rs handles placesAddServer and placesLocalServers since PR
  128), and the remaining gaps listed.
- 2026-11-25: **Windows and Linux parity PRs landed together** (branch `claude/desktop-parity-integration`): PRs 116,
  118, 119, 120, 121, 123, 124, 125, 126 and 127 merged into one branch (each conflicted with the next in HANDOFF.md,
  Cargo.toml and lib.rs). Resolved once: one `windows` crate line with every feature; the page's boot carries the
  server, the lock and `background`; background sync's unread count uses each Folevi Server account's own Convex
  and site; the open windows are saved in `prepare_to_quit`, so an update's restart keeps them too. 177 Rust tests.
- 2026-11-25: **Your own server in Folevi for Windows and Linux** (branch `claude/desktop-server-places`, item 2 of
  docs/DESKTOP_PARITY.md): `src/server.rs` ports ShellServer (address and folevi.json checks, names, page policy,
  ServerReach, Bonjour); places, sign-in, Convex tokens and the page's config follow each account's server. Rust
  tests pass (155, plus a live lookup against the test server at localhost:8460). Not yet: http servers on the
  home network other than localhost (WebView2 mixed content; the shell is to carry that traffic), and
  `serverPlaces: false` in bridge/host.js comes out once PR 113 is on main.
- 2026-11-25: **Automatic updates for Folevi for Windows and the Linux AppImage** (branch `claude/desktop-updater`,
  first item of docs/DESKTOP_PARITY.md): the Tauri updater is registered, checks a minute after launch and every 12
  hours, and the tray has Check for Updates…. Update key made and kept at `~/.folevi-desktop-signing/` (section 7);
  `packaging/desktop/publish-update-feed.sh` signs the published installers and writes the feed
  (docs/DESKTOP_APP.md, "Updates"). Takes effect from the first release that carries it; 1.6.78 and older have no
  updater, so their users install that release by hand once.
- 2026-11-25: **Desktop parity.** Owner rule: web and Mac features also go to the Windows and Linux app
  (`CLAUDE.md`, `docs/claude-context/memory/desktop-feature-parity.md`). Audit and to-do list in
  `docs/DESKTOP_PARITY.md`. Fixed: the web app now recognises the Windows and Linux apps as native
  (`macBridge.ts`; Linux had counted as a Mac, Windows as a browser), and the Tauri host leaves "Your own server" out
  of the bridge (`host.serverPlaces = false`) until it is built, instead of failing.
- 2026-11-25: **App lock and Windows Hello in Folevi for Windows and Linux** (branch `claude/desktop-app-lock`, item 3
  of docs/DESKTOP_PARITY.md): lockGet/lockSet as on the Mac; Windows Hello on Windows, a passphrase on Linux; the
  shell's cover over the main windows at launch, after time away and after sleep; "Ask for Windows Hello to unlock
  encrypted notes". Rust tests pass (149), the cover was walked through in jsdom (14 checks), the Windows Hello
  code compiles for x86_64-pc-windows-msvc. Not run on real Windows or a Linux desktop.
- 2026-11-25: **Background sync in Folevi for Windows and Linux** (branch `claude/desktop-background-sync`, item 4 of
  docs/DESKTOP_PARITY.md): hidden runner windows for places not on screen, woken and closed by the Mac's
  BackgroundSync plan, and a native unread count per background account. Rust tests pass (152). Not run end to end
  (needs two signed-in accounts on a test machine).
- 2026-11-25: **Windows Jump List** (branch `claude/desktop-launcher-actions`, item 8 of docs/DESKTOP_PARITY.md): New
  Note, Quick Add Task, Today's Tasks; Linux's .desktop actions already had them. Compiles for x86_64-pc-windows-msvc;
  not seen on real Windows.
- 2026-11-25: **Dropbox and Google Drive in Folevi for Windows and Linux** (branch `claude/desktop-cloud-sync`, item 5
  of docs/DESKTOP_PARITY.md): `src/cloud.rs` (loopback PKCE sign-in, sealed tokens, refresh, the page's requests to
  the provider's hosts only, revoke on sign-out) and the shared cloud kit in every page. Waiting on the owner: the
  Dropbox app's loopback redirect URIs, a Google "Desktop app" client, and repository variables
  `FOLEVI_DROPBOX_APP_KEY` / `FOLEVI_GOOGLE_DESKTOP_CLIENT_ID`; until then neither is offered. Rust tests pass
  (149, including a real loopback sign-in that's refused and cancelled); no real sign-in run.
- 2026-11-25: **Notification actions in Folevi for Windows and Linux** (branch `claude/desktop-notification-actions`,
  item 6 of docs/DESKTOP_PARITY.md): Reply (Windows), Mark as Read, Open, Complete and the three Snoozes, Windows
  toasts grouped by note; the web now does Complete and Snooze (they did nothing before, the Mac included). Rust
  tests pass (146); the toast code compiles for Windows; not run on a real desktop.
- 2026-11-25: **Recording a call in Folevi for Windows** (branch `claude/desktop-call-recording`, item 7 of
  docs/DESKTOP_PARITY.md): WebView2's getDisplayMedia with "Share system audio", Windows wording when the sound
  doesn't come. Web unit test passes; not tried on a real PC.
- 2026-11-25: **Shortcuts and Open for attachments in Folevi for Windows and Linux** (branch
  `claude/desktop-shortcuts-open`, part of item 9 of docs/DESKTOP_PARITY.md): the Mac's menu shortcuts the page
  handles, Ctrl+Q on Linux, and attachments opened in their default app. Rust tests pass (144).
- 2026-11-25: **Windows open again where they were in Folevi for Windows and Linux** (branch
  `claude/desktop-window-restore`, part of item 9 of docs/DESKTOP_PARITY.md): every main window and its page, from
  windows.json. Rust tests pass (145).
- 2026-11-25: **Share and text in images in Folevi for Windows** (branch `claude/desktop-share-ocr`, the last part of
  item 9 of docs/DESKTOP_PARITY.md): the Share sheet from the note's Share dialog, and Windows.Media.Ocr for
  search in images. The Windows code compiles for x86_64-pc-windows-msvc; not run on a real PC.
- 2026-11-25: **1.6.78 released** from PR 109's merge (`e0183862`): web and Convex deployed; Mac published
  (notarized, Sparkle feed); iPhone and iPad on TestFlight (delivery 7120ad6e); Windows installers and Linux packages
  uploaded, apt and rpm repositories rebuilt and uploaded; the Android bundle built and left for the owner's Play
  drag-in. CI needed two more fixes before the merge (dialog closing fade, swipe rows) and one re-run of a flaky
  shard (`tab-switch.spec.ts` timed out once, passed on the re-run). Dependabot PRs 19, 20, 21 and 27 were asked to
  rebase with auto-merge on.
- 2026-11-25: **Integration branch `claude/integration-2026-11-25`** (the owner: "check and resolve [the merging issues]
  and release all apps and platforms, I approve everything"). The backlog could not drain PR by PR: every PR edits
  this file, so each merge made the others conflict and restart CI, and the PRs also conflicted in code. PRs 104, 96,
  92, 89, 78, 97, 98, 81, 82, 69 (with 66), 83, 65, 99, 107, 100, 105, 103, 106 and 93 are merged here once, with one
  CI run and one production deploy. Resolutions worth knowing:
  - Foli AI: Folevi Cloud keeps PR 81's per-feature routes and native adapters (`convex/lib/ai/openai.ts`); a Folevi
    Server takes its provider from the server's settings (`provider()` in `convex/lib/ai/provider.ts`), and its
    OpenAI-compatible adapter moved to `convex/lib/ai/openaiCompatible.ts`. `aiConfig.ts` route readers answer from
    `serverRoute` on a server.
  - PRs 100 and 107 were two copies of the server work: merged file by file from the 107 commit each PR 100 file was
    copied from. `convex/auth.config.ts` is main's (107's fix); the server bundle has its own.
  - Folevi Server's repo scripts are `packaging/linux/repo/build-server-apt-repo.sh` and `build-server-rpm-repo.sh`;
    `build-apt-repo.sh` and `build-rpm-repo.sh` are the Linux desktop app's (PR 99).
  - `build-shell.mjs` takes `--platform mobile` and `--platform windows`. Version files follow PR 83 (1.5.78, build 101).
  - Dialog and command palette: the keyboard leaves first (PR 83), then the 150 ms fade (PR 82).
  - The Downloads and Apps pages' pills use `rounded-control` (the corner test refuses `rounded-full`).
  - Auto-merge was turned off on those PRs; they close as merged when this lands.
  - Found by building the apps and by CI's e2e run, and fixed on this branch: PRs 66, 69 and 83 carried the
    SwiftUI-era `apps/mac/project.yml` (the Mac app did not build; main's file is back, with `ShellServer.swift`);
    PR 82's 150 ms closing fade left the page inert, so typing right after a dialog closed was lost
    (`ui/closing.ts` now closes the dialog first and fades its picture as an inert manual popover); PR 83's
    pointer-event swipe rows stayed open after a quick tap elsewhere in Chromium on Linux (they also close on a
    touch `pointerdown` outside the list).
  - Released from this branch as **1.6.78** (build 102), a Big update cut with `scripts/version.mjs release update`
    (the owner asked for 1.6.0; a Big update keeps the patch number, and 1.6.78 meets Folevi Server's
    `minAppVersion` 1.6.0).
- 2026-11-25: CI secret scan reads only the history HEAD reaches (`--log-opts=HEAD`, owner's OK), not every fetched
  branch: test tokens on unmerged branches (Folevi Server, Linux stores) had failed the required check on every PR.
- 2026-11-25: Notes say Android is active (the Capacitor app, PR 69, Play internal testing); only the native Compose
  app is paused. An Android SDK is installed at `~/Library/Android/sdk` (not on PATH), so Android builds can run on
  this Mac.
- 2026-11-25: Performance pass, Android and Windows/Linux shells (`docs/perf/android-windows-results.md`). PRs into
  each shell's branch: #86 Android (Firebase and legacy session off the main thread, one resize per keyboard slide,
  a new Android CI workflow), #84 Tauri (library and reminders open after the window, lighter asset serving and
  scans, launch time in `measure.mjs`), #85 Electron (Quick Add on first use, runners on demand, throttling back
  on). Electron uses about 28% less memory on Windows x64 (CI). Android not measured (no SDK).
- 2026-11-25: Apple shells performance pass (`docs/perf/apple-results.md`). Mac: rules lookup in parallel with the
  library, runners after the first page, private throttling switches for runners only, Keychain off the main thread,
  bridge script cached (2.3 to 0.68 ms per view), test host never activates, `PerfTests`, perf scripts for the web-view
  app, `calendarDays` build fix. iOS (`claude/perf-ios-3eaf61`): Keychain off the main thread. Measured: note-page
  memory flat after warm-up (162 MB Home, about 223 MB after 60 opens, 190 MB under memory pressure). Mac tests: 117
  of 119 pass (the Vision OCR test timed out under load, passes alone). The launch run found and fixed a crash (WebKit's
  default rule store first touched off the main thread through an `async let` default argument).
- 2026-11-25: New Downloads page (`/downloads`, owner's request): every download in one list (Mac, Windows x64 and
  arm64, the six Linux packages and checksums, App Store, Android coming soon, web), in the site nav after Apps and
  in the sitemap. The page is `/downloads` because `/download/*` is rewritten to the R2 download bucket.
- 2026-11-25: Apps page (`/apps`): an Android card, "coming soon to Google Play" with the web app meanwhile (owner's
  choice while Play is internal testing only). Mac, Windows and Linux download links checked (all 200).
- 2026-11-25: Foli AI providers branch: main merged in again (backend performance pass); `convex/aiConfig.ts` now
  builds its mutations from `lib/functions.ts` like every other mutation.
- 2026-11-25: Foli AI on OpenAI and Anthropic too (`claude/foli-ai-openai-anthropic-8112bb`): Admin > Foli AI with
  sealed keys, a provider per feature and Fast/Main/Heavy models; OpenAI (Responses API) and Anthropic (Messages
  API) adapters through their SDKs with native streaming, tools, JSON, web search and prompt caching; credits priced
  per provider; "cheap first" defaults (Gemini Main is now Flash-Lite). 19 new tests; 4 existing tests updated for
  the new default (3 metering tests pin Main to Flash).
- 2026-11-25: Interface-polish pass on the whole web UI (review by typography, surfaces and motion; owner chose to fix
  every MEDIUM and LOW finding): see the commit "Interface polish pass". Checked: typecheck, lint, full unit suite,
  WebKit harness (dialog, command palette and Show all tabs fade out; Mac fades only), screenshots.
- 2026-11-25: Mac feedback: Home's card rows no longer block page scrolling in the Mac app (overscroll held per axis);
  folders 35% less round (`folder` radius token, 9); Show all tabs redesigned (cards of what each tab holds, below
  the top bar, names under cards, on iPad too). How scrolling was checked: a Swift harness puts a WKWebView in an
  offscreen window and calls `scrollWheel(with:)` with CGEvent-made wheel events (location = window coordinates,
  since the event has no window); Playwright's wheel bypasses macOS's scrolling path and can't show this bug.
- 2026-11-25: Android own server, part 2 (PR 103): merged PR 100's a800051c (the sign-in names the server, the
  version check uses the app's version, `places.scanCode`). Added `scanCode` with Google's code scanner
  (`play-services-code-scanner`, no camera permission; the module is installed on first use), only on devices with
  a camera. Emulator: the server's sign-in screen says "Sign in with your account on localhost:8460" with one Sign in
  button; the scanner opens and closing it answers null (Play services reports Back as error 13 there). Reading a
  real QR code wasn't tested (the emulator's camera shows a virtual scene).
- 2026-11-25: Android "Your own server" (Folevi Server places, CONTRACT §6.1) on `claude/android-own-server`, built on
  PR 69 with PR 100 (`claude/server-apps-base`) merged in: `server/ShellServer.kt` (address rules, folevi.json
  check, CSP, the Kotlin twin of ShellServer.swift), `server/LocalServers.kt` (NsdManager `_folevi._tcp`), Places
  accounts carry `server`, AuthBridge sends each account's calls to its own website, `places.server`,
  `addServerPlace`, `listLocalServers` in the bridge, the best connection through connection.ts bundled as
  `assets/folevi-server.js`, per-place CSP header, mixed content only for http server places and sign-in pages,
  cleartext allowed in network_security_config but enforced to home addresses by `net/Http.kt`. Server accounts
  are left out of the share sheet, Quick Add and the outbox (Folevi Cloud's REST API only). 46 unit tests pass
  (8 new). On the emulator against the test server (`adb reverse tcp:8460`; its folevi.json says
  `http://localhost:8460`, so 10.0.2.2 doesn't work): add, refusals, reload bound to the server, CSP and the
  own-server lookup UI checked; sign-in not completed (no test password used). No QR scan: the contract has no
  bridge call for it.
- 2026-11-25: CI secret scan fix for PR 69: gitleaks scans every branch (`git log --all`), so false positives on
  `claude/sleepy-goodall-3cg4e7` (the certificate key type line in folevid's `acme.go`, and made-up tokens in three
  folevid and Connect tests) failed the check on every PR. Their fingerprints are now in `.gitleaksignore`. New test
  values on any branch should carry a `gitleaks:allow` comment, or every open PR fails again.
- 2026-11-25: PR 69 checked on this Mac (Android session): the Android SDK is at `~/Library/Android/sdk` (set
  `ANDROID_HOME`, put `platform-tools` and `emulator` on PATH; JDK is Homebrew `openjdk`). `apps/android` compiles
  (`:app:compileDebugKotlin`, so `CALENDAR_DAYS` is fine); `apps/mobile/android` `:app:assembleDebug` builds and
  `:app:testDebugUnitTest` passes (38 tests, 11 suites). Fixed `pnpm sync` in `apps/mobile`: it ran
  `scripts/prepare-web.mjs`, which never existed (build-shell `--dest ../mobile/web` already copies the export).
  Emulator not run: both installed system images (android-36, android-37.0 google_apis_playstore arm64) are only
  the kernel, without `system.img`; re-downloading android-37.0 is about 2.0 GB and waits for the owner's OK.
- 2026-11-25: Owner OK'd the image download: `system-images;android-37.0;google_apis_playstore;arm64-v8a` reinstalled
  (about 2 GB). PR 69's debug APK installed on `Folevi_Phone` (headless, read-only, 37.0 image, port 5560): MainActivity
  resumed in 2.5 s, no crash, the first-launch screen ("Where should your notes live?") renders.
- 2026-11-25: PR 69 build fix: `Routes.kt:61` and `Tabs.kt:88` used `WebIcon.CALENDAR`, which the icon regeneration
  (c3ce5640) removed; both now use `WebIcon.CALENDAR_DAYS` (owner's pick, matching the web's command palette). Not
  compiled locally (no Android SDK on this Mac).
- 2026-11-25: Merged `main` (e35a97d3, the backend performance pass and the sync status words) into
  `claude/android-capacitor-197cf4` for PR 69 (owner's OK); only HANDOFF.md conflicted, both sides kept.
- 2026-11-25: Merged `main` (4d22880f, the web PRs) into `claude/android-capacitor-197cf4` for PR 69: versions stay 1.5.74 / 89; the web layout files take main's width-decides version (formFactor).
- 2026-11-25: Android polish pass: web side on `claude/ios-feedback-b1307a` (3c8fb728, keyboard bar fix), native side in PR 108 on PR 69's branch; measured on the phone emulator; no Play upload.
- 2026-11-25: iPhone/iPad "Your own server" in the Capacitor app (`claude/ios-server-signin`, PR 106): VisionKit QR
  scan as `places.scanCode`, server places wired into the mobile host, Keychain test for server tokens, Info.plist
  local network keys; PR 100's web sign-in and scan button taken over this branch's; with an account open, adding a
  server no longer reopens that account instead of the server's sign-in (startPlaces skips a pending sign-in, mobile
  and apps/ios hosts). Swift 86/86 (5 ServerTests).
- 2026-11-25: Folevi Server, app side split onto `main` (`claude/server-apps-base`): web server edition, admin panel,
  Your own server sign-in, Connect pages, backend server edition, Mac/iOS server places, best-connection module; server
  functions registered for E2EE routing and local mode; server fallback origin is 127.0.0.1 so shell exports pass.
- 2026-11-25: iOS feedback session: PRs 66, 79 and 80 merged into `claude/ios-feedback-b1307a`; widgets, Shortcuts, Spotlight in the Capacitor app; Duo fold marks; phone sync sheet redesigned; starter note wording; 1.5.78 (build 93) cut for TestFlight.
- 2026-11-25: `main` (4d22880f, all web PRs) merged into `claude/mobile-capacitor-f41734` for PR 66: `lib/iphone.ts`, NotificationsButton and DocumentView taken from `main` (PR 61's width rule, `lib/platform.ts`, replaces this branch's iPhone Duo 600 x 600 rule; `test/mobile-layout.test.ts` removed, `test/platform.test.ts` covers it); HANDOFF both sides kept. Checks: typecheck, lint, all 2,161 web tests, version check and the iOS build pass. 1.5.76 unchanged.
- 2026-11-25: 1.5.76 (build 91) with PR 74's iPhone memory fix uploaded to TestFlight (delivery bc805158); `main` (85574054) merged into `claude/mobile-capacitor-f41734`.
- 2026-11-24: PR 74 plus 1.5.75's change measured: 140 MB after the low-memory signal against a 130 MB start, the same as PR 74 alone; nothing left of the memory growth. 1.5.75 is one shared release with Linux (published untagged by the Linux session first): when PR 66 merges, combine the Linux notes into the 1.5.75 changelog entry. Next free version 1.5.76.
- 2026-11-24: PR 74's fix for the iPhone note memory growth measured on the simulator: after 20 opens and WebKit's low-memory signal, 138 MB against a 136 MB start (before: 232 to 241 MB). Goes into the next TestFlight build once PR 74 merges; when merging main here, keep PR 74's `transitions.ts` (my 1.5.75 change is superseded).
- 2026-11-24: Memory growth traced further: about 60% is the screen copy shown during iPhone moves (kept by WebKit after removal), the rest elsewhere in the iPhone layout; emptying the copy recovers a third of it, shipped as 1.5.75 (build 90) to TestFlight (delivery 13e2530f). A Safari heap snapshot is still needed for the rest.
- 2026-11-24: Mobile memory growth narrowed (docs/mobile/ios-review-2026-11-24.md follow-up): only in the iPhone layout under WebKit, about 5 MB kept per note open; not the bridge, logging, close path or WebKit caches; none on iPad. Needs a Safari Web Inspector heap snapshot next.
- 2026-11-24: 1.5.74 (build 89), the mobile app with the iOS review's fixes, uploaded to TestFlight with the owner's OK (delivery 9fe1d590); tag local.
- 2026-11-24: iOS review of the mobile app (design/HIG, polish, performance; docs/mobile/ios-review-2026-11-24.md): 44 pt hit areas for Calendar's grabber, a note's place chip and Foli AI's Add; local mode's network rules now apply from the first request and compile once. Open for the web session: iPad touch targets under 44 pt and about 4 MB of web memory kept per note open and close.
- 2026-11-24: 1.5.72 (build 87), the Capacitor mobile app, uploaded to TestFlight with the owner's OK (delivery 58636ca8); internal testing only.
- 2026-11-24: Owner: local mode may check Folevi for new note styles. iOS local-mode rules allow only `<deployment>.convex.site/note-styles` and Convex storage images (checked on the simulator: everything else still blocked); features and docs pages say notes never leave the device and the app only checks for new styles.
- 2026-11-24: 1.5.72 (build 87) cut on `claude/mobile-capacitor-f41734` (tag local) for the Capacitor mobile app; iOS IPA exported, TestFlight upload pending a permission; Android build handed to the Android session. PR 66: main merged again; its one failing e2e (vault-team) had passed on the same code the run before.
- 2026-11-24: Owner: keep note covers inside the mobile app and sync note styles when the server changes them. Plan in docs/MOBILE.md; local mode's part asked of the owner.
- 2026-11-24: PR 66 opened for the Capacitor mobile app (`claude/mobile-capacitor-f41734` pushed); open question to the owner: note covers.
- 2026-11-24: `apps/mobile`: one Capacitor app for iPhone, iPad, iPhone Duo and Android around the web app (no native screens), reusing the shared Swift and Kotlin services; window-size layouts in `lib/iphone.ts`; `version.mjs` covers it; checked on simulators and emulators, size and memory compared (docs/MOBILE.md). Branch `claude/mobile-capacitor-f41734`, PR not merged.
- 2026-11-25: Linux icons: every package now uses the desktop icon (`apps/desktop/build/icon-1024.png`, sizes from `icons.mjs`) instead of the web's full-bleed icon-512; Snap `folevi` registered, shipped without the D-Bus slot (owner's pick) so it needs no manual review; arm64 revision 3 uploaded, amd64 building on Launchpad.
- 2026-11-25: Linux apt/rpm repositories published (owner's OK, after the owner's Cloudflare sign-in) and install-tested from the live addresses; Flathub stopped by Flathub's Generative AI policy (no AI-written manifests or AI-opened submissions), recorded in docs/LINUX.md.
- 2026-11-25: Linux stores prepared (owner's OK): signed apt and rpm repositories for 1.5.75 at
  `folevi.com/download/linux/apt` and `/rpm` (built and install-tested in the VM on Ubuntu 24.04, Debian 12, Fedora 41,
  openSUSE Tumbleweed; upload waits on a Cloudflare sign-in), new signing key AEF1 4472 8549 A0B5 9ADC 3A77 67F3 C502
  BF6A 5D42, the .deb and .rpm add the repositories on install from the next release; Flathub manifest on the
  published 1.5.75 .debs, lint clean except screenshots not yet online, real-app screenshots in
  `packaging/linux/screenshots/`; snap built for arm64 and run in the VM (first-launch screen, single instance via
  `com.folevi.Folevi.SingleInstance`).
- 2026-11-25: Windows session: PR 84 (Tauri perf: library opens after the window, lighter asset serving and scans) merged into `claude/desktop-tauri`, then `main` (e35a97d3, backend perf PRs 87, 88, 91 and the safe-queries work) merged in for PR 65; HANDOFF.md conflicts only, both sides kept. version.json stays 1.5.77 / 92 (1.5.77 not published; folevi.com still serves Windows 1.5.73).
- 2026-11-25: PR 73: merged `claude/desktop-tauri` (Windows 1.5.77, main 1a1ca06f); `apps/desktop/RELEASE_VERSION` removed (version.json is 1.5.77), so the next Linux build is 1.5.77 or later unless stamped. CHANGELOG now has iOS's 1.5.75 entry; Linux joins it at the sync after PR 65.
- 2026-11-25: PR 73: merged `claude/desktop-tauri` (now carrying main 4d22880f, the web PRs); HANDOFF conflict only. The web download page's Linux links (apps/web/src/components/marketing/site.ts) match the uploaded latest names.
- 2026-11-25: Main session: PR 73 merges last (after PR 65); its 1.5.75 changelog lines join iOS's 1.5.75 entry at the sync with main (proposed text in Next steps). PR 73 e2e shard 7 (tab-switch.spec) failed twice, then passed on rerun (flaky; the branch changes no web code); all PR 73 checks green. Merge order (main session): 66, 69, 65, then 73.
- 2026-11-24: PR 73: merged `claude/desktop-tauri` again (HANDOFF conflict only); Flatpak CI chose the sandboxed builder on Ubuntu 24.04 (flatpak-builder 1.4.2) and it couldn't find the SDK; the version check in `flatpak-bundle.sh` now parses robustly and logs what it found.
- 2026-11-24: PR 73 conflict (HANDOFF only) resolved by merging `claude/desktop-tauri` (interface installed as files, 6269a7ff; ready marker for measurements). On Linux in the VM: .deb puts the interface at /usr/lib/Folevi/web, the Flatpak at /app/lib/Folevi/web, AppImage inside; all three open; memory 355 MB PSS (main 101).
- 2026-11-24: First Flatpak: ARM bundle from the 1.5.75 .deb built in the VM, installed system-wide and opens to the first-launch screen (tray library loads); copy in `~/Downloads/Folevi for Linux 1.5.75 test/`. Not on Flathub or folevi.com. AppStream release set to 1.5.75.
- 2026-11-24: Flatpak in the VM: the inlined tray modules and the Folevi module build; Ubuntu 22.04's flatpak-builder 1.2 then fails on appstream-compose (gone from GNOME 51), so `flatpak-bundle.sh` uses Flathub's org.flatpak.Builder below 1.3.
- 2026-11-24: `install-build-deps.sh --test-tools` adds elfutils (flatpak-builder needs eu-strip).
- 2026-11-24: PR 73 CI: both Flatpak jobs failed (Flathub's shared tray module puts ayatana-ido in /app/lib64 with the GNOME 51 SDK); the tray modules are now inlined in `packaging/linux/flatpak/com.folevi.Folevi.yml` with `-DCMAKE_INSTALL_LIBDIR=lib` and their patches.
- 2026-11-24: Windows session takes on the web-export-as-files memory idea for Windows and Linux; Linux merges it when it lands and re-measures.
- 2026-11-24: Linux memory measured in the VM (docs/LINUX.md "Memory"): 1.5.75 as published 446 MB PSS; with the merged Quick Add-on-first-use change (e75ac156) 369 MB (Electron on CI: 348). Folevi's own process: 27 MB program file (web export compiled in), 23 MB software renderer (no GPU). Merged `claude/desktop-tauri` (e75ac156, d5283c55) into PR 73.
- 2026-11-24: 1.5.75 is one shared release: Linux downloads and the iPhone/iPad TestFlight build (mobile session tagged v1.5.75); the Linux files keep their names. Next version on any platform: 1.5.76 or later, check the tags first.
- 2026-11-24: PR 73 CI: gitleaks flagged the made-up Vault demo login in apps/mac/scripts/screens.mjs (from the Mac web-view work); added main's same `.gitleaksignore` entry.
- 2026-11-24: PR 73 opened (owner's OK): `claude/linux-tauri-02790e` into `claude/desktop-tauri`, after merging its two newest commits (the cherry-picked blank-window fix, smoke.mjs `--embedded`); the `--embedded` smoke walk passes 7/7 on Linux.
- 2026-11-24: Folevi for Linux 1.5.75 published (owner's OK in chat): 14 files at R2 `folevi-updates/linux/` (versioned AppImage, .deb, .rpm for x86_64 and aarch64, SHA256SUMS-1.5.75.txt, and no-cache latest names), all checked live (sizes, types, a downloaded .deb's checksum). 144 Rust tests pass on the merged code.
- 2026-11-24: Linux 1.5.75 built (AppImage, .deb, .rpm for x86_64 and aarch64) and smoke-tested in the VM: installed .deb and AppImage of both architectures render the first-launch screen (x86_64 through Rosetta); test copies in `~/Downloads/Folevi for Linux 1.5.75 test/`; upload next.
- 2026-11-24: Linux release 1.5.75 under way (owner in chat: upload the Linux builds now; Flathub, Snap, apt/dnf still need an OK): merged the latest `claude/desktop-tauri` (Windows 1.5.73 recorded), `apps/desktop/RELEASE_VERSION` = 1.5.75, `packaging/linux/scripts/upload-release.sh` added; building in the VM, upload to `folevi.com/download/linux/` after the smoke tests.
- 2026-11-24: Desktop app fix found on Linux: release builds showed a blank window because a built-in page was served under the asked-for name ("documents" as application/octet-stream, no boot script); `asset()` in lib.rs now takes exact names only. Likely affects Windows release builds too (told the Windows session). On Linux: release renders from its built-in files, 144 Rust tests and all 7 smoke-walk checks pass; AppImage, .deb, .rpm built for aarch64 and x86_64 with `build-in-lima.sh`.
- 2026-11-24: Linux on the shared shell: merged `claude/desktop-tauri` (ed8a4c17) into `claude/linux-tauri-02790e`; added `apps/desktop/src-tauri/src/linux.rs` with cfg(linux) hooks, the Linux dialog/portal dependencies, `tauri.linux.conf.json`; one Flatpak manifest (`packaging/linux/flatpak`, GNOME 51, tray module) replaced `apps/desktop/flatpak`; `desktop.yml` builds Flatpaks for both architectures. Linux compile and tests running in the VM.
- 2026-11-24: The merged shell compiles on Linux (Ubuntu 22.04 arm64 VM) and 143 of 144 Rust tests pass, the new Linux ones included; `reminders::survive_a_restart_and_late_ones_show_within_a_day` failed once under heavy load and passes 3 of 3 alone (timing). `build-in-lima.sh` now also copies the iOS shell-bridge.js and the local-store fixtures and keeps macOS `._` files out.
- 2026-11-24: Linux probe (a small Tauri app with `linux.rs`, scratch only) passed on X11 in the VM: window renders, tray, notification sent, global shortcut registered, `folevi://new` from a second launch reaches the running app, Secret Service store and read back, desktop dark mode through the portal turns the page dark (WebKitGTK 2.50 does that by itself; the hook keeps GTK's title bar and menus in step). Smoke test fixed (inner part re-invokes the script; test keyring password; portals get the display).
- 2026-11-24: Linux build root fix: the amd64 root is Ubuntu's own 22.04 base image (debootstrap unmounts /proc mid-way and Rosetta can't run x86_64 programs without it); `setup-amd64-root.sh` and `install-build-deps.sh` (no sudo needed as root) updated. The build scripts live in `packaging/linux/scripts/` (the repo's .gitignore drops any `build/` folder, so the first commit missed them).
- 2026-11-24: Folevi for Linux started on `claude/linux-tauri-02790e`: packaging, docs, build scripts and CI workflow committed (34cc11fe); waiting on the shared Tauri shell from `claude/desktop-tauri`.
- 2026-11-25: Merged main (4d22880f, the web PRs incl. the Windows download page, PR 70) into `claude/desktop-tauri` for PR 65; 1.5.73's Mac and Windows changelog entries combined into one release (build 88, tag v1.5.73); web 2,169, Rust 141, bridge 4 tests and the Windows smoke walk pass.
- 2026-11-24: Desktop CI measurements now require the page to have started (the app prints "FOLEVI READY" with FOLEVI_REPORT_READY; measure.mjs --expect-ready fails otherwise). Verified run 45443908032 (every Tauri page started) with both memory changes: Windows x64 151 MB private (375 MB working set) vs Electron's 207 (433), ARM64 149 MB, Linux x86_64 365 vs 349 MB PSS. Not in the published 1.5.73 yet.
- 2026-11-24: Desktop memory work (not in the published 1.5.73 yet): Quick Add's window made on first use (e75ac156; Linux measured 446 -> 369 MB PSS) and the web export installed as files beside the app instead of compiled in (6269a7ff; frontendDist is `apps/desktop/shell-stub`, the pages read from `<resources>/web`); CI run measuring both on Windows pending.
- 2026-11-24: The published Windows 1.5.73 installers opened a blank window (built-in pages served under the asked-for name, so as application/octet-stream without the boot script; the Linux session found it, fix bb9906f0 cherry-picked as c150ba78). Replaced in place with the fixed build from CI run 45418586764 (owner's choice; same names and version; sha256 arm64 4a651ed1..., x64 326d03ba...). Memory corrected: with the page loaded Tauri is about Electron's on Windows (214 vs 207 MB private) and higher on Linux; the earlier "a third lighter" measured the blank page. Quick Add's window is now made on first use. `smoke.mjs --embedded` covers built-in assets.
- 2026-11-24: Release 1.5.73 (build 88) recorded on `claude/desktop-tauri` (untagged: the Mac session's own 1.5.73 on `claude/mac-webview` took tag v1.5.73 three minutes earlier; the main session decided: one release 1.5.73 / build 88 for both, the Mac's tag v1.5.73 (b972616a) stays, no rebuild; whichever of PR 65 and the Mac PR merges second merges main and combines the two CHANGELOG entries into one 1.5.73 entry) with the 1.5.69 to 1.5.72 history from tag v1.5.72; PR 66 (1.5.72) merges first, take the higher version on conflict.
- 2026-11-24: Owner: "release it", on folevi.com: stable latest links live (folevi.com/download/windows/Folevi-arm64-setup.exe and Folevi-x64-setup.exe, no-cache, now 1.5.73); the download page entry (Web session) and the 1.5.73 version record and tag on main (main session) requested.
- 2026-11-24: Folevi for Windows 1.5.73 test download published (owner's OK, after v1.5.72): unsigned NSIS installers at https://folevi.com/download/windows/Folevi_1.5.73_arm64-setup.exe (sha256 72f39313...2f4c) and .../Folevi_1.5.73_x64-setup.exe (sha256 a54b07bf...c241), R2 `folevi-updates` windows/, from CI run 45392111016; no update feed (no signing key); version.json/CHANGELOG/tag for 1.5.73 still to record at merge.
- 2026-11-24: Owner (directly): build Folevi for Windows 1.5.73 test installers now and upload them unsigned to `folevi.com/download/windows/` once tag v1.5.72 exists; `apps/desktop/RELEASE_VERSION` stamps 1.5.73 on this branch (version.json and CHANGELOG still to record it at merge).
- 2026-11-24: PR 65 opened (Tauri desktop app into `main`, supersedes PR 58); merge `main` in when its turn comes (after PRs 55 and 57).
- 2026-11-24: Desktop CI: Windows x64 builds (NSIS 78 MB, MSI 79 MB) and is lighter than Electron (139 vs 204 MB private); Windows etags now use the NTFS file index (concurrent writes lost an update on ARM64); the workflow's binary lookup fixed for Linux.
- 2026-11-24: Folevi desktop moved to Tauri 2 for Windows (ARM64, x64) and Linux (x86_64, aarch64) on `claude/desktop-tauri` (owner: "one web app everywhere", small and light like the Mac app); CI builds and memory measurements; Electron PR 58 superseded, not merged.
- 2026-11-24: Merged `main` (PR 56, iPhone/iPad second round, and the e2e and secret-scan fixes) into `claude/windows-electron-4ed862` to clear PR 58's conflict; only HANDOFF.md conflicted (both sides kept). Owner decided "one web app everywhere": this Electron app becomes the desktop app for Windows, Mac and Linux (Mac and Linux targets wait for the plan).
- 2026-11-24: Folevi for Windows: branch pushed and PR 58 opened into `main` with the owner's OK; not merged.
- 2026-11-24: Folevi for Windows built on `claude/windows-electron-4ed862` (Electron `apps/desktop` revived, Mac parts removed, web `windows` platform); unsigned arm64 and x64 test installers handed to the owner; not merged or published.
- 2026-11-25: Folevi Server built (branch `claude/sleepy-goodall-3cg4e7`): backend and web server editions, setup
  and admin panel walked end to end on a real backend, `folevid` supervisor (encrypted backups, Connect client,
  memory profiles), Folevi Connect service, packages for Synology/QNAP/ASUSTOR/TerraMaster/UGREEN/Unraid/Linux/
  container/TrueNAS/CasaOS/Umbrel, Mac/iOS server places, folevi.com/server. Server domain `folevi.app` (owner
  bought it); owner's test NAS is a DS223 (ARM64, 2 GB).
- 2026-11-25: Self-hosting plan version 2 (`docs/SELF_HOSTING_PLAN.md`): native packages on every NAS that allows
  them, catalog apps on TrueNAS and the container-only systems, native Linux installer for DigitalOcean/Hetzner,
  Folevi Connect for Plex-like access, roles and admin panel, email and other services through optional relays.
- 2026-11-25: the live Bonjour browse (`testAServerAdvertisedOnThisNetworkIsFound`) ran on this Mac with the owner's
  OK and passed: it advertised `_folevi._tcp` and found it with its TXT name, version and url.
- 2026-11-25: Mac sign-in screen may look up any server (`https: http:` in its connect-src, `ShellPolicy.csp`
  `signIn`); `ServerPageTests` (offscreen web view) shows home http servers aren't mixed content on the Mac.
- 2026-11-25: Folevi Server on the Mac: `ServerFlowTests` (end to end against the local test server, Bonjour entries,
  version gate, best connection on a network change, Keychain only); `ServerReach.probe`/`networkChanged()`,
  `LocalServers.entry` (TXT values checked), `ShellAuth.exchange` split out of the sheet; Mac build fixed for the
  regenerated icons (`calendar` is `calendarDays`).
- 2026-11-25: Folevi Server, app side split onto `main` (`claude/server-apps-base`): web server edition, admin panel,
  Your own server sign-in, Connect pages, backend server edition, Mac/iOS server places, best-connection module; server
  functions registered for E2EE routing and local mode; server fallback origin is 127.0.0.1 so shell exports pass.
- 2026-11-25: The owner ran `migrations:backfillDocumentText` on production (373 notes copied, 0 failed); #93 is
  ready to merge, then `migrations:narrowDocumentText`.
- 2026-11-25: Backend performance pass, step 4 (draft PR, waits for the owner and the production backfill): search,
  Foli AI and Spotlight read note text from `documentText`; `documents.searchText` is no longer written, emptied by
  `migrations:narrowDocumentText`, and its search index dropped. Tests read text through `textOf` (tests/convex/helpers.ts).
- 2026-11-25: Backend performance pass, step 3 (widen): `documentText` table holds each note's search text and search
  fields, kept in step by the write hook; `migrations:backfillDocumentText` copies older notes (production run waits
  for the owner). Readers are unchanged until the switch PR.
- 2026-11-25: Backend performance pass, step 2: kept folder and Drafts stats (`listStats`, through the new
  `lib/functions.ts` write hook), task rows with their note's title and icon, `changes.list` reads a note only once it
  has unseen changes, a folder by last edit pages through its index. Numbers in `docs/perf/backend-results.md`.
- 2026-11-25: Backend performance pass, step 1: a generated 5,000-note test library (`convex/devSeed.ts`, test
  accounts only, refused on production), a read-cost harness with Convex's limits on (`tests/convex/perf/`), and the
  baseline in `docs/perf/backend-results.md`.
- 2026-11-25: One set of sync status words on every screen (owner's pick: the desktop's): the phone and iPad's sync
  button (`components/iphone/SyncStatusTouch.tsx`) now reads `SYNC_LABELS` from `components/app/SyncStatus.tsx`
  (Saved, Saving…, Syncing…, Offline, Conflict, Not saved) instead of Synced / Waiting to sync / Edited in two places,
  and its accessible name is the desktop's `sync.button.label` ("Sync status: Offline, 2 changes waiting").
  `offline-notes.spec.ts` follows. Help, docs and marketing already used these words. The paused native apps'
  `SyncStatus.swift` was left as it is. Web unit tests: 2161 pass; e2e not run locally.
- 2026-11-25: PR 79 review fix: a paginated list that failed emptied and swapped "Couldn't load" for the loading
  placeholder on every retry (the retry starts the query over from its first page, and that first load read as
  "ok"). `usePaginatedQuery` now keeps the loaded results and `failed` until the restarted query answers; new
  regression test in `test/safe-queries.test.tsx` (fails on the old hook). Pages loaded with "load more" before the
  failure still go back to the first page once it recovers. Web unit tests: 2167 pass.
- 2026-11-24: Failed queries keep the page: `lib/convex/queries.ts` hooks (retry with backoff, last good result,
  `failed` and `retry()`), used in every component with an eslint rule; `LoadFailed` error state on the main lists;
  local query cache re-runs failed entries; `test/safe-queries.test.tsx`.
- 2026-11-25: Main green pass (`claude/project-thread-8numex`): `multi-select-local` draws its rectangle from under
  Birch (the smaller desktop cards of 2026-11-20 put Alder, Birch and Cedar on one row, so a rectangle from the right of
  Cedar crossed Cedar); `e2ee-approve` waits for the first dialog to close and for the second request's code before
  "They don't match" (failed twice on `main` after PR 76, which changed only docs); safe dependency bumps (katex 0.19.1,
  typescript-eslint 8.72.2, the clipper's @types/chrome 0.3.7 and jsdom 30.1.3, lockfiles regenerated); Dependabot
  groups `@tiptap/*` and skips @types/node majors.
- 2026-11-24: Android 89 (1.5.74) published to Play internal testing (owner dragged the AAB in; Claude added it from the library, notes, published).
- 2026-11-24: Android 1.5.74 (89) built from the merged mobile release for Play internal testing; upload waits on the owner's drag-in.
- 2026-11-24: PR 69 opened for the Android Capacitor app (contains PR 66); mergeable with `main`, not merged.
- 2026-11-24: Merged `main` (PR 60, Mac 1.5.71) into `claude/android-capacitor-197cf4` for its PR: versions stay 1.5.72 / 87, both changelog entries kept.
- 2026-11-24: Android 87 (1.5.72), the Capacitor app, published to Play internal testing with the owner's OK (built from `d2ef501c`, Firebase push on); replaces 83.
- 2026-11-24: Android release prepared for Play internal testing (owner's OK via the main session): dry-run AAB with Firebase push built, signed with build 83's upload key; waiting for the mobile session's 1.5.72 commit.
- 2026-11-24: Merged the iOS session's `claude/mobile-capacitor-f41734` into the Android branch: both had restored the same Capacitor Android app into `apps/mobile/android`; kept this branch's Kotlin and manifest fixes and their shared cloud-kit bundling, R8 rules and bridge additions; `apps/mobile/.gitignore` now ignores only `/web/` (a bare `web/` had hidden the app's `com/folevi/android/web/` Kotlin from their commits).
- 2026-11-24: Android as Capacitor: safe areas reach the WebView, wide-window Back follows the web's tab rule; checked on phone, tablet (signed in), foldable and desktop emulators; size and memory measured against the native app (README). Pushed, no PR.
- 2026-11-24: Android as Capacitor on `claude/android-capacitor-197cf4`: `apps/mobile/android` restored from the paused Capacitor app on Capacitor 8.6.2, updating in place over the native app (same package and storage); version from version.json, upload-key signing, R8, multi-window, no stock plugins on Android; unit, bridge, parity and version tests pass; not pushed.
- 2026-11-24: 1.5.74 (build 89), the mobile app with the iOS review's fixes, uploaded to TestFlight with the owner's OK (delivery 9fe1d590); tag local.
- 2026-11-24: iOS review of the mobile app (design/HIG, polish, performance; docs/mobile/ios-review-2026-11-24.md): 44 pt hit areas for Calendar's grabber, a note's place chip and Foli AI's Add; local mode's network rules now apply from the first request and compile once. Open for the web session: iPad touch targets under 44 pt and about 4 MB of web memory kept per note open and close.
- 2026-11-24: 1.5.72 (build 87), the Capacitor mobile app, uploaded to TestFlight with the owner's OK (delivery 58636ca8); internal testing only.
- 2026-11-24: Owner: local mode may check Folevi for new note styles. iOS local-mode rules allow only `<deployment>.convex.site/note-styles` and Convex storage images (checked on the simulator: everything else still blocked); features and docs pages say notes never leave the device and the app only checks for new styles.
- 2026-11-24: 1.5.72 (build 87) cut on `claude/mobile-capacitor-f41734` (tag local) for the Capacitor mobile app; iOS IPA exported, TestFlight upload pending a permission; Android build handed to the Android session. PR 66: main merged again; its one failing e2e (vault-team) had passed on the same code the run before.
- 2026-11-24: Owner: keep note covers inside the mobile app and sync note styles when the server changes them. Plan in docs/MOBILE.md; local mode's part asked of the owner.
- 2026-11-24: PR 66 opened for the Capacitor mobile app (`claude/mobile-capacitor-f41734` pushed); open question to the owner: note covers.
- 2026-11-24: `apps/mobile`: one Capacitor app for iPhone, iPad, iPhone Duo and Android around the web app (no native screens), reusing the shared Swift and Kotlin services; window-size layouts in `lib/iphone.ts`; `version.mjs` covers it; checked on simulators and emulators, size and memory compared (docs/MOBILE.md). Branch `claude/mobile-capacitor-f41734`, PR not merged.
- 2026-11-25: Web everywhere queue landed (61, 62, 63, 64, 70, 75, 71, 72 after 68 and 74); this is their combined entry:
  PR 62 shortcuts per system (and documents.spec:187 waits for the bar's Share and the panel's focus instead of racing
  them); PR 63 Mac no-bounce motion and Android press ripple, the owner's picks in the web-everywhere memory; PR 64 one
  wording set, Tasks and Calendar icons, Calendar's loading placeholder (native and Android icon files regenerated);
  PR 70 and 75 Windows and Linux downloads on `/apps` (pickers by user agent, every package listed, unsigned-build notes);
  PR 71 note styles sync (`/note-styles`, Cache Storage, newer `updatedAt` wins; the local e2e guard answers the check);
  PR 72 the privacy policy's "Using the apps without an account" paragraph. While queued, these PRs left HANDOFF.md
  alone so each merge didn't conflict the rest.
- 2026-11-25: PR 61 CI fixes: the app counts as a touch device only with touch points (real iPhones, iPads and Android devices report them; the e2e suite's desktop "iOS app" keeps the desktop layout); a tab's 44 pt hit area moved onto its link (the wrapper's layer took the link's taps); the iOS purchase check no longer matches Choose profile picture. Local: ios-app, ios-native, tab-strip-overflow and iphone-app pass (11).
- 2026-11-24: Web everywhere PR 1: touch hit areas of at least 44 pt (`.ui-hit`, `.ui-seg > *`, `:root[data-tablet|data-iphone]`) for the small chrome controls the iOS review measured, no change to the look. Note-page memory growth (iOS review): no web leak found; in Chromium the growth is V8 optimizing existing functions (decelerating) and in desktop WebKit the web process has no trend; waiting on the mobile session's repro details or a Web Inspector heap snapshot.
- 2026-11-24: Web everywhere PR 1 fixes from CI: boards (flowchart, stickies, wireframe, mind map) ignored nothing React handed up from their sheets, so a sheet's buttons never worked with a mouse (`pressIsElsewhere`); the phone layout no longer hides the note's tools while typing on a computer; phone-width e2e steps go through the phone layout. Local CI-style run: 79 + 4 affected account specs pass.
- 2026-11-24: Web everywhere PR 1 merged with `main` (PR 55, iPhone Duo); `lib/platform.ts` now uses the Duo app's fold marks (`data-fold`, `--fold-start`, `--fold-end`) instead of its own; 12 platform unit tests.
- 2026-11-24: Web everywhere PR 1: `lib/platform.ts` (form factor, shell, OS, fold, `<html>` marks), width decides the phone layout on every device (owner's pick), the open Duo gets the tablet layout, every touch tablet gets the iPad's touch look; e2e specs updated for the phone browser's bottom bar; 11 new unit tests.
- 2026-11-24: PR 74's memory spec is tagged @local too and skips outside WebKit (CI's account project had run it signed in, with no local library).
- 2026-11-24: PR 74 also empties the move's screen picture when it ends (`leaving.replaceChildren()`, the iOS review's TestFlight 1.5.75 change): with it a WebKit probe keeps 0 of 10 pictures and 0 of 5 editors in every run. The iOS review's remaining ~2 MB per open (no-copy runs) was the real note screen held by finished animations, which the first PR 74 commit releases; the mobile session re-measures on iOS.
- 2026-11-24: iPhone layout memory fix (branch `claude/web-iphone-note-memory`): the push/pop/zoom moves' finished animations kept every note that slid in reachable in WebKit (about 5 MB per open on iOS); `transitions.ts` now drops their element and handlers when a move ends. Regression spec `e2e/iphone-note-memory.spec.ts` (tagged @local and @mac, skipped outside WebKit) runs in the mac-webkit project against the shell dev server; CI's account project leaves it out. How it was found: a WeakRef probe in Playwright WebKit; note that locators mark what they touch (`__playwright_target__`), which keeps elements alive, so such probes must find elements from inside the page.
- 2026-11-24: Intermittent e2e fix (`claude/web-e2e-flakes`): the note tools panel chose its tool only after a note's details loaded and forgot a tool picked on the previous note, so clicks raced a late switch (documents.spec:187, ai-study.spec:60). Now decided before the note's first draw, and a picked tool stays from note to note. Local stack: both specs 8/8, 42 panel-related account specs pass. Local runs need the stack's GEMINI_API_KEY removed for the "isn't set up" specs (CI has none).
- 2026-11-24: `apps/web/test/version.test.tsx` checks the AppKit app's About panel again (AppDelegate.swift, MenuModel.swift) instead of the SwiftUI app's AppCommands.swift.
- 2026-11-24: Secret scan: the Mac screenshot script's made-up Vault demo values (brought back in 8ebce629) marked `gitleaks:allow` and fingerprinted in `.gitleaksignore`.
- 2026-11-24: Folevi for Mac 1.5.73 (build 88) released to the Mac feed with the owner's OK ("Release it"): the AppKit web-view app with the web's own UI; 1.5.72 (Capacitor mobile) recorded from its tag.
- 2026-11-24: Folevi for Mac back to the AppKit web-view app on `claude/mac-webview` (owner's pick): web's own UI, native frame removed, Mac extras kept; SwiftUI app tagged `archive/mac-swiftui`; 111 Mac tests pass; not released.
- 2026-11-24: Merged `main` (PR 57, bda71bcd) into the Mac branch for PR 60; versions stay 1.5.71 / 86.
- 2026-11-24: Merged `main` (PRs 55 and 59, f7893e54) into the Mac branch for PR 60; versions stay 1.5.71 / 86, changelogs kept.
- 2026-11-24: Folevi for Mac 1.5.71 (build 86) released to the Mac feed with the owner's OK: web-style tabs and the best-native pass; main (PR 56) merged into the Mac branch, 46 Mac tests pass, notarized and stapled.
- 2026-11-24: All branches synced with main (289b11af): PR 56 `claude/ios-native-redesign-f4a8be` (da225a57), PR 55 `claude/iphone-duo-native-ipad` (9642b0f7: Android version read from version.json, `isIphoneApp` keeps the Duo and Android rules), PR 57 `claude/android-tabs`, PR 58 `claude/windows-electron-4ed862`, and `claude/mac-web-tabs` (Phase 0 added). A trial merge of all five onto main in that order is clean except HANDOFF.md change-log lines (keep both); result 1.5.69 build 84. Merge order: 56, then 55 (retarget to main), 57, 58, then the Mac branch's PR. Leftover branches `claude/iphone-duo-ipad-layout`, `claude/ipad-native` and `claude/handoff-2026-11-23` hold nothing new.
- 2026-11-24: Synology native Folevi Server started. Phase 0 passed on branch `worktree-agent-a21c347ca995aad59` (commit 0b4dd44e, not pushed; `docs/self-hosting/PHASE0.md`, `scripts/self-host/`): Folevi deploys to a standalone Convex backend unchanged; single-origin proxy works; memory about 570 MB peak tuned. Fixes needed: optional email verification, internal URLs, LAN http, hide AI/billing, standalone build. Waiting on the owner's OK to download the Linux Convex and Node binaries, and their NAS models.
- 2026-11-24: Self-hosting plan updated with the owner's decision: native Synology `.spk` and QNAP `.qpkg` apps (no Docker), containers elsewhere; the owner also wants a Windows app (options given: revive the Electron app from 7cb6ddda^, Tauri, PWA, native).
- 2026-11-24: Self-hosting plan written for the owner (`docs/SELF_HOSTING_PLAN.md`): Folevi Server on NAS boxes and hosts, apps sign in to any server; plan only, decisions in its section 7.
- 2026-11-24: PR 51 (native Mac app, 1.5.66 to 1.5.68 line) merged into main and deployed; PR 54 freed.
- 2026-11-24: Mac tabs open as on the web and the Mac best-native pass (skills audits + owner picks) on `claude/mac-web-tabs`; not released.
- 2026-11-24: Merged `main` (PR 59, 1.5.70 build 85) into `claude/android-tabs` for PR 57; only the change log conflicted (both sides kept), main's version.json kept.
- 2026-11-24: 1.5.70 (build 85) cut on `claude/ios-release-1.5.70` (off PR 55's branch, all of `main` plus iPhone Duo) and uploaded to TestFlight with the owner's OK (delivery e18198df); tag local. Native releases then paused by the owner (one web app everywhere).
- 2026-11-24: Merged `main` (PR 55, iPhone Duo, 1.5.69) into `claude/android-tabs` to clear PR 57's conflicts; only HANDOFF.md conflicted (both sides kept).
- 2026-11-24: Merged `main` (PR 56, iPhone and iPad second round) into `claude/android-tabs` to clear PR 57's conflicts; only HANDOFF.md conflicted (both sides kept). PR 57's secret scan fixed: it tripped on the Windows branch's placeholder Dropbox key (the scan reads every branch); same ignore line as main.
- 2026-11-24: Play internal testing live: release 83 (1.5.68) published to the internal track with the owner's OK.
- 2026-11-24: Android upload key created (outside the repo) and a signed release bundle built; Folevi created in Play Console with an internal testing track (owner's OK, declarations ticked with the owner's OK); first upload waits on the owner.
- 2026-11-24: PR 54 (Android native app) merged into `main` (289b11af) once CI passed; `main` merged into `claude/android-tabs`, opened as PR 57.
- 2026-11-24: Android tabs on tablets, foldables and Googlebooks with the web's rules, links inside notes, and an android-skills polish pass (security, edge-to-edge, widgets, ANRs, Back, keys) on `claude/android-tabs` (976a7172); pushed, no PR yet.
- 2026-11-24: PR 56 merged into `main` (546f6aa4); PR 55 retargeted to `main` and `main` merged into the Duo branch (no conflicts).
- 2026-11-24: PR 55 caught up again with its base (the iPad branch's test notes and the secret scan's known false positive in `.gitleaksignore`), which clears PR 55's failing secret scan.
- 2026-11-24: PR 56's conflicts with `main` fixed (main's PR 54 merged into the iPad branch, HANDOFF only), then the iPad branch merged into the Duo branch for PR 55: Android's Gradle version comes from version.json (main's), and `isIphoneApp` keeps the Duo's `wide` check next to main's Android phone check.
- 2026-11-24: PR 55's merge conflict with its base (which took main's PR 51) resolved: versions stay 1.5.69 (build 84), changelogs merged.
- 2026-11-24: 1.5.69 (build 84) cut on `claude/iphone-duo-native-ipad` (1.5.68's release line merged in first; 1.5.68 was the Mac fix) and uploaded to TestFlight with the owner's OK (delivery 5facce96): Folevi on iPhone Duo. Tag v1.5.69 local only.
- 2026-11-24: PR 55 opened for the iPhone Duo on the native iPad window (owner: replace PR 53); PR 53 closed, its branch kept.
- 2026-11-24: iPhone Duo made to Apple's Duo page on `claude/iphone-duo-native-ipad` (owner's ask): whole toolbar and the note's tools in iOS's side column, page dock dropped there, sidebar beside the content and to the fold, inspector makes room; fold no longer hides the sidebar.
- 2026-11-24: iPhone Duo put on the native iPad window (local branch `claude/iphone-duo-native-ipad`: PR 53 + the iPad redesign branch; fold handling on the tabs row); PR 53 caught up with the 1.5.66 release branch (HANDOFF conflict only); tabletop checked.
- 2026-11-24: PR 53 held until the 1.5.66 release (PR 51) merges, at the main session's request; then retarget it to main.
- 2026-11-24: PR 52 merged into `claude/folevi-core-529dbe` (owner's OK; no required checks, so it merged before its lint run, which PR 53 had already passed on a superset); PR 53 retargeted to `claude/folevi-core-529dbe`.
- 2026-11-24: iPhone Duo branch pushed with the owner's OK; PR 53 opened into `claude/ios-native-redesign-f4a8be` (PR 52's audit commits merged in first).
- 2026-11-23: iPhone Duo resumed and redone (third pass, owner's pick): the iPad's wide layout when open, the iPhone layout closed; branch `claude/iphone-duo-ipad-layout` on PR 52's branch, not pushed.
- 2026-11-24: Merged `main` (PR 54, Android native) into `claude/ios-native-redesign-f4a8be` to clear PR 56's conflicts; only HANDOFF.md conflicted (next steps and change log, both sides kept). All native-kit iOS tests (274, 31, 38, 28, 31), the macOS build and 39 Mac app tests pass (one earlier run timed out 19 checks in FoleviScreens while the machine's load average was about 40; the rerun passed).
- 2026-11-24: PR 56 opened (iPhone and iPad second round, 1.5.67, into `main`) after merging `main` (PR 51, 1.5.68) into `claude/ios-native-redesign-f4a8be`; all native-kit iOS tests, the macOS build and 39 Mac app tests pass.
- 2026-11-24: Owner confirmed links inside a note stay in the same tab, like the web (saved in `ios-redesign-decisions-2026-11-23.md`); no code change.
- 2026-11-24: iPad tabs audited against the web's rule (owner, 2026-11-24: everything opens in a new tab like the web): already matching, no change. Lists, cards, See all, folder cards, search, palette and Foli AI/notification links open a new tab with an opener (FrameModel.open default); sidebar items and the toolbar's New note open fresh tabs; links inside a note follow in the same tab (FrameModel:694, as tabs.tsx); Back with nothing left closes the tab and returns to its opener (TabsModel.travel). Checked on the iPad simulator.
- 2026-11-24: 1.5.67 (build 82) cut on `claude/ios-native-redesign-f4a8be` (after merging the released 1.5.66) and uploaded to TestFlight with the owner's OK (delivery f33671ae): the native iPad window and the iPhone's system lists. Tag `v1.5.67` local; web and Mac not released; a PR into `main` follows once PR 51 merges.
- 2026-11-24: iPad rebuilt natively and merged (`claude/ipad-native`): system split view, system toolbar (Back/Forward, title, items, ink New note, sync, bell, search), Safari-style tabs row, the note's Style/Format/Insert/Foli AI in the system inspector; Debug iPad launch with FOLEVI_REBUILD_OPEN fixed; all iOS package tests pass on the iPhone simulator.
- 2026-11-24: Owner chose native like the Mac for iOS: iPhone lists and Settings on iOS's own List (rows unlined, native swipe actions); the iPad's native split-view rebuild runs on `claude/ipad-native` (helper, not merged yet).
- 2026-11-24: PR 51 merged, so `main` was merged into the Android branch (PR 54): main's version kept (1.5.68, build 83, read from `version.json`; the old Capacitor `build.gradle.kts` stays deleted); both sides had used contract revision 34, so Android's platform became revision 35 (Swift, Kotlin and fixtures regenerated).
- 2026-11-24: PR 54 CI fix: the version test checked the removed Capacitor project; it now checks that Android's Gradle build reads version.json.
- 2026-11-24: Android native branch pushed and opened as PR 54 (14 commits, merges cleanly with main); not merged.
- 2026-11-24: Android: signing in from the first-launch screen opened an empty Home ("The message names no place.") until a restart; the page's place marker now refreshes when the open place changes. Sign-in checked on an emulator with a dev test account; on `claude/android-native-622675`, not merged.
- 2026-11-23: Android first build on `claude/android-native-622675`: host bridge and services moved in, Capacitor removed, all first-build screens, Vault, Googlebook keys/menus/windows, contract revision 34, R8 release build; not merged.
- 2026-11-23: Android resumed as a native Compose app (owner's answers, research, Kotlin bridge codegen, engine module, app skeleton verified on phone/tablet/foldable/desktop emulators) on `claude/android-native-622675`; not released.
- 2026-11-24: 1.5.68 confirmed by the owner and published to the Mac feed; Mac web-style tabs started on `claude/mac-web-tabs`; Taskeni Mac polish started in its own session.
- 2026-11-24: 1.5.66 released (Mac on Sparkle, TestFlight) and pulled from the Mac feed after it left signed-in Macs on the loading screen (page policy never knew the place's mode); fix in 1.5.68, notarized DMG handed to the owner, not on the feed yet; tabs-match-web rule saved and forwarded.
- 2026-11-23: Folevi for Mac: no more Core naming; `apps/mac/FoleviCore` became `apps/mac/Folevi` (project, target, scheme, module, tests), `core.mjs` became `app.mjs`, internal Core* types became App*; identity, data and update feed unchanged; 38 Mac tests and the web version test pass.
- 2026-11-23: Folevi for Mac: the window rebuilt the native way (system split view, unified Liquid Glass toolbar with each screen's items and search, system inspector, segmented controls, sidebar can be hidden); the Macloving card design dropped at the owner's word; 38 tests pass.
- 2026-11-23: Folevi for Mac: HIG and Liquid Glass pass (content under the glass bar with a soft edge, split screens below it, tab bar state after restored tabs, no shadow on the palette's glass, Jump to Latest materializes, hover on bar choices); iPhone/iPad pass handed to the redesign session (PR 52).
- 2026-11-23: iPhone/iPad audited with apple-hig, liquid-glass, liquid-glass-motion and axiom-design (owner's ask): + is the system's prominent glass, search button titled, 44 pt tag chips and iPad history buttons; owner's calls listed in PR 52.
- 2026-11-23: PR 52 opened (iPhone and iPad redesign into `claude/folevi-core-529dbe`).
- 2026-11-23: iPhone and iPad redesigned after the Mac's window (owner's checkbox answers saved in memory); 1.5.65 cut on `claude/ios-native-redesign-f4a8be` and uploaded to TestFlight; not merged.
- 2026-11-23: `claude/folevi-core-529dbe` pushed to GitHub with the owner's OK (a337b65b) so the iPhone/iPad redesign can open its pull request into it; `main` untouched.
- 2026-11-23: Folevi for Mac: the owner's main-window profile (hidden title bar, sidebar, content card, glass top bar from each screen, flat inspector panel, capsule choices; ink kept, native tabs kept below the tab bar); iPad card margin 12 pt; a notarized test DMG built for the owner (1.5.64, not published).
- 2026-11-23: Folevi for Mac: "Folevi Core" replaced the AppKit app as an update in place (same bundle id, data, Keychain, scheme, Sparkle feed and key, Developer ID profile); `apps/mac-core` became `apps/mac`; the AppKit app is at tag `archive/mac-appkit`; it takes over lock.json, Spotlight and the Electron migration; publish.mjs follows the AppKit flow (universal, changelog notes); LIST-053 drag gap and NOTE-036 Foli DNA of a note done (engine contract revision 34: `web.show` query); a dark-mode accent that kept selected rows unreadable fixed. Next: the full Macloving window redesign on Mac and iPad, then a test DMG.
- 2026-11-22: Folevi Core: Liquid Glass motion pass: one named motion set (`Motion` in `Views/Common/CoreLook.swift`) taken from the family's FoleviSpring/WebMotion (the owner's playful springs: panels grow from what opened them with a visible overshoot, selection slides, bars arrive firmly, Mac presses darken and never scale), each with a Reduce Motion substitute; floating glass (toasts, selection bars, the Ask button, carousel arrows, the folder menu, the palette) materializes instead of fading, in containers that never merge stacked toasts; the Ask panel and palette animate the same from every way in (persistent animation contexts); presses dim instead of scaling with Reduce Motion.
- 2026-11-22: Folevi Core: web screens made native where safe (library passphrase step, system Sign in with Apple button, Touch ID for encryption keys, test feed folder, ink primary gate buttons); two-step, workspace group, e2ee on/off and OAuth consent kept on the web on purpose; owner kept ⌘T, Open at login and native tabs (1,112 there, 6 partly); saved windows per data folder.
- 2026-11-22: Folevi Core: last native items (1,108 there, 15 partly): card grid keys and ⌘A, one intent dispatcher, views paused off screen, notes prepared on press, a billing history list, the large control size; Core's 36 tests pass.
- 2026-11-22: Folevi Core: third finishing round (1,102 of 1,343 there, 21 partly, 0 missing): launch snapshot wired (sidebar, Home, counts drawn at once; nothing kept for encrypted spaces), card previews with the page's line breaks (text.layout), spelling from the word's paragraph with 8 guesses and Learn/Ignore clearing WebKit's underline (core-page.js), Dock badge for places not open, plan badges and reminder marks in the account menu, inline diffs on Changes, a Folders tree, File > Share off a note, early keys after ⌘K, early link handler; design pass (web icons, hovers, no small controls, no row lines, cards 25% smaller, Home spacing); sidebar picks now navigate and start fresh.
- 2026-11-22: Folevi Core: second finishing round (1,041 of 1,343 there, 81 partly, 3 missing): demo mode fixed (one shared demo client), tabs per space, file import, empty-space menu, middle-click, mixed moves, Add Tag, Foli DNA of a note, folder drop zones and spring-loading, optimistic list changes. Drag behaviours and Foli DNA centring are built and unit-tested but not yet tried by hand.
- 2026-11-21: Folevi Core: finishing round toward full parity (1,027 of 1,343 there, 83 partly, 17 missing): lists, folders, tags, tasks, calendar week grid, sharing, templates, changes, notifications, Help window, Settings search and rows, menus, move between places, gate screens, links, App Lock, sidebar rule, inspector. The owner's Mac UI guide (macloving-mac-ui.md) is applied to the sidebar scale and Settings; the owner chose to keep native window tabs, so its main-window profile is not used.
- 2026-11-21: Folevi Core: tabs (trashed notes leave history, background tabs, ⌘T at Search) and Home (catch-up Markdown and sources, reviews card, carousels, all folders with menus and drops); fixed a launch crash restoring windows saved by earlier builds; PARITY.md: 688 there, 290 partly, 155 missing.
- 2026-11-21: Folevi Core: the Vault complete, Quick Add parity, Foli AI chat details and a floating Ask Foli AI panel (⌘J), search and palette, Settings in today's order with a Library pane, About and Support, sidebar details; ready follows the engine client (no more stuck starting screen); PARITY.md recounted: 672 there, 301 partly, 160 missing, 210 n/a.
- 2026-11-21: Folevi Core: draft PR 51; parity checklist (595 of 1,343 present, 343 partial, 195 missing, 210 n/a at first grading) and the first work packages closed (bugs, sharing, folder picker, tabs, task editor, calendar views); Developer ID release with iCloud verified (not notarized).
- 2026-11-21: Folevi Core started in `apps/mac-core` (branch `claude/folevi-core-529dbe`): native app, release and publish scripts, tests, parity checklist. FoleviKit's demo engine is its own target `FoleviEngineDemo` (files unmoved, re-exported by FoleviMac).
- 2026-11-21: Note cards' shadows as shared pictures, faces live and unflattened, on `claude/note-card-shadow-pictures` (Mac All notes 175-232 missed frames to 67-135); not released.
- 2026-11-21: Native performance pass on `claude/native-perf-pass`: folder cards scroll from a picture (Mac Folders 321-347 missed frames to 13-37); report in `docs/NATIVE_PERFORMANCE_2026-11-21.md`; not released.
- 2026-11-21: iPhone (old UIKit frame, Debug builds): Home's Folders "…" > All folders opens the folders grid, not All notes; the Mac's `.allFolders` route opens `/folders` instead of Home; on `claude/phone-all-folders-route`.
- 2026-11-21: 1.5.63 released on Mac and TestFlight (PR 46 + 47 + PR 45's motion pass); the web build was skipped (native-only).
- 2026-11-21: iPhone Home's folder strip no longer cuts its cards' shadow off in a straight line (`scrollClipDisabled`), on `claude/phone-strip-shadows`.
- 2026-11-21: iPhone search's field and close button at the foot above the keyboard (iOS 26), chips just above it; Quick add's Task/Note switch matches Foli AI's Chat/Research, full width; on `claude/phone-search-bottom`.
- 2026-11-21: PR 45 opened for the Liquid Glass motion pass.
- 2026-11-21: Liquid Glass motion pass on `claude/liquid-glass-animations-b1d70e` (shared springs, glass materializing, Mac search morph, swipe velocity, Reduce Motion gaps); not released.
- 2026-11-21: 1.5.62 released on web, Mac and TestFlight (PR 44).
- 2026-11-21: Mac 1.5.59 uploaded (wrangler signed in). CI's type-scale test fixed (Home picture headings use Title 2); 1.5.62 cut on PR 44.
- 2026-11-21: iPhone folder cards fixed (176 pt strips, one-line name fallback), web Show All Tabs draws Home; 1.5.61 cut on PR 44.
- 2026-11-21: 1.5.59 released (web, TestFlight; Mac waiting on the R2 upload). Back-to-opener and the drawn Home picture built on `claude/tab-back-and-overview`.
- 2026-11-21: Folder fronts fully frosted (strong tint and 7 px blur across the whole front), on all platforms.
- 2026-11-21: Folder fronts frosted only behind their words (name, counts, Edited), clear between, on all platforms.
- 2026-11-21: Folder corners match the front, frost 30% lighter, Mac Home carousel gaps and section spacing tightened, on `claude/folder-design-refinements-cd77e4`.
- 2026-11-20: Handoff rewritten for another Claude: sections 9 and 10 as a clean snapshot; the owner's design decisions copied into `docs/claude-context/memory/`.
- 2026-11-20: Frosted folder cards, 25% smaller desktop cards and the new folder glyph built on `design/frosted-folders` (not released).
- 2026-11-20: PR 42 e2e fixes (Created date contrast, the folder name back directly in the front); CI green.
- 2026-11-20: Released 1.5.58 (PR 42 merged).
- 2026-11-20: Released 1.5.57.
- 2026-11-20: Settings sections renamed and reordered (App lock, Signed-in devices).
- 2026-11-20: Offline & sync readings fixed on iPhone, iPad and Mac (whole numbers from the engine); Download gives feedback.
- 2026-11-20: iPhone Home tile counts as quiet badges (branch `catch-up-redesign`).
- 2026-11-20: iPhone sheet bars keep 8 pt between round buttons (branch `catch-up-redesign`).
- 2026-11-20: iPhone Foli AI composer on its own card (branch `catch-up-redesign`).
- 2026-11-20: iPhone sync details sheet redesigned (branch `catch-up-redesign`).
- 2026-11-20: Catch me up page redesigned (branch `catch-up-redesign`).
- 2026-11-20: Quick add polish on iPhone and iPad (branch `ios-quick-add-polish`).
- 2026-11-20: Released 1.5.56: Folevi's own iPhone note bars, trading places with the tab bar in place.
- 2026-11-20: Reverted iPhone notes to Folevi's own bars (owner's call); not yet released.
- 2026-11-20: Released 1.5.55: iPhone notes use iOS's own bars.
- 2026-11-20: `chrome-extension` and `pricing-decisions` brought up to date with `main` (tests pass on both) and pushed; every other branch is already in `main`.
- 2026-11-20: Pushed `chrome-extension` and `pricing-decisions` to GitHub as a backup.
- 2026-11-19: Archived the merged and old branches as `archive/*` tags.
- 2026-11-19: Released 1.5.54 (web, Mac, iPhone and iPad).

- 2026-11-19: pull request 41 (`claude/reverent-leakey-c9bd25`, into `main`): onboarding no longer scrolls sideways
  at phone width while a step slides in (app), closing the tools panel leaves the caret where it is (app,
  `DocumentView.tsx` `closeInspector`), tab-switch also waits for the tab it switches to to be warm, CI's local
  backend gets a 4 second query limit. Local CI-like run and two gotchas added.
- 2026-11-19: pull request 40 merged into `main` as `ce420649` on a fully green CI run (44556502512); production deploy
  completed and CI on `main` green (44562664255). These notes are on `editor/rock-solid`, not yet on `main`.
- 2026-11-19: pull request 40, CI run 44547866717: 7 of 8 browser shards green. `e2e/tab-switch.spec.ts` watched for
  a loading placeholder while the note opened just before was still loading its own lines; it waits for them now.
- 2026-11-19: pull request 40, CI run 44538632686: 6 of 8 browser shards green. Fixed the mind map phone spec (its
  full canvas is checked at 390 again); `e2e/ai-attachments.spec.ts` gets 3 retries on CI (see Gotchas).
- 2026-11-19: `tests/convex/organize.test.ts` holds the clock in its rate limit test: the limit counts per clock
  minute and a CI run that straddled the turn of a minute failed it (pull request 40, run 44537137363).
- 2026-11-19: the two root handoff files (the handoff session's on `editor/rock-solid`, the release session's on
  `main`) merged into this one while bringing 1.5.53 into pull request 40.
- 2026-11-19: Released 1.5.53 (Foli AI tab, iPhone Duo, shorter first-launch copy, marketing pages).
- 2026-11-19: Shorter first-launch copy (where notes live, where the library lives, the passphrase card) on web, Mac, iPhone and iPad, on branch `claude/iphone-duo-18adb4`.
- 2026-11-19: iPhone Duo support on branch `claude/iphone-duo-18adb4` (PhoneColumns, PhoneSideBars, NotePageSlot).
- 2026-11-19: `CLAUDE.md` says to read this file first and keep it current (the owner's OK in chat).
- 2026-11-19: committed on `editor/rock-solid` with pull request 40; next step 1 and the e2e gotcha brought up to
  date (the edits they called uncommitted are in the pull request).
- 2026-11-19: Git state updated: editor/rock-solid pushed as pull request 40; docs/HANDOFF.md section 0 noted.
- 2026-11-19: Handoff created. 1.5.50, 1.5.51 and 1.5.52 released (iPhone and iPad native look, Home and filter fields,
  Filter notes on Mac and web); Foli AI tab on branch `ios-ai-tab`.
