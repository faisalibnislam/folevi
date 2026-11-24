# iOS app review: design, polish, performance (2026-11-24)

The Capacitor mobile app (`apps/mobile`) on iPhone 18 Pro and iPad Pro 13 simulators (iOS 27.2), local library, light
and dark, with Axiom's design (HIG) and performance skills and the interface polish checklist. Checks ran inside the
live app (scripts/sim.mjs eval): every visible control's size and name, text contrast, overflow at the largest text
size, Increase Contrast, Reduce Motion handling, launch timing, and memory across repeated note opens. The build Mac's
load average was 100 to 700 throughout, so absolute times are pessimistic; comparisons are within one run.

## Scope and coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| HIG: touch targets, names | iPhone: Home, Tasks, Calendar, a note, a note with a table, Foli AI, the account sheet; iPad: Home | 3 fixed (iPhone), iPad findings handed to the web session |
| HIG: contrast, Dynamic Type, Increase Contrast, dark | The same screens; largest accessibility text size + Increase Contrast + dark on Home | Clear (two checker false positives, below) |
| Typography | `components/iphone` (tabular numbers, wrapping) | Clear |
| Surfaces, animations, icons | `components/iphone`, press scales, `transition: all` across `components` | Clear |
| Performance: launch | Native launch to page start, page start to Home, bridge calls (temporary probes, removed) | 1 fixed |
| Performance: memory | Native app and web content across 20 rounds of opening two notes; WebKit low-memory signal | Native clear; web leak reported |

## Findings

