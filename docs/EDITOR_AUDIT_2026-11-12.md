# Note editor audit, 2026-11-12

Scope: the note editor on web and in the Mac app (the same Tiptap 3 / ProseMirror editor, shown in a WKWebView
on the Mac). Branch `ipad/rounds-1-3` at `7bae9532` (1.2.38).

How it was done: four full code reviews (core text editing, flowchart, every other rich block, the Mac host
seam) plus a hands-on pass in a test account on a local dev server (Chromium). Nothing was changed.

How to read the confidence column:
- **Run**: seen in the running web editor.
- **Code**: the code path was read end to end and the defect follows from it; not yet reproduced by hand.
- **Likely**: the code is as described, but the visible result depends on browser or WebKit behaviour that
  needs one run to confirm.

Not covered: nothing was run in the Mac app or in Safari/WebKit (no Playwright browsers on this machine), no
IME, iPad or two-device session was exercised, and no performance was measured on large notes.

Paths are under `apps/web/src/components/editor/` unless they start with another root.

## 1. Verdict

The base is better than it feels. The sync and save logic for ordinary text (the 250 ms flush, id repair,
remote apply, undo restoring deleted blocks) was read closely and no lost-edit path was found. Lists, Enter and
Backspace rules, numbering, toggles and the table's keyboard basics behave.

What makes it feel finicky is concentrated in six design causes (section 2). They produce about 90 concrete
defects, of which 9 can lose work. The rich blocks (flowchart, mind map, stickies, wireframe, whiteboard, table,
chart) are where most of it lives, and the Mac app adds its own layer because the menu bar and the page both
think they own the keyboard.

## 2. Root causes

1. **Every rich block is one opaque attribute with a private copy.** A whole flowchart, table or drawing is a
   single JSON string on the block. The view keeps its own React copy, writes it back about 400 ms after changes
   settle, and replaces it whenever the attribute changes from outside. Result: text being typed is not saved
   until the edit ends, anything pending is dropped when the view goes away, two devices overwrite each other
   whole, and an open table cell can end up pointing at a different row.
2. **Four to six undo systems.** The note's history, a private history in each canvas, the browser's own input
   undo, and (on the Mac) WebKit's undo manager behind Edit > Undo. Which one Cmd+Z reaches depends on where
   focus happens to be, and in several places it reaches none.
3. **Focus is the mode switch, and blocks have no enter/exit contract.** Canvases take focus without moving the
   note's selection, toolbars inside them keep focus after a click, wheel capture hangs on focus, and only three
   block types can be entered from the keyboard. Note-level listeners then act on a stale selection.
4. **The canvas interaction model is written five times.** Flowchart, mind map, stickies, wireframe and
   whiteboard each have their own drag thresholds, shortcuts, zoom limits, selection rules, IME handling and
   save rules (table in section 8).
5. **Keyboard handling is spread over many layers.** At least nine extension-level key handlers plus seven raw
   keydown listeners, ordered by priority numbers and capture phase. On the Mac the native menu bar is one more
   layer that claims shortcuts by route ("a note is open") instead of by who has the keyboard.
6. **Paste and the flat depth model have no single owner.** Paste has two parallel pipelines chosen by string
   sniffing. The flat "depth" document has no invariant layer, so each command re-derives subtrees by hand and
   some forget (drop target, selection highlight, jump to block).

## 3. Can lose work (fix first)

