# Cross-platform reliability and interaction audit, 15 November 2026

## Scope and approach

The request was to improve web, Mac, iPhone and iPad behavior while keeping Folevi's visual identity and existing features. All changes are local. Nothing was committed, pushed, deployed, signed for distribution or released to TestFlight. Simulator interaction used newly created disposable libraries; the installed Mac app and the user's library were not used for testing.

This is a focused repair pass, not a claim of feature or performance parity with Craft. The editor, storage schema, sync protocol, visual tokens and navigation design remain in place. Small touch-target changes retain the existing appearance.

## Research and assessment

Craft's [3.5.0 release](https://www.craft.do/blog/craft-update-3-5-0) describes quick capture without leaving the current work, more keyboard shortcuts, task multi-selection and typing/performance work. Its [3.1.6 release](https://www.craft.do/blog/craft-update-3-1-6) emphasizes navigation and search improvements. These are vendor descriptions, not measurements against Folevi.

The useful benchmark for this pass was dependable interaction: capture must work wherever it is offered, an interrupted gesture must not commit a destructive action, a save must not erase newer input, and a keyboard must not obscure or unnecessarily shrink the editor. Folevi already has the visual language and most supporting screens. Several native entry points were disconnected from those implementations.

## Repairs

| Area | Finding | Change |
| --- | --- | --- |
| Native iPhone Create menu | New folder and Quick task used default no-op callbacks. | Connect both to existing native flows; new folders retain the current parent folder. |
| Native capture | Quick Add deep links and the iPad shortcut navigated to Tasks without opening capture. | Present the shared capture sheet from those entry points on either layout. |
| iPad routing | Some native routes opened the phone stack while the wide layout displayed the desktop model. | Route supported destinations and new notes into the visible layout; transfer the current route across the 700-point layout boundary. |
| iPhone note sharing | Share displayed a placeholder despite an existing share implementation. | Present the existing native sharing flow. |
| iPhone retained tabs | Leaving a note parks/closes the shared editor, but opacity-based tab switching does not call its appearance handler again. | Reattach and show the current note when its tab is selected again. |
| Mac Quick Add | Reopening the floating panel cleared an unfinished draft. | Resume the draft while resetting only the presentation round. |
| Shared native capture | A completed asynchronous save could clear text entered after submission. Overlapping queue flush calls could resend the same pending item. | Compare the submitted draft before resetting/closing; serialize flushes within the model. This does not claim network-wide exactly-once delivery. |
| Web capture | Two submissions before React committed its busy state could create duplicate tasks. | Use a synchronous in-flight guard and release it after success/failure. |
| Native task completion | A second tap during the completion grace period was ignored. | Cancel the pending completion and restore the unchecked state; canceled work cannot send its command. |
| Native task sheet | Read-only tasks still offered status editing. | Disable completion and guard saving when the host disallows edits. |
| Native and web swipe rows | Gesture cancellation could execute the full-swipe action. | Cancel and restore the row instead; reject multi-touch as a committed swipe. |
| Web sheets | A canceled downward drag could dismiss a sheet and discard its input. | Return to the resting detent on interruption or a second finger. |
| iPad keyboard | Screen/window coordinates were mixed; a floating keyboard near the bottom could reserve docked-keyboard space. | Convert coordinates, require horizontal coverage and clamp the intersecting height. |
| Web phone tables | Later CSS overrode the intended 44-point add-row/add-column controls with 40/36-point targets. | Restore the 44-point minimums without changing the table design. |

The existing Simulator-only diagnostic hook now reads the rebuild frame and dispatches keyboard shortcuts to it. Previously it only understood the older frame, which made the active native implementation harder to inspect. These hooks are excluded from device and Release builds.

## Follow-up: snapshots and streaming

The ten snapshot failures were checked visually against current rendering and Git history before replacing the references. Commit `feb66b7d` introduced the Foli flower in place of sparkle icons; `5e97d3e7` introduced the softened folder cards with their name/count/date below. The failing references predated those changes. Only the two Foli empty-state and eight folder-title references were updated. Existing snapshot tolerances and UI styling were not changed.

Profiling pointed to SwiftUI layout work rather than incremental Markdown parsing. Following Apple's guidance on [constant row counts in lazy containers](https://developer.apple.com/documentation/swiftui/foreach) and [narrow view updates](https://developer.apple.com/documentation/xcode/understanding-and-improving-swiftui-performance), the repair:

