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
| MEDIUM | The web app's JavaScript heap (the note page) | Web content 131 MB at Home, 263 MB after 20 rounds of opening and closing two notes, 219 MB after WebKit's low-memory signal (`org.WebKit.lowMemory`): about 4 MB kept per round | For the web session: a heap snapshot in Safari's Web Inspector (Develop > Simulator) around a note open and close | Grows for as long as notes are opened; the native app stayed flat at 25 to 26 MB. Not listeners or timers: window listeners, intervals and Resize/Mutation observers stayed balanced, and the DOM went back to 487 elements with no editor left |

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
- Verdict: **Needs changes** (MEDIUM items with the web session: iPad touch targets and the web content memory growth).