| # | What | Where | Confidence |
| --- | --- | --- | --- |
| D1 | **Mac: quitting never flushes the editor.** Cmd+Q (or Sparkle restart) right after typing loses the last 250 ms to about 1.5 s of text; closing a secondary window or floating note may do the same. There is no `applicationShouldTerminate` anywhere. | `apps/mac/Folevi/App/AppDelegate.swift`; web relies on `pagehide` in `Editor.tsx:350` | Code (exact window needs the app) |
| D2 | **Text typed in a flowchart shape, mind map idea, sticky or wireframe part is not saved until the edit ends.** Close the tab, reload or quit mid-sentence and it is gone. Page hide flushes the note only, not the canvas timers. | `flowchart/interactions/textEditing.tsx:57`, `flowchart/useFlowDoc.ts:7,57`, `mindmap/MindmapView.tsx:817` | Code |
| D3 | **Leaving the note within 400 ms of a canvas change drops it** (stickies, wireframe, whiteboard; flowchart probably). The flush runs after Tiptap has torn the node view down, so `updateAttributes` silently does nothing. | `stickies/useStickiesDoc.ts:125`, `wireframe/useWireDoc.ts:57`, `WhiteboardView.tsx` unmount | Code |
| D4 | **Whiteboard: drawing past the 200,000 character limit blanks the board, and the next stroke overwrites the whole drawing.** `write()` has no size check; over-limit data reads back as empty. | `WhiteboardView.tsx:183-202`, `packages/editor-schema/src/whiteboard.ts:45` | Code |
| D5 | **A change to the same canvas block from another device replaces the local chart mid-gesture, clears its undo, and the running drag then overwrites the other side's change.** Flowchart, mind map, wireframe, chart ("Outside changes win over unsaved local ones"). Only stickies merges. | `flowchart/useFlowDoc.ts:44-55`, `mindmap/useMindDoc.ts:46`, `wireframe/useWireDoc.ts:44` | Code |
| D6 | **Audio: navigating to another note while recording discards the recording** (up to 3 hours, memory only, no prompt). | `AudioRecorder.tsx:337-352` | Code |
| D7 | **Tab with a selection that starts in a code block and ends in another block replaces the whole selection with two spaces.** | `extensions.ts:474-479` | Code |
| D8 | **"Turn into To-do" on a line that is already a to-do (Cmd+Shift+9, slash menu, Turn into) wipes its due date, reminder, assignee, repeat and checked state.** | `commands.ts:115-163` | Code |
| D9 | **Mac: Cmd+Backspace moves the whole note to Trash whenever the caret is not in editable text** (a sticky selected, blank area clicked, probably the native Find field). No confirmation. | `apps/mac/Folevi/Chrome/MenuModel.swift:229`, `Frame/NativeFrame.swift:367,432` | Code (Find field: Likely) |

Also in this class, smaller: a flowchart over 400,000 characters keeps accepting edits that never save
(`flowchart/useFlowDoc.ts:28`); the Mac silently reloads after a web content process crash and drops pending
typing (`apps/mac/Folevi/App/Navigation.swift:77`).

## 4. Flowchart

Sound: keys and clipboard never leak to the note (Backspace cannot delete the block from inside, checked in the
run), each drag is one history step, moves are frame-throttled, wheel over an inactive canvas scrolls the page.

| # | What | Where | Confidence |
| --- | --- | --- | --- |
| F1 | No copy, cut or paste of shapes at all. Only Cmd+D. | `flowchart/interactions/keyboard.ts:40`, `interactions/content.tsx:191` | Code |
| F2 | Shortcuts go dead after clicking any toolbar or selection-bar button (Delete, Cmd+Z, arrows, typing) until you click the canvas again. Chromium only; WebKit differs, which is why it feels random. | `flowchart/controller/useInteractions.ts:14,134` | Code |
| F3 | Trackpad pinch does nothing in Safari and the Mac app (WebKit sends gesture events, the code only handles ctrl+wheel; no `gesturechange` listener exists in the web app). Same for mind map, stickies, wireframe. | `flowchart/controller/useViewport.ts:107-125` | Likely |
| F4 | The "+" quick-add arrow of a selected or hovered shape sits on top of its own connector and label: clicking the connector's middle adds a shape instead. | `flowchart/interactions/quickAdd.tsx:21,183-206` | Code |
| F5 | The floating selection bar covers the incoming connector, the top port and the top "+". | `flowchart/chrome/SelectionBar.tsx` | Run |
| F6 | After moving a shape the connector keeps its original sides and takes a detour (out the bottom, around, into the top) instead of re-picking sides. | routing in `packages/editor-schema/src/flowchartRouting.ts` | Run |
| F7 | The block's toolbar is clipped at normal note width ("Present" cut off). | `flowchart/FlowchartChrome.tsx` | Run |
| F8 | Connector hit area shrinks with zoom (3 to 7 px when zoomed out, 35 px at 250%). | `flowchart/flowchart.css:76` | Code |
| F9 | Clicking inside the shape you are writing in, but off the text line, ends the edit. | `flowchart/interactions/shapeText.tsx:287`, `textEditing.tsx:105` | Code |
| F10 | Two undo stacks: Cmd+Z in the canvas is swallowed when its private stack is empty (after any outside change or block move); Cmd+Z in the note undoes the chart in arbitrary 400 ms chunks. | `flowchart/ops.ts:259-301`, `interactions/keyboard.ts:22` | Code |
| F11 | Once clicked, the canvas traps the scroll wheel until it loses focus; no release at the edge or on pointer leave. | `flowchart/controller/useViewport.ts:116` | Code |
| F12 | Marquee picks shapes only (not connectors or frames); Cmd+A gives a mixed selection for which no selection bar renders; no area select on touch. | `flowchart/interactions/select.tsx:38`, `chrome/SelectionBar.tsx:42` | Code |
| F13 | Arrow keys mean three things: one shape selected jumps to a neighbour, several nudges them, none pans. | `flowchart/interactions/keyboardFlow.ts:135` | Code |
| F14 | Selecting a connector with a slightly moving hand inserts a bend (4 px threshold) and pins the route. | `flowchart/interactions/bends.tsx:13,84` | Code |
| F15 | Resize handle, connection port and "+" are stacked at each side midpoint; grabbing a side handle often starts a connector. | `flowchart/interactions/resize.tsx:45`, `connect.tsx:187` | Code |
| F16 | IME: Enter that confirms a candidate ends connector label editing; typing to start an edit ignores IME and dead keys. | `flowchart/interactions/edgeLabels.tsx:144` | Code |
| F17 | Escape does not cancel a drag; Backspace mid-drag deletes the shape and the next move resurrects it. | `flowchart/controller/useInteractions.ts:129` | Code |
| F18 | A stray keypress on a selected shape replaces its whole text (formatting dropped); Escape commits, there is no cancel. | `flowchart/interactions/keyboard.ts:76` | Code |
| F19 | No auto-pan when dragging or connecting toward the canvas edge. | `flowchart/interactions/move.tsx` | Code |
| F20 | A missed pointer-up leaves the shape following the pointer until the next click. | `flowchart/controller/useInteractions.ts:70-95` | Likely |
| F21 | Whole view re-renders and re-runs the chart check on every drag frame and wheel tick. | `flowchart/FlowchartView.tsx:143` | Code |

