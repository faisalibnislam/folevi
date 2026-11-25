# Apple shells: performance results (2026-11-25)

Part of the performance pass (`docs/perf/PERF_PASS_2026-11-25.md`, "Native shell findings"). Everything here was
measured headless while the owner kept working on this Mac (Mac17,8, M5 Pro, 48 GB, macOS 27.2.1; other sessions
were building at the same time, so single runs are noisy and medians are given). iOS numbers come from the iOS 27.2
Simulator with a Debug build: trends only, not confirmed on a device.

## Mac (`apps/mac`, branch `claude/perf-apple-3eaf61`)

### Measured (XCTest `measure {}`, `apps/mac/FoleviTests/PerfTests.swift`, 10 iterations each)

| What | Before | After |
| --- | --- | --- |
| `AppScheme.respond` (a 300 KB `_next` chunk, the page, an app path), per request | 0.11 ms | 0.10 ms (unchanged, already cheap) |
| Bridge script for a new web view (bundle files read and put together) | 2.3 ms per view | 0.68 ms per view (files read once) |
| Library content rules at launch | compiled every launch: 85 to 88 ms, on the first window's critical path | looked up from WebKit's store: 32 to 73 ms, and run in parallel with opening the library |

The rule lookup is less of a win on its own than the audit expected (WebKit's store costs nearly as much to open as
the tiny list costs to compile); the gain is that it no longer runs in series before the library opens. A changed
list (another website host) compiles once and replaces the older one (`testRuleListCompilesOncePerText`).

### Changed, not measurable without launching the app

- Runners (hidden web views for places in the background) start once the first main window's page has loaded, or after
  5 s, instead of 1 s after launch, so they no longer compete with the first page load.
- WebKit's private switches that turn off hidden-page timer throttling and process suppression now apply to runners
  only (they exist only while their place has work). Library windows keep WebKit's defaults, so a minimized or covered
  library window's timers may stretch and its process may nap like any page's. `inactiveSchedulingPolicy = .none` stays
  for both (the library's sync and reminders keep running behind other windows).
- The legacy Keychain session is read off the main thread at launch.
- FOLEVI_OFFLINE's rules are looked up while the migration check runs.
- The XCTest host never activates (`.prohibited` activation policy when testing), so `xcodebuild test` takes no focus.

### Launched (owner's OK, 2026-11-25): `perf.mjs`, before and after

`node apps/mac/scripts/perf.mjs` with two Debug builds side by side: "before" is `main`'s Mac code with only the
`calendarDays` build fix, "after" is this branch. Same scratch library (local mode, the starter notes, two made-up
accounts), same web export (`FOLEVI_SHELL_DIR`). The Mac was heavily loaded by other sessions (load average about 43).

| | Before | After |
| --- | --- | --- |
| Launch to the first page loaded (median) | 0.93 s (3 runs), 1.09 s (4 runs) | 1.12 s (4 runs) |
| Launch to the first screen drawn (median) | 1.03 s, 1.81 s | 1.45 s |
| Footprint at Home, app and its 5 WebKit helpers | 383 MB | 395 MB |
| The app process alone | 44 to 46 MB | 39 to 42 MB |
| Idle, 30 s, Energy Impact (top) | 0.4 avg, 1.5 max | 0.7 avg, 1.4 max |

No measurable launch, memory or idle-energy difference on this Mac at this load: the run-to-run spread (0.9 to 1.7 s)
is larger than anything these changes could save. The runner and throttling changes can't show here at all: the
script's made-up accounts never start a runner. A run on a quiet Mac, with a generated 5,000-note library
(`--library`), is what would show them. `perf-scroll.mjs` wasn't run: the scratch library has nothing long enough to
scroll.

The launch run found a crash the unit tests missed: `async let` evaluated `ruleList`'s default argument
(`WKContentRuleListStore.default()`) off the main thread, where WebKit's first use traps. Fixed (the store is looked up
inside the main-actor function) before these numbers; the "after" first launch right after the fix took 9 s once and
didn't repeat.

### Tests

Full Mac suite: 119 tests, 117 pass. The 2 failures are one test, `CapabilitiesTests.testVisionReadsTheTextInAnImage`,
which timed out (33 s) while the Mac was under load and passes alone (0.25 s); not related to these changes.

