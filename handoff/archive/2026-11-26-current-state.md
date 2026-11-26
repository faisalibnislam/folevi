# Archive: current state (HANDOFF.md section 9)

> Frozen copy of `HANDOFF.md`'s "Current state" sections as it stood on 2026-11-26, when the handoff became the `handoff/` folder.
> Nothing here is kept up to date: the current state is in `handoff/state/`, new entries go in `handoff/log/`.

## 9. Current state (as of 2026-11-26)

**1.7.78 (build 103) is released**, a Big update cut from PR 131's merge (`b11f3256`): the Mac feedback round 2
fixes and Float this note (PR 114, which carried PR 122), plus everything merged since 1.6.78 (the Windows and Linux
parity work in PR 113). Tag `v1.7.78` is local only (not pushed). What is live:

| Platform | 1.7.78 | Checked |
| --- | --- | --- |
| Web and Convex | Deployed by the merge (Vercel status success) | folevi.com, app.folevi.com, `/downloads` and `/signin` answer 200 |
| Mac | Published with `apps/mac/scripts/publish.mjs`: notarized, stapled, Sparkle feed and `mac/Folevi.dmg` on R2, delta from build 102 | Feed's first item is 1.7.78; `stapler validate` passes. Not opened on a Mac |
| iPhone and iPad | TestFlight, internal "Folevi team", delivery `1ce1048f-6e01-45b8-9da3-a4980ac34711` (the Capacitor app, `apps/mobile`) | Upload accepted. Not opened on a device |
| Windows | `windows/Folevi_1.7.78_x64-setup.exe` and `_arm64-setup.exe` plus the two stable names, from CI run 45680883507. Unsigned, as before. Update feeds `desktop/windows-*/latest.json` published (`packaging/desktop/publish-update-feed.sh`) | The stable x64 link serves the new file (same SHA-256); both feeds say 1.7.78 and carry a signature. Not installed on Windows |
| Linux | Six packages and `SHA256SUMS` (`upload-release.sh`); apt and rpm repositories rebuilt and uploaded; update feeds `desktop/linux-*/latest.json` published | Both AppImages pass `smoke-test.sh` in the VM (welcome screen); apt `Packages` lists 1.7.78 and `InRelease` verifies |
| Snap Store | arm64: revision 7 (1.7.78) on stable, built in the VM. amd64: revision 8 (1.7.78) on stable, built on Launchpad (the first `remote-build` lost its connection before building; a plain retry worked) | `snapcraft status folevi` in the VM |
| Android | NOT on Play yet. The signed bundle is at `~/Downloads/Folevi 1.7.78 Android/Folevi-1.7.78-103.aab`; the owner drags it into Play Console's internal testing | Version code and signer checked. Not run on a device or emulator |

Not done, and why:
- **Android on Play:** needs the owner's drag-in.
- **Hardware checks:** Float this note on a Mac (several panels, pin off and on, over a full-screen app), on a Windows
  PC and in Chrome; the first automatic update from 1.7.78 on Windows and Linux (1.6.78 and older have no updater, so
  those users install 1.7.78 by hand once).
- **Flaky Rust test:** `two_folder_fs_on_one_folder_never_lose_increments` failed once on Linux aarch64 during this
  release; worth a look.

## 9. Current state (as of 2026-11-25)

