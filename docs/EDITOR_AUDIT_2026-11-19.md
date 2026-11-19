# Note editor audit and fix pass, 2026-11-19

Scope: the note editor that the website, the Mac app and the iPhone and iPad apps all show (Tiptap 3 /
ProseMirror, in a WKWebView in the apps), with the save and sync path under it and the native seam on iPhone
and iPad. Branch `editor/rock-solid`, 16 commits on top of `origin/main` at `a4def99d`. Nothing is pushed,
deployed or released.

What the owner asked for (2026-11-19): a full audit and "rock solid". It bothers them most on iPhone and iPad;
speed, caret and keys, paste and undo, and rich blocks all still do. A note of about 2,000 blocks must stay
smooth. English and Latin typing only. Fixes may go deep, but the stored note format does not change.

How it was done:

- Eight code reviews in parallel, one per area (core typing, paste and undo, performance, the iPhone and iPad
  seam, saving and sync, tables and databases, canvases, media and other blocks). Each finding was traced end to
  end; many were reproduced with the real editor code in a test before anything was changed. About 170 findings.
- Measured, not guessed: a new spec (`apps/web/e2e/editor-long-note.spec.ts`) types, edits, pastes, opens and
  scrolls a 2,000-block note at iPhone size, in Chromium with the CPU slowed 4 times and in WebKit, against the
  export the app carries. It can also bisect CSS rules (`PERF_DROP`) and time the editor's parts (`PERF_TRACE`).
- Fixes with a test each. The paste, table, canvas and media areas were fixed by four agents working on
  separate files; the rest (performance, typing, sync, the iPhone and iPad seam) and every piece of wiring
  between areas was done in the main session.

Finding ids below: C core typing, P paste, Y sync, I iPhone and iPad, S performance, M media and other blocks,
G tables and databases, V canvases. Paths are under `apps/web/src/components/editor/` unless they start with
another root.

## 1. Verdict

The earlier audits (3 and 12 November) were run in Chromium on a desktop. This one found that the worst
problems live exactly where those could not look: ProseMirror's iOS code path, WebKit's style engine, touch
events, and the native frame around the page. Three of them explain most of "unreliable on iPhone and iPad":

1. **Return in a to-do or a toggle on iOS lost the words after the caret and came 200 ms late** (C1). On iOS
   ProseMirror never gives Return to the editor's handlers; it reads what WebKit did to the page. The to-do and
   toggle views told it to ignore exactly that change. No test ran that path, because every test ran
   ProseMirror's desktop path.
2. **Nothing kept the line being written above the keyboard in the native app** (I1). The page fills the screen
   under the keyboard there and only knew its height as padding.
3. **Every Enter, Backspace and Tab restyled every line after the caret in a long note** (measured). One chart
   rule ending in a bare `:nth-child` did it in WebKit; the page's `:has()` rules did it in Chromium.

Around these: several ways to lose or silently overwrite text between devices (section 3), about 60 paste,
table, canvas and media defects, and touch handlers that resized, dragged or drew when the finger meant to
scroll.

## 2. Speed in a 2,000-block note

Measured with `e2e/editor-long-note.spec.ts` at 440 by 956, against the iOS export. Key to the frame that shows
it, median, in milliseconds. (A plain letter takes about two frames in this harness, so 17 to 30 is "instant".)

| | Chromium, CPU slowed 4 times: before | after | WebKit: before | after |
| --- | --- | --- | --- | --- |
| A letter (start, middle, end of the note) | 17 to 22 | 13 to 20 | 26 | 25 |
| Enter | 117 | 42 | about 80 | 32 |
| Backspace joining lines | 184 | 53 | about 50 | 27 |
| Tab and Shift+Tab | 113 | 35 | 46 | 24 |
| Style work per Enter | 88 | 8 | (not measurable) | |
| Pasting 2,000 lines, until the page is quiet | 30 s | 11 s | 11.5 s | 5.8 s |
| React commits per Enter / components drawn | 3 / 111 | 0.6 / 22 | 2 / 70 | 0.9 / 34 |
| Components drawn per arrow key | 35 | 4 | 35 | 4 |

What changed:

- `chart/chart.css`: `.fb-chart-grid tr > :nth-child(2)` named its cells. WebKit tries a rule whose last part
  names no tag or class on every element; once `:nth-child` had been tried on a note's lines, each line added
  or removed restyled all the lines after it (about 40 ms a key on a fast Mac).
- `app/globals.css`: the page's `:has(> .fb-sheet ...)` rules became attributes (`data-sheet-host`, and
  `data-sheet-pages` set by `usePageBreakMask`). In Chromium those rules restyled the whole note on every
  structural change (about 100 ms a key on a slow device).
