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
| callout | yes | `tone` (note/info/success/warning/danger), `icon?` |
| divider | no | `style?` (extralight/light/regular/strong; unset follows the page's separator style) |
| pageBreak | no | none (a sheet break in the editor; `break-after: page` in print/PDF) |
| code | no | `language`, `code` |
| image | no | `fileId?` or `url?`, `alt`, `caption`, `width?`, `naturalWidth?`, `naturalHeight?` |
| file | no | `fileId`, `name`, `size`, `mimeType` |
| table | no | `rows: InlineNode[][][]`, `headerRow` |
| page | no | `documentId`, `display` (link/card), `titleCache?`, `iconCache?` |
| bookmark | no | `url`, `title?`, `description?`, `siteName?` |
| collection | no | `collectionId`, `viewId?` |
| formula | no | `latex` (≤ `LIMITS.maxFormulaLength`; rendered with KaTeX, `trust: false`) |
| whiteboard | no | `data` (JSON `{ v: 1, strokes: [{ points: [[x, y]…] \| d, color, width, opacity? }] }`, ≤ `LIMITS.maxWhiteboardDataLength`; x in 0–1000, y in 0–`height`), `height` (logical units, `minWhiteboardHeight`–`maxWhiteboardHeight`) |
| flowchart | no | `data` (JSON `{ v: 1, nodes: [{ id, shape, x, y, w, h, text?, color? }], edges: [{ id, from, to, fromSide?, toSide?, label?, style?, arrow? }] }`, ≤ `LIMITS.maxFlowchartDataLength`; shapes process/decision/terminator/io/circle/note/text, colours neutral/accent/blue/green/yellow/pink/purple, sides top/right/bottom/left, style solid/dashed, arrow end/both/none; see `src/flowchart.ts`), `height` (canvas height, `minFlowchartHeight`–`maxFlowchartHeight`). Marked `"webOnly"` in the spec: the retired native Swift app never drew it, so the shared golden document fixture leaves it out (`flowchart.test.ts` covers it). |

| mindmap | no | `data` (JSON `{ v: 1, layout?, nodes: [{ id, parent, text, color?, side?, collapsed? }] }`, ≤ `LIMITS.maxMindmapDataLength`; exactly one node with `parent: null` (the central idea), every other node's parent present, no loops, depth ≤ 32; children in array order; layout both/right/down; no positions (always laid out automatically); see `src/mindmap.ts`), `height` (`minMindmapHeight`–`maxMindmapHeight`). `webOnly`. |
| stickies | no | `data` (JSON `{ v: 1, notes: [{ id, x, y, w?, h?, text, color?, tags?, author? }], groups?: [{ id, label, x, y, w, h }] }`, ≤ `LIMITS.maxStickiesDataLength`; colours yellow/orange/pink/purple/blue/green/gray; a note belongs to the group its centre is in; `author` is a profile id; see `src/stickies.ts`), `height` (`minStickiesHeight`–`maxStickiesHeight`). `webOnly`. |
| chart | no | `data` (JSON `{ v: 1, kind, title?, takeaway?, columns: string[], rows: (string \| number \| null)[][] }`, ≤ `LIMITS.maxChartDataLength`; kinds bar/stackedBar/line/area/pie/donut/scatter/bubble/org/venn; the first column names each row, the others are series; every row as long as `columns`; see `src/chart.ts`), `height` (`minChartHeight`–`maxChartHeight`). `webOnly`. |
| wireframe | no | `data` (JSON `{ v: 1, style?, screens: [{ id, name, frame, x, y, w, h }], items: [{ id, screen, kind, x, y, w, h, text? }], links?: [{ id, from, to }] }`, ≤ `LIMITS.maxWireframeDataLength`; style clean/sketch, frames phone/tablet/browser/plain, `kind` one of `WIREFRAME_COMPONENTS`; an item's x/y is inside its screen; a link goes from a screen or item to a screen; see `src/wireframe.ts`), `height` (`minWireframeHeight`–`maxWireframeHeight`). `webOnly`. |

The data blocks share one pattern: a strict `*DataIssue` the server runs on every write, a forgiving
`parse*`/`normalize*` reader that never throws (clients, AI output, paste), and `serialize*` that writes the
compact form (`""` for an empty block). `repairWireBlock` runs refused mind maps, boards, charts and
wireframes through their reader (keeping what's usable) and brings their height into range; data over the
size limit is left alone.

Mermaid diagrams are `code` blocks with `language: "mermaid"`; editors render a live SVG preview.

Documents carry `DocumentStyle` (`font`, `width`, `background`, `accent`, `card`) and `DocumentCover`.
Tasks are `todo` blocks; the `tasks` table is only a projection.

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