**Native iOS again, matching today's UI (2026-11-25, branch `claude/ios-native-today-ui`, worktree
`.claude/worktrees/ios-native-today`).** The owner found the Capacitor app finicky and chose native SwiftUI for
everything but the writing area, matching today's UI with Liquid Glass and iOS's own controls (decisions:
`docs/claude-context/memory/native-apps-today-ui-2026-11-25.md`). The base is `apps/ios` + `apps/native-kit` on
`main` (RebuildFrame, FoleviPhone), which already had native screens; one big switch, Simulator only until then.
- Step 1 (ae912d75): iOS 26 minimum; `NativeChrome.brandText` keeps Folevi's fonts for interface text (Instrument
  Sans, Spectral titles via the navigation bar's appearance); plain rows on the web canvas instead of cards on grey
  (`PhoneLook.frame` = canvas, `phoneCard` draws no card; grouped screens keep the grey); Home in today's order
  with "Search in <place>" (`PhoneSearchOpener`); + as a floating Liquid Glass button over the tab bar
  (`PhoneCreateButton`; iOS's bar holds five items), no + or search capsule in the top bars. Mac package builds.
- Foli AI (branch `claude/ios-native-foli-ai`): the composer is Liquid Glass and the thread's bottom bar
  (`safeAreaBar`): answers scroll under it, it rides the keyboard with SwiftUI's own avoidance in the sheet and on the
  page (the page's composer used to float mid-screen over a gap), Return sends, a light haptic on Send and a tick on
  Stop (RebuildAI now uses `RebuildFeedback`). Fixed: the tab bar's Foli AI opened its sheet only on the next touch;
  an answer with follow-ups crashed the app (`ai.followup` style missing; `PhoneFollowUp` draws ChatMessage.tsx's
  values); Stop never fired on the iPhone (the Mac's hover and Cmd-. on the button ate the tap) and, in local mode,
  the engine refused it (`validate.ts` ids now allow `~`, a local message id's separator; also fixes Apply, Save as
  note and Copy as Markdown of one answer); the drawer drew under the status bar and kept the keyboard; the thread
  stopped following when the keyboard went. No credits line without an account. Checked on the Simulator with
  Apple's on-device model: send, stream, citations opening notes, follow-ups, Stop, Regenerate, history open and
  delete, light and dark.
- Checked on the "Folevi Native iPhone" Simulator (AC2852C2), local mode: Home, Tasks, Calendar, a note, Foli AI's
  sheet, the account sheet. Reference shots of today's app from the Capacitor build on "Folevi Mobile iPhone".
- Step 2b (branch `claude/ios-native-sync-signin`, from step 2 at af78bdbd): the sync sheet in this week's design
  (`RebuildSync.swift`: hero status, facts card with a live "Last synced", Try again now, iOS sheet with a glass
  Close); "Sign in to your own server" on the native sign-in screen (`RebuildOwnServer.swift`, a native sheet over
  `ShellServer.lookUp`, VisionKit QR scanning where the device can; the button through `gateOwnServer` in
  `FoleviScreens/Onboarding/WebGates.swift`); R5.6 fixed in `ShellSignIn.tsx` (the first-launch choice's flag
  moved to localStorage, so sign-in follows the choice); R5.7 native side (`RebuildNote.swift`: the note's cover
  and a spinner stay until the engine is ready, the note is asked for once more). Debug `FOLEVI_SLOW_ENGINE=<s>`.
  Not checked: QR scanning (no camera in the Simulator), a real server sign-in, the sync sheet signed in.
- Step 2 (all merged on this branch, 2026-11-25): launch snapshot in the rebuild frame (no pop-in), filter fields
  always shown, capital headings, lists loading not empty at launch, the keyboard bar riding down, + readable in dark;
  sync sheet, Your own server sign-in, R5.6 and R5.7 native (`claude/ios-native-sync-signin`); native Foli AI
  finished (`claude/ios-native-foli-ai`); iPad today's tablet layout and Duo (`claude/ios-native-ipad-duo`); Duo
  upright = phone layout (owner); iPad tabs 128 pt least. Web changes ride along: `ShellSignIn.tsx` (R5.6) and
  `lib/engine/validate.ts` (`~` in ids): merging this branch into `main` deploys them.
- Tests: app Debug build, `swift build`, `swift test` (2 timing tests flake only under the full run), web engine
  tests 168/168, tsc. Unchecked: iPad landscape, Split View, Slide Over, rotation (Simulator access not granted), QR
  scan, a real server sign-in, signed-in Foli AI and sync sheet, a device.
- **The switch is uploaded: 1.6.79 (build 103), native `apps/ios`, TestFlight internal "Folevi team", delivery
  `fd1a648b-4f59-4d51-b0f2-758ec65709ae` (owner: "Yes, upload it", 2026-11-25).** It replaces the Capacitor build
  1.6.78 (102) for testers; same `com.folevi.ios`, data carries over. Not opened on a device yet. `version.json` is
  1.6.79/103 on this branch only: merging it into `main` also deploys the two web changes above.
- Next: the owner tests on devices; `apps/mobile` stays for Android (native Compose in the Android session).
- **iPad and iPhone Duo, today's tablet layout (branch `claude/ios-native-ipad-duo`, off this one, 2026-11-25).**
  `IPadFrameView` keeps iOS's split view but draws today's tablet Shell: the sidebar beside the content at every
  wide width (320 pt; it steps aside only for the note's tools in a window under 1000 pt), today's web sidebar
  (`WebSidebar.webBody`: wordmark, the real sync status, bell, its own button, "Search or jump to…", places,
  Folders, Tags, Archive, Trash, account; a note's outline on a note) with no system bar over it; iOS's toolbar in
  today's order (Back and Forward, the tabs via `WebTopBar(stripOnly:)`, Foli AI, New note as a glass +; no title,
  no toolbar search, no floating Ask button). Screens keep their own controls in their content
  (`screensKeepControls`, so `cardSlot` is nil): Calendar's title row, Tasks' views and Add task, list headers;
  narrow content stacks Calendar's day list under the month (iOS only) and scrolls the Tasks views and list header
  controls sideways. A note opens with its outline and the page's dock, the inspector shut until a tool is asked
  for; the page is told `wide` on the iPad too (`RebuildPageLayout.tell`). iPhone Duo open across keeps iOS's
  toolbar column (sideBars) with the same sidebar; closed is the phone layout; half open the sidebar reaches the
  fold. Checked on Simulators "Folevi Native iPad" (11-inch, portrait), "Folevi Native iPad 13" and "Folevi Native
  Duo" (closed, half open, open; note, caret and keyboard carried both ways). Not checked: iPad landscape, Split
  View and Slide Over (no rotation access to the iPad Simulator), Duo upright (the Simulator's rotation drew a
  squeezed frame). Screenshots: `/tmp/folevi-ipad-duo/`.
**Read this first: everything open on 2026-11-25 is merged and released as 1.6.78 (build 102).** PR 109
(`claude/integration-2026-11-25`, merge commit `e0183862`) merged PRs 104, 96, 92, 89, 78, 97, 98, 81, 82, 69 (with
66), 83, 65, 99, 107, 100, 105, 103, 106 and 93 at once; the change log's first entry says why and what was resolved.
Where the paragraphs below say a branch or PR is "not merged" or "open", it is merged now. Tag `v1.6.78` is local
only (not pushed). What is live:

| Platform | 1.6.78 | Checked |
| --- | --- | --- |
| Web and Convex | Deployed by the merge (Vercel status success) | Production answers `server:info` and `aiConfig:overview`; `/signin` shows "Sign in to your own server"; `/downloads` is up; no console errors on either |
| Mac | Published with `apps/mac/scripts/publish.mjs`: notarized, stapled, feed and `mac/Folevi.dmg` on R2, deltas from builds 83, 86 and 88 | Feed's first item is 1.6.78 (102); the DMG is "Notarized Developer ID". Not opened on a Mac |
| iPhone and iPad | TestFlight, internal "Folevi team", delivery `7120ad6e-d96e-4265-be53-67bdd079ce3e` (the Capacitor app, `apps/mobile`) | Upload accepted. Not opened on a device |
| Windows | `windows/Folevi_1.6.78_x64-setup.exe` and `_arm64-setup.exe` plus the two stable names, from CI run 45580647007. Unsigned, as before | Links answer with the new sizes. Not installed on Windows |
| Linux | Six packages and `SHA256SUMS` (`upload-release.sh`); apt and rpm repositories rebuilt in the VM with 1.5.75 and 1.6.78 and uploaded (`upload-repos.sh`) | Both AppImages pass `smoke-test.sh` in the VM; the live `InRelease` verifies with the Folevi key |
| Snap Store | arm64: revision 5 (1.6.78) on stable, built in the VM (`sg lxd -c "packaging/linux/scripts/snap-build.sh ..."`: a plain `limactl shell` lacks the lxd group). amd64: revision 6 (1.6.78) on stable, built on Launchpad (`snapcraft remote-build` in the VM's `~/snap-remote`, about an hour) | `snapcraft status folevi` in the VM shows what is live per architecture |
| Android | NOT on Play yet. The signed bundle (upload key, push values from the owner's `google-services.json`) is at `~/Downloads/Folevi 1.6.78 Android/Folevi-1.6.78-102.aab`; the owner drags it into Play Console's internal testing | Signer checked. Not run on a device or emulator |

Not done, and why:
- **Android on Play:** needs the owner's drag-in (files this size can't be attached from here).
- **`migrations:narrowDocumentText` on production (PR 93's last step):** the owner ran it on 2026-11-25 after the
  release (first answer `{ cleared: 100, done: false }`; it schedules its own next pages until the notes run out, so
  one run is enough). Not checked afterwards: that every page finished. From here, rolling PR 93 back also needs the
  text copied back from `documentText`.
- **Folevi Server packages and stores:** not part of this release. The server code and "Your own server" in every
  app are in; publishing the NAS and Linux server packages stays with the Folevi Server session.
- **Flathub:** needs a person (Flathub's AI policy, docs/LINUX.md).
- **Real hardware:** QR scan on real phones, foldable fold marks and the Android back gesture, real-iPhone swipes,
  the Mac's server sign-in sheet in the app itself, and whether Chromium's click hold-back after a swipe also
  happens on real Android (the swipe rows now close on touch either way).
- **Android security trade-off to review (PR 103):** `network_security_config` allows cleartext because it can't name
  private address ranges; `net/Http.kt` refuses http to hosts that aren't home addresses, and each place has its CSP.
- Mac XCTest and Swift package tests were not run for this release (the Debug build and the universal Release
  build with its signing checks were).

How the backlog was merged, for next time: when several PRs are open, don't merge `main` into each in turn (every PR
edits this file, so each merge restarts the others' CI). Merge them into one integration branch, resolve once, run CI
once. `gh pr merge <n> --disable-auto` and cancelling queued runs keeps them from landing piecemeal meanwhile.

**Float this note (branch `claude/float-this-note`, 2026-11-25, PR open, not released).** The owner's decisions: a
note in a small window of its own that stays on top of other apps, with full editing, on the Mac app, the Windows
(and, with the same code, Linux) app and the web (Chrome and Edge). Entry points: "Float this note" in a note tab's
right-click menu (`TabStrip.tsx`) and in a note's right-click menu in lists (folder pages and Home through
`NoteContextMenu` in `DocumentBrowser.tsx`, search results in `CommandPalette.tsx`, the sidebar's bookmarks in
`Sidebar.tsx`); no shortcut and nothing in the ··· menu. The item is left out where a note can't float (Safari,
Firefox, the iPhone, iPad and Android apps, a desktop app build without the call, a floating window itself). Shared
logic: `apps/web/src/lib/app/float.ts` (where it can float, the Picture-in-Picture manager, remembered sizes, links
from a floating note sent to the main window) and the page `/float/<id>` (`components/app/FloatNote.tsx`): the
note's title and text in the same `DocumentView` (a `useFloating()` flag drops the breadcrumbs, dock, tools panel,
suggestions and backlinks; `globals.css` `:root[data-float]`) under a slim bar with the note's name, Always on top
(desktop apps only), Open in main window and Close. Edits sync as between any two windows.
- Mac: `apps/mac/Folevi/Chrome/FloatWindows.swift`, an `NSPanel` per note (view role `.float`), floating level on
  every Space and over full-screen apps while pinned, stays when Folevi is in the background; size and place by
  autosave name `FoleviFloat-<id>`, pin in UserDefaults `folevi.float.onTop.<id>`. Bridge: `floatNote`,
  `floatOnTop` (features in `mac-bridge.js`), `closeWindow` now also closes a floating panel.
- Windows and Linux: `lib.rs` `create_float` (window label `float-<id>`, no decorations, `always_on_top`, size and
  place by tauri-plugin-window-state, pins in `float-pins.json` in the user data folder); `host.js` adds
  `floatNote`/`floatOnTop` and lets a float window move by its bar (no maximize). On Wayland the compositor may
  ignore always-on-top.
- Web: Document Picture-in-Picture. A page may have one such window, so several floated notes share it: each note
  is an iframe on `/float/<id>?pip=1`, a row of names switches between them once there are two, floating one again
  brings it forward; each note's size is remembered (localStorage `folevi:float-size:<id>`) for when it opens first.
  Chrome places the window itself (position can't be set).
- App lock: a floating note is covered like the main windows (Mac: the same lock cover on its panel; Windows and
  Linux: its window hides while locked and comes back on unlock).
- Tests: `apps/web/test/float-note.test.tsx` (23), `apps/web/e2e/float-note.spec.ts` (4, local mode, Chromium and
  WebKit), `apps/mac/FoleviTests/FloatTests.swift` (8, panels made but never shown), `lib.rs`
  `floating_note_windows`. Not checked: a real floating panel on screen on the Mac or Windows (headless only, per
  the owner's testing rule), and a real Picture-in-Picture window (headless Chromium can't open one; the manager is
  tested with a stand-in window).

**Foli AI on Gemini, OpenAI and Anthropic (branch `claude/foli-ai-openai-anthropic-8112bb`, 2026-11-25, PR open, not
merged).** Owner's decisions: `docs/claude-context/memory/foli-ai-multi-provider-decisions.md`. Admin > Foli AI
(`/admin/foli-ai`, `convex/aiConfig.ts`, `components/admin/FoliAiView.tsx`) picks a provider per feature (chat,
agent, writing, research, attachments, digests, routines, knowledge graph, other) and three models per provider
(Fast, Main, Heavy; Heavy = tools, web search, files, prompts over ~50k tokens). Keys are saved by the owner,
sealed in `aiProviderKeys` (AES-GCM from `FOLEVI_HASH_SALT`), shown only as set + last 4; env vars still work.
Adapters: `lib/ai/gemini.ts` (as before, model and key now from the route), `lib/ai/openai.ts` (OpenAI SDK,
Responses API), `lib/ai/anthropic.ts` (Anthropic SDK, Messages API), shared bits in `lib/ai/common.ts`, routing in
`lib/ai/config.ts`. Transcription and search embeddings always use Gemini; no cross-provider fallback; credits follow
each provider's list price (cache reads/writes and web search priced per provider in `capabilities.ts`).
**Behaviour change on merge:** the owner chose "cheap first" defaults, so Gemini's Main becomes Flash-Lite
(`GEMINI_FAST_MODEL`) and 3.8 Flash (`GEMINI_MODEL`) moves to Heavy; every feature stays on Gemini until an admin
switches it. Tests: `tests/convex/ai-providers.test.ts` (19, fetch stubbed); full convex suite 1,150 pass. Not run
locally: the e2e suite and a visual check of the admin page (this Mac's local Convex backend refused pushes with a
500, with or without the change); CI runs both on the PR.


**Apple shells performance pass (2026-11-25, `docs/perf/apple-results.md`).** Mac (`claude/perf-apple-3eaf61`, PR into
`main`): content rules looked up from WebKit's store and in parallel with the library opening, runners start after the
first page loads (or 5 s), WebKit's private no-throttling switches for runners only, the Keychain read off the main
thread, the bridge script assembled once, an XCTest host that never takes focus, `PerfTests` (XCTest `measure`), and
`perf.mjs` / `perf-scroll.mjs` rewritten for the web-view app. Also fixes `main`'s Mac build (the regenerated icon set
renamed `calendar` to `calendarDays`). iPhone and iPad (`claude/perf-ios-3eaf61`, PR into `claude/ios-feedback-b1307a`):
the Keychain read off the main thread at launch; note-page memory measured and not leaking; `_bridge` route, splash
change and `capacitor://` caching measured and not worth changing.
## 9. Current state (as of 2026-11-24)

**Mac feedback, 2026-11-25 (branch `claude/mac-feedback-8652d2`, the owner's Mac feedback session).** Three fixes in the
web UI the Mac shows (so every platform gets them): (1) Home's rows of note cards blocked scrolling the page in the
Mac app: `globals.css`'s Mac no-bounce rule held both axes on every `.overflow-x-auto`; each region now holds only
along the way it scrolls (`test/mac-scroll-axes.test.ts`). (2) Folders 35% less round: radius token `folder` (9 px,
`rounded-folder`) for the folder card and `FolderGlyph`'s corners. (3) Show all tabs redesigned (owner's picks):
`TabOverview.tsx` + `TabPictures.tsx`; a note tab is its Home card, a split tab two cards (double-wide tile), a
folder tab its folder card, Home and other views a small drawing; names under the cards; it fills the page's panel
below the top bar (no clash with the window buttons); arrow keys by position (`test/tab-overview.test.ts`); also on
the iPad's tab bar now. Then an interface-polish pass (owner's "fix MEDIUM and LOW", conflicts by Folevi's rule):
Mac buttons don't shrink on press, overlays fade out (`ui/closing.ts`, Popover's copy fade), Reduce Motion keeps
fades, no hover lift on the Mac except folders, state icons cross-fade (`ui/SwapIcons.tsx`), concentric corners,
image outlines (`ui-img-outline`), steady-width counters, tab pin/close no longer overlap. Checked headlessly in an offscreen WKWebView harness (real NSEvent wheel events, a
`FOLEVI_BUILD=shell` dev server with the e2e FakeShell, scratch OPFS library); not yet seen in a Mac release build.
**Mac feedback, round 2 (2026-11-25, same branch, new PR).** Web UI fixes, so every platform gets them: (1) New
note (and New folder) sit 6 px from the tab bar's edges on every side, corners concentric (`rounded-small` inside
the bar's 14). (2) A note in two joined tabs no longer jumps to the other tab: the tabs provider keeps the tab on
screen (`shownId`, sticky `current` in `lib/app/tabs.tsx`); a click on a tab or a Show all tabs tile `pick`s that
tab; the strip, `NotePanes` and close follow `shownId` (tests in `test/tabs.test.tsx`). (3) The pin on a hovered
tab no longer sits on the title: the open tab's title fades out clear of pin and close on hover (48 px,
`globals.css` `.ui-tab`), pin and close in `text-muted`. (4) Table cells wrap the same being edited (their `<p>`
lines took `text-wrap: pretty`) as not: `editor.css` sets `text-wrap: wrap` on cells.

**Folevi Server on iPhone and iPad (Capacitor app, branch `claude/ios-server-signin`, 2026-11-25).** "Your own server"
works end to end in `apps/mobile`: the address (typed, or a QR code read with VisionKit's DataScannerViewController,
`apps/mobile/ios/App/App/ServerCodeScanner.swift`, exposed as PR 100's `foleviShell.places.scanCode()` only where the
device can scan; with camera access off it refuses with a reason the page shows), `addServerPlace`, the server's own sign-in
page in the sign-in sheet, and the account becoming a place on that server. The Capacitor host now passes
`places.server` to the page, loads that sign-in screen in account mode (even on first launch or from the library),
runs ServerReach (best connection, re-checked on network changes) and keeps the share sheet's REST base on Folevi
Cloud. The web sign-in screen and scan button are PR 100's (a800051c). Checked on the Simulator: the page at
`capacitor://localhost` (a secure context) can fetch and open ws:// to a plain-http private address (WKWebView doesn't
block it as mixed content), and the Capacitor app sets no policy header, so no-place sign-in pages keep the export's
meta policy (the paused native host in apps/ios would give them ShellPolicy.cloudNarrowing). Server sessions are Keychain items per account (`session.<user id>` in `com.folevi.shell-auth`,
as for Cloud), never in places.json (new `ServerTests.testAServerPlacesTokenStaysInTheKeychain`). Info.plist has
`NSLocalNetworkUsageDescription`, `NSBonjourServices` `_folevi._tcp` and `NSAllowsLocalNetworking`. Checked on the
Simulator against the local test server (http://localhost:8460) as 1.6.0: add, member sign-in, cold restart into the
server place. This branch also carries PR 83 (`claude/ios-feedback-b1307a`), since `apps/mobile` exists only there.

**Folevi Server, app side on `main` (server lead session, 2026-11-25, branch `claude/server-apps-base`).** "Your own
server" sign-in (address, QR, home network, linked servers), the server edition of the web app (`FOLEVI_EDITION=server`:
setup page, server admin panel, `/.well-known/folevi.json`, runtime addresses), Connect's cloud pages
(`/connect/approve`, `connect:myServers`), the backend's server edition (`convex/server*.ts`, `connect.ts`, SMTP, own AI
key, invites, roles), the Mac and iPhone/iPad `ShellServer` places, and `lib/server-edition/connection.ts` (best
connection for the web-based shells). Folevi Cloud is unchanged when `FOLEVI_EDITION` is unset (tests). The supervisor,
Connect service and packages stay on `claude/sleepy-goodall-3cg4e7` / `claude/server-connect`. Contract:
`docs/self-hosting/CONTRACT.md`. Local test server and how apps test against it: shared notes `folevi-server-apps.md`.
Rule for all Folevi Server work: mark every fake test token `// gitleaks:allow` (CI's secret scan reads every branch).

**iOS feedback session, release 1.5.78 (build 93), the Capacitor mobile app, 2026-11-25** (branch
`claude/ios-feedback-b1307a`, worktree `.claude/worktrees/ios-feedback-b1307a`; the owner's own words in chat:
"fix all the issues, push to testflight"). The branch holds `main` plus PR 66 (`claude/mobile-capacitor-f41734`, the
Capacitor app), PR 79 (failed queries keep pages up) and PR 80 (one set of sync words). On top:
- Widgets, the Control Center control, Siri and Shortcuts intents, and Spotlight carried into `apps/mobile` (a
  `FoleviWidgets` target, `com.folevi.ios.widgets`, App Group `group.com.folevi`; sources used in place from
  `apps/ios`; account mode fed by `AppServices.swift`, local mode by the page through `FoleviNative`'s
  `setWidgetSnapshot` / `takeLocalActions` / `finishLocalAction` / `indexSpotlight`). Not checked: a widget drawn on
  the Home Screen, running an intent or Shortcut end to end, account mode. See `docs/MOBILE.md`.
- `mobile-bridge.js` fell back to nothing when `Capacitor.registerPlugin` wasn't there yet, so the page got no native
  events (deep links from widgets and Shortcuts, app foreground and background); it now uses `Capacitor.Plugins`.
- iPhone Duo partly open: `FoldMarks.swift` (UIHingeInteraction plus the web view's `.division` reserved region,
  iOS 27.1) sets `<html data-fold>`, `--fold-start`, `--fold-end` as the native Duo app did. Checked on the Duo
  Simulator: half open the page gets 455 to 496 px and the sidebar reaches the fold; open and closed unchanged.
- The phone sync sheet redesigned (owner's feedback with a screenshot: "needs a huge UI improvement on phone"):
  `components/iphone/SyncStatusTouch.tsx`, a fitted sheet with a coloured status badge, the status and one
  sentence, and a card with Last synced, Waiting on this device, Connection and where it saves. Checked in the
  Simulator light and dark with the button shown temporarily in local mode (not committed); not seen signed in.
- The starter note (`packages/editor-schema/src/seed.ts`) no longer names only Mac shortcuts.
- iPhone top bar (owner's feedback, twice: cards cut off hard under it, then "too pushed to the icon, needs more
  spacing"): `.iphone-bar` in `globals.css` is a soft scroll edge on every screen (solid through the buttons and 8
  pt below them, then a 32 pt cosine fade, no hairline, no blur); the bar's buttons sit 8 pt under the status bar
  (was 4) and content starts 8 pt lower (`Screen.tsx`, Calendar's sticky header, banners, pull to refresh).
- A note's small title laid out mid slide-in could sit over Back; `Screen.tsx` lays it out again after the move and
  when it comes in.
- Uploaded to TestFlight on the owner's "push to testflight", internal "Folevi team": 1.5.78 build 93 (delivery
  45243ea1-b324-41f0-a07d-c8c2126386df), build 94 with the soft edge (2a7f351b-688c-4304-ba19-d6ada2ba8a13),
  build 95 with the spacing and title fix (f11a09ac-9c54-4f2a-8ecc-1e142a4a5dec), build 96 with the Foli AI and
  pop-in fixes below (b948ddf3-c4eb-4eb8-b34b-2941c6ae6cc0). No tag pushed.
- Foli AI (owner's screen recording): the composer went behind the keyboard because the Capacitor app sent no
  keyboard moves and the page's fallback (the visual viewport) reads 0 once the web view shrinks. `KeyboardBridge.swift`
  is now built into `apps/mobile` and `mobile-bridge.js` has `onKeyboard` / `keyboard`. Not checked with an on-screen
  keyboard: the Simulator has a hardware keyboard attached (toggle it in the Simulator pane to check). Also: the chat's
  preloaded code draws in the same turn (`AskAiChat.tsx`, a settled thenable for `lazy`), the stand-in is shaped like
  the composer, capabilities are kept per account (`ChatThread.tsx useLastKnown`), + Add shows while loading.
- Pop-ins: Home's counts, Reviews and Vault, the bell dot, Calendar's tasks and Tasks' counts use `useOfflineQuery`.
  Measured in local mode: no late DOM insertions on All notes, Tasks, Calendar. Account mode not checked (no account).
- Seen in the recording, not fixed: Home's lower half blank for a frame after the keyboard closes (WebKit repaint after
  the resize).
- Phone polish pass (owner: "the app feels finicky, a lot of small things load when I go to the page"), build 97
  (delivery d20d43f0-5651-4156-ae39-72d39011864a). Cause found by an audit: the iPhone remounts each screen on every
  push, pop and tab switch (`IphoneShell.tsx key`), so anything not cached loads again. Fixed: note lists keep their
  first page per list in memory (`DocumentBrowser.tsx firstPages`), Tasks use `useCachedQuery` (now with
  `failed`/`retry`), theme images keep their signed URL and palette for 50 minutes (`coverImage.ts`), calendar events
  and backlinks use `useOfflineQuery`, the list header and Select show while loading, Catch me up reads its brief
  before the first frame, Changes and Reviews hold their last answer, Settings/Changes/Shared/Reviews/Vault preload
  on the phone and draw in the same turn (`RouteView.tsx soon`), the note bar takes the page's tone in
  `useLayoutEffect`, press feedback waits 70 ms, and a note no longer fades and tilts in on top of the zoom.
- The rest of the audit, build 98 (delivery 6ce7ce3e-efa3-4ac1-aeca-0ba594e74920; the first upload try failed when a
  cleanup removed altool's temporary copy, the retry with the same .ipa succeeded): leaving rows (checked tasks, swipe
  to Trash/Archive) slide, fade and fold away (`components/iphone/exit.tsx`, `Swipe.tsx` `removes`, `Tasks.tsx`);
  SwipeRow uses passive Pointer Events with `touch-action: pan-y` (no touchmove listener holding up scrolls); the
  week-to-month strip moves with transforms only (`WeekStrip.tsx`); the tab bar moves on the push's spring when the
  move starts (`transitions.ts onMoveStart`); `READY_WAIT_MS` 50 (was 150); Reduce Motion keeps opacity-only fades
  (150 ms); Spectral uses `display: fallback`. Checked in the Simulator: the Foli AI composer above a real on-screen
  keyboard (it stays at 292 of 374 pt), the month opening and closing, a checked task folding away after about 0.9 s.
- Build 99 (delivery cea3add5-fcd0-4340-b6bc-5a8ceefb2abe): the keyboard leaves cleanly. Recorded in the Simulator
  (`simctl io recordVideo --display=1`, frames at 30 fps): closing Foli AI, the keyboard stayed up about 0.45 s after
  the sheet had gone, then Home showed blank where it had been for about 150 ms. Cause, measured: Capacitor's Keyboard
  plugin gives the web view its height back at keyboardWillHide, and WebKit takes about 90 ms (the page's own resize
  handlers take 0 ms) to lay the page out and draw it at the new size while the keyboard moves. Fix: a sheet closing
  with its field in focus lets the keyboard go as it starts to close, through `letKeyboardGo` (`lib/native/ui.ts`),
  which first calls the app's new `foleviNative.keyboardWillLeave` (`FoleviNativePlugin.swift`: the web view back to
  full height under the keyboard) and blurs once the page has re-laid out and drawn (resize plus two frames, at most
  300 ms); the sheet's own move starts a frame earlier. Done over a note and Hide keyboard use it too (blur after
  126 ms, measured). After: no blank frames as the keyboard uncovers Home. A keyboard dismissed by the user's own
  gesture (dragging it down) still goes the Capacitor way.