- `test/css-selector-cost.test.ts` keeps both kinds of rule out of the stylesheets.
- Local mode counted a note's blocks for every new line by copying every block (`lib/local/functions/sync.ts`):
  a paste of 2,000 lines made four million copies. Counted once per batch.
- The page-break mask no longer measures the sheet after every key (`doc/usePageBreakMask.ts`).
- Moving the caret to another line no longer redraws the note page (the focused block was page state used only
  for the presence heartbeat; S6). The touch grip asks for the caret's block directly and does nothing on a
  phone (S10, I16). Questions and action items are looked for once writing rests (S9).
- A save's echo no longer builds a node for every block (S4, Y11), and an echo that changed nothing in the note
  draws nothing.
- Also from the area passes: the website's spell check scan went from a third of a second to a few
  milliseconds (S17, M14); a key in a table cell redraws its row, not the table (G12); the columns layout
  measures only when something moved (S8, M17); pictures load as they come near and hold their place (S1 in
  part, M7, M8); one query asks for all of a note's files (S14, M9).

Important for the existing perf spec: Playwright's trace (`retain-on-failure` in `playwright.config.ts`) copies
the whole page before and after every key. In a long note that copy took longer than the key. The new spec
turns it off; `e2e/iphone-perf.spec.ts` still runs with it on, so its typing times are inflated.

## 3. Could lose or silently overwrite text (fixed)

| Id | What | Fix |
| --- | --- | --- |
| C1 | iPhone and iPad: Return in the middle of a to-do or toggle deleted the words after the caret from the note (they stayed on screen until a reload); every Return there was 200 ms late and what was typed meanwhile was lost. | `extensions.ts`: the views ignore only their own drawing. `test/editor-ios-return.test.ts` runs ProseMirror's iOS path with the real views. |
| Y1 | A note open on this device before and changed elsewhere since could open showing the old text, and typing in a line then replaced the other device's version of that line with no conflict. | `Editor.tsx`: the editor compares what it opened with against the engine when it is ready, keeps the older revisions as the base, and draws the newer blocks at once. `test/editor-open-behind.test.tsx`. |
| Y4 | An edit resent after a lost answer came back as a replay; typing queued behind it was then applied over another device's change. | `packages/editor-schema/src/sync.ts`: no rebase when the replay answers with other text. |
| Y9 | A line cut and pasted elsewhere on another device could be skipped (the "anything new?" signature collided). | The server's head counter is part of it (`doc/DocumentView.tsx`, `synced/SyncedView.tsx`). |
| Y8 | A server re-spacing of ranks landing mid-typing moved the line under the caret, and a line added then stayed in the wrong place. | A block whose queued change does not move it follows the server's rank; re-spacing waits for a pause. |
| Y12 | More than 2,000 queued changes: the rest waited for the next edit with "Saving" showing. | `lib/sync/engine.ts`: the send loop schedules itself. |
| I5, Y14 | iPhone and iPad: typing from the last second was only flushed if WebKit sent `visibilitychange`, which it may send late or not at all. | The app tells the page it is leaving the front (`folevi:app-inactive`); the note, canvases, title and queue save at once and the app holds 3 seconds for it. |
| P1 | Pasting over selected blocks deleted them even when the paste put nothing in (a file over the limit). | One transaction; nothing is cleared unless something is pasted. |
| P6 | Plain text starting with a divider lost everything up to the next one (read as front matter). | `markdown.ts`: front matter only for imports. |
| G1 | Text typed in a database field was lost when the field went away without a blur (the note closing, the Mac quitting). | `collection/LiveInput.tsx` commits on unmount, hide and the note's flush. |
| G2 | Renaming a select option gave it a new id: every row lost its value and left the board. | A rename keeps the id; unknown ids show in the empty column. |
| G3, Y6 | A table had no size limit, could pass what the backend stores, and that one refused save then blocked every later save of the account. | A cell and a table have limits, said when reached; any block too large is refused on its own with a code (`validate.ts`). Takes effect on the server once the backend is deployed. |
| G4 | Several lines pasted into an open cell kept only the first. | Kept as line breaks. |
| G5 | A number field left with something that is not a number cleared the number. | Kept, with a message. |
| G8 | Accepting a Foli AI table change wrote the table as it was when the request was sent. | Applied onto the table as it is now. |
| V1, V2 | Undo of a canvas step (from the note or the canvas) put the whole stored drawing back, erasing what another device added since. | Each step takes back only what it did (`canvas/noteUndo.ts`, `useCanvasDoc.ts`). |
| V3 | A canvas merge over the size limit read back empty and was saved over the block. | Local work is kept, nothing is written. |
| V11 | A change from elsewhere landing mid-drag was overwritten by the next frame. | Outside changes wait for the pointer to lift. |
| V12 | A chart over its data limit went blank and saved that. | Refused with a message. |
| V18 | Text typed on a sticky note was only written on leave. | Saved while typing, as the other canvases. |
| M1 | A recording in a background tab could pass 50 MB and was then deleted when the server refused it. | Limits checked as data arrives; an oversized recording is kept for download. |
| M3 | A picture undone mid-upload and redone came back with no file and was refused on save. | It gets its file back. |
| Vault | A Vault note's Close, Escape and click outside threw away what was typed (Y5, in part). | They ask first. Autosave there is an owner decision (section 6). |