Smaller: shift-click that deselects then drags the rest; shape-library ghost left on cancel and no touch drag; no
self connection, duplicate connectors merged; deleting a shape deletes its connectors; read-only zoom about the
centre; first touch on iPad scrolls the page instead of dragging.

## 5. Other blocks

| # | What | Where | Confidence |
| --- | --- | --- | --- |
| B1 | **Table: sort and filter re-apply on every keystroke.** Typing in a filtered or sorted column makes the row jump or vanish mid-word; a new row that fails the filter is added invisibly (repeated Tab adds more). | `table/TableView.tsx:70,215-234,475` | Code |
| B2 | Table: no cell range selection, no column resize, no drag reorder of rows or columns, no text selection across cells. | `table/TableView.tsx:49,379` | Code |
| B3 | Table: the whole table is one attribute addressed by row and column index; a remote row insert makes the open cell edit the wrong row. | `table/TableView.tsx:103,181` | Likely |
| B4 | Table: arrows cannot leave the table (only Escape); fast entry collapses into one undo step; deleting a column left of the caret moves it to the wrong column; a hidden tool row and a fixed tool column are always reserved. | `table/TableView.tsx:296,337,432` | Code |
| B5 | **Canvases: four undo systems.** Undo inside a canvas is written to the note as a new step, so Cmd+Z in the note first undoes the undo. | `mindmap/ops.ts:330`, `wireframe/ops.ts:466`, `NodeViews.tsx:798` | Code |
| B6 | IME: Enter that confirms a candidate commits or leaves the field in stickies, wireframe, chart, collection (no check) and mind map, tabs (wrong check for WebKit). The correct guard exists in the table cell editor. | `stickies/StickiesView.tsx:857`, `wireframe/WireframeView.tsx:1096`, `mindmap/MindmapView.tsx:870` | Code |
| B7 | No keyboard way into a canvas, chart, synced block, collection, bookmark or audio block: Enter on the selected block adds a line under it. | `plugins.ts:704-724` | Code |
| B8 | Synced block: the caret cannot enter or leave it with the arrow keys; its undo is separate. | `synced/SyncedView.tsx:264` | Code |
| B9 | Chart: Cmd+Z does nothing while focus is anywhere in a chart. | `NodeViews.tsx:915`, `chart/ChartView.tsx:532` | Code |
| B10 | Tabs: Cmd+Z is dead right after deleting or reordering a tab from its menu. | `tabs/tabsExtension.ts:193` | Likely |
| B11 | Cmd+Z while typing in an idea, sticky or wireframe label throws away the whole label and leaves edit mode. | `mindmap/MindmapView.tsx:863`, `stickies/StickiesView.tsx:823` | Code |
| B12 | Keys pressed in a canvas reach note-level listeners acting on the note's stale selection (Enter opens a previously selected formula, Cmd+J opens inline Foli AI at the old caret). | `EditorMenus.tsx:419,553`, `FormulaView.tsx:50` | Code |
| B13 | Mind map, stickies, wireframe trap the wheel once focused (same as F11); mind map pan is not frame-throttled. | `mindmap/MindmapView.tsx:254,592` | Code |
| B14 | Columns: clicking the empty space under a short column does nothing. | `columns/columnsExtension.ts:84` | Code |
| B15 | Images: three preset widths only, no drag resize, no alignment, toolbar drawn over the picture, "Image unavailable" flashes while a fresh upload's preview loads. | `NodeViews.tsx:257-297` | Code |
| B16 | A bookmark's preview fetch is an undo step. | `NodeViews.tsx:565` | Code |
| B17 | Collection embed: a live update to the cell you are typing in resets it; board drops always land at the end; nothing is undoable. | `CollectionEmbed.tsx:733,1090` | Code |
| B18 | Whiteboard has no redo, no zoom or pan. Mind map: with an idea selected "+", "-", "=" and Space do not type; Cmd+A selects the page. Wireframe: no copy or paste. | see section 8 | Code |
| B19 | A canvas stays editable after the note turns read-only, and its changes are silently not saved. | `mindmap/MindmapView.tsx:83` | Code |
| B20 | The floating page dock overlaps the line under a tall block at small window heights. | page dock | Run |