- Swipe axis lock checked in the Simulator with real touch drags (List layout of All notes): a sideways swipe opens
  Archive and Trash without scrolling; a vertical drag starting on a row scrolls the list 184 pt and opens nothing.
- iPad polish pass, build 100 (delivery e0d350bc-6c0e-4517-ba54-7b8cb39076b6; owner: "do the same polish pass for
  iPad"). The tablet layout (Shell, Sidebar, TabStrip, HomeDashboard, PageDock), audited then fixed:
  - Sidebar: unmounted on close and when a note opens, so its counts and rows loaded again each time; all its queries
    and the unread badge use `useOfflineQuery` (clock-moving ones held, as on the phone). It slides in and out with the
    page (transform only, 260 ms; `Shell.tsx`), checked on the iPad Simulator: hide 8 to -320 over about 270 ms, show
    with an ease-out. 44 pt targets for the folder chevron, Bookmarks toggle and pane buttons.
  - Home: Today's reviews held, Recent folders measure columns before paint. Settings, Foli AI, Changes, Shared,
    Reviews and Vault preload on the iPad too (`RouteView.tsx`). Tab titles keep known titles (`TabStrip.tsx`).
  - Touch: sidebar rows, tabs and sidebar buttons show a press (they only had hover), after the 70 ms beat.
  - Keyboard: the note's tool bar and overlay panels ride the keyboard (`rideKeyboard` in `lib/native/ui.ts`, the lift
    is `max(0, keyboard - (screen - 100dvh))` in CSS so the web view's resize can't leave it a frame out of place;
    measured: no more off-screen frame). Closing the floating chat, the command palette, prompts and popovers with a
    field in focus lets the keyboard go first (`afterKeyboardGoes`).
  - Motion: menus and popovers open on one 150 ms rise (`POP_IN`) and fade out (`popOut`); the note's floating side
    panel fades out on Close panel (`Inspector.tsx`).
  - Not changed, on purpose: `FolderDropLayer.tsx`'s document-wide non-passive touchmove (it lets press-and-hold drag
    stop the page scrolling; WebKit decides at touchstart, so it can't be added mid-drag).
  - Checked in local mode on a new "Folevi Feedback iPad" Simulator (iPad Air 11-inch): no late DOM insertions on Home,
    All notes, Tasks, Calendar or a folder. Not checked signed in or on a device.
