# Visual blocks, smarter tables and block copy (plan, 2026-10-19)

Decisions agreed with the owner, after studying Miro (graphs, sticky notes, wireframes, AI mind maps) and
Whimsical (mind maps). One release with everything below. Nothing ships until the owner says "push".

## Ground rules for every new block

- Each is its own block in a note, like the flowchart and the whiteboard today (not one shared canvas).
- Each has a full-screen mode like the flowchart's Full canvas: a button in its own toolbar, ⇧⌘F, Esc back.
  Shared code: the full-canvas behaviour is extracted from `components/editor/flowchart/FlowchartView.tsx`
  into a reusable hook and stylesheet, and the flowchart uses it too.
- Available on every plan, Free included. Foli AI actions use AI credits, as Foli AI does today
  (`convex/lib/credits.ts`), and are hidden when AI is off.
- Full editing on iPhone and iPad (touch, Apple Pencil on iPad), following the iPhone interface rules in
  `docs/IOS.md` (44 pt targets, sheets, haptics).
- Export from each block's menu: PNG, SVG, PDF, and Copy as image. Note exports (PDF, HTML, Markdown) include
  them as images; Markdown keeps mind maps as nested lists and charts as tables. Public share pages show them
  read-only with zoom and pan.
- Foli AI chat and MCP (`convex/lib/mcp/tools.ts`) can create and edit mind maps, charts, sticky notes and
  wireframes.
- Data lives in the block's props, validated in `packages/editor-schema` (spec, limits, `validateWireBlock`,
  `repairWireBlock`), with size limits like the flowchart's.
- House rules: Folevi's own fonts, neutral chrome, custom controls only (no OS-default select/inputs), no
  emoji, no em dashes, "Foli AI" by name, corner tokens from the scale (`apps/web/test/radius.test.ts`).
- Freehand drawing stays in the Whiteboard block.

## Insert panel and slash menu

Grouped into: Suggested · Text (headings, quote, callout) · Lists and tasks (bulleted, numbered, to-do,
toggle) · **Visuals** (Flowchart, Mind map, Chart, Sticky notes, Wireframe, Whiteboard, Mermaid diagram) ·
Media (image, Unsplash, file, audio, bookmark, embed) · Data and more (table, collection, page, date, code
block, TeX formula). The slash menu uses the same groups.

## Mind map block

- Starts with the central idea in the middle, branches on both sides, each main branch its own colour
  (automatic); switchable to right-only or top-down tree.
- Keyboard-first: Tab adds a child, Enter a sibling, arrows move between ideas, typing writes, Delete
  removes; Whimsical-style.
- Always tidy (automatic layout) plus a Tidy up action; collapse and expand branches (a count badge), focus
  on one branch.
- Outline view: the same map as a nested bulleted list; turn a bulleted list in the note into a mind map and
  back.
- Foli AI: generate from a prompt; generate from the note (or selected text, or a PDF attachment); expand a
  branch (3 to 6 sub-ideas); summarise into the note; turn chosen branches into Folevi tasks; AI tidy.

## Sticky notes block

- Bulk add (each typed line becomes a note); paste from a spreadsheet or list makes one note per row.
- Colours, tags, dot voting (each person gets a few votes; totals shown), who wrote each note (avatar).
- Sort and group by colour, tag, author or votes; labelled group areas.
- A workshop timer everyone in the note sees.
- Foli AI: cluster by theme, summarise the board, suggest new ideas; photo of paper notes into digital notes
  (Foli AI vision, AI credits; nothing heavy runs on our servers).
- Turn chosen notes into Folevi tasks, or the board into a note with a summary and next steps.

## Chart block

- Types: bar (grouped, stacked), line, area, pie and donut, scatter and bubble, org chart, Venn (2 to 3
  circles). Switch type after creating.
- Data from: its own built-in table; a table block in the same note (live); a collection (grouped or summed
  by a field, live); CSV upload or pasted rows.
- "Turn into chart" on any table: a styled chart with a title and a takeaway line Foli AI writes.
- Colours, labels, axes, legends, several series.
- Foli AI: suggest the chart type and layout; explain the data (takeaways under the chart); make a chart from
  words (finds the numbers in the note); tidy and style.

## Wireframe block

- Component library covering all basic interface parts: phone, tablet and browser frames; text, headings,
  buttons, inputs, search box, text area, checkbox, radio, toggle, slider, dropdown, date picker, tabs, nav
  bar, sidebar, menu, breadcrumbs, pagination, cards, tables, lists, avatars, badges, tooltips, modals,
  alerts, progress, image and icon placeholders, video placeholder, map placeholder, dividers.
- Several screens in one wireframe, arrows linking them. No click-through prototype mode in this release.
- Clean greyscale by default, with a hand-drawn Sketch style switch per wireframe.
- Foli AI: draw a screen from a prompt, variations, refine.
- Export screens as PNG, SVG, PDF.

## Tables

- Formatting inside cells like normal text: select words, ⌘B/⌘I/⌘U, strikethrough, code, links, colour,
  highlight, from shortcuts, the formatting toolbar and the Format panel.
- Formulas like Google Sheets: type `=`; A1 references (`=B2*C2`, `=SUM(B2:B5)`, `=AVERAGE(B:B)`) and column
  names (`=sum(Price)`, `=Price * Quantity`) both work. Letters and numbers show while editing a formula;
  click cells to insert them. Live results.
- Functions: maths (+ - * / %, SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS); logic (IF, AND, OR, NOT,
  comparisons, IFERROR); text and dates (CONCAT, LEFT, RIGHT, LEN, UPPER, LOWER, TODAY, date differences);
  lookups (COUNTIF, SUMIF, VLOOKUP, XLOOKUP within the table).
- Errors like Sheets (#DIV/0!, #REF!, #NAME?, #VALUE!), with a plain explanation on hover.
- Number formats per column (number, currency, percent, date; numbers right-aligned, thousands separators),
  a one-click totals row, sort and filter saved as a view on the table (rows themselves aren't reordered),
  paste from Google Sheets and Excel keeps rows, columns and simple formulas.
- Foli AI in the table's block menu: edit with a prompt, fill and clean, write a formula from words,
  explain and chart. Changes are shown as a preview (changed cells highlighted), then Accept or Discard.

## Copy and cut blocks

- The block menu gets Copy (⌘C) and Cut (⌘X).
- Several blocks at once: shift-click or drag across block handles; Copy and Cut work on all, nested items
  included.
- Pasting into any Folevi note (web, Mac, iPhone, iPad) recreates the blocks exactly: tables, charts, mind
  maps, flowcharts, sticky notes, wireframes, everything.
- Images, files and recordings: the copy shares the same stored file (no extra storage; deleting one copy
  doesn't remove the file from the other).
- Pasting into other apps gives the best fit: formatted text and lists, real tables, and an image (with a
  text fallback) for charts, mind maps, flowcharts, wireframes and sticky boards.
