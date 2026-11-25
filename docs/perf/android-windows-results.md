# Android and Windows/Linux shells: performance results, 2026-11-25

Part of the performance pass (`PERF_PASS_2026-11-25.md`, "Native shell findings"). Each fix is a pull request into
its shell's own branch, so it lands with that shell:

| Shell | Pull request | Into |
| --- | --- | --- |
| Android | [#86](https://github.com/faisalibnislam/folevi/pull/86) `claude/perf-android-shell` | PR 69, `claude/android-capacitor-197cf4` |
| Tauri (Windows/Linux) | [#84](https://github.com/faisalibnislam/folevi/pull/84) `claude/perf-tauri` | PR 65, `claude/desktop-tauri` |
| Electron (Windows) | [#85](https://github.com/faisalibnislam/folevi/pull/85) `claude/perf-electron` | PR 58, `claude/windows-electron-4ed862` |

Nothing was uploaded to Play or published as a desktop release.

## How it was measured

- Desktop: `apps/desktop/scripts/measure.mjs` in the "Desktop app" workflow on GitHub's Windows and Linux runners.
  Each build starts on a scratch data folder (no account, no library) and is measured 30 s after launch. Windows
  gives the working set and private bytes; Linux gives RSS and PSS. Single runs on shared runners, so expect a few
  percent of noise. None of this ran on real hardware.
- The script now also records launch time (`readyMs`): from starting the process until the main page prints its
  ready line. Only the Tauri build prints that line, so Electron has no launch time.
- Before: run 45510877025 (the Tauri branch as it was) and run 45530563185 (`claude/desktop-perf-before`, the same
  branch plus the launch-time script). After: run 45528496090 and run 45530600565 (`claude/desktop-perf-measure`:
  PR 84, with Electron built from PR 85). The two `desktop-perf-*` branches are for measuring only and get no PR.
- Android: no SDK or emulator on this Mac (installing one needs the owner's OK), so nothing was measured. The new
  Android workflow (in PR 86) compiles the app and runs the unit tests on a GitHub runner.

## Electron (PR 85): memory

Settled memory 30 s after launch (two runs before, two after):

| | Before | After | Change |
| --- | --- | --- | --- |
| Windows x64, private bytes | 219.5 / 205.6 MB | 153.5 / 152.4 MB | about -28% |
| Windows x64, working set | 448.6 / 435.2 MB | 322.1 / 321.7 MB | about -27% |
| Windows x64, processes | 5 | 4 | one renderer fewer (Quick Add) |
| Linux x86_64, PSS | 349.8 / 351.4 MB | 300.6 / 299.9 MB | about -14% |
| Linux x86_64, RSS | 801.2 / 805.3 MB | 651.2 / 651.7 MB | about -19% |
| Linux x86_64, processes | 7 | 6 | |

This only shows the Quick Add saving, because the scratch profile has no accounts. Each extra account or library
also used to keep its own hidden runner renderer all day (roughly 60 to 100 MB each, from the process detail above).
Now a runner exists only while its place has work. That saving grows with the number of places and isn't measured
here.

## Tauri (PR 84): launch time and memory

| | Before | After |
| --- | --- | --- |
| Windows x64, launch to page ready | 7652 ms | 7080 ms |
| Windows ARM64, launch to page ready | 2328 ms | 2352 ms |
| Linux x86_64, launch to page ready | 760 ms | 853 ms |
| Linux aarch64, launch to page ready | 1287 ms | 1051 ms |
| Windows x64, private bytes | 154.6 / 150.3 MB | 150.1 / 154.1 MB |
| Linux x86_64, PSS | 366.7 / 365.7 MB | 363.3 / 361.4 MB |

- Launch: no measurable change on CI, as expected. The scratch profile has no library, so `library.open()` finished
  almost at once before the fix too. The fix takes the library open and the reminders load out of the window's path,
  so the saving grows with library size. A measurement with a generated 5,000-note library is still open.
- Windows x64's 7 s is mostly WebView2 starting cold on a fresh runner.
- Memory: unchanged within noise. The Tauri fixes target launch and disk work, not memory.

## Android (PR 86): not measured

- Fixed:
  - Firebase now starts off the main thread.
  - The legacy session's Keystore and file work in `adoptLegacySession` moved to IO.
  - The page now resizes once per keyboard slide instead of every frame.
- Verified: compile and unit tests in CI (bridge 27/27, engine and app JVM tests).
- Not measured: launch time (would need an emulator) and runtime behaviour on any device.
- Note: the audit's Android line numbers matched the old Capacitor activity. The fixes target the live Compose app.

## Waiting on the owner

- Android SDK and emulator: needed to measure Android launch time and check the keyboard on an emulator. The Android
  command-line tools, one platform and one system image come to about 6 to 8 GB.
- Windows check of PR 85 on a real PC: two accounts plus a library, switching places, the first Quick Add press, and
  a notification from a background account.
- Merging PRs 84, 85 and 86 into their shell branches.