## 4. Everything else that was fixed

Core typing (`test/editor-core-edges.test.ts`):
- C2: a selection that only reaches the start of the next line no longer takes that line for Tab, Turn into,
  Duplicate, Delete and formats.
- C3: Backspace after a tabs block leaves the line alone (it was moved into the open tab, or deleted).
- C5, C11: folding a toggle with the caret inside puts the caret on the toggle's line; its key is not an undo
  step.
- C6: Shift+Up after Shift+Down shrinks the selection instead of making it whole blocks.
- C9: "@" then a space is not a mention (its menu took the next Enter).
- C12: a phone's double space after a lone number no longer makes an empty numbered line.
- C7, M11, M12: code and formulas on iPhone and iPad take quotes, dashes and the ellipsis as typed.

iPhone and iPad:
- I1: the caret stays above the keyboard and below the top bar (`lib/native/bars.ts`); menus stop at the
  keyboard's top.
- I7: the bars' room survives a page reload (taken without a note, and said again when the note is ready).
- I2, I14: a held finger while writing is left to iOS; it used to lift the block when the finger slid.
- I3, M4: a picture's resize edges only answer once it is selected, and only to a sideways drag.
- I4, G11: a table column's edge over the cells no longer takes taps and swipes.
- I12, P3: a touch the system takes away puts a dragged block back. P2: a finger drag always ends.
- I10: a reopened note does not raise the keyboard by itself. I11: an empty Update in Edit link changes
  nothing; Remove link is its own button.
- I19: a tap on the empty paper under the note writes there. I20: the to-do box is a 44 pt target.
- I16, S10: no per-frame grip work on a phone.
- V4 to V8, V17, V23: canvases under fingers and Apple Pencil (a mind map's "+" no longer breaks every later
  touch; a finger over a whiteboard scrolls; a canvas takes the keyboard on a tap, not on a scroll; a resting
  palm; a wobbling tap; full-screen drags).

Paste, copy and cut (P5, P7 to P10, P12 to P16, P18, P4; four new test files, 68 tests): Google Docs lists,
checklists and links; CSS line breaks; chat code blocks; lists pasted at a line's end; blank lines; limits said
at paste time; one undo step per paste; nested lists and checkboxes when copying out; ids kept on cut and paste
in one note; WebKit no longer reports a blocked copy that worked.

Tables and databases (G6, G12 to G15, G17 in part, G18, G19): ranges after a row move, formula chains and
loops, speed, the Excel formula paste, paste at the row limit, the column menu following its column.

Canvases (V9, V10, V13 to V16, V20 to V22, V25): undo steps, whiteboard ink stored about six times smaller, one
redraw per frame while drawing, pinch guards, order kept in merges.

Media and other blocks (M6, M9, M10, M13, M15, M16, M19, M20, M22, M23, M25, M26, M21 in part): one broken
block shows a card instead of the app's error page (and the app has an error page of its own); addresses kept;
microphone interruptions; more than 200 page links; upload retries; MP4 on WebKit.

## 5. Needs a run on a real iPhone or iPad

Everything touch-related is pinned by tests of the logic, and the iOS app compiles (Simulator build), but none
of it was watched on a device. In order of importance:

1. Return in the middle and at the end of a to-do and a toggle (C1), with the on-screen keyboard.
2. Tap a line in the lower half of a long note, type until it wraps; open the title; a table cell (I1).
3. Type, swipe home within a second, open the Mac: is the text there (I5).
4. Leave the app long enough for iOS to end the page, come back: the title clears the top bar (I7).
5. Long press on a word while writing, then slide (I2). Scroll starting on a picture's edge and a table
   column's edge (I3, I4). Drag a block and pull down Notification Center (I12).
6. Canvases: the list at the end of the canvas commit (V4 to V8, V16, V17, V23, V25).
7. Code on iPhone: does autocorrect stop without refocusing (M11). Recording through a call (M10) and the
   recording's format (M20).

