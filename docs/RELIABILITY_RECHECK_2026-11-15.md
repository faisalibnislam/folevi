# Reliability recheck after 1.3.41

Local follow-up to release `a7a03cb6` (`1.3.41`, build 54). The owner requested a broad reliability, functionality and visual review for Mac, web, iPhone and iPad, preserving the design. This pass is local only: no commit, push, deployment, release or version change. Physical-device validation is deferred to phase 3 at the owner's request.

## Confirmed repairs

- Native Foli AI: an outstanding send/edit/regenerate response could reopen a conversation after the person selected another chat. Conversation generations now prevent stale success/failure callbacks from changing the current chat or its send state.
- Native Foli AI: a failed send discarded the typed question. Failed sends restore the submitted draft when no newer words have been entered. Failed edits restore their original edit target for a correct retry.
- Native Foli AI: opening history could carry an edit target from the previous chat into the selected conversation. Switching conversations clears that edit state and stale errors, while retaining ordinary unsent drafts.
- Native iOS Foli AI streaming: the legacy thread forced a scroll-to-end layout on every content-height change, including when the end was already visible. On iOS it now corrects only a real gap and does not issue that correction during user scrolling. Existing iOS snapshot, follow-to-end and performance assertions pass without changing their limits. The Mac scroll policy is unchanged.
- Web Quick Add (including the web Mac capture form): a successful asynchronous save could close/reset over newer title, date, priority or destination input. Completion now checks the submitted draft and mounted form before closing/resetting. A completion from a dismissed form cannot close a newly opened capture.
- Native Quick Add: an unavailable engine followed by a queue-file write failure still reported success and cleared the draft. Queue persistence now reports failure, rolls back the unsaved enqueue, preserves the editable draft and displays an error.
- Mac capture isolation: the panel used the shared package's default Application Support path, bypassing the Mac app's Debug/scratch data-folder selection. It now explicitly stores its queue under `Paths.supportFolder`; the release path remains the existing Folevi support folder.
- Editor test reliability: tabs tests left editor observers alive beyond test teardown, causing an intermittent `document is not defined` exception. Every editor created by that suite is now destroyed after its test; assertions are unchanged.
- Web check reliability: shell builds could leave incompatible generated route definitions for standalone typechecking. The web typecheck script now runs the installed Next.js CLI's `next typegen` first, and CI uses that script. This regenerates validation rather than skipping it.
- Mac test reliability: frame tests pumped the main run loop while waiting for main-actor work, occasionally failing engine readiness. They now yield the main actor asynchronously, retaining the same three-second deadline and assertions.

These changes do not alter layout, tokens, visual assets, navigation structure, editor schema or sync protocol. No snapshot references or performance thresholds were changed.

## Verification

Logs use the `/tmp/folevi-recheck-` prefix on this machine.

- Web: **1,804 passed, 1 skipped**. The first full rerun exposed the tabs-editor teardown exception described above; the full rerun after cleanup passed without unhandled errors.
- Shared JavaScript packages: schema **479 passed, 1 skipped**, email **198**, cloud folders **78**, local store **172**, AI prompts **33**. Backend integration: **1,129 passed**. API contract: **4 passed**.
- Browser: **24 passed** against the development shell. Coverage includes folder-tab navigation, phone editing/toolbars/tables/collections/menus, canceled capture gestures, persistence/reload, simulated cross-device changes and conflicts, encrypted-library unlock, library settings, cloud-provider UI stubs, accessibility checks and phone-width layouts. Provider stubs are not a live Dropbox/Google/iCloud integration check.
- Shared native on Mac: **460 tests exercised** on the changed shared code. An earlier full run failed three performance cases during concurrent build load; all five selected performance tests then passed with this audit's builds stopped: legacy chat p95 **23.69 ms**, current chat **24.10 ms** (budget **33.4 ms**); 5,000-note list **4.88 ms**, cards **13.00 ms** (budget **33 ms**). A later full run passed **458/460**, with the Mac conversation snapshot differing when the iOS scroll correction was temporarily applied there, and current chat p95 **34.91 ms**. The final correction is iOS-only, restoring the original Mac scroll policy. The unchanged release baseline had passed all 453 tests before these edits. References and performance limits remain unchanged.
- Final Mac AI selection: all seven snapshot/layout/scroll tests passed. Parser and legacy streaming checks passed (legacy p95 **31.72 ms**), but current chat p95 **35.48 ms** still exceeded **33.4 ms**. Result: **8/9 test methods passed**, `/tmp/folevi-recheck-mac-ai-final.log`. Other projects still had sustained compiler load during this run. Earlier passing timings do not supersede this failure: a quiet-machine rerun remains a release gate, and the cause of the remaining variation is not conclusively established.
- Mac app: final Debug build and **118 tests passed** on the final local source, including the queue-path and async frame-test wait fixes. Log: `/tmp/folevi-recheck-mac-complete.log`.
- iOS app: **70 unit tests passed**, zero skipped. Shared iOS capture/AI/phone-frame selection: **50 passed**, zero skipped.
- iOS AI rendering: **10 tests passed** (12 executions including parameterized cases), zero skipped, in `/tmp/folevi-recheck-ios-scroll.xcresult`. This includes iPhone/iPad-size light/dark snapshots, reading-position preservation, streamed/settled layout, follow-to-end and the 5,000-word benchmark. Final legacy chat p95 **25.16 ms**, current chat **26.06 ms**, both below **33.4 ms**. The legacy renderer initially failed at **37.29 ms** and **39.02 ms**; it passed after removing redundant scroll corrections. An earlier row-equality experiment did not improve the result and was removed. The current renderer passed each run. Timings vary with simulator/system load and are not physical-device measurements.
- Fresh iPhone UI run: **2 passed**, zero skipped. Fresh iPad UI run: **1 passed**, zero skipped. Both used rebuilt bundled editor assets and disposable local libraries.
- Production web build with CI placeholder endpoints passed. Separate Mac and iOS development-shell exports passed; the clean exports were copied into the Debug app bundles before runtime checks.
- Full root typecheck, lint, token/schema/bridge/icon generation checks, contrast checks and `git diff --check` passed. Web lint retains **53 warnings**, zero errors. Existing native compiler/deprecation warnings remain.
- Screenshots of phone editing in light/dark, library setup, the conflict notice, and the real Mac Quick Add panel were inspected. No layout or visual-identity change was needed.