## iPhone and iPad (Capacitor, `apps/mobile`, branch `claude/perf-ios-3eaf61` from `claude/ios-feedback-b1307a`)

Scratch install on a Simulator of its own ("Folevi Perf iPhone", iPhone 18 Pro, booted with `simctl`, Simulator.app
never opened), a library on the device with the starter notes. Web export: the one built for `claude/ios-feedback-b1307a`.

### Launch (cold, `simctl launch` to the page's clock, median of the stable runs)

| Phase | Before | After (Keychain off the main thread) |
| --- | --- | --- |
| `simctl launch` to navigation start | 2.58 s | 2.43 s (inside the noise) |
| Navigation start to DOMContentLoaded / load | 25 ms / 81 ms | 37 ms / 105 ms (noise) |
| Navigation start to first contentful paint | 587 ms | 715 ms (noise, Mac under load) |

About 2.3 s of the native phase passes before the app's first log line: `simctl`'s spawn and pre-main of a Debug
Simulator build (separate debug dylib, Capacitor's frameworks). App code from the first log line to the web page being
created is about 1 s (scene setup about 0.4 s, Capacitor's bridge about 0.3 s). This needs a Release build on a device
to mean anything; `xctrace` App Launch on the Simulator gives no lifecycle periods and an unsymbolicated time profile.

### Splash screen

The audit suggested hiding the splash on the first frame instead of at window `load`. Measured: `load` comes about
80 ms after navigation starts, so the current hide (at `load`, next frame) already is the first frame; the page's own
content paints about 500 ms later. Tying the hide to the first contentful paint was tried and dropped: WebKit reports
paint entries late (a paint at 187 ms showed up at about 690 ms), so the splash stayed up longer. No change.

### Note-page memory (the audit's HIGH item)

`footprint` of the app and its WebContent process (`memloop.mjs`, the Debug `SimulatorEval` hook):

| Step | App | WebContent | Total |
| --- | --- | --- | --- |
| Home, fresh launch | 27 MB | 135 MB | 162 MB |
| After 5 note opens and closes | 27 MB | 185 MB | 212 MB |
| After 20 | 27 MB | 206 MB | 233 MB (settled 222 MB) |
| 40 more opens | 27 MB | 195 to 206 MB, one +18 MB step at the end | 223 MB flat for 35 opens |
| 90 interrupted opens (back after 60 to 150 ms) | 27 MB | 227 to 261 MB | 254 to 288 MB |
| Then memory pressure (`org.WebKit.lowMemory`) | 28 MB | 162 MB | 190 MB |

Not a leak: the first opens load the editor's code (warm-up), after which memory holds flat, and everything above that
is garbage WebKit gives back under memory pressure. Interrupted transitions leave nothing behind (no running
animations, no `will-change`, no zoom pictures; 496 DOM nodes on Home afterwards), so the 2026-11-24 `release()` fix in
`components/iphone/transitions.ts` holds and no `apps/web` change is needed. Home is 162 MB against 183 MB in
`docs/MOBILE.md` (a different web export).

### Bridge payloads (the `_bridge` route question)

Through Capacitor's message handler (`foleviShell.library` write, read, read again):

| Size | Write | Read |
| --- | --- | --- |
| 16 KB | 31 ms (first call) | 5 to 13 ms |
| 256 KB | 17 ms | 7 to 8 ms |
| 1 MB | 21 ms | 12 to 13 ms |
| 4 MB | 50 ms | 31 to 35 ms |
| 50 small calls (`info`) | | 14 ms in all (0.3 ms each) |

About 8 ms per MB, base64 included. Note files are a few KB and attachments already go through `folevi-file://`, so a
`_bridge` scheme route like the Mac's would save a few milliseconds on rare large files. Not built; worth it only if a
5,000-note library shows large listing or journal payloads.

### `capacitor://` caching

Capacitor's `WebViewAssetHandler` answers every file with `Cache-Control: no-cache` and reads it on the main thread.
Custom-scheme responses are not kept in WebKit's disk cache and the single-page app fetches each chunk once per page,
so this costs only on a page restart (a mode or place switch). The handler is created in Capacitor's `final loadView`
and can't be swapped without patching Capacitor; left as it is.

### Changed

- `FoleviViewController.startPlaces`: the legacy Keychain session read moved off the main thread (it ran before the
  first page load on every launch). `Keychain.forgetAfterReinstall` stays: it only reads a default after the first run.