- iPhone Duo polish pass, build 101 (delivery 1add5ccd-2e5c-4ae5-bb55-0266131abb81; owner: "do the same polish pass
  for iPhone Duo"). Audited, then fixed:
  - Folding and unfolding rebuilt the note page (phone and tablet layouts are different trees): the caret, scroll and
    keyboard were lost, against the owner's carry-over rule. `lib/app/noteCarry.ts` keeps the note's selection, focus and
    scroll anchor for 1.5 s across a layout switch and `DocumentView` restores them; Capacitor already lets focus()
    raise the keyboard (`CAPBridgeViewController` keyboardShouldRequireUserInteraction false). Checked on the Duo
    Simulator both ways: same note, caret at the same offset, editor focused, keyboard up.
  - App-wide pieces (Foli AI chat, Quick Add, runners) stay mounted across folds (`<Fragment key="globals">`).
  - The iPad sidebar slide ran on unfold (it saw the layout switch as an open): it now only slides on the user's
    toggle (`Shell.tsx sidebarLayout`); half open it follows the hinge with a width transition, its toggle and the menu's
    Hide sidebar aren't offered, and the layout switch fades in over 150 ms.
  - Half open, nothing in the fold: dialogs and the search window sit past it (`pastFoldFrame`), toasts too, menus and
    popovers keep to their anchor's side (`popupSpan`, the editor's menus included), the note dock's old fold rule
    (which crushed it) is gone. Closed and open, the side status column (84 pt) is kept clear: phone sheets, toasts, the
    palette, the banner, menus (`sideInsets()` in `lib/iphone.ts`; `safeInsets()` answers only in the phone layout).
  - Not checked: a real Duo; a horizontal fold (upright inner screen) by eye.
- Android polish pass (owner: "do the same polish pass for Android"), no Play upload. Two parts:
  - Web side, on this branch (3c8fb728 plus the keyboard bar fix after it): keyboard riding through the app's own
    frames, ripples in sheets and menus, one press feedback (no ripple plus :active together), no text selection on a
    long hold, `data-back` on Back buttons for the native back gesture. `NoteBars.tsx`: the plugin's
    `keyboardWillHide` no longer drops the bar on the keyboard when the app sends its own frames (it landed just
    before the app's frame and the bar vanished, then came back at the bottom), a bar drawn during a hide rides down
    from the keyboard's last height, and a hide already under way when writing stops (Android's Back) is followed.
  - Native side: PR 108 (`claude/android-polish-pass`, based on PR 69's `claude/android-capacitor-197cf4`): keyboard
    frames from the decor view (web view shrinks at the end of the show, grows back as the hide starts,
    `keyboardWillLeave`), the back watcher, predictive back with no page peek on phone, the saved launch colour, a
    cover while reloading, fold marks via WindowInfoTracker (not checkable on the emulator), overscroll off, and the
    font size following the system on a configuration change.
  - Measured on the phone emulator (combined build, post-paint frames): opening, the bar leaves the bottom at about
    150 ms and settles at 587 by 450 ms (before: held 0.9 s, then flew in); Back and Hide keyboard both ride it down
    to 923 with no gap or jump. Tablet and foldable emulators show the tablet layout; fold marks not checked.
  - The Capacitor app id on Android is `com.folevi.android` (launch `com.folevi.android/.MainActivity`).
  - Known: this branch's own `apps/mobile/android` is incomplete (its `web/` Kotlin package is caught by the unanchored
    `web/` in `.gitignore`); build Android from PR 69's branch. Whichever of PR 83 and PR 69 merges second reconciles
    `apps/mobile`. Glass blur on Android held as is (owner: same look as iPhone).
- Memory re-check (the open item): Duo closed, 20 opens of "Welcome to Folevi": 126 MB, 200 MB, 130 MB after
  `org.WebKit.lowMemory`; nothing kept per open.
- The three failing e2e specs listed in section 10 were already fixed on `main` by PR 77.
- Version history: 1.5.77's entry taken from tag `v1.5.77` (the Windows release) so this is 1.5.78.

**Release 1.5.76 (build 91), the Capacitor mobile app, 2026-11-25:** the iPhone note memory fix (PR 74, merged into
`main` as 85574054, then `main` merged here; PR 74's `transitions.ts` replaces 1.5.75's change); release commit
`83a4f3fc`, tag `v1.5.76` local; uploaded to TestFlight under the owner's "mobile to testers" approval (relayed by the
main session), delivery bc805158-7281-477d-923c-970475668b7e, internal "Folevi team". iOS only. Next free: 1.5.77.

**Release 1.5.75 (build 90), the Capacitor mobile app, 2026-11-24:** the iPhone screen moves empty their screen copy
afterwards (part of the memory growth, docs/mobile/ios-review-2026-11-24.md experiments G to P); release commit
`21c40255`, tag `v1.5.75` local; uploaded to TestFlight under the owner's standing OK ("release everything when ready",
relayed by the main session: internal "Folevi team" only, App Store submission still asked), delivery
13e2530f-5ba1-4952-9fbe-2989389f7657. iOS only.

**Release 1.5.74 (build 89), the Capacitor mobile app, 2026-11-24:** the iOS review's fixes (44 pt hit areas, local
mode's rules from the first request), cut after 1.5.73's history entry (tag `v1.5.73`, the Mac release); release
commit `e86fbbca`, tag `v1.5.74` local. Uploaded to TestFlight on the owner's "Release it" (delivery
9fe1d590-737b-47d1-a14c-fa4968d94428), internal group "Folevi team". iOS only; Android was not rebuilt.

**Release 1.5.72 (build 87), the Capacitor mobile app, 2026-11-24:** owner's OK, relayed by the main session ("release
all ready apps for all platform", "Mobile to testers": TestFlight and Play internal testing only). Cut on
`claude/mobile-capacitor-f41734` after 1.5.71's history entry (from tag `v1.5.71`); release commit `d153ae34`, tag
`v1.5.72` local. iOS: `apps/mobile/scripts/release.mjs --skip-shell --no-upload` made `apps/mobile/release/Folevi.ipa`
(84 MB, App Store profiles, production push, production backend), **uploaded to TestFlight on the owner's own
"Release it" in chat (delivery 58636ca8-bf67-4fb5-bcb9-6ce7ec46059c)**, internal group "Folevi team" once Apple has
processed it. That build predates the local-mode note-style rules (commit 2aa79b97). Android: the Android session builds the same commit for Play internal testing. The Windows session takes 1.5.73.
Sign-in on the simulator reached iOS's "Folevi wants to use app.folevi.com to sign in" prompt (no account used further).

