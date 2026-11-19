# Folevi for Mac: performance pass (2026-11-19)

Asked for by the owner after 1.4.49: "nothing specific", and also that it feels slow inside a note, in tabs and
navigation, in lists and screens, and in windows and dialogs; memory or battery; launch. Measured and read, fixes on
judgment, on the local branch `mac-ui-audit`. Nothing here is released.

## How it was measured

- This Mac only (Apple M5 Pro, 48 GB, macOS 27.2). Other sessions ran Swift builds and tests the whole time (load
  average 5 to 18), so single numbers are noisy. Every comparison below is two builds or two settings run back to
  back, alternating, three times.
- The existing scripts on a fresh scratch library of 2,000 notes: `perf.mjs` (launch, memory, idle energy),
  `perf-interact.mjs` (open a note, switch tabs, type), `perf-scroll.mjs` (scrolling), `stress.mjs` (tab churn,
  every screen, 900 engine changes, a heap check). `sample` for where the main thread's time goes. An optimized
  build (`-O`, whole module, the Debug hooks kept) to tell slow Swift from slow framework work.
- The owner's installed Folevi, read only (`ps`, `top`): 133 MB, 0% CPU, no idle wakeups, 22 minutes after it was
  opened. Too soon after a launch to say anything about long runs.
- Three code audits (memory, energy, SwiftUI redraws) read the Mac's code. Each finding acted on below was read
  again in the code first; those not acted on are listed at the end.

A scroll's numbers depend on where the pointer is. `scrollBench` now reports `pointerInside`; every run below had
the pointer over the test window.

## Baseline (the unchanged 1.4.49 code, under load)

| | 2026-10-31 | now |
| --- | --- | --- |
| Launch to the window's page, to ready | 1.56 s, 2.08 s | 1.34 s, 2.02 s |
| Opening a note (median) | 157 ms | 300 to 350 ms |
| Switching tabs (median) | 139 ms | 152 to 157 ms |
| Typing (frame, median; frames over 33 ms) | 17 ms, 0 | 17 ms, 1 of 80 |
| All notes, 3 s scroll (p95 frame, missed frames) | 8.3 ms, 2 to 17 | 32 to 37 ms, 130 to 180 |
| Home, the same | 8.3 ms, 2 to 3 | 8 to 17 ms, 7 to 35 |
| Folders, the same | 17 to 21 ms, 40 to 107 | 8 to 20 ms, 14 to 63 |
| Idle energy impact, a list open | 0.9 | 6.1 average in one 45 s run |
| Stress run | | no crash, no leak found |

The October numbers were taken on a quieter Mac and with an unknown pointer position, so the columns are not a
clean comparison. The optimized build scrolls All notes the same (32 ms, 126 to 146 missed): the time is in
SwiftUI, AppKit and Core Animation, not in Folevi's own Swift.

## What was found and fixed

1. **A list asked what was under the pointer on every frame of a scroll.** With the pointer resting on a list,
   SwiftUI sends a hover update each frame the content moves, and the hit test for it walks every card or row the
   list has built so far (shapes, hovers, gestures, helper views): about a quarter of the main thread's work while
   All notes scrolled, more the further it had scrolled. The main lists (Home, the notes lists, Folders, Tags,
   Tasks, Calendar, the Vault, the sidebar) are now `QuietScrollView`: their content takes no pointer while it
   moves and for 120 ms after. A press ends that at once and is sent on 20 ms later, so a click lands (checked in
   the app: at rest, in the middle of a scroll, and 30, 90 and 300 ms after one). No hover highlight shows while a
   list moves, as in Finder and Safari. Same build, the switch off and on (`FOLEVI_SCROLL_HOVER=1`), missed frames
   in a 3 s scroll, nine runs each:

   | | before | after |
   | --- | --- | --- |
   | All notes | 132 to 165 (mean 153) | 74 to 109 (mean 88) |
   | Home | 7 to 35 (mean 15) | 0 to 9 (mean 2) |
   | Folders | 14 to 63 (mean 33) | 9 to 20 (mean 15) |

   All notes is better, not fixed: its p95 frame is still about 33 ms (see "Left for a second pass").