- Gives each Markdown block a stable observable identity. Typing changes the growing block without invalidating settled blocks or rebuilding the conversation structure.
- Separates the legacy lazy thread from its scroll geometry and gives every row exactly one container, including empty headers/footers.
- Renders current answer blocks lazily, isolates link-handler environment updates, and keeps reveal completion observable so finished actions appear correctly.
- Stops per-word observation in the current Mac/iPhone scroll containers while they follow the end or already show the unread indicator. The iPhone now shares the existing Mac follow rule and uses a top anchor while reading older text.
- Fixes the legacy iOS thread's failure to follow long answers: it now follows actual content-height changes, as its Mac counterpart already did.

The 5,000-word/500-update benchmark keeps its **33.4 ms p95** budget and now covers the actual current iPhone and Mac chat views, alongside the legacy thread. It also checks the final scroll position. Separate tests cover reading-position preservation, per-block observation, reveal completion, and light/dark appearance equivalence using the existing 1% antialiasing tolerance.

| Final local run | p95 frame interval | Frames over 33.4 ms |
| --- | ---: | ---: |
| Current iPhone chat, Simulator | 21.24 ms | 1/613 |
| Legacy iPhone chat, Simulator | 30.20 ms | 20/605 |
| Current Mac chat, full native suite | 24.44 ms | 1/606 |
| Legacy Mac chat, full native suite | 24.67 ms | 0/604 |

These are Debug host/Simulator measurements, not physical-device or 120 Hz guarantees. Earlier follow-up runs still failed during investigation; the final results above include the subsequent rendering and scrolling repairs. No performance threshold was relaxed.

The broader preflight also repaired three check issues: the generated native icon catalog lacked four existing web imports (only those entries were added); Turbo could validate tokens while its generator was rewriting them (token test/typecheck validation now depends on its build); and `next-env.d.ts` pointed to stale port-specific route declarations (regenerated by the successful production web build against `.next`).

## Verification

All runs used development/test builds and disposable data, without deploying or using production accounts.

- Workspace package tests: **2,758 passed, 2 skipped**, including web (1,798), schema (479), email (198), cloud folders (78), local storage (172) and AI prompts (33). Token/contrast checks passed too.
- Backend integration tests: **1,128 passed** across 126 files. API contract: **4 passed**.
- Full CI lint selections and all TypeScript projects: passed. Web lint reports 51 warnings and no errors. The initial stale-route type failure was resolved by regeneration; the subsequent standalone typecheck passed.
- Web production build: passed with CI placeholder URLs. The earlier iOS shell export also passed with `--platform ios --no-copy`; it was not copied into release bundles.
- Generated token, schema, contrast, native-bridge and icon checks: passed. `git diff --check` passed.
- Complete final native package suite: **453 passed, 0 failed**, run serially. All snapshot references, streaming budgets, rendering comparisons and end-follow checks passed. The 5,000-row scroll tests also passed: tasks p95 4.31 ms, note lists 3.63 ms, note cards 10.00 ms.
- Complete iOS app unit target: **70 passed, 0 skipped**, covering host/UI logic, API fixtures, local storage, encryption and app extras.
- iPhone AI/observation/rendering regression selection: **9 passed, 0 skipped**. The two parameterized tests additionally exercise both renderers/layout variants.
- Final iPhone UI smoke tests: **2 passed, 0 skipped**: Create → folder/capture, task saving, note creation, OS deep link to Tasks, and returning to the retained editor.
- Final iPad UI smoke test: **1 passed, 0 skipped**: Quick Add deep link, typing and saving.
- Final unsigned Mac Debug build and iOS UI build-for-testing: passed. Existing compiler/deprecation warnings remain.
- Disposable local-library round trip: **5 checks passed**, including opening a native-created note in the web frame and preserving the library across relaunches. This checks current shared storage, not an upgrade from a previously released TestFlight binary. The first attempt stopped before testing because the simulator was shut down; explicitly booting it resolved the harness issue.
- Earlier browser local-mode checks passed for phone editing/table controls, canceled capture-sheet gestures, and the core Tasks/Calendar/Search/Settings/Trash/Templates flow.

Both audit simulators were shut down after their checks. The installed Mac app and the user's personal library were untouched.

### Release checks still requiring the release environment

Real-device VoiceOver, large Dynamic Type, keyboard/pointer behavior, iPad Split View/Stage Manager transitions, production cloud sharing/sync, offline reconnect against a real account, and upgrading an existing TestFlight library remain unverified. The Mac floating capture panel has model/build coverage rather than a fresh end-to-end run of the installed Mac app. Existing notification-download and specialized routing placeholders outside these repaired flows remain.