### Touch targets (HIG: 44 x 44 pt)
| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `apps/web/src/components/iphone/WeekStrip.tsx` (Calendar's month grabber) | 64 x 20 pt button | Hit area reaches 24 pt down into the empty space under the strip (44 pt), never up into the days | Too small to hit reliably; a tap just under it did nothing |
| MEDIUM | `apps/web/src/components/iphone/NoteChrome.tsx` (`NotePlaceChip`, a note's "In Drafts") | 32 pt tall link | 44 pt link with the same 32 pt glass capsule inside (the glass style already uses `::before` and `::after`) | Same |
| MEDIUM | `apps/web/src/components/ai/chat/ContextChips.tsx` (Foli AI's "+ Add") | 61 x 28 pt | Hit area 8 pt above and below (44 pt), overlapping nothing | Same |
| MEDIUM | iPad sidebar layout (`globals.css` `[data-ipad]`, `Shell.tsx`): Sync status and Sidebar buttons 32 x 32, Collapse Folders/Tags 24 x 28, section headers 28, See all 28, tabs 40, Catch me up 40 | Not changed here | For the web session (PR 61 owns these files) | iPad is touch first; HIG asks 44 pt there too |

### Memory (web content)
| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | The iPhone layout's note page under WebKit (`components/iphone` and what it renders around a note) | Opening and closing "Welcome to Folevi" 20 times: web content 131 to 300 MB, 238 to 241 MB after WebKit's low-memory signal, about 5 MB kept per open | For the web session (see the follow-up below) | Grows for as long as notes are opened, until iOS ends the web view |

**Follow-up (2026-11-24, at the main session's request).** The web session found no leak in Chromium heap snapshots or in
WebKit under Playwright, so the steps were narrowed on the simulator. Every run is a fresh launch of the Debug build
(production web export), local library on this device ("This device only", the sample notes), iPhone 18 Pro or iPad Pro
13 (iOS 27.2), light mode, one round = tap the Home card, wait 2 s, close, wait 2 s; memory is the app's WebContent
process (`footprint`):

| Run | Layout | Rounds and note | Closed with | Start | After 20 | After `org.WebKit.lowMemory` |
| --- | --- | --- | --- | --- | --- | --- |
| A | iPhone | Home to Tasks and Calendar, no notes | history.back() | 134 MB | 139 MB | 113 MB |
| B | iPhone | "Reading Shelf" + "Welcome to Folevi", 40 rounds | history.back() | 135 MB | 263 MB (344 MB at 40) | 299 MB |
| C1 | iPhone | "Welcome to Folevi" twice per round | history.back() | 134 MB | 270 MB | 219 MB |
| D | iPhone | "Welcome to Folevi" | the note's Back button | 131 MB | 300 MB | 241 MB |
| E | iPhone | as D, with Capacitor's logging and web inspection off (as in releases) | Back button | 128 MB | 300 MB | 238 MB |
| F | iPad (sidebar layout) | "Welcome to Folevi" | Back button | 135 MB | 189 MB (levels off) | 136 MB |

| G | iPhone, Reduce Motion on (no screen transitions) | "Welcome to Folevi" | Back button | 130 MB | 209 MB | 173 MB |
| H | iPhone, transitions on, every animation cancelled and its callbacks dropped after the move | same | Back button | 128 MB | 300 MB | 233 MB |
| I | iPhone, transitions on, no picture (an empty element instead of the screen's copy) | same | Back button | 130 MB | 207 MB | 172 MB |
| J | iPhone, copy without `contenteditable`, its fields disabled | same | Back button | 129 MB | 295 MB | 232 MB |
| K | iPhone, copy made and trimmed but never shown | same | Back button | 130 MB | 210 MB | 172 MB |
| L | iPhone, copy shown with nothing in it scrollable | same | Back button | 129 MB | 296 MB | 234 MB |
| M | iPhone, copy shown without its images | same | Back button | 124 MB | 300 MB | 238 MB |
| N | iPhone, copy shown without `inert` and `aria-hidden` | same | Back button | 127 MB | 308 MB | 241 MB |
| O | iPhone, copy shown without `will-change` | same | Back button | 129 MB | 308 MB | 241 MB |
| P | iPhone, copy emptied after the move (shipped) | same | Back button | 131 MB | 281 MB | 216 MB |

| Q | iPhone, PR 74's `transitions.ts` (finished animations let go: `effect = null`, handlers dropped) | same | Back button | 136 MB | 244 MB | **138 MB** |

**Fixed by PR 74 (2026-11-24):** with the web session's change, WebKit's low-memory signal brings the web view back to
its starting level after 20 note opens (138 MB against 136 MB at the start), so nothing is kept per open any more. The
peak before the signal (246 MB) is garbage not yet collected. My cancel-and-drop test (H) didn't detach the effects;
PR 74 does. The partial fix in 1.5.75 (emptying the copy) becomes unnecessary once PR 74 is in.

What it is, as far as these runs go (2026-11-24, second follow-up):
- About 60% of the growth is the **screen copy the iPhone layout shows during a move** (`picture()` in
  `components/iphone/transitions.ts`, a `cloneNode(true)` of the screen being left): with no copy (I), or with the
  copy made but not shown (K), the growth matches having no transitions at all (G). A shown copy is kept after it's
  removed, by something none of these switches reach: not its animations (H), scroll areas (L), images (M), editing
  surfaces (J), accessibility attributes (N) or compositing (O). Emptying the copy after the move (P, shipped) gives
  back about a third of it (216 MB against 232 to 241 MB).
- The rest, about 2 MB per open (G, I, K: 172 to 173 MB against iPad's 136 MB), is something else in the iPhone layout.
- Both need a heap snapshot to name what holds them (Safari's Web Inspector on the Simulator).

- Not WebKit's caches: JIT code is 1.2 MB and graphics memory negligible; the growth is in "WebKit Malloc" (184 of
  247 MB in run D), where JavaScript objects and WebKit's page objects live, and the low-memory signal doesn't free it.
- Not the bridge: its event listeners (`listen`) and Capacitor plugin listeners stayed at the same counts; window
  listeners, intervals and Resize/Mutation observers stayed balanced; the page returned to 487 elements with no editor.
- Not the close path or debug logging (D, E), and not the shared note page (F: none on iPad).
- So it is something the **iPhone layout** keeps per note open that WebKit's collector can't free, invisible in
  Chromium. Next step: a heap snapshot in Safari's Web Inspector (Develop > Simulator > Folevi) on a Debug build before
  and after five opens, comparing the largest retained types; that needs Safari's window, which these tools can't drive.

### Launch and local mode's network rules
| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `apps/mobile/ios/App/App/FoleviViewController.swift`, `AppDelegate.swift` | The rules were compiled on every launch and added after the first page load had started, so the earliest requests weren't covered | Compiled once and looked up from WebKit's store (identifier from a stable hash of the list); the first load waits for them (a few ms behind the splash); if they still miss it, they're added and the page reloads once | Local mode's promise holds from the very first request; no recompiling each launch. Checked: one navigation per launch, Folevi blocked, launch time unchanged |

Launch, measured: the app asks the web view to load about 0.34 s after its process starts; WebKit's helper processes take
about 0.6 s on the Simulator; the page shows Home with its notes 0.3 to 0.5 s after it starts. The first library calls
wait 0.25 s warm (1.3 s cold under heavy load) for the library to open.

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Note card previews on Home | Text under 11 pt and "low contrast" | They are scaled-down pictures of notes, not text to read; the card's title and footer are full size |
| Table headers in notes | 2.88:1 contrast | The checker misread an `oklab()` background; the real ratio is about 7:1 |
| Tasks filter, note title, Foli AI field | "No accessible name" | Each is named by a `<label>` |
| Dynamic Type stops at 150% | HIG asks 200% | Deliberate (the bridge caps `--ios-text-scale`: past 150% the screens lack room and iOS's Zoom is there); layouts held at the cap with no clipping |
| Table column controls (24 pt) and task chips (24 to 29 pt) inside notes | Bigger hit areas | Neighbours sit closer than 44 pt; larger areas would overlap each other or the text lines |
| "AI policy" link under Foli AI | 26 pt tall | An inline text link in a sentence |
| Press scale 0.97 | Polish rule says 0.96 | Used consistently across the app; within the 0.95 floor |

## Verification and verdict

- Ran: the audit script on each screen; `simctl ui` content size, Increase Contrast and dark; three launches each before
  and after the rules change (`performance.timeOrigin`, navigation type, a blocked fetch to app.folevi.com); 20 rounds of
  note open and close with `footprint`; `elementFromPoint` taps 6 to 20 pt outside each fixed control; `tsc` and eslint.
- Not verified: a real device, Reduce Transparency (no `simctl` switch), iPhone Duo open, VoiceOver itself, the iPad
  fixes (handed over).
- Verdict: **Needs changes** (MEDIUM items with the web session: iPad touch targets and the iPhone layout's memory growth).