**One mobile app with Capacitor (2026-11-24, branch `claude/mobile-capacitor-f41734`, PR 66 https://github.com/faisalibnislam/folevi/pull/66 into `main`, not merged):**
the owner's "one web app everywhere" plan for phones and tablets. `apps/mobile` is one Capacitor 8 project for
iPhone, iPad, iPhone Duo and Android around the web app's shell export (`build-shell.mjs --platform mobile`), with
no native screens. Details: `docs/MOBILE.md`.
- **iOS** (`com.folevi.ios`, same App Group, Keychain group, iCloud container and `capacitor://localhost` origin as
  the native app): XcodeGen project `apps/mobile/ios/App/project.yml`; the shell services shared with the Mac app are
  built in place from `apps/ios/ios/App/Native/Shell` behind one Capacitor plugin, `FoleviHost`
  (`App/Host/HostBridge.swift`); `bridge/mobile-bridge.js` gives the page `foleviNative` and `foleviShell` with
  Capacitor's Haptics, StatusBar, Share, Clipboard, ActionSheet, App and SplashScreen plugins. Share extension in;
  widgets, Siri/Shortcuts and Spotlight not carried over yet.
- **Android** (`com.folevi.android`): the Capacitor project as it was before the native rewrite (`7a4155c0~1`) with
  its Kotlin plugins and `folevi-bridge.js`, now on Capacitor 8.6.2, R8 in release, splash/insets/start-page fixes.
- **Layouts** (`apps/web/src/lib/platform.ts`, from PR 61): under 700 px the phone layout, wider the sidebar layout
  (iPhone Duo open is 951 pt wide, so the sidebar); tests in `apps/web/test/platform.test.ts`. `scripts/version.mjs` now writes the mobile app's version (1.5.70, 85).
- **Checked** (simulators "Folevi Mobile iPhone/iPad/Duo", emulators `Folevi_Mobile_Phone/Tablet/Foldable`):
  first launch, a library on the device, Home, the editor (an edit lands in the `.fnote` file), tabs on iPad and
  Android tablet, the share inbox (a queued share becomes a note), dark mode, Duo closed, foldable open; updating
  in place over the native iOS and Android apps keeps the library. Release builds: iOS 94 MB vs native 182 MB;
  Android 125 MB vs native 128 MB (86 MB of each is the web export, 64 MB of that note covers). Memory at Home:
  iOS about 183 MB vs native 172 MB; Android about 227 MB vs native 205 MB (PSS).
- **Not checked:** a real device; signing in end to end (on Android it reached the browser, which wanted its own
  terms accepted on the emulator; iOS's sign-in sheet couldn't be tapped from scripts); iPhone Duo open and
  folding (the simulator's hinge couldn't be moved from scripts on this Mac); push delivery.
- Nothing uploaded; native releases stay paused (a release would be 1.5.71 or later via `node scripts/version.mjs`).
**Folevi for Linux (branch `claude/linux-tauri-02790e`, worktree `.claude/worktrees/linux-tauri-02790e`, PR 73 https://github.com/faisalibnislam/folevi/pull/73 into `claude/desktop-tauri`, not merged; 1.5.75 published as downloads at `https://folevi.com/download/linux/`, latest links `Folevi-x86_64.AppImage`, `Folevi-aarch64.AppImage`, `Folevi-amd64.deb`, `Folevi-arm64.deb`, `Folevi-x86_64.rpm`, `Folevi-aarch64.rpm`, `SHA256SUMS.txt`; docs/LINUX.md "Releasing"):**
the shared Tauri 2 desktop shell (WebKitGTK) packaged for Linux, per the owner's 2026-11-24 "one web app
everywhere, system web views" direction. The shell itself comes from the Windows session (`claude/desktop-tauri`,
`apps/desktop/src-tauri`, merged into this branch 2026-11-24); Linux adds only Linux config, `src-tauri/src/linux.rs` and packaging.
Committed so far: `packaging/linux/` (desktop template, AppStream metadata, icons, `tauri.linux.conf.json` staged
for the shell, Flatpak manifest on GNOME 51, optional Snap, apt and dnf/zypper repo scripts), build scripts (Lima
VM on this Mac: Ubuntu 22.04 arm64 + a Rosetta amd64 root), Linux jobs in `.github/workflows/desktop.yml`,
`apps/desktop/src-tauri/src/linux.rs` and `tauri.linux.conf.json`, `docs/LINUX.md`, `docs/LINUX-TESTING.md`. Not on Flathub, Snap or apt/dnf (each needs the owner's OK); no in-app updates (no signing key). Untested on real Linux hardware: Wayland Quick Add, tray, notifications, file dialogs, browser sign-in, NVIDIA, Fedora/openSUSE installs, the Flatpak.

**Folevi for Windows and Linux (branch `claude/desktop-tauri`, PR 65 https://github.com/faisalibnislam/folevi/pull/65 into `main`, not merged; Windows 1.5.73 unsigned test installers published at `folevi.com/download/windows/Folevi_1.5.73_<arm64|x64>-setup.exe`):** the owner chose "one
web app everywhere" and the Mac app's approach (small, light), so the desktop app is now **Tauri 2** in the system
web view (WebView2, WebKitGTK), replacing the same day's Electron build (PR 58, `claude/windows-electron-4ed862`,
kept in history; the main session closes PR 58 when the Tauri PR supersedes it). Rust shell with the Mac's
ShellRouter method names behind the shared shell-bridge.js: library (FLV1), sign-in, places, E2EE keys, Foli AI own
keys, calendars, reminders, tray, Quick Add (Ctrl+Alt+Space), notifications, badge, folevi:// links, single
instance, window state, own spelling, printing, Windows caption buttons. Builds: `.github/workflows/desktop.yml` on
GitHub's native Windows x64/ARM64 and Linux x64/ARM64 machines (owner's pick), with memory measured against Electron.
141 Rust tests, bridge tests and a local smoke run (`apps/desktop/scripts/smoke.mjs`) pass. Updater off until an
update signing key is approved. Details and the owner's checklist: `docs/DESKTOP_APP.md`. First CI results (Windows
x64): NSIS 78 MB and MSI 79 MB against Electron's 182 MB installer; memory about the same as Electron's on Windows
(214 vs 207 MB private, run 45418586764; an earlier lower figure measured a page that never loaded). Windows ARM64 lost an increment in a
concurrent-write test (NTFS creation-time tunneling made etags repeat); fixed by using the NTFS file index
(bb8c25a1). Rerun 45361580640 passed every job (Windows x64 and ARM64, Linux x86_64 and aarch64, Flatpak); its
Windows test builds are in the owner's Downloads ("Folevi for Windows 1.5.68 Tauri test"), measurements in
`docs/DESKTOP_APP.md`. Since 2026-11-24 this session is **Windows only**: a Linux session
(`claude/linux-tauri-02790e`) takes Linux packaging (the Linux CI jobs and `apps/desktop/flatpak/`) on top of this branch.
**Folevi Server plan, version 2 (2026-11-25).** `docs/SELF_HOSTING_PLAN.md` rewritten for the owner's new brief:
native packages on Synology, QNAP, ASUSTOR and TerraMaster (UGREEN once they authorize us), a native Unraid plugin,
one-click catalog apps where only containers are allowed (TrueNAS, ZimaOS/CasaOS, Umbrel), a one-command native
Linux installer plus DigitalOcean 1-Click for hosted servers, one Go supervisor (`folevid`) wrapping the same
bundle everywhere, Plex-like Folevi Connect (server listed in the apps, `folevi.app` HTTPS names including LAN,
pass-through relay), owner/admin/member/guest roles, a full server admin panel, and relays for email, push, AI and
sign-in. Plan only; Phase 0 is still the only built part.
**Folevi Server, app side on `main` (server lead session, 2026-11-25, branch `claude/server-apps-base`).** "Your own
server" sign-in (address, QR, home network, linked servers), the server edition of the web app (`FOLEVI_EDITION=server`:
setup page, server admin panel, `/.well-known/folevi.json`, runtime addresses), Connect's cloud pages
(`/connect/approve`, `connect:myServers`), the backend's server edition (`convex/server*.ts`, `connect.ts`, SMTP, own AI
key, invites, roles), the Mac and iPhone/iPad `ShellServer` places, and `lib/server-edition/connection.ts` (best
connection for the web-based shells). Folevi Cloud is unchanged when `FOLEVI_EDITION` is unset (tests). The supervisor,
Connect service and packages stay on `claude/sleepy-goodall-3cg4e7` / `claude/server-connect`. Contract:
`docs/self-hosting/CONTRACT.md`. Local test server and how apps test against it: shared notes `folevi-server-apps.md`.
Rule for all Folevi Server work: mark every fake test token `// gitleaks:allow` (CI's secret scan reads every branch).

**Folevi Server on the Mac (session for the Mac, 2026-11-25, branch `claude/focused-brahmagupta-639148`).** Verified
against the local test server (`http://localhost:8460`) with headless tests, `apps/mac/FoleviTests/ServerFlowTests.swift`:
adding the address (this 1.5.73 build gets `app_outdated`, a 1.6.0 build gets the server), its sign-in screen (the
sheet's `/connect` sends a signed-out visitor to the server's `/signin`), signing in through the sheet's PKCE path
(`/api/auth/native/authorize` then `ShellAuth.exchange`) and through the native email form, a Convex token from the
server, the place switcher listing the server place next to a Folevi Cloud account and the library, and sign-out
ending the server's session. Also covered: Bonjour entries (`LocalServers.entry`), the version gate, `ServerReach`
(home name first, back to the added address when leaving home, no sign-out, `probe` injectable, `networkChanged()`),
and each server place's token in the Keychain only (`session.<user>` for place `acct:<user>`, never in places.json,
the run folder or the settings). The live tests skip without the server or `~/FoleviServerTest/test-accounts.env`;
the real Bonjour browse runs only with `FOLEVI_LIVE_BONJOUR=1` (it can ask for Local Network access; with the
owner's OK it ran and passed on this Mac on 2026-11-25, headless, `TEST_RUNNER_FOLEVI_LIVE_BONJOUR=1`). The server
rate-limits sign-ins: run the two live sign-in tests a minute apart if they get 429. Also fixed: the Mac build was
broken on `main` since the icon regeneration dropped `WebIcon.calendar` (now `.calendarDays`).
The sign-in screen (account mode, no place yet: `AppScheme.signInOf`) gets `https: http:` in its connect-src so the
page's own `lookUpServer` can read any server's folevi.json; account pages and local mode are unchanged.
`ServerPageTests` checks it in an offscreen web view with the real scheme handler and a listener on the Mac's LAN
address: an `app://` page fetching a home http server is not blocked as mixed content on the Mac (WebKit lets it
through although `app://` is a secure context), a Folevi Cloud page and local mode can't reach it, and a server
place on that http address can. That test needs the Mac's firewall off, or `FOLEVI_LIVE_LAN=1`.

**Backend performance pass (session `perf-backend`, 2026-11-25).** A generated 5,000-note test library
(`convex/lib/fakeLibrary.ts`, seeded by `convex/devSeed.ts` into an `@example.com` test account, refused on
production) and a read-cost harness (`tests/convex/perf/`, run with `FOLEVI_PERF=1`). Baseline and every fix's
before/after numbers: `docs/perf/backend-results.md`. At 5,000 notes `organization.index` reads 13 MB per run (the
limit is 16 MiB) and task lists read up to 1,476 documents.
Step 2: every mutation is now built from `convex/lib/functions.ts` (not `_generated/server`), whose db wrapper reports
writes to `documents` and `folders` to `lib/listStats.ts`. That keeps `listStats` (per folder: page count, last edit,
5 newest previews; per scope: the Drafts count) in step, and `organization.index`, `recentFolders` and `draftCount`
read it instead of the pages. A folder or scope without a row is counted from its pages as before until
`migrations:backfillListStats` runs (production run waits for the owner's OK). Task rows carry their note's public
id, title and icon (`syncTaskLabels`, cleared when a note is sealed), so task lists read no notes. Writing straight
to the db in a test (`t.run`) skips the wrapper: use `watchedDb(ctx)` from `lib/functions.ts` there.

**A failed query no longer takes a page down (branch `claude/project-thread-u99yc5`, open PR, 2026-11-24).** Components
read queries through `apps/web/src/lib/convex/queries.ts` (`useQuery`, `usePaginatedQuery`, `useQueryState`), never
convex/react's (an eslint `no-restricted-imports` rule says so). A failed query reads as still loading (keeping its
last good result), is dropped and asked again after 1, 2, 5, 10 and then every 30 seconds (shared by every hook on the
same query and arguments), and says `failed` with a `retry()`. Lists that failed show `components/ui/LoadFailed.tsx`
("Couldn't load your notes", Try again) in place of their placeholder: note lists (desktop and iPhone), Tasks (both),
Shared with Me, Changes, the Foli AI chat history. Local mode's query cache re-runs a failed entry when it's watched
again. Still thrown on purpose: E2eeGate's `e2ee_locked_session` (`throwsToBoundary`), and `useQueryOrThrow` where a
component's own boundary handles the failure (the admin gate's whoami, a chart's collection source). Tests that mock
convex/react keep working: `test/setup.ts` hands the app's hooks over to the mock's.

**One web app everywhere: the web side (branch `claude/web-everywhere-0e2975`, 2026-11-24).** The web app is now the
interface on every platform (browser, Mac, Windows, Linux, iPhone, iPad, Duo, Android, Folevi Server). Layout rule
(owner, 2026-11-24, `docs/claude-context/memory/web-everywhere-layout-rules-2026-11-24.md`): width decides on every
device. `apps/web/src/lib/platform.ts` answers `formFactor()` (phone under 700 px, else tablet when used by touch,
else desktop), `shell()` and `os()`, and marks `<html data-form data-shell data-os data-touch data-fold>` (first paint:
`lib/theme/bootScript.ts`). `lib/iphone.ts` reads it: a phone's browser and a narrow computer window now get the
phone interface with the bottom bar; an open iPhone Duo gets the tablet layout (it got a stretched phone layout,
because the phone was picked from the iPhone user agent); Android tablets and touch browsers get the iPad's touch
look (CSS moved from `:root[data-ipad]` to `:root[data-tablet]`). A vertical fold keeps the sidebar left of the
fold and the page past it; the fold is read from the marks the native Duo app already sets (`data-fold`,
`--fold-start`, `--fold-end`) or Chromium's viewport segments, and an app's own marks are never cleared. The contract for shells is in the shared notes (`web-everywhere-platform-contract.md`).
**Web everywhere, landed on `main` 2026-11-25 (PRs 61, 62, 63, 64, 68, 70, 71, 72, 74, 75).** Besides the layout rule
above: shortcuts read the way each system writes them (`lib/shortcuts.ts` `useMacKeys`, `useKeyLabels`; Ctrl+ off
Apple's); the owner's platform touches (Instrument Sans everywhere, the web's springs kept except the Mac's no-bounce
motion, Android's press ripple `lib/android/ripple.ts`); one wording set and one icon per thing on phone and desktop;
touch hit areas of at least 44 pt (`.ui-hit`); the app counts as a touch device only with touch points; boards ignore
presses from their own sheets (`canvas/pointers.ts pressIsElsewhere`); the iPhone layout lets go of closed notes in
WebKit (`components/iphone/transitions.ts`, about 5 MB per open before); the tools panel picks its tool before a note
draws; `/apps` lists Folevi for Windows and Linux; note styles sync into the apps (`GET /note-styles`,
`lib/shell/styleSync.ts`, local mode's one anonymous request) and the privacy policy says so.
**Folevi for Mac back to the web view (owner, 2026-11-24, branch `claude/mac-webview`, PR 67): released as 1.5.73**
(build 88, tag `v1.5.73` local, live on the Mac feed, notarized, universal; the owner said "Release it"; 1.5.72 was
already the Capacitor mobile app's, recorded from tag `v1.5.72`). the owner
chose to bring back the AppKit WKWebView app (`archive/mac-appkit`, 1.5.64) showing the web app's own UI (sidebar,
tabs, top bar, Mac window buttons in the page's top bar), as on Windows and Linux, keeping the menu bar, Quick Add
and the menu bar icon, Spotlight, Shortcuts, Share and Services. Done: `apps/mac` restored from the tag and the
native frame (N8) removed (Frame/, floating notes, the native Settings window: ⌘, opens the web's /settings in the
main window; Quick Add is the web panel). The SwiftUI app is at tag `archive/mac-swiftui` (= v1.5.71, local).
Carry-over from 1.5.71 checked on scratch data: same bundle id, support folder, Keychain names, web storage and
desktop settings key; the SwiftUI app's "Lock Folevi" defaults (`folevi.lock`) are written back to lock.json once.
111 Mac tests pass; the Release build passes release.mjs's checks; 1.5.71 then the new build on one scratch
library opens the same notes. The owner kept this look (window buttons in the web's top-left corner). Not done: a signed-in Release
run (twice the owner answered "notes appear" but the test copy's scratch folder recorded no sign-in: do it with the
owner at the Mac, the installed Folevi quit first), which the owner chose to skip by releasing. Debug scripts that compared "web" and "native" frames (screens, menus, quickadd, gates) still take a kind;
only "web" means anything now.

**1.5.70 on TestFlight (2026-11-24, owner's OK):** build 85, cut on `claude/ios-release-1.5.70` from the iPhone Duo
branch (PR 55, which holds all of `main`), so testers keep the Duo window that 1.5.69 had; uploaded (delivery
e18198df), tag `v1.5.70` local only. No visible change from 1.5.69: it lines TestFlight up with the merged code
(engine contract revision 35). Its PR into `main` holds only the version commit once PR 55 merges. **Owner's
decision the same day: "one web app everywhere"** (Electron for desktop, Capacitor for iPhone, iPad, Duo and
Android); native releases and new native UI work are paused until the owner says otherwise. This pauses the
native apps only: Android itself is active as the Capacitor app (owner, 2026-11-25).

**Release, 2026-11-24 (branch `claude/folevi-core-529dbe`, PR 51 merged into `main` as 7e2080e9):**
- **1.5.66** (tag `v1.5.66`, local): the native Mac app replacing the AppKit one, plus PR 52's iPhone/iPad redesign.
  Published to Sparkle and uploaded to TestFlight with the owner's OK. **It broke signed-in Macs:** the window stayed
  on the loading screen. Cause: the app never set `AppScheme.modeOf`, so every page got the local
  Content-Security-Policy, which blocks Convex; a signed-in place's engine page threw on its first WebSocket.
  Local libraries were fine.
- **Mitigation (owner's OK):** the 1.5.66 item was removed from `mac/appcast.xml` and `mac/Folevi.dmg` points at
  1.5.64 again, so Macs on 1.5.64 get no update. Macs already on 1.5.66 stay stuck until 1.5.68.
- **1.5.68 is live on the Mac feed** (tag `v1.5.68`, local; build 83): the fix (`WebViewFactory.scheme` sets
  `modeOf`; `SchemeModeTests`), 70 Mac tests pass. The owner installed it by hand and confirmed their signed-in
  account opens; then it was published (feed and `Folevi.dmg` show 1.5.68, notarized). With a fake account place and
  no token, the Release build has no page errors but still waits. 1.5.67 is the iPhone/iPad release that
  `claude/ios-native-redesign-f4a8be` cut; its code reaches `main` through PR 56.
- **PR 51 merged** (7e2080e9). After it: the Android session merges PR 54 (owner: "merge PR 54 after PR 51"); the
  iPhone/iPad session opened PR 56 into `main`.
- **Tabs (owner, 2026-11-24):** everything opens in a new tab exactly like the web on Mac, iPad, and Android
  tablets/Googlebooks (`docs/claude-context/memory/tabs-match-web-2026-11-24.md`). iPad and Android were forwarded
  to their sessions (the iPad already matched). **Mac: done on branch `claude/mac-web-tabs`** (off the release
  branch, pushed, no PR yet, not released): the rule is `AppModel.placement` (`Destination.tabKind`,
  `TabRuleTests`), `WindowModel.go` routes, `step(to:)` moves inside a tab. Checked in the demo app.
- **Mac best-native pass (owner, 2026-11-24), same branch:** three read-only skill audits (HIG/macOS, motion,
  SwiftUI performance), then the fixes: no-bounce motion, Bookmark wording, Ask Foli AI in the toolbar, New
  Folder ⇧⌘N, menu and performance fixes (commit dc6b33ed). Owner's picks:
  `docs/claude-context/memory/mac-best-native-pass-2026-11-24.md`. 77 Mac tests pass; demo screenshots checked.
  **Released as 1.5.71 (build 86, tag `v1.5.71`, local) and live on the Mac feed, 2026-11-24**, with the owner's
  OK ("Release Mac 1.5.71"), from branch `claude/mac-app-d228e2` (the Mac session's worktree; it merged
  `claude/mac-web-tabs` and main at PR 56, 546f6aa4). 1.5.69 and 1.5.70 (TestFlight, other branches) were recorded
  from tag `v1.5.70`. Release build checked: signed, universal, production export, same Keychain requirement; on a
  scratch folder with an account place and no token it reaches the first-launch screen (no hang). The owner said
  "publish" after being asked to sign in on that test copy, but no sign-in showed up in its data folder, so a real
  signed-in Release run was **not** observed; the Mac host and shell code is unchanged since 1.5.68 (the
  `modeOf` fix), and web changes since then are Android-only. Owner's strategy (2026-11-24): the Mac keeps this
  web-view app; Windows/Linux get a Tauri shell and mobile Capacitor (other sessions). Not done from the audits: toolbar customization
  (`.toolbar(id:)`), menu-bar items for every toolbar action (Sort By, Empty Trash, Enclosing Folder), click
  semantics (select vs open) across lists, Recent/Shared selection, cover image downsampling, card picture
  invalidation, Settings search.

**iPhone Duo, third pass (owner's pick, 2026-11-23; was PR 53, now in PR 55 below):** branch
`claude/iphone-duo-ipad-layout` (worktree `.claude/worktrees/iphone-duo-18adb4`), on top of PR 52's branch
`claude/ios-native-redesign-f4a8be`. Open (the inner screen, across or upright) the Duo shows the iPad's wide
layout; closed, and in a Split View half, the iPhone layout with iOS's side column (`RebuildIPad.isWide`: an iPhone
window of regular width, 600 pt or more). The note page follows (`RebuildPageLayout` sets `wide` on the page's
marker; `lib/iphone.ts`), the open note, caret and keyboard carry across folds both ways, and partly folded nothing
sits in the crease (`FoldSpan`: the strip's tabs, the card's bar, the note's dock). The second pass's split view
(PhoneColumns, the last note in the empty column) is gone: Home is one stack on every iPhone again. Plan, research
and screenshots: `docs/IPHONE_DUO_PLAN.md`, `docs/iphone-duo/`. Decisions:
`docs/claude-context/memory/iphone-duo-decisions.md`.

**iPhone Duo on the native iPad window, Apple's Duo rules applied (2026-11-24; PR 55,
https://github.com/faisalibnislam/folevi/pull/55, branch `claude/iphone-duo-native-ipad` into
`claude/ios-native-redesign-f4a8be`; replaces PR 53, closed; released as 1.5.69 build 84 to TestFlight, tag
v1.5.69 local only):** PR 53's Duo work merged with `claude/ios-native-redesign-f4a8be` (the
native iPad window), then a pass against Apple's "Designing for iPhone Duo" (owner: "make the best duo app possible").
Open, the whole toolbar sits in iOS's side column (`IPadToolbar` with `sideBars`, read by `readVerticalBars`), the
note's tools sit at its foot where the closed phone has them and the page drops its dock (marker `sideTools`), the
sidebar stays beside the content and reaches the fold when partly closed, and it steps aside while the inspector is
open. `FrameModel.windowResizedAt` (set by RebuildFrame's viewWillTransition) keeps a fold from hiding the sidebar.
Details and checks: `docs/IPHONE_DUO_PLAN.md`, "Update (2026-11-24)".

**iPhone and iPad redesigned after the Mac's window (1.5.65, TestFlight):** branch
**iPhone and iPad redesigned after the Mac's window (1.5.65 and 1.5.67, TestFlight):** branch
`claude/ios-native-redesign-f4a8be` (worktree `.claude/worktrees/ios-native-redesign-f4a8be`), built on the Mac
redesign branch `claude/folevi-core-529dbe`. The owner's answers: `docs/claude-context/memory/ios-redesign-decisions-2026-11-23.md`.

- **iPhone** (FoleviDesign/Phone, FoleviPhone, apps/ios Rebuild): every screen on the frame's grey
  (`PhoneLook.frame`), its sections and lists on rounded opaque cards (`.phoneCard()`, `PhoneLook`), no row lines
  (rounded press highlights). Each top bar ends in the Mac's order: the screen's actions in one glass capsule, the
  main action (+) in Folevi's ink (`PhoneRootCreateItem`), then a search capsule (a screen's filter where it has
  one, else the app's Search, `phoneOpenSearch`). Interface text in four sizes (`NativeChrome.fourSize`: 15, 17,
  20, 28), sentence-case headings. Home in the Mac's order (places, Catch me up, Recent, Bookmarks, Folders, Tags
  as chips, the rest). Tasks, Calendar and Search group rows on cards. The note keeps its drawn bars; its place
  chip is 44 pt. Tab bar unchanged: Home, Tasks, Calendar, Foli AI, search.
- **iPad, second round (2026-11-24, replaces the bullet below):** `IPadFrame` is a system split view;
  `IPadToolbar.swift` fills the system toolbar; tabs sit in a Safari-style row under it; `IPadInspector.swift` is
  the system inspector holding the iPhone's native Style, Format and Insert panels and the Ask Foli AI chat. Under
  700 pt the phone layout takes over. Owner's call: the inspector's Foli AI tab is the Ask chat, not the web
  panel's Write/Ask/Study actions.
- **iPad, first round** (FoleviMac, merged from `claude/ipad-redesign`): a top bar per screen inside the card
  (`IPadScreenBar`: Back/Forward, title, actions capsule, New note ink pill, search; 44 pt controls), screens start
  below it; the note's tools panel is the Mac's flat inspector (`data-ipad-native` in `globals.css`); 228 pt
  sidebar, 44 pt rows; card corners 12 pt; tabs stay on the strip.
- **Checked:** Simulators "Folevi Redesign iPhone", "Folevi Redesign iPad", "Folevi Redesign iPad 11" (scratch
  local libraries), light and dark; native-kit iOS tests (all pass after the iOS snapshots were recorded again: the
  references were stale on Xcode 27.2), the iOS app's tests, the macOS package build.
- **Not checked:** a real iPhone or iPad, signed-in screens (Shared with Me, Changes, notifications with data),
  Dynamic Type at the largest sizes in the app itself (the snapshot tests cover xxxl for some screens).
- **Released:** 1.5.65 (build 80) cut on this branch (tag `v1.5.65`, local, not pushed) and uploaded to TestFlight
  with the owner's OK (delivery 953a8af0, internal group once Apple has processed it). Its first round reached
  `main` through PR 52 into `claude/folevi-core-529dbe` and PR 51.
- **1.5.67** (build 82, tag `v1.5.67`, local): the second round (native iPad window, iPhone system lists) on
  TestFlight with the owner's OK. **PR 56** (https://github.com/faisalibnislam/folevi/pull/56) brings it into
  `main`, with `main` (1.5.68) merged in; native-kit iOS tests, the macOS build and the Mac app's 39 tests pass.
  Merging is the owner's call (it deploys the web, though no web code changed).

**Folevi for Mac is now the native app (in progress, not released):** branch `claude/folevi-core-529dbe`
(worktree `.claude/worktrees/folevi-core-529dbe`), `apps/mac`; pushed to GitHub 2026-11-23 with the owner's OK (not merged). The iPhone/iPad
redesign's first round came in through PR 52; its second round goes straight to `main` (PR 56).

- **What happened (2026-11-23):** the native macOS 26 app (built as "Folevi Core" from 2026-11-21) replaced the
  AppKit Folevi for Mac (the owner's choice). The AppKit app was removed from `apps/mac`; its last release, 1.5.64,
  is at the git tag `archive/mac-appkit`. The owner then said there is no separate Core version any more: the
  project, target and module are `Folevi` (`apps/mac/Folevi`, `apps/mac/FoleviTests`, `Folevi.xcodeproj` generated
  from `project.yml`), and `scripts/app.mjs` runs the Debug app (was `core.mjs`). The product is "Folevi" ("Folevi
  Dev" in Debug). Only the branch and worktree keep the old name (`claude/folevi-core-529dbe`), because PR 52 targets
  it. "Folevi Core" elsewhere in the repo is the pricing plan, unrelated.
- **Seamless update:** it carries the AppKit app's identity unchanged:
  - `com.folevi.mac`, `Application Support/Folevi`, Keychain `com.folevi.*`, `folevi://`
  - the Sparkle feed `download/mac/appcast.xml` with the EdDSA key at account "folevi"
  - Developer ID signing with the committed profile `apps/mac/signing/Folevi.provisionprofile`
- **What it takes over on first launch:**
  - the app lock (`lock.json`)
  - Spotlight (the old entries are cleared, then indexed again)
  - the Electron migration, which runs at launch as before
- **Trial Release build:** it met the Keychain items' designated requirement ("same designated requirement as the
  installed Folevi").
- **Shared host files:** the UI-free files moved into `apps/mac/Folevi/Host/Shared`.
- **Editor and data layer:** SwiftUI around the web editor, which runs in pooled warm web views. The data layer is
  the web export through FoleviEngine and the iOS shell services, compiled by path.
- **The window (2026-11-23, latest):** the owner set the Macloving guide aside ("do the UI your way, pixel
  perfect, as good as Finder and Apple Notes, UX like the web, every feature"). The window is now built the way
  Finder and Notes are: a system `NavigationSplitView` (sidebar can be hidden, View > Hide Sidebar), a unified
  Liquid Glass toolbar (Back and Forward, title and subtitle, New Note as the ink pill, the screen's items, the
  screen's search as the toolbar search field), the system `.inspector`, native window tabs laid out by the system.
  Screens still declare their bar with `.screenActions` / `.screenSearch` / `.screenSubtitle` / `.screenLeading` /
  `.screenTitle` (`Views/Common/ScreenBar.swift`); those now feed the system toolbar. The custom card, glass top
  bar and `WindowMetrics` are gone. `docs/design/macloving-mac-ui.md` no longer applies to the Mac window.
- **Read first:** `apps/mac/README.md`, then `apps/mac/PARITY.md`.
- **Parity on 2026-11-23:** 1,114 of 1,343 there, 4 partly, 0 missing, 225 n/a. The 4 partly stay web pages on
  purpose, by the owner's choice: two-step verification, end-to-end encryption on/off, OAuth consent and the
  workspace settings group. LIST-053 (Folders page drag gap) and NOTE-036 (Foli DNA of a note, which needed the
  engine's `web.show` query, contract revision 34) were closed and tried by hand.
- **Checked:**
  - the Debug "Folevi Dev" runs on the demo engine and on a scratch "on this Mac" library
  - its 38 tests pass
  - the web tests pass
- **Not checked yet:**
  - the update in place over a real installed Folevi, with real data
  - signing in to a real account
  - iCloud and folder libraries
  - drag-out to Finder
  - notification actions


**Live: Folevi 1.5.63** (tag `v1.5.63`, PR 46 merged with PR 47 in it, `main` = `3258f12b`): Mac published (feed and
DMG at folevi.com/download/mac show 1.5.63), iPhone and iPad uploaded to TestFlight. Vercel skipped the web build
(Ignored Build Step: only native code changed), so the web is still 1.5.62's build. 1.5.63 carries PR 45's Liquid
Glass motion pass, card strips that no longer clip their shadows, iPhone search at the foot above the keyboard, and
Quick add's Task/Note in Foli AI's switch style. 1.5.62 (PR 44) shipped on all three before it. 1.5.60 and 1.5.61 are tags only (each was superseded before shipping; tags never move). 1.5.59
(PR 43) shipped earlier the same day on all three.

This session's wrangler login lives in the app's own `XDG_CONFIG_HOME` (not `~/.wrangler`); `npx wrangler whoami`
there shows the account that owns `folevi-updates`. Decisions: `docs/claude-context/memory/tab-back-and-overview-2026-11-21.md`
and `frosted-folders-decision-2026-11-20.md`.

**Android native app (2026-11-23):** branch `claude/android-native-622675` (worktree
`.claude/worktrees/android-native-622675`, off `e12fb272`), not merged or pushed. Owner's answers:
`docs/ANDROID_NATIVE_PLAN.md` section 1 and `docs/claude-context/memory/android-native-decisions-2026-11-23.md`.
What's there (checklist in the plan, section 4):
- Kotlin bridge codegen (`scripts/engine-codegen-kotlin.mjs`; `pnpm engine:gen` writes Swift and Kotlin; CI
  `--check`), Lucide icons (`scripts/icons-codegen-kotlin.mjs`), the engine module (client, stores, WebView
  transport; test round-trips every fixture).
- **Contract revision 34** (on this branch): `"android"` in the marker's and `AppInfo`'s platforms; Swift and
  Kotlin regenerated (hash `bbfa6dca`); web host posts big batches straight to `foleviEngineHost`.
- The Capacitor app is **removed**; its Kotlin services moved into `apps/android/app` behind a host bridge
  (`bridge/`: a `window.Capacitor` stand-in over a WebMessageListener). 38 service tests and 133 parity tests pass.
- Screens: adaptive frame (bar / rail / Googlebook sidebar, list beside note, note stays on fold), Home, notes
  lists, Drafts, Shared, Changes, search, Tasks with quick add, Calendar month, Foli AI chat, Settings, Vault,
  generic gate screen (first-launch choice, sign-in, library setup, E2EE). Googlebook: shortcuts helper,
  right-click menus, new windows, drag out. Release build with R8 and upload-key signing.
- Checked on emulators: local mode end to end, the editor in the note pane, share target, Vault set-up/lock/
  unlock, Googlebook-size window, fold/unfold, an R8 release build, and (2026-11-24) signing in to a test account
  on the dev backend (`peaceful-mockingbird-196`) by tapping Sign in to Folevi, Sign in with email and Continue,
  landing on the account's Home and notes. The test account is in `apps/android/.e2e-account.json` (git-ignored);
  `node apps/android/scripts/e2e/signin.mjs` makes a new one.
- **Not verified:** push (needs Firebase settings), Drive/Dropbox (need client ids), widgets and the tile on a home screen, a Back press
  that once left the app on the desktop emulator (not reproduced).
- Emulators: Taskeni's emulators (another project) use ports 5554-5558 now; this app's AVDs are Folevi_Phone,
  Folevi_Tablet, Folevi_Foldable, Folevi_Desktop (1920x1200 @160). Boot them on free ports.

**Android as Capacitor (2026-11-24, replaces the native app above; owner: one web app everywhere):** branch
`claude/android-capacitor-197cf4` (worktree `.claude/worktrees/android-capacitor-197cf4`), **PR 69**
(https://github.com/faisalibnislam/folevi/pull/69, contains PR 66 and `main` up to PR 60; merging it deploys the web). Folder
`apps/mobile/android`: the Android half of the one Capacitor mobile app; the shared setup (`apps/mobile`,
`capacitor.config.ts`, `package.json`, `scripts/`) is the iOS session's `claude/mobile-capacitor-f41734`, merged
into this branch. Both sessions had restored the same Android app; the merge keeps this branch's Kotlin and
manifest fixes and their shared cloud-kit bundling (`apps/mobile/scripts/bundle-bridge.mjs`), R8 rules and bridge
additions. The only shared-config line Android adds is `android.includePlugins: []`.
- Restored from the paused Capacitor app (`e12fb272`) on Capacitor 8.6.2; same package, storage names, Keystore
  and `https://localhost` origin as the native app, so it updates in place. Version and versionCode from
  `version.json`, upload-key signing, R8. Android takes no stock Capacitor plugins (`android.includePlugins: []`,
  the one line it needs in the shared config; reasons in `apps/mobile/android/README.md`).
- Fixed on the way: `env(safe-area-inset-*)` never reached the WebView (the inset listener replaced its handling;
  the phone top bar sat under the status bar), and wide windows' Back used browser history instead of the web's
  tab rule (one Back from a note could leave the app). Back now presses the page's Back, then Home, then leaves.
- Checked on emulators (debug unless noted): installed over the native app (debug and release builds) it opens
  the same library; editor, keyboard and its bar; Back on phone and tablet (a tab opened from Home closes back to
  Home); share target into the Inbox; signing in to a scratch dev account through the Custom Tab (tablet, sidebar
  layout, account notes open); fold/unfold switches phone/sidebar layout with no reload; Googlebook-size window
  with Ctrl+Shift+N opening a second window; light and dark. Kotlin unit tests, cloud bridge tests (27), parity
  tests (133, now on this app's bridge), version test.
- **On Play internal testing: 87 (1.5.72), published 2026-11-24 19:05** with the owner's OK (relayed by the main
  session, "release all ready apps for all platform", mobile to testers), replacing 83 (the native app). Built from
  `d2ef501c` (this branch with the mobile session's release commit `d153ae34` merged): production web export
  (`build-shell.mjs --platform mobile --production --required`), `FOLEVI_RELEASE=1 npx cap sync android`,
  `bundleRelease` with the upload key and Firebase push values (`FOLEVI_FIREBASE_*` from the owner's
  `~/Downloads/google-services.json`, project `folevi-9b8a5`; never committed). The owner dragged the AAB into Play
  Console; Claude added it from the library, wrote the release notes and published. Only warning: no native debug
  symbols. Checked on an emulator with that exact build: first launch, local mode Home, editor, Back, no crash.
  Not tested: production sign-in, push arriving, Drive/Dropbox, widgets and tile, a real device, Android 13, the
  update from build 83 with release keys (checked with debug-key builds only).
- Size and memory vs the native app: AAB 96.6 vs 100.8 MB; memory on Home 205.7 vs 199.3 MB (table in the README).
- Not checked: push arriving (Firebase is set up as of 1.5.72), Drive/Dropbox, widgets and the tile, a real device, Android 13.
  On a Googlebook the device words say "tablet" (the web knows only phone and tablet for Android).
- Native app (`apps/android`) stays in the tree as the reference; CI's Kotlin codegen checks still point at it.

**Also in progress:** branch `claude/native-perf-pass` (worktree `.claude/worktrees/recursing-dijkstra-48aa7c`, off
`main` at `d617d60b`, not released): a native performance pass, report in `docs/NATIVE_PERFORMANCE_2026-11-21.md`.
Folder cards at rest are drawn once into a picture (`FoleviDesign/Web/CardPicture.swift`; live while hovered, on whole
pixels, a capped cache let go on memory warnings, `FOLEVI_CARD_PICTURES=0` draws them live): a 60-folder Mac grid
missed 321 to 347 of about 360 frames in a 3 s scroll, now 13 to 37; Home 52 to 166, now 0 to 11. Window captures
match the live cards. Note cards are unchanged (pictures thrashed the cache on All notes); iPhone numbers need the
owner's phone (the Simulator shows no difference).

**Also in progress:** branch `claude/note-card-shadow-pictures` (off `claude/native-perf-pass`, so it carries PR 48;
rebase onto `main` once PR 48 merges; not released): a note card's shadow (and a stack's sheets, a divider's tabs) is
one shared picture per card size and look, and the card's face is drawn live and no longer flattened (the
`drawingGroup` RenderBox redrew on every frame of a scroll was the real cost, more than the blurs). Mac All notes, 3 s
scroll: 175 to 232 missed frames down to 67 to 135 in quiet alternating pairs (median of every run 296 to 197; the
slowest 5% of frames 151 to 60 ms). Shadows match pixel for pixel in window captures; cards at fractional places
round their words half a point differently (0.5 to 0.6% of pixels). Hover lifts the shadow as before. Report in
`docs/NATIVE_PERFORMANCE_2026-11-21.md`.

**Also in progress:** branch `claude/phone-all-folders-route` (not released): on the iPhone, Home's Folders "…" >
All folders opened All notes. That Home and menu belong to the older UIKit phone frame (`PhoneFrameController`,
`Native/Phone/`), which Debug builds run unless `FOLEVI_REBUILD=1` or the `folevi.rebuild` default is set; Release
builds run the rebuild (`RebuildFrame`), where All folders is a row in More and already opened the grid. The old
frame now pushes `AllFoldersScreenController` (the shared `AllFoldersScreen` with its "…": New folder, View as, Sort
by). The Mac's `FrameNavigation` also sent `.allFolders` to Home; it now opens `/folders` (nothing on the Mac calls
it today). Checked in the Simulator (iPhone 17 Pro, Debug, a fresh local library).

**Also in progress:** branch `claude/liquid-glass-animations-b1d70e` (worktree
`.claude/worktrees/liquid-glass-animations-b1d70e`, off `main` at `d752bb0d`, PR 45, not released): a Liquid Glass
motion pass on the Mac, iPhone and iPad apps, keeping the owner's playful springs (FoleviSpring, 2026-11-01). Shared
motion in `apps/native-kit/Sources/FoleviDesign/Web/WebMotion.swift`: named springs for every repeated interaction
(`pressIn`/`press(_:)`, `glassRelease`, `reorder`, `appear`, `menu`, `bar`, `settle(velocity:distance:)`), `projected`
(a flick's coast) and `glassArrival` (floating glass materializes instead of fading flat). Changes: the Mac card's
search is one glass capsule that grows into the field (it swapped two capsules, a cut); toasts, the selection bars,
the Foli AI chat and the iPhone note bars materialize their glass; the Foli AI chat no longer drags its button in
from the corner while it opens (the overlay's host resizes at once; the button's move is now unanimated); presses go
down without wobble and spring back; the iPhone's glass circles no longer double the system glass's own swell; seven
iOS button styles use the one `pressDip`; swipe rows open on a quick flick and carry its speed; the iPhone toast and
the graph's camera move respect Reduce Motion. A Debug-only `frame` eval action `toast` drives toasts from scripts.
Checked: native-kit `swift test` (all pass), Mac and iOS builds, the Mac dev app driven on a scratch library (search
opening and closing, rapid toggles, toasts in and out, the chat open and close and rapid toggles), the iPhone
simulator (Home, All notes, Select, a note's bars). Not checked: Reduce Motion on (a system setting), real devices,
the iPad live.

What shipped in the last week, newest first (detail in `CHANGELOG.md`):
- 1.5.62: Back goes to the tab a page came from (closing it, Safari's rule); Show All Tabs draws Home on web, Mac
  and iPad; iPhone Home cards 176 pt and folder cards never cut their date off (PR 44).
- 1.5.59: Folder cards' corners line up, the front fully frosted, tighter Home rows (PR 43).
- 1.5.58: Frosted folder cards, desktop and Mac cards 25% smaller, a new folder glyph (PR 42, branch
  `design/frosted-folders`, from the card design session). Design pages the owner reviewed (private artifacts):
  https://claude.ai/artifact/SaZdm3uekCoRpGPkwcDCBn (27 note and folder ideas) and
  https://claude.ai/artifact/LxPzWN9JNK4FKuiqWDQgUD (folder states, Frosted / Paper). Decision:
  `docs/claude-context/memory/frosted-folders-decision-2026-11-20.md`.
- 1.5.57: Offline & sync fixed on iPhone, iPad and Mac (Notes kept and Space used stayed "…": the engine sent
  `attachmentLimitBytes` as a fraction and the apps, decoding an integer, dropped the whole `device.storage` update;
  `apps/web/src/lib/engine/viewsDevice.ts` `whole`, test in `apps/web/test/device-usage.test.ts`); Download everything
  now confirms and shows progress; Settings renamed ("This device" -> "App lock", next to Security; "Devices" ->
  "Signed-in devices"); Catch me up page redesigned (`CatchUpScreen` in `FoleviMac/Views/Screens.swift`, used on
  iPhone, iPad and Mac); iPhone sync details sheet (`apps/ios/ios/App/Native/Rebuild/RebuildSync.swift`); Foli AI
  composer as a raised card (`PhoneComposerSurface`); Quick add's full-width Task/Note switch; Send buttons hidden
  until there's text; 8 pt between a sheet bar's round buttons; quieter Home count badges.
- 1.5.56: iPhone notes keep Folevi's own bars, drawn by the frame where the tab bar is (`PhoneNoteBarsSlot.swift`), so
  the tab bar and the note's bars swap in place instead of the bars riding the page. (1.5.55 tried iOS's own bars; the
  owner rejected that look the same day: never switch notes to system bars.)
- 1.5.54: iPad fixes and speed, New note as a black pill in the Mac and iPad title bars (gone from the sidebar), the
  iPad account in the title bar's top left, iPhone sync status on Home, PR 41's e2e and app fixes.

**Branches** (GitHub): `main`; Dependabot's; `chrome-extension` and `pricing-decisions` (both pushed, both a little
behind `main`, both merge cleanly as of 2026-11-20). Every older branch was archived on 2026-11-19 as an
`archive/<name>` tag (27 tags; `git checkout -b <name> archive/<name>` restores one). Local worktrees under
`.claude/worktrees/` (gitignored) are mostly merged leftovers; `mac-native` is one of them (a Stop hook asks for its
own HANDOFF.md every turn: it needs none).

**Paused by the owner** (don't resume without being asked):
- Chrome extension, `apps/clipper` on `chrome-extension`: 1.1.0 (quick note, a note on a clip, keyboard shortcuts) and
  an unfinished, untested search that asks to read notes only when first used. Plan and checklist:
  `apps/clipper/PLAN.md`; store listing: `apps/clipper/STORE.md`.

**Waiting on the owner:** `pricing-decisions` (new plans, fair-use downloads, files on R2: `docs/PRICING_PROPOSAL.md`
there; tests pass; the owner's decisions are still open). Backup secrets (`backup-setup-half-done.md`). Items in
`docs/HANDOFF.md` section 7.

**The owner's design rules** are in `docs/claude-context/memory/` (index `MEMORY.md`); read these before any UI work:
`ios-native-look-decisions.md`, `mac-native-look-decisions.md`, `mac-polish-rules-2026-11-18.md`,
`note-page-and-tabs-rules-2026-11-18.md`, `iphone-duo-decisions.md`, `frosted-folders-decision-2026-11-20.md`,
`folevi-web-copy-voice.md`. Short version: native iOS 26 / macOS 26 look with Liquid Glass on controls (never on
content); the tab bar's scroll collapse stays iOS's own; a disabled Send or Add button is hidden until there's text,
not faded; one New note on Mac and iPad (the black pill after the tabs); settings named for what they hold.

**Tests** (2026-11-20, on 1.5.57's code): web 2,121 passed; Mac 234 passed (the old
`TabPreviewStateTests.enteringTheNextTabBeforeLeavingThisOneStillShowsIt` failure is intermittent: it passed twice
today); iOS package 390 passed. Every UI change this week was checked in the iPhone or iPad simulator, not on a device.

**Not verified on a real device:** the 1.5.56 note bar swap, 1.5.57's Download everything now progress with a
signed-in account, 1.5.58's frosted folders with a large library, and the iPad changes in a resizable window (the
account button should move past iPadOS's window buttons).