## Reproduction and release handoff

Run from the repository root. Native testing requires Xcode and its normal cache/Simulator permissions.

```sh
pnpm --filter @folevi/web test
pnpm --filter @folevi/web typecheck
swift test --package-path apps/native-kit --no-parallel
pnpm exec turbo run test --concurrency=2
pnpm test:convex
pnpm test:contract
node apps/web/scripts/build-shell.mjs --platform ios --no-copy
```

The added `CaptureAuditUITests.swift` tests are explicitly opt-in with `TEST_RUNNER_FOLEVI_AUDIT_LOCAL=1`. Use only a disposable Simulator seeded with a local library. The audit devices were `Folevi Audit November 15` (iPhone 18 Pro, `8609DA56-2D9B-4A03-BE31-54BDA6630940`) and `Folevi iPad Audit November 15` (iPad Pro 13-inch, `5D74CBFA-84F3-4D07-8077-1129EF2A9059`), iOS Simulator 27.2. The existing `apps/ios/scripts/gates.mjs` harness can seed these; its `open` operation reinstalls the app, so never point it at a personal test library.

Before Claude releases: review this diff, rebuild/copy the appropriate **production** bundled web assets using the repository's release workflow, run device checks for capture/edit/save/reopen, check the release-environment items above, then run signing/archive/TestFlight steps. Native validation here used the existing bundled editor assets; web fixes were independently validated in the local browser and fresh shell export.

Existing untracked Capacitor configuration/plugin files were present before this work and were left intact. Test-generated failed snapshots were moved out of the source tree to `/tmp/folevi-audit-snapshot-failures/`; logs and screenshots are under `/tmp/folevi-audit-*` and `/tmp/folevi-native-*` on this machine.

Follow-up evidence: `/tmp/folevi-followup-native-final.log`, `/tmp/folevi-followup-root-static.log`, `/tmp/folevi-followup-ios-verified.log`, `/tmp/folevi-followup-ios-passed/`, `/tmp/folevi-followup-packages-tests.log`, `/tmp/folevi-followup-workspace-tests.log`, `/tmp/folevi-followup-web-build.log`, `/tmp/folevi-followup-web-typecheck.log`, `/tmp/folevi-followup-final-app-checks.log`, and `/tmp/folevi-followup-library-compat.log`. Final UI result bundles: `/tmp/folevi-followup-iphone-capture.xcresult` and `/tmp/folevi-followup-ipad-capture.xcresult`.

## Release review (1.3.40)

Reviewed independently before the 1.3.40 TestFlight release, on the final tree with a fresh **production** iOS
shell (`build-shell.mjs --platform ios --production --required`, then `sync-web.mjs`: production Convex
deployment and app.folevi.com, no development values).

- Lint, typecheck, workspace package tests (web 1,798 passed, 1 skipped), backend integration (1,128 passed) and
  API contract (4 passed). The first backend run hit a vitest worker-teardown error after all tests passed; a
  rerun was clean.
- Native package on the Mac host: 456 tests; all passed except the three timing budgets while another
  project's UI tests held the machine at load average 47. Rerun at normal load: Mac chat streaming p95 23.04 ms
  (legacy) and 24.29 ms (current), note cards p95 13.92 ms, all within the unchanged budgets.
- Native package on the iPhone Simulator: chat streaming p95 24.64 ms (legacy) and 22.52 ms (current). The
  iPhone Foli AI references were out of date: the empty state predates the Foli flower (feb66b7d), and the
  conversation reference recorded the bug this change fixes (an opened conversation left mid-thread behind
  "Jump to latest"). Those four references were updated after visual review. Nine other iPhone/iPad screen
  references (settings, share, calendars, notifications, folder, all folders, folder cards) fail identically on
  the previous commit and are untouched by this change; they remain to be re-recorded separately.
- iOS app unit tests: 70 passed. iPhone capture UI tests: 2 passed. iPad Quick Add UI test: 1 passed.
- Upgrade on a disposable Simulator: Folevi 1.2.39 (the last TestFlight build's source) installed, a local
  library made (unencrypted, then encrypted with a passphrase at setup), a folder, two notes, a task with
  priority and due date, and a dark appearance setting added; then this build installed over it without
  uninstalling. Every item, the note text and the setting were there, the encrypted library opened without a
  passphrase prompt, and no first-launch screen appeared. Attachments were not part of this check. This is
  not an upgrade of an installed TestFlight binary on a device.
