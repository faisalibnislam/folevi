# Folevi for Mac, iPhone and iPad: performance pass (2026-11-21)

Asked for after the Liquid Glass motion pass (PR 45) and 1.5.63: launch, scrolling long note and folder grids (the
frosted folder cards blur and draw their contents twice), tabs and notes, Show All Tabs, memory, hangs, energy.
Branch `claude/native-perf-pass`. Nothing here is released.

## How it was measured

- This Mac (Apple M5 Pro, macOS 27.2, a 120 Hz display), the Debug "Folevi Dev" app on the scripts' scratch library:
  2,000 notes and 62 folders (60 made with `perf-scroll.mjs --folders 60`, four notes each). Other sessions built and
  tested the whole time (load average 4 to 37), so every comparison is the same build with a switch off and on,
  run back to back, alternating, two or three times.
- Scrolling: the Debug app's `scrollBench` (down 3,000 points and back in 3 s, a step every display frame; frames the
  main thread missed of about 360). `sample` and Instruments (CPU Profiler, `xcprof`) for where the time goes.
- Looks: real window captures (`screencapture -l`) compared pixel by pixel. Offscreen captures (ImageRenderer,
  `cacheDisplay`, the snapshot tests' hosts) don't draw the cards' blurred shadows, so only real captures count.
- iPhone: the iOS Simulator (iPhone 17 Pro, "Folevi Native iPhone", a scratch library) with a new Debug `scrollBench`
  hook (`simulator.mjs native '{"command":"scrollBench"}'`). The Simulator runs at 60 Hz on the Mac's GPU: it
  missed no frames either way, so it says nothing about the phone's speed. The owner's iPhone wasn't connected.

## Baseline (main at 60075022, 1.5.62 plus the Liquid Glass pass)

| | |
| --- | --- |
| Launch to the window's page, to ready (3 runs) | 0.77 to 0.92 s, 1.44 to 1.60 s (1.34 s and 2.02 s on 2026-11-19) |
| Memory at Home, the app alone / with its WebKit helpers | 150 to 154 MB / 435 to 528 MB |
| Idle, All notes open, after a minute | app 0 to 3% CPU, 12 wakeups in 10 s; the page 0.3% |
| Home, 3 s scroll (missed frames, slowest 5% of frames) | 52 to 166, 17 to 25 ms |
| Folders, 60 frosted folder cards | **312 to 356**, 146 to 319 ms (about 12 frames a second) |
| All notes | 105 to 279, 38 to 50 ms |

`perf.mjs`'s idle energy (8.7 average) is the 30 s straight after opening All notes, so it's launch work settling; the
minute after reads as above.

## What was found and fixed

**SwiftUI drew every folder card again on every frame of a scroll, blurs and all.** In the Folders profile the main
thread spent most of each frame in Core Animation's commit, and most of that in RenderBox drawing the cards'
`drawingGroup` layers again (`-[RBLayer display]`), then SwiftUI's layout. Each frosted card has about thirteen
blurs: its shadow, its five notes' shadows, the same again in the frost's copy, and the frost itself. Bisected with a
switch: a plain grey card in its place missed 28 frames; no frost 265 to 303; no notes 211 to 244; neither 102 to 108.

Each folder card at rest is now drawn once into a picture and shown as that picture
(`FoleviDesign/Web/CardPicture.swift`):

- Drawn with `ImageRenderer` and the card's whole environment, so it's the same drawing. The shadow is its own
  picture, one for every card of a size and stack, so a card's picture is just its size.
- Live while the pointer is over it (its notes rise as before) and for 400 ms after, so the hover animates as it did.
- Placed on whole pixels: drawn at the card's place between two pixels, and drawn again where it comes to rest (after
  200 ms still, one card a frame). Without this a card at a fractional place in the Mac's grid came out a shade soft,
  its light words a shade heavier on dark.
- Kept in an `NSCache` (96 MB on the Mac, 48 MB on iOS, least recently used out first), let go on a memory warning
  (`Memory.relieve` on the Mac, `RebuildFrame` on iOS). Anything observable the drawing read (a style image that came
  later) forgets the picture when it changes; the card draws it again.