## 6. Not fixed, and why

Owner decisions:
- **Vault notes have no autosave** (Y5). They now ask before discarding. Saving by themselves (and before the
  Vault locks when the app is left) changes how the Vault works: yours to decide.
- **Numbers written 1,5 or 1.234,5 are text in tables** (G16). A marker is cheap; parsing by locale changes what
  existing cells mean.
- **A refused change can be dismissed unseen** (Y7): the text should be shown and copyable first.
- A "select cells" mode for tables on touch, sticky table headers, the 24 px row and column tools (G17).
- A "Tap to interact" cover on embeds (M24); a visible "draw with finger" switch on the whiteboard (V5).

Need the device first:
- iPad Shift+Return (C4) and system undo (shake, three fingers, the shortcut bar; I6, P17). Two reviewers read
  the code differently; one run settles it.
- The hidden "Bullet," words at the start of every bulleted line (C8, C10) sit in the editable text: iOS likely
  does not capitalize a bullet's first word, and they cost time per key in bullet-heavy notes. The fix moves
  screen reader text, so it needs a VoiceOver check.

Native frame work (belongs with the iPad pass, N15):
- I8: on an iPad whose page is 656 to 699 pt wide the note has no tools at all (the frame decides "wide" by the
  window, the page by its own width). Native has to tell the page its layout.
- I9: a new note can open with no caret (the focus request is lost between three messages).
- I13: colour buttons in the native Format sheet raise the keyboard over it.
- I15: a label typed low in a full-screen canvas is under the keyboard.

Larger pieces of work, each its own change:
- S3, Y10: every save copies the block map of the whole account (about 15 ms per save at 25,000 blocks on a
  Mac). Keep blocks per note.
- S1, M18, V19: heavy blocks (tables, canvases, synced blocks) still mount in full when the note opens.
- S2: a note with page breaks is drawn through a mask the size of the whole sheet.
- Y2: a note created offline in a folder that was deleted elsewhere is refused and cannot be saved.
- Y3: two windows or tabs of one account share one queue record (Mac and browser only).
- Y6, client side: one change the server cannot take still blocks the queue (the known trigger, an oversized
  block, is now refused cleanly).
- G7: two devices in the same table still overwrite each other whole (design in the tables report).
- M2: a recording lives in memory until saved. P11: pictures inside pasted HTML. P19: HEIC as a picture.
- S5, S7, S13: smaller whole-note style and decoration costs.

## 7. Checks

- Web unit tests: 239 files, 2,113 passed. Schema package: 508 passed. Backend (Convex) tests: 1,131 passed.
- `pnpm typecheck`: clean. ESLint on every changed web file: no errors.
- End to end, against the dev site and backend: the editor specs in account mode (`editor`, `editor-keyboard`,
  `new-note-typing`, `block-copy`, `caret-after-click`, `insert-blocks`, `table-formulas`: 18 tests) and the
  iPhone editor and multi-select specs in local mode (7 tests) pass. They did not at first, for a reason that
  came with `main` (section 9).
- `e2e/editor-long-note.spec.ts` passes in Chromium and WebKit (the numbers in section 2).
- iOS app: Debug build for the Simulator compiles with the Swift changes (`RebuildNote.swift`,
  `SceneDelegate.swift`) and `bridge.js`.
- Not done: nothing was run in the Mac app, the Simulator or on a device; the dev backend does not have the
  new size limits (no Convex command was run).

## 8. To ship it

- The web changes reach the Mac, iPhone and iPad apps only with a rebuilt bundled web copy.
- The iPhone and iPad fixes I5, I7 and I11 need a new app build (native changes).
- The table and block size limits are enforced by the backend once it is deployed with this branch; until then
  the editor enforces its own (lower) limits.
- Nothing here changes the stored note format or the engine protocol.

## 9. Found by the end-to-end run: a new note's title lost the caret

Not part of the audit, and not from this branch: since 18 November every note opens with its tools panel on
Foli AI (`a989411b`), and the panel's Write box and Ask field took the keyboard as they appeared. After New
note the title lost the caret and what was typed went into Foli AI's box; opening any note on the website or
the Mac moved the keyboard into the panel. Twelve of the editor's end-to-end tests failed on it (and on a
second button named "New note" that the panel brought, which made a locator in 77 specs match twice).

Fixed here: a panel that comes up with the note leaves the keyboard alone (`components/ai/chat/events.ts`,
`ai/AiPanel.tsx`, `doc/DocumentView.tsx`); asked for (its button, Cmd+J, a tab chosen in it), its field takes it
as before. The specs pick the header's button. Only the editor specs were run again; the rest of the
end-to-end suite has not been run since that change on `main`.