## 6. Core text editing

Sound: flush and id logic, list numbering, toggles, remote changes staying out of undo, IME respected by remote
apply and the trigger menu.

| # | What | Where | Confidence |
| --- | --- | --- | --- |
| T1 | **Pasting several lines never joins the line the caret is in and ignores its type.** "Hel\|lo" plus a two-line paste gives four blocks; lines pasted into a bullet become plain paragraphs; one Markdown-looking line splits the sentence. (Currently tested as intended.) | `paste.ts:476-534` | Code |
| T2 | Text copied from Word, Excel or PowerPoint is probably pasted as a picture: any clipboard file wins before HTML or text. | `Editor.tsx:178-183` | Likely |
| T3 | Plain text with a tab and two lines (indented code, a Makefile) becomes a table. | `paste.ts:440`, `table/sheetPaste.ts:155` | Code |
| T4 | Cmd+Shift+V still pastes rich content. | `Editor.tsx:165-194` | Likely |
| T5 | Shift+Up/Down from a one-line block jumps straight to whole-block selection and discards the text range. (Tested as intended.) | `blockSelection.ts:197` | Code |
| T6 | Block selection highlights only the picked block, but Delete, Cut and Move also take everything indented under it. | `blockSelection.ts:121`, `commands.ts:422` | Code |
| T7 | Dropping a block between a parent and its children at the parent's level silently re-parents the children. | `commands.ts:521-542` | Code |
| T8 | Slash, @ and [[ menus reopen when the caret merely moves next to old text, linger with "No matches" for several words, and steal Enter, Tab and arrows. Enter next to an old "/table" inserts a table. | `plugins.ts:1141-1163`, `EditorMenus.tsx:528,1097` | Code |
| T9 | Undo is too coarse across Enter: three short lines typed quickly vanish with one Cmd+Z. | `editorExtensions.ts:40`, `plugins.ts:793` | Code |
| T10 | Backspace at the start of a paragraph after an empty heading or bullet turns the paragraph into that type. | `plugins.ts:931` | Likely |
| T11 | Autolink turns "install.sh", "lib.so", "Thanks.It" into links; Backspace does not revert. | `autolink.ts:9-13` | Code |
| T12 | Find misses text in tables and captions; Replace all stops at 1000. | `findReplace.ts:11,52` | Code |
| T13 | Jumping to a block inside a collapsed toggle (outline, comments, tasks, Foli AI suggestions) leaves the caret invisible. | `Editor.tsx:446` | Code |
| T14 | Escape mid-line then typing puts the character at the end of the line, not at the old caret. | `blockSelection.ts:23,301` | Code |
| T15 | Markdown shortcuts are narrow: only "1. " starts a numbered list, "(**bold**)" does nothing, no `*italic*`, "***" becomes a divider. | `plugins.ts:1067-1096` | Code |
| T16 | Cmd+A always selects the whole note (no block-first step, even in a code block). | Tiptap default | Code |
| T17 | Enter on an empty indented plain paragraph keeps adding indented lines; it never steps out the way an empty bullet does. | `plugins.ts` Enter handler | Run |
| T18 | A slash-inserted block goes after the current block's whole subtree and the caret can land past the next block. | `commands.ts:343` | Likely |
| T19 | Dragging a block measures every block in the note on every frame. | `blockDrag.ts:204` | Code |

Unconfirmed and worth one test: the first IME composition in a brand-new note may be interrupted
(`plugins.ts:185`); an upload that finishes while its block is undone is not applied after redo.

## 7. Mac app (the seam between native and web)

| # | What | Where | Confidence |
| --- | --- | --- | --- |
| M1 | Format and block shortcuts (Cmd+B, I, E, D, Cmd+Shift+7/8/9, Cmd+Opt+1/2/3) act on the note's last selection while the keyboard is in a canvas, the native Find field, the palette or a dialog. | `apps/mac/Folevi/Frame/NativeFrame.swift:374-392,432` | Code (native fields: Likely) |
| M2 | Edit > Undo and Redo from the menu drive WebKit's own undo stack, not the editor's history, so the two diverge and the item is greyed out after paste or formatting. | `apps/mac/Folevi/Chrome/MenuModel.swift:148` | Likely |
| M3 | The keyboard is not returned to the note after the Cmd+K palette or any native dialog closes: typing beeps until you click. | `apps/native-kit/Sources/FoleviMac/Views/More/FrameSheets.swift:71,169` | Code |
| M4 | Switching tabs destroys the editor, so undo history is gone (kept 30 s only for note to Home and back). | `apps/web/src/components/app/Shell.tsx:272`, `FrameModel.swift:193` | Code |
| M5 | Menu items that are enabled but do nothing in the native frame: Format > Link (Cmd+Opt+K, while the page's real key is Cmd+Shift+K), Keyboard Shortcuts, Quick Add Task, New Note from Template, What's New, Send Feedback; Find Next/Previous only reopen Find. | `apps/mac/Folevi/Frame/NativeFrame.swift:401,418` | Code |
| M6 | System smart quotes, smart dashes, autocorrect and text replacement are active everywhere including code blocks; "---" may never make a divider. Chrome does none of this, so Mac and web disagree. | `Editor.tsx:162` | Likely |
| M7 | Right-click on the title, a caption, the cover or the page margin shows WebKit's stock menu (probably with Reload, which would reload the engine page). | `apps/mac/Folevi/App/WebViewFactory.swift:14-50` | Code |
| M8 | "Ignore Spelling" does not clear the red underline (different spell document tag). | `apps/mac/Folevi/Chrome/TextMenu.swift:13` | Code |
| M9 | View > Zoom zooms only the note and breaks its top inset (title slides under the tab bar). | `apps/mac/Folevi/Chrome/MainMenu.swift:354` | Code |
| M10 | Escape in the empty native Find field never returns focus to the note (class-name lookup for "WKWebView" misses `FoleviWebView`). | `apps/native-kit/Sources/FoleviMac/Views/WebNoteSidebar.swift:884` | Code |
| M11 | Find is three different things depending on where focus is. | `DocumentView.tsx:701,864` | Code |
| M12 | The default global Quick Add hotkey is Option+Space, which fires while typing and blocks the non-breaking space system-wide. | `apps/mac/Folevi/Chrome/DesktopSettings.swift:9` | Likely |
| M13 | Cmd+[ and Cmd+] navigate away instead of outdent and indent (an Apple Notes habit). | `apps/mac/Folevi/Chrome/MenuModel.swift:257` | Code |
| M14 | Context-menu Paste goes through a lossy native clipboard (text, HTML, PNG only): Finder files paste as names, Folevi's own block format is lost. | `apps/mac/Folevi/Services/Clipboard.swift:12` | Likely |
| M15 | Latency: a page script watches the whole document for drag regions the native frame ignores; note tools are rebuilt and stringified at every save on the typing thread, which is shared with every list and sync view. | `apps/mac/Folevi/Chrome/chrome-page.js:136`, `apps/web/src/lib/engine/noteTools.ts:113` | Code (cost unmeasured) |
| M16 | Process: the Debug Mac app's bundled web is from 1.2.35 (2026-11-05), 13 editor commits behind; it is rebuilt only by hand. Release builds always rebuild. | `apps/mac/web/shell/build.json` | Code |

## 8. The five canvases side by side

| Aspect | Flowchart | Mind map | Stickies | Wireframe | Whiteboard |
| --- | --- | --- | --- | --- | --- |
| Multi-select | yes, marquee shapes only | single only | yes | yes | yes (Select tool) |
| Drag on empty space | marquee (mouse), pan (touch) | pan | marquee | marquee | draw |
| Zoom range | own | 0.2 to 2.5 | 0.15 to 2.5 | 0.05 to 4 | none |
| Arrow keys | jump, nudge 8 or pan | move between ideas | nudge 8 | nudge 1 | nudge 4 |
| Space | types | folds branch | hold to pan | hold to pan | nothing |
| Escape while writing | commit | commit | commit | commit | n/a |
| IME guard | shapes yes, labels no | partial | none | none | n/a |
| Cmd+D | duplicate | reaches the browser | duplicate | duplicate | duplicate |
| Cmd+A | shapes and connectors | selects the page | all notes | all parts | all strokes |
| Copy and paste | none | branch as list | text | none | none |
| Undo | private, redo | private, redo | private with merge, redo | private, redo | private, no redo |
| Outside change | replaces, clears undo | replaces, clears undo | merged | replaces, clears undo | rebased |
| Save on blur | no | yes | no | no | no |

## 9. Recommended order of work

1. **Stop losing work** (D1 to D9). Mostly small, local fixes: a quit hook that asks the page to flush; canvases
   save typing on a short debounce and flush on page hide, blur and teardown by block id; size guards; the Tab
   and Turn into fixes; scope Cmd+Backspace to the body. Each gets a regression test.
2. **One canvas kit.** A shared document hook (save, flush, merge by item id as stickies already does), one
   viewport (wheel, pinch for WebKit, edge release, auto-pan), one text-edit contract (Enter, Escape cancels,
   IME guard, native undo while typing), one focus rule (bar buttons never keep focus). Move flowchart onto it
   first, then the other four. This removes most of sections 4 and 5 at the source.
3. **One undo.** Each canvas gesture is a single note transaction; Cmd+Z in a canvas, chart, tab strip or cell
   goes to the note's history; the Mac's Edit > Undo calls the same command.
4. **Keyboard ownership on the Mac.** Menu items validate against who has the keyboard, not the route; focus
   returns after sheets; dead items are wired or removed; substitutions off in code.
5. **Text feel.** Paste that joins and inherits the line type, file-versus-text precedence, trigger menus that
   open only on a typed trigger, gentler Shift+Arrow escalation, undo boundaries at Enter, drop-depth floor.
6. **Table as a real grid.** Stable row and column ids, frozen order while a cell is open, range selection,
   column resize, drag reorder.
7. **Flowchart polish.** Copy and paste, hit-target arbitration, connector side re-picking, selection bar
   placement, toolbar overflow.

Items 1, 3 and 4 are days. Item 2 is the large one and is what turns "finicky" into "robust". Items 5 to 7 can
run in parallel once 2 has landed for the block concerned.

## 10. Still to confirm in a running Mac app

Exact loss on Cmd+Q after typing; Cmd+Backspace and Cmd+B in the native Find field and palette; Edit > Undo with
the mouse; smart quotes in code and the "---" divider; pinch on each canvas; the stock context menu's contents;
caret after Cmd+K then Escape; IME in every block; Office paste; typing latency on a large note.

## 11. Status after the fix pass (2026-11-12, not committed, not released)

How to read it: **Fixed** means the change is in the working tree with a unit test where one is possible, and
the web suite, typecheck and the Mac build pass. "Seen" means it was also watched working in the running web
editor. Nothing here was run in the Mac app or in Safari, and no Playwright spec was run (no browsers on the
machine the work was done on).

### Lost work (section 3)

| # | Status |
| --- | --- |
| D1 | Fixed. The Mac app tells every page it is closing before it quits, and before a window or floating note closes or a place is switched (`PageClosing`, `applicationShouldTerminate`). Needs a run in the app. |
| D2, D3 | Fixed, seen. One shared hook (`canvas/useCanvasDoc.ts`) for flowchart, mind map and wireframe: typing is saved 800 ms after the last key, everything is written when the page hides, the window loses the keyboard, a press lands anywhere, or the note closes (by block id, so it works while the view is going away). Stickies and the whiteboard use the same leave rules. |
| D4 | Fixed. A stroke that would pass the limit is refused with the "whiteboard is full" message. |
| D5 | Fixed for flowchart, mind map and wireframe: a change from elsewhere that finds unsaved work is merged item by item (`canvas/canvasMerge.ts`) instead of replacing it, and undo is kept. Chart and table are still whole-block. |
| D6 | Fixed. Leaving the note stops the recording and stores it in the note it was made in; only Cancel discards. |
| D7, D8 | Fixed. |
| D9 | Fixed. Cmd+Backspace trashes the note only when nothing in the window or the page is being edited. Needs a run in the app. |

### Flowchart (section 4)

Fixed: F1 (copy, cut, paste of shapes, also between charts and notes; pasted text becomes a shape; seen), F2,
F3 (WebKit pinch, for all canvases; needs the Mac app), F4 (the "+" steps aside from its own connector), F5
(the bar sits clear of the top connection point), F6 (a connector that a move would send round the shape turns
to face it; connectors that already double back are left alone), F8, F9, F11 (the wheel is the canvas's only
while the pointer was pressed in it and has not left), F12 (area select takes connectors; a mixed selection
gets the shapes' bar), F14 (8 px before a new bend), F16 (labels), F17 (Escape cancels a drag, other keys wait),
F18 (edge auto-pan), F19, F21, and the shift-click drag. F20 in part (the issue count no longer runs per frame).

Not changed: F7 (the toolbar scrolls sideways when narrow, with no hint), F10 (the canvas keeps its own undo so
Cmd+Z in it can never remove the block; the owner's earlier choice), F13 (arrow keys, as designed and tested),
F15 (handle sizes), Escape while writing still commits.

### Other blocks (section 5)

Fixed: B1 (rows hold still while a cell is edited; a new row always shows), B4 (arrows leave the table, seen;
each cell is its own undo step; row and column deletes keep the right cell), B6 (one input-method test for
every field), B7 for canvases and charts (Enter on the selected block goes in, seen), B9, B10, B13, whiteboard
redo, mind map Cmd+A and Cmd+D no longer leak to the page or browser. Bar buttons no longer keep the canvas's
keys in mind map, stickies, wireframe and chart either.

Not done: B2 (cell ranges, column resize, drag reorder), B3 (stable row ids), B5 and B11 (one undo across
canvases), B8 (arrow keys in and out of a synced block), B12, B14, B15 (image resize), B16, B17, B19, B20.

### Text (section 6)

Fixed: T1 to T19 (see `test/editor-core-paste.test.ts`, `editor-core-keys.test.ts`, `editor-core-blocks.test.ts`).
Seen: paste joining the line and undone in one step, the slash menu opening only when typed and closing when
nothing matches, block-first select all. Three behaviours that older tests asserted changed on purpose (paste
splitting the line, Shift+Arrow escalation, typing on a block selection). Blocks copied as blocks in Folevi
still paste as whole blocks.

### Mac (section 7)

Fixed (compiled, not run): M1, M2, M3, M5 (every item wired), M6 (code is left as typed; the divider accepts
the dash smart dashes make), M7, M8, M9, M10, find next and previous.

Not changed: M4 (tabs still rebuild the editor, so undo does not survive a tab switch), M12 and M13 (the
owner's shortcuts), M14, M15, M16. The Mac app's bundled web has to be rebuilt for the web side of these fixes
to reach it.

### Spelling (new)

- Mac app: "Check Spelling While Typing" was off unless the person found the menu item, so no word was ever
  underlined. It is now on by default (a registered default, the menu still turns it off). Right-click guesses
  are checked in their sentence (a lone word was passed as right under "Automatic by Language"), and Learn and
  Ignore clear the underline. Needs a run in the app.
- Website: Folevi's own checker (`lib/spelling`, `components/editor/spellcheck.ts`): red wavy underlines for the
  whole note, guesses, Learn and Ignore in Folevi's menu. Seen. English only (American and British word lists
  from SCOWL in `public/spelling`, with their licenses); other languages keep the browser's own underlines.

## 12. Second pass (2026-11-12, later the same day; not committed, not released)

The items section 11 left open. Same reading as section 11: "seen" means watched working in the running web
editor (Chromium); nothing was run in the Mac app or Safari; no Playwright spec was run.

### One undo (B5, B11, F10, M4)

- **A canvas and its note now share one undo** (`canvas/noteUndo.ts`, flowchart, mind map, wireframe). Each
  change in a canvas is exactly one step of the note's undo, however often it was saved while it was being
  made, and never joined to typing next to it. When the canvas undoes or redoes, it has the note's history do
  it, as long as its change is the note's last step; the step moves in both places at once. When something
  else was done in the note since, the canvas writes the older drawing as no step, and the note's undo later
  passes over the step that has nothing left to change (`noteHistory.ts`). Before: Cmd+Z in the note first put
  back what the canvas had just undone, or a half-typed label from an auto-save. Seen (mind map: type, canvas
  undo, note undo, note redo, canvas redo).
- Cmd+Z in a canvas still never removes the canvas block itself, and is still swallowed when the canvas has
  nothing of its own to undo (the owner's earlier choice).
- Sticky notes and the whiteboard keep their own undo, which takes back only this person's part of a shared
  board (the note's history cannot do that). Their own undo and redo are written as no step of the note's, so
  the note's Cmd+Z no longer undoes the undo.
- **Cmd+Z while typing a label** (an idea, a sticky note, a group name, a wireframe part or screen name) takes
  the typing back a step at a time (pause, word, typing turned deleting, paste), then redoes it; only with no
  typing left does it end the edit and use the canvas's undo (`canvas/typingHistory.ts`). Seen (mind map).
- **Undo survives leaving a note** (`historyKeep.ts`): the history of the last 8 notes left is kept for 20
  minutes in the window's memory and given to the note's next editor when the note still reads exactly as it
  was left. This is what a tab switch in the Mac app does (M4), and opening another note and coming back on
  the web. What could be redone is not kept. Seen (web: type, switch tab, back, Cmd+Z).

### Blocks

- B8: the arrow keys carry the caret into and out of a synced block (`synced/caretCrossing.ts`): Down or Right
  from the end of the line above, Up or Left from the start of the line below, Enter on the selected block;
  inside, Up or Left at its very start and Down or Right at its very end. Seen, all eight moves.
- B12: keys pressed in a canvas or a block's own field no longer reach the note's shortcuts (`blockField.ts`):
  Cmd+J, Enter on a still-selected formula, the context-menu key, Cmd+Shift+V.
- B19: every canvas switches to its read-only picture the moment the note turns read-only (it used to stay
  editable and lose what was drawn).
- F7: the flowchart's toolbar fades at the edge it is cut off at while there is more that way.
- F15: a press on a shape's edge resizes (the handle's hit area is wider than it looks and sits over the
  connection dot's); the dot just outside starts a connector.
- B10: the tab strip's Cmd+Z now really reaches the note's history (the selector written in the first pass
  matched nothing); after a tab is deleted or moved from a menu the keyboard goes back to the strip.
- B14: a click in the empty space under a short column puts the caret at the end of that column.
- B15: images resize by dragging either edge (live, one undo step, Escape cancels, double-click for full
  width, 20% to 100%); the tools float above the picture when there is room; "Image unavailable" no longer
  shows while an upload is still on its way. No alignment setting (it needs a schema field).
- B16: a bookmark's preview arriving is no longer an undo step.
- B17: in a collection embed, what you are typing in a cell is no longer replaced by a live update, and a card
  dropped on a board lands where it was dropped (not at the end). Collection edits are still not undoable.
- B20: looked at again and left as it is. The page tools float by design; the caret is always scrolled clear
  of them, and the end of a note clears them.

### Table (B2, B3)

- **Cell ranges.** Dragging across cells selects the rectangle (a plain click still opens the cell);
  Shift+click and Shift+Arrow extend it; Cmd+A in a cell selects its text, then every cell. With a range:
  arrows move, Enter or typing opens the first cell, Delete clears (one undo step), copy and cut write both
  tab-separated text and an HTML table (so a range pastes into a spreadsheet and back, formulas included
  between Folevi tables), paste fills from the range's corner, Escape drops it. Seen: drag select, Delete,
  Cmd+Z, arrows, typing into the selected cell. Not on a finger drag (that scrolls).
- **Column resize.** Drag the line on a column's right edge (live, one undo step on release, Escape cancels,
  double-click for automatic); the column menu has Narrower, Wider and Reset for the keyboard. Stored as
  `width` (whole pixels, 60 to 800) on the column's settings. Seen to resize and draw.
  **This is a new field in the shared block schema** (`packages/editor-schema/spec/folevi-blocks.v1.json`,
  `TableColumn.width`). The backend checks blocks with the same package, so a backend that has not been
  deployed with it refuses the width and the table snaps back to automatic a few seconds later (seen against
  the dev backend before it had the change). The dev backend was then pushed once with the owner's OK
  (`npx convex dev --once`, dev only): a width now holds and is still there after a reload. Production is
  untouched: deploy the backend before or with the web. An older app shows the
  table without widths and drops them if it edits the table; nothing else is lost.
- **Drag to reorder.** Each row and column has a grip (the row number, the column letter) to drag it to a new
  place, with a drop line; the arrow buttons and Option+Shift+Arrow stay. Not while a sort or filter is on;
  the totals row stays last. Seen for rows.
- **B3.** When another device (or undo) inserts, removes or moves rows or columns, the open cell follows its
  row and column by their content, and closes when they are gone. The data model still has no row ids.
- Not done: the hidden tool row above and the tool column beside every table still reserve their space.

### Mac

- M14: Paste in Folevi's own right-click menu now asks the app for a real paste (as Cmd+V), so files copied in
  the Finder and Folevi's own blocks arrive whole; if no paste reaches the page it falls back to reading the
  clipboard as before. Compiled, not run.
- Still open: M12 and M13 (the owner's shortcuts), M15 (latency, unmeasured), M16 (the Debug app's bundled web
  is rebuilt by hand).

### Checks after the second pass

Web: 207 test files, 1,788 tests pass (1 skipped); typecheck clean; lint has no errors on any changed file.
Shared schema package: generated files up to date, 479 tests pass. Mac app: builds (unsigned Debug build).
Not run: the Mac app itself, Safari, Playwright specs, anything on a touch screen.

Still open after both passes: B3 in full (stable row ids need a data-model change), the table's reserved
tool row and column, image alignment (needs a schema field), undo for collection edits, F13 (arrow keys in
the flowchart, as designed), M12, M13, M15, M16, and a finger-drag cell range on touch screens.
