# Canonical editor schema

The single source of truth is `packages/editor-schema/spec/folevi-blocks.v1.json`. From it,
`pnpm schema:gen` generates:

- `packages/editor-schema/src/generated/schema.ts`: TypeScript types, enum value lists, limits, the spec
  used by the runtime validator
- `packages/editor-schema/generated/folevi-blocks.schema.json`: JSON Schema for documentation/tools

CI runs the generator with `--check` and fails if any output is stale.

## Wire block

```ts
interface WireBlock {
  id: string;              // ULID, stable forever (moves, edits, restore)
  type: string;            // "paragraph" | "heading" | … or a future type
  parentId: string | null; // nesting (lists, toggles, any block)
  rank: string;            // base-62 fractional index among siblings; ties broken by id
  schemaVersion: number;   // 1
  text: InlineNode[];      // text-bearing types only
  props: object;           // typed per block type
  revision?: number;       // server revision (absent for never-acknowledged blocks)
}
```

Inline content is a flat array of runs and atoms: `text` (with marks bold, italic, underline, strike,
code, link, color, highlight), `mention`, `date`, `pageLink`.

## Block types (v1)

| Type | Text | Props |
| --- | --- | --- |
| paragraph, bulleted, numbered, quote | yes | none |
| heading | yes | `level` 1–3 |
| todo | yes | `checked`, `canceled?`, `dueDate?`, `dueTime?`, `priority?`, `assigneeId?`, `reminderAt?`, `completedAt?` |
| toggle | yes | `collapsed` |
| tabs, tab | `tab` only | `tabs`: none (the tab strip). `tab`: none; its text is the tab's name (one line, at most `MAX_TAB_NAME` characters). A tabs block's children are its tabs in rank order, a tab's children are what the tab holds (any blocks). Which tab is open is not stored. See *Tabs* below and `src/tabs.ts`. `webOnly`. |
| callout | yes | `tone` (note/info/success/warning/danger), `icon?` |
| divider | no | `style?` (extralight/light/regular/strong; unset follows the page's separator style) |
| pageBreak | no | none (a sheet break in the editor; `break-after: page` in print/PDF) |
| code | no | `language`, `code` |
| image | no | `fileId?` or `url?`, `alt`, `caption`, `width?`, `naturalWidth?`, `naturalHeight?` |
| file | no | `fileId`, `name`, `size`, `mimeType` |
| table | no | `rows: InlineNode[][][]`, `headerRow`, `totalsRow?` (the last row is totals), `columns?: [{ format?, currency?, decimals? }]` (number/currency/percent/date, an ISO currency code, 0 to 6 decimals; at most one per column), `view?: { sort?: { column, desc? }, filters?: [{ column, op, value? }] }` (a saved view: rows are never reordered). A cell whose text starts with `=` is a formula, stored as typed; `src/tableFormulas.ts` (`evaluateTable`) works out what every cell shows, for the editor, exports, search and charts |
| page | no | `documentId`, `display` (link/card), `titleCache?`, `iconCache?` |
| synced | no | `sourceId` (the public id of the synced content it shows: a document of kind `synced`). No text. A synced block never goes inside synced content. See *Synced blocks* below and `docs/SYNCED_BLOCKS.md`. `webOnly`. |
| bookmark | no | `url`, `title?`, `description?`, `siteName?` |
| collection | no | `collectionId`, `viewId?` |
| formula | no | `latex` (≤ `LIMITS.maxFormulaLength`; rendered with KaTeX, `trust: false`) |
| whiteboard | no | `data` (JSON `{ v: 1, strokes: [{ points: [[x, y]…] \| d, color, width, opacity? }] }`, ≤ `LIMITS.maxWhiteboardDataLength`; x in 0–1000, y in 0–`height`), `height` (logical units, `minWhiteboardHeight`–`maxWhiteboardHeight`) |
| flowchart | no | `data` (JSON v2 `{ v: 2, nodes: [{ id, shape, x, y, w, h, text?, color?, rich?, align?, valign?, autoHeight?, fill?, stroke?, strokeWidth?, strokeStyle?, image?, note?, link?, icon?, parent? }], edges: [{ id, from? \| fromPoint?, to? \| toPoint?, fromSide?, fromAt?, toSide?, toAt?, route?, bends?, start?, end?, style?, width?, color?, labels? }], frames?: [{ id, x, y, w, h, title?, color?, parent? }], pools?: [{ id, x, y, orient?, title?, length, lanes: [{ id, title?, size, color? }] }] }`, ≤ `LIMITS.maxFlowchartDataLength`; 53 shapes (`FLOWCHART_SHAPES`: the flowchart library and basic shapes), `text` is always the label's plain text and `rich` its formatting (paragraphs of marked text runs, optional lists), an end is attached to a node side (and a position 0 to 1 along it) or floats at a point, routes elbow/curved/straight, heads none/arrow/open/circle/diamond/bar, lines solid/dashed/dotted, `parent` names a frame or a swimlane lane; v1 data `{ v: 1, … label, arrow }` is still accepted and is migrated when read; see `src/flowchart.ts`, routing in `src/flowchartRouting.ts`, layout in `src/flowchartLayout.ts`, frames and swimlanes as edits in `src/flowchartContainers.ts`: a shape or frame belongs to the innermost frame or lane its centre is dropped over, frames grow to hold their shapes, lanes keep theirs inside), `height` (canvas height, `minFlowchartHeight`–`maxFlowchartHeight`). `repairWireBlock` rewrites refused flowcharts through the reader. Marked `"webOnly"` in the spec: the retired native Swift app never drew it, so the shared golden document fixture leaves it out (`flowchart*.test.ts` and `fixtures/flowchart-v1.json` cover it). |

| mindmap | no | `data` (JSON `{ v: 1, layout?, nodes: [{ id, parent, text, color?, side?, collapsed? }] }`, ≤ `LIMITS.maxMindmapDataLength`; exactly one node with `parent: null` (the central idea), every other node's parent present, no loops, depth ≤ 32; children in array order; layout both/right/down; no positions (always laid out automatically); see `src/mindmap.ts`), `height` (`minMindmapHeight`–`maxMindmapHeight`). `webOnly`. |
| stickies | no | `data` (JSON `{ v: 1, notes: [{ id, x, y, w?, h?, text, color?, tags?, author? }], groups?: [{ id, label, x, y, w, h }] }`, ≤ `LIMITS.maxStickiesDataLength`; colours yellow/orange/pink/purple/blue/green/gray; a note belongs to the group its centre is in; `author` is a profile id; see `src/stickies.ts`), `height` (`minStickiesHeight`–`maxStickiesHeight`). `webOnly`. |
| chart | no | `data` (JSON `{ v: 1, kind, title?, takeaway?, columns: string[], rows: (string \| number \| null)[][] }`, ≤ `LIMITS.maxChartDataLength`; kinds bar/stackedBar/line/area/pie/donut/scatter/bubble/org/venn; the first column names each row, the others are series; every row as long as `columns`; see `src/chart.ts`), `height` (`minChartHeight`–`maxChartHeight`). `webOnly`. |
| wireframe | no | `data` (JSON `{ v: 1, style?, screens: [{ id, name, frame, x, y, w, h }], items: [{ id, screen, kind, x, y, w, h, text? }], links?: [{ id, from, to }] }`, ≤ `LIMITS.maxWireframeDataLength`; style clean/sketch, frames phone/tablet/browser/plain, `kind` one of `WIREFRAME_COMPONENTS`; an item's x/y is inside its screen; a link goes from a screen or item to a screen; see `src/wireframe.ts`), `height` (`minWireframeHeight`–`maxWireframeHeight`). `webOnly`. |
| columns, column | no | `columns`: none (a row of columns side by side). `column`: `width?` (its share of the row, `LIMITS.minColumnWidth` to 1; without one, an equal share). A row's children are its columns (2 to `LIMITS.maxColumns`), a column's children are its blocks (any type). See *Columns* below and `src/columns.ts`. `webOnly`. |

The data blocks share one pattern: a strict `*DataIssue` the server runs on every write, a forgiving
`parse*`/`normalize*` reader that never throws (clients, AI output, paste), and `serialize*` that writes the
compact form (`""` for an empty block). `repairWireBlock` runs refused flowcharts, mind maps, boards, charts and
wireframes through their reader (keeping what's usable) and brings their height into range; data over the
size limit is left alone.

Mermaid diagrams are `code` blocks with `language: "mermaid"`; editors render a live SVG preview.

Documents carry `DocumentStyle` (`font`, `width`, `background`, `accent`, `card`) and `DocumentCover`.
Tasks are `todo` blocks; the `tasks` table is only a projection.

## Columns

Blocks side by side (like Notion or Craft) are three levels of ordinary blocks: a `columns` block (the row), its
`column` children in rank order, and each column's own blocks under it (nested as deep as anywhere else, up
to `LIMITS.maxDepth`). We chose this over a single container whose props list child ids, or a "column index"
prop on following blocks, because it keeps every rule that already holds:

- **Sync stays per block.** Writing in one column, or two people adding blocks to two columns at once, never
  touches the same block, so nothing conflicts. A column's `width` lives on the column (one small upsert when
  resizing; all columns are written so the shares always add up).
- **The tree is the layout.** `parentId` + rank say which column a block is in and where; moving a block
  between columns is a position change like any other. History, copy and paste (`blockClipboard.ts`),
  search, backlinks, tasks and the server need nothing new.
- **Older clients lose nothing.** An app that doesn't know the types shows the row and its columns as
  "newer version" placeholders and the column contents under them, and round-trips everything untouched.

In the editor the note stays a flat list of lines (`docs/SYNC_PROTOCOL.md`, `convert.ts`): the row's line at
depth d, each column's line at d + 1 (never shown), its blocks at d + 2 and deeper. ProseMirror can't wrap a
column's lines in a box of their own, so `apps/web/src/components/editor/columns/columnsLayout.ts` places them:
the row's line reserves the row's height and a stylesheet keyed by block id gives each column's lines their
column's left edge, width and top (measured from the lines' heights at that width), without touching
ProseMirror's DOM. Below 520 px (phones, the iPhone app, a narrow window) nothing is placed and the columns
simply stack. The gaps hold the resize handles (drag, ← / →, double-click for equal widths).

Rows are kept in shape after every **local** edit by `repairColumnLines` (pure, unit-tested): a block left
directly in a row (outdented, dropped or pasted there) moves into the column before it, an emptied column
goes, columns past `LIMITS.maxColumns` join the last one, a row with one column left becomes its blocks again,
a row inside a column becomes its blocks, and a column outside a row goes (its blocks stay). Nothing written is
dropped. Remote changes are never repaired (a row someone else is still filling in arrives block by block);
readers (`columnGroupAt`, `columnsToHtml`, `ReadOnlyBlocks`) tolerate any shape, and `columnsIssues` reports
what's out of shape. The server validates each block alone (`width` in range, no text): structure across
blocks can't be refused when blocks are written one at a time by several people.

Exports: HTML and PDF draw the columns side by side (`.columns`, each column `flex` by its share, stacked
under 640 px), share pages and version previews too (version history lists them in order so every change
reads top to bottom); Markdown writes the blocks in order (`liftColumns`). Markdown import (Foli AI, MCP)
turns a ` ```columns ` fence into a row: its parts, split by lines holding only `+++`, become 2 to 4 columns
(```` ````columns ```` when a column holds a code fence); see `COLUMNS_MARKDOWN_HINT`.

## Tabs

Tabs inside a note (like Notion's tabs) are ordinary nested blocks: a `tabs` block, its `tab` children (each
one's text is its name) and each tab's blocks under it. We chose this over one container block holding its
tabs' content in props, or a "tab" prop on the blocks that follow a header, because nothing else has to know:

- **Sync stays per block.** Writing in one tab while someone renames another, or two people adding lines to two
  tabs, touches different blocks, so nothing conflicts. Renaming is a text edit of the tab; reordering tabs is a
  rank change; deleting a tab deletes its subtree like any nested block.
- **History, copy and paste, search, backlinks and tasks work unchanged**: tab names are text (searchable,
  translatable), a tab's blocks are blocks (a to-do in a tab is a task).
- **The open tab is each viewer's own** and isn't written anywhere shared: the editor and read-only pages
  remember it on the device (`localStorage` key `folevi:tab:<tabs block id>`); the first tab opens otherwise.

In the editor (`apps/web/src/components/editor/tabs/`) the note stays a flat list of lines: the tabs block's
line at depth d draws the tab strip (a `tablist`: click or arrow keys open a tab, Home and End, Enter goes
into the tab's text, F2 or a double-click renames, Option+Shift+arrows or a drag reorders, the tab's menu
renames, moves and deletes), each tab's line at d + 1 is never shown, and only the open tab's lines (d + 2 and
deeper) show, drawn at the tabs block's indent (`--lift` in `editor.css`). `tabsState.ts` works out what's
hidden; block selection, the arrow keys, Backspace and Delete, find (which opens the tab with a match), drag
and drop and indenting all respect it, so nothing reaches into a tab that isn't open. After every **local**
edit `tabsFix` keeps the shape: a line left directly in a tabs block moves into the tab before it (or into the
first tab), and a tab outside a tabs block becomes a plain line with its name; nothing is dropped. Remote
changes are never repaired, and every reader tolerates any shape. The server validates each block alone.

Exports write every tab under its name as a heading with its blocks below (Markdown `###`, HTML and PDF
`<h4 class="tab-name">`), through `liftTabs`. Shared pages and slides show the tab strip and let readers
switch tabs (`ReadOnlyTabs`, real `tabpanel`s); version history shows every tab under its name.

## Presenting

`src/slides.ts` (`splitSlides`, `slidesOf`) cuts a note into slides for presenting
(`apps/web/src/components/present/`): each divider and page break at the top level starts a slide (and isn't
shown); a note with neither is cut at its top-level Heading 1s, or, without those, its Heading 2s. A slide holds
whole blocks with everything nested under them (a toggle, a list or a tabs block is never split), and slides
of nothing but empty lines are left out.

## Validation

`validateWireBlock` (TypeScript, used by the server on every write) checks ids, ranks, types, required
fields, enums, formats (dates, times, URLs), table shape, safe link protocols and size limits
(`LIMITS`). Invalid writes are rejected with stable error codes.

## Unknown and future types

A block whose `type` is unknown to a client, or whose `schemaVersion` is newer, is parsed into an
`unknown` block carrying the original payload. Clients render it as a read-only placeholder
(“created by a newer version of Folevi”) and serialize it back byte-for-byte, so older clients never
delete newer content. The server accepts unknown types only when they claim a schema version newer than
its own.

## Synced blocks

One piece of content shown in several notes. The content is a document of kind `synced` (in a Personal or a
workspace, never listed as a page) holding ordinary blocks; each note shows it through a `synced` block whose
`props.sourceId` names it. Readers that take a note as one text (exports, share pages, search text, Foli AI, MCP)
put the content in place with `expandSyncedBlocks` (`src/synced.ts`), as far as the reader may see it. Who sees and
edits it, and what deleting does: `docs/SYNCED_BLOCKS.md`.

## Versioning and migrations

`src/migrations.ts` upgrades wire blocks step by step (`from → from + 1`). Version 0 (the pre-release
prototype format) → 1 is implemented as the template. To change the schema:

1. Bump `schemaVersion` in the spec and edit the definitions.
2. Add `migrations[N]` in `src/migrations.ts`.
3. `pnpm schema:gen`, add fixtures for the new shapes, run the tests.

## Golden fixtures

- `fixtures/document-golden.json`: every v1 block type plus an unknown `timeline` (schema v2) block;
  it must round-trip to identical canonical (sorted-key) JSON. (The retired native Swift app ran these
  fixtures too; Folevi for Mac is now the web app in Electron, `docs/DESKTOP.md`.)
- `fixtures/ranks.json`: `rankBetween` cases and an evenly spread sequence.
- `fixtures/sync-scenarios.json`: the nine offline/sync scenarios from `SYNC_PROTOCOL.md`, with the
  expected final canonical reducer state.

## Ranks

`rankBetween(a, b)` returns a base-62 string strictly between two ranks (never ending in `0`), with
`rankSequence(n)` for evenly spaced bulk inserts. The server rebalances a sibling list when ranks grow
past `LIMITS.maxRankLength` (`blocks.rebalance`).

## Editor mappings

- Web (Tiptap): one ProseMirror node per block type with `id` and `depth` attributes; the code block node
  is named `codeBlock` inside the editor (the inline mark is `code`). See `apps/web/src/components/editor/convert.ts`.
- Folevi for Mac uses the web editor (`docs/DESKTOP.md`).

## Import / export

Markdown import (`markdownToBlocks`) keeps headings, lists (nested), checklists (with `(due YYYY-MM-DD HH:mm)`),
links, code fences (language normalized), quotes, GitHub-style callouts, tables, images (absolute URLs or
uploaded files), display math (`$$…$$` → formula), page breaks (`<div style="page-break-after: always"></div>`),
front matter; HTML blocks, footnotes, reference links and unresolved images are kept as
text and reported as warnings. Markdown/HTML export (`blocksToMarkdown`, `blocksToHtml`) is used for page
exports, workspace ZIPs and version previews. Formulas export as `$$…$$` (HTML: MathML from KaTeX when
the caller passes `renderMath`, otherwise the LaTeX source), whiteboards as an inline SVG (Markdown: an SVG
data-URL image), flowcharts as an inline SVG (Markdown: a ` ```mermaid ` flowchart, so they stay portable), mind maps as a nested
bulleted list, charts as a table (title in bold, takeaway in italics), sticky notes as a list under each group's
label and wireframes as each screen's parts in reading order, and page breaks as a `page-break-after` div.