- `FOLEVI_CARD_PICTURES=0` draws every card live, as before.

| Mac, 3 s scroll | pictures off | pictures on |
| --- | --- | --- |
| Folders, missed frames | 321 to 347 | 79 to 99 the first time, then 13 to 37 |
| Folders, slowest 5% of frames | 160 to 319 ms | 8 to 17 ms |
| Home | 52 to 166 | 0 to 11 |
| All notes | 106 to 279 | the same (note cards aren't pictures; see below) |

Looks: window captures of Folders, light and dark, pictures off against on: 0.04% of pixels differ, all of them
relative times that moved on between the two launches and a sliver of one shadow. iPhone Home, the same check in the
Simulator: 0.023% (the status bar's clock). The frosted fronts, the notes and the shadows are the same pixels.

Show All Tabs' Home picture, the Mac and iPad Home carousels and the iPhone's Home strip draw the same folder card and
get the same pictures.

## Tried and taken back

- One `drawingGroup` for the card and its frost instead of two: no difference. No `drawingGroup` at all: a little
  better than now, still 290+.
- Pictures redrawn at every move to stay on whole pixels: worse than live (a scroll that doesn't land on whole pixels
  redrew every card every frame). Redrawn at every rest without taking turns, and with the bookkeeping in SwiftUI
  state: two to three times the missed frames. Placed once and never again: the screen's opening animation left some
  cards a shade soft.
- **Note cards as pictures**: All notes went from 106 to 163 missed to 73 to 90 in one run and 173 to 253 in the next.
  About 75 note cards at 1.5 MB each pass through a long scroll, more than the cache keeps, so pictures were dropped
  and drawn again over and over. Taken back.

## Left, with the reason

- **All notes still misses 105 to 160 frames.** Note cards blur too (the page's shadows, the stack looks' sheets).
  Next to try: only the shadow as a picture, one per card size and look (small, shared), the card itself live.
- **Real iPhone and iPad numbers.** The Simulator can't show this; on the owner's iPhone, scroll a long Folders grid
  with `FOLEVI_CARD_PICTURES=0` and without (Xcode scheme environment) and watch the 48 MB cap: an iPhone folder card
  is about 1.3 MB at 3x, so a 60-folder grid keeps about 35.
- Not measured this time: opening and switching notes and tabs (`perf-interact.mjs`), memory over a long session
  (`stress.mjs`), launch in Instruments, an 8 GB Mac.
- Found on the way, not performance: on the iPhone, Home's Folders "…" menu, All folders opens All notes. The
  iOS screen snapshot tests fail the same 18 tests on main as on this branch (stale iPhone and iPad references).

## Checks

- `CardPictureTests` (3): a picture is kept until its place changes or memory is short; it's forgotten when something
  it showed changes; a frosted folder card shown in a window and drawn again from its pictures matches the card drawn
  live (fewer than 0.5% of pixels by more than 8 levels), and a single ImageRenderer pass draws it live.
- The Swift package on macOS passes. Two 1x Mac snapshots were re-recorded, `home-picture-light` and
  `list-header-folders-ipad-light`: their hosts wait long enough for the pictures, and a 2x picture drawn into a 1x
  capture differs from live shapes drawn at 1x by 1 to 3% of pixels (the same on screen; looked at side by side).
- iOS Simulator: the package's tests fail the same 18 screen snapshots on main and on this branch, and nothing else.

## Note cards: the shadow as a picture, the face live (branch `claude/note-card-shadow-pictures`, off PR 48)

All notes still missed 105 to 160 of about 360 frames after the folder cards. Pictures of whole note cards had
thrashed the cache, so this tried only what lies under a note card's cover as a picture: its shadow, a stack's two
sheets and a divider's tabs (all in the app's colours, never the note's). One picture is shared by every card of a
size, look (plain, stack or tabs), scheme and scale, so All notes keeps two or three, about 1.5 MB each.

**What it showed: the blurs were not the main cost; the card's `drawingGroup` was.** Each note card was flattened
(`flattened()`, a `drawingGroup` with room for its shadows), and RenderBox drew that group again on every frame the
card moved (`-[RBLayer display]`, about 1,400 to 1,700 of 4,000 main-thread samples in a scroll). With the shadow a
picture but the face still flattened, nothing changed (median 268 missed against 296). With nothing blurred left in
the face, it no longer needs flattening: its layers move as they are, and RBLayer display fell to about 10 samples.
So the change is two parts that only work together:

- `WebNoteCard`: at rest, `CardPicture` draws what's under the cover (`behind`), and the face is drawn live over it,
  not flattened. A plain card's shadow is only soft, so its picture isn't kept on whole pixels (`CardPicture(snaps:
  false)`: drawn once, its place not followed, no geometry report a frame); a stack's sheets and a divider's tabs
  have edges, so theirs is.
- While the pointer is over a card, and 400 ms after, the under-layer is drawn live (flattened, as before) and lifts
  to the hover shadow with WebNoteCell's curve; the face stays the same live layers, so only the shadow changes.
- `FOLEVI_CARD_PICTURES=0` draws every card as before (the whole card flattened).

| Mac, All notes, 3 s scroll (`perf-scroll.mjs --folders 60`) | pictures off | pictures on |
| --- | --- | --- |
| Three alternating pairs at load 16 to 24 (missed frames) | 175 to 232 | 67 to 135 |
| Slowest 5% of frames, the same runs | 54 to 94 ms | 32 to 49 ms |
| Every run of the day (63 and 87 scrolls, load 9 to 880): median missed | 296 (quartiles 222 to 321) | 197 (152 to 268) |
| The same, median slowest 5% | 151 ms | 60 ms |

Other sessions built and ran simulators the whole time (load 9 to 880, free memory 26 to 33%), so single runs swing
by 200 frames; the medians and the quiet pairs agree. Home and Folders didn't scroll in this library's later runs
(28 and 0 points), so they say nothing here; folder cards are untouched by this change.

Looks, real window captures (`screencapture -l`) of All notes, pictures off against on: 0.60% of pixels differ by
more than 8 levels in light, 0.50% in dark. The shadows are the same pixels. Every difference is on cards that sit
at a fractional place in the grid: a flattened card and live layers round that place to device pixels differently,
so a card's words land one device pixel (half a point) to one side and its spine's edge a pixel wider. Side by side
at 3x they are equally sharp. Inside the app the face is always the live layers now, at rest and hovered, so nothing
jumps when a card goes from picture to live and back.

Hover, real window captures of a card in a window with `hovered` turned on and off (the scripts' pointer moves
don't reach SwiftUI's hover, so the card's own switch was used): the card lifts with the deeper hover shadow (the
band under it from 5.66 to 7.29 average darkness), a frame caught on the way back sits between the two (5.72), and
400 ms after, back on its picture, it is the same pixels as before the hover (0 differ).

Checks: `CardPictureTests.aNoteCardsShadowPictureLooksLikeTheCard` (two plain cards and a stack in a window, light
and dark, drawn again from their shadow pictures: under 0.5% of pixels off by more than 8 levels). One snapshot was
re-recorded, `home-picture-dark` (Mac, 1x offscreen): its note cards' faces are live layers now, 1.48% of pixels
moved, the same side by side; it passes with the original card. `swift test` (macOS): all pass but `TabPreviewStateTests.enteringTheNextTabBeforeLeavingThisOneStillShowsIt`, a
450 ms timer test of the tab strip's hover card (no cards in it) that fails only in the full parallel run on this
loaded Mac and passes on its own; the Foli AI streaming speed check failed once at load 600 and passed after.

## Left after the note cards

- All notes still misses frames under load: what's left is SwiftUI's own work per frame (the lazy grid's placement,
  the cards' GeometryReaders, the display list of each card's live layers), not drawing.
- The iPhone and iPad note cards get the same change (shared `WebNoteCard`); not measured on a device.