2. **A planner popover was never released.** The date picker, the list of times and the time zone list each kept
   their panel and whole view tree after closing (the content's `close` held the panel, the panel its content).
   Held weakly now. Not measured in MB; one object tree per open.
3. **Card covers and card line breaks went through the first window's engine for good.** Two app-wide helpers
   kept the first window's engine client. It outlived its window, and after that window closed, every other
   window's requests for style-image covers and for line breaks went to a stopped engine: covers retried forever
   and line breaks stayed rough. They now ask whichever window's engine is up (`LiveEngines`), and a failed
   line-break request is asked again.
4. **Caches that only grew.** Decoded style-image covers are capped at 60 (oldest out first), card line breaks at
   6,000 answers, and both, with the bundled cover art, are let go on a memory warning (they were not part of
   `Memory.relieve`). A window's per-note facts (outline, tasks, attachments, links, comments, kept for every note
   ever opened in it) go when no tab shows the note.
5. **The title bar's tabs were drawn again at every move of the caret in a note.** They read focus mode through
   the editor's whole state, which changes with the caret, the selection and the marks. Focus mode is its own
   value now.
6. **Date formatters made on every redraw.** A month's page made about sixty a pass, a task row one or two, Quick
   Add three a keystroke and 192 on opening the list of times. One formatter per template now. Too small to show
   in the timings (opening Calendar takes the same 470 ms round trip before and after), so this is tidiness, not a
   speed claim.

Tried and taken back: attaching a tooltip's helper view only while the pointer is over its control. It made no
measurable difference to scrolling, and a hover-driven tooltip could not be checked without taking over the
pointer, so the change was reverted.

## Checked and fine

- **No leak in the stress run** (6 rounds of 12 tabs, every screen 4 times, 210 fast tab switches, 900 engine
  changes): the heap check reports none.
- **Memory under bulk changes is temporary.** With All notes on screen, 300 notes created took the app from 144 MB
  to 293 MB and back to 138 MB. The extra is graphics memory (cards redrawn as the list changes), not kept.
- **Idle.** With All notes open and nothing moving, the main thread waits 96% of the time.
- **Typing in a note** holds 17 ms frames.

## Left for a second pass, with the reason

- **All notes still misses frames while scrolling.** With the pointer check gone, the time is split between
  SwiftUI laying out cards as they come in and drawing each card's picture (`flattened()`, added on 2026-10-31
  because unflattened card shadows were worse). Next to try, each behind a switch and measured: a cheaper card
  while it scrolls in, keeping fewer cards built, and drawing cards off the main thread.
- **Opening a note is about twice as slow as on 2026-10-31.** Since 1.4.47 every note opens with Foli AI's panel
  beside it, which is the likely cause, but it was not measured apart. It is the note page (web), so the fix
  belongs with the web session.
- **Energy while hidden** (from the audit, read in the code, not measured): the library's windows opt out of
  WebKit's hidden-page throttling on purpose (`Places.swift`, "its sync and reminders run in the page"), so the
  page's timers keep running behind other windows, and the page rescans the library every 30 s and writes its sync
  state each time even when nothing changed (`libraryStore.ts`). Changing either touches sync, so it needs the
  owner's decision and a test of sync in the background. One idle energy sample read 6.1 against 0.9 in October;
  not repeated on a quiet Mac.
- **Smaller audit findings not acted on:** the tab strip redraws on each hover crossing and on each navigation
  inside a tab; Show All Tabs redraws every card on pointer moves; the Tasks list sorts and filters on each key and
  is not lazy; a screen's picture is taken on the main thread when leaving a tab; the Vault decodes a file's
  picture in its body and reads uploads on the main thread; a 30 Hz timer runs while the mouse button is down
  (`DragOut`); old web views leave small entries in static tables. None showed up in a measurement here.
- **Launch** was not profiled (1.3 s to the page, 2.0 s to ready, about as before).
- **Not measured:** an 8 GB Mac, an M1, battery power, a long run of the installed app, a signed-in account with
  sync.

## Checks

`MacPerformanceTests` (6): a closed popover is released, dates share formatters and read the same, Quick Add's
words are unchanged, covers stop at their cap and are let go, line breaks can be let go, a moving list is quiet
until it rests or is pressed (and a press is sent on). The whole Swift package passes (232 Mac frame tests then,
257 + 16 + 28 + 28 in the others; iPad and iPhone pictures unchanged), but for
`TabPreviewStateTests.enteringTheNextTabBeforeLeavingThisOneStillShowsIt`, a timing test that fails in some full
runs on a loaded Mac and passes alone. Scripts for the
measurements are in `apps/mac/scripts/` (`perf*.mjs`, `stress.mjs`).