The browser suite uses the documented development-shell server on port 4328 and its existing fake local-library fixtures. Initial static-export attempts could not load that development-only bridge; they were stopped and rerun against the proper environment. A temporary test-flag export was not copied into native bundles. Native Debug bundles use separately built development shells without that flag. Release preparation must rebuild production assets through the existing release scripts.

The older Mac `screens.mjs` harness timed out waiting for a web sidebar selector during setup. Direct verification instead opened the current native frame on the harness's scratch library: Quick Add retained the typed draft after hiding/reopening, its Return-key handler saved it, and the engine query confirmed exactly one matching task. The panel snapshot was reviewed at `/tmp/folevi-recheck-mac-capture.png`. This is not a test of the global hotkey from another app.

## Phase 3 and release handoff

- Before release, rerun the Mac AI benchmark with other builds stopped: `swift test --package-path apps/native-kit --no-parallel --filter 'FoliAISnapshotTests|FoliStreamingPerformanceTests'`. Resolve any repeatable failure at the existing limits; do not update snapshots or relax budgets to obtain a pass.
- Physical iPhone/iPad: capture/edit/save/reopen, VoiceOver, large Dynamic Type, software/hardware keyboards, pointer interaction, Split View and Stage Manager transitions.
- Dedicated production test account: cross-device sharing/sync, offline reconnect, queued capture replay across restarts, account/workspace switching and encryption unlock/relock.
- A real upgrade over the installed TestFlight binary, including attachments and encrypted/local data. Scratch simulator setup in this pass is not an upgrade test.
- Review the complete local diff, rebuild production bundles, run final release signing/archive/CI checks and obtain the owner's release instruction before pushing or uploading.
- Existing untracked Capacitor config/plugin files predate this pass and remain untouched. Do not stage them blindly.

Automated tests cover the scenarios exercised, not every possible device, account, network or library state. This audit does not establish that the app is free of all bugs.

## Release review (1.3.42)

Independent review of the changes above before release. Each fix was read in context and keeps cancellation, retries, keyboard, accessibility, scrolling and persistence behaviour. The Mac capture queue's release path is unchanged: `Paths.supportFolder` resolves to the same `Application Support/Folevi/quick-add-queue.json` the shared default used, so no queued items are stranded. Only Debug and scratch runs move.

Added in review:

- Mac Foli AI follow: the thread's scroll reading now includes the content height. Before, once the bottom anchor let the end slip (a long chunk on a busy Mac), further growth changed neither the offset nor `atEnd`, so no new reading arrived and the catch-up scroll never ran. One baseline run ended 8,414 pt above the answer's end. Test: `growthAloneIsANewReadingSoTheCatchUpRuns`. When following stops is unchanged.
- The bundled shell drops the website's spelling dictionaries (`public/spelling`, 1.1 MB). The apps use the system checker (`ownSpelling` is false in every app), and `e2e/shell/export.spec.ts` failed on the unexpected folder.

Mac AI streaming, at the same limit (p95 < 33.4 ms) and workload:

- Under heavy load from other projects (load average 9 to 400), the current renderer's p95 ranged 25.30 to 41.97 ms and the legacy renderer's 22.99 to 36.64 ms. The idle timer alone rose to a p95 of 24 to 33 ms in those runs.
- A CPU profile of the benchmark showed ordinary SwiftUI work: window layout, view-graph updates, display-list rendering, and the lazy stack sizing its rows. No redundant per-update work was found to remove.
- At load average about 6, three consecutive runs all passed. Current renderer p95: 23.10, 22.42 and 22.94 ms. Legacy p95: 20.98, 22.21 and 20.74 ms. Idle timer p95: 20.1 ms. The full native-kit suite then measured 23.90 ms (current) and 21.26 ms (legacy).
- No budgets, workloads or snapshot references were changed.

Final verification on the release source:

- Generated-file checks, root lint (0 errors), root typecheck (including `next typegen`) and `git diff --check` passed.
- Web: **1,804 passed, 1 skipped**. Schema 479 (1 skipped), email 198, cloud folders 78, local store 172, AI prompts 33. Backend **1,129**. API contract **4**.
- Browser:
  - The shell export suite passed (**13**, 1 skipped).
  - The local-mode suite against the development shell passed **24**: local library, local screens, iPhone editor, folder tabs.
- native-kit on macOS: every suite passed. 5,000-row list p95 4.34 ms, cards 11.29 ms.
- Mac app: build, plus **118** and **11** tests, passed.
- iOS:
  - App unit tests: **70** passed.
  - Shared screens on the iPhone simulator: **235** passed. Streaming p95 was 24.94 ms (legacy) and 25.44 ms (current).
  - iPhone capture UI: **2** passed. iPad Quick Add UI: **1** passed. Both ran on disposable audit simulators.

Still deferred to phase 3 (physical devices):

- VoiceOver, large Dynamic Type, keyboards and pointer, Split View and Stage Manager.
- Cross-device sync and sharing, and offline replay across restarts, with a test account.
- A real TestFlight-over-TestFlight upgrade, including attachments and encrypted data.
