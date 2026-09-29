# Canonical editor schema

The single source of truth is `packages/editor-schema/spec/folevi-blocks.v1.json`. From it,
`pnpm schema:gen` generates:

- `packages/editor-schema/src/generated/schema.ts` — TypeScript types, enum value lists, limits, the spec
  used by the runtime validator
- `apps/macos/Folevi/Domain/Generated/BlockSchema.swift` — Swift `Codable` types, including a
  `BlockContent` enum with an `.unknown(type:props:)` case
- `packages/editor-schema/generated/folevi-blocks.schema.json` — JSON Schema for documentation/tools

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

Inline content is a flat array of runs and atoms — `text` (with marks bold, italic, underline, strike,
code, link, color, highlight), `mention`, `date`, `pageLink`.

## Block types (v1)

| Type | Text | Props |
| --- | --- | --- |
| paragraph, bulleted, numbered, quote | yes | — |
| heading | yes | `level` 1–3 |
| todo | yes | `checked`, `canceled?`, `dueDate?`, `dueTime?`, `priority?`, `assigneeId?`, `reminderAt?`, `completedAt?` |
| toggle | yes | `collapsed` |
| callout | yes | `tone` (note/info/success/warning/danger), `icon?` |
| divider | no | `style?` (extralight/light/regular/strong; unset follows the page's separator style) |
| pageBreak | no | — (a sheet break in the editor; `break-after: page` in print/PDF) |
| code | no | `language`, `code` |
| image | no | `fileId?` or `url?`, `alt`, `caption`, `width?`, `naturalWidth?`, `naturalHeight?` |
| file | no | `fileId`, `name`, `size`, `mimeType` |
| table | no | `rows: InlineNode[][][]`, `headerRow` |
| page | no | `documentId`, `display` (link/card), `titleCache?`, `iconCache?` |
| bookmark | no | `url`, `title?`, `description?`, `siteName?` |
| collection | no | `collectionId`, `viewId?` |
| formula | no | `latex` (≤ `LIMITS.maxFormulaLength`; rendered with KaTeX, `trust: false`) |
| whiteboard | no | `data` (JSON `{ v: 1, strokes: [{ points: [[x, y]…] \| d, color, width, opacity? }] }`, ≤ `LIMITS.maxWhiteboardDataLength`; x in 0–1000, y in 0–`height`), `height` (logical units, `minWhiteboardHeight`–`maxWhiteboardHeight`) |
| flowchart | no | `data` (JSON `{ v: 1, nodes: [{ id, shape, x, y, w, h, text?, color? }], edges: [{ id, from, to, fromSide?, toSide?, label?, style?, arrow? }] }`, ≤ `LIMITS.maxFlowchartDataLength`; shapes process/decision/terminator/io/circle/note/text, colours neutral/accent/blue/green/yellow/pink/purple, sides top/right/bottom/left, style solid/dashed, arrow end/both/none; see `src/flowchart.ts`), `height` (canvas height, `minFlowchartHeight`–`maxFlowchartHeight`). **Web only** (`"webOnly"` in the spec): left out of the Swift types, so native clients keep it verbatim as an unknown block. |

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
2. Add `migrations[N]` in `src/migrations.ts`, and the equivalent Swift migration.
3. `pnpm schema:gen`, add fixtures for the new shapes, run both test suites.

## Golden fixtures (shared by TypeScript and Swift)

- `fixtures/document-golden.json` — every v1 block type plus an unknown `timeline` (schema v2) block;
  both clients must round-trip it to identical canonical (sorted-key) JSON.
- `fixtures/ranks.json` — `rankBetween` cases and an evenly spread sequence.
- `fixtures/sync-scenarios.json` — the nine offline/sync scenarios from `SYNC_PROTOCOL.md`, with the
  expected final canonical reducer state.

## Ranks

`rankBetween(a, b)` returns a base-62 string strictly between two ranks (never ending in `0`), with
`rankSequence(n)` for evenly spaced bulk inserts. The server rebalances a sibling list when ranks grow
past `LIMITS.maxRankLength` (`blocks.rebalance`).

## Editor mappings

- Web (Tiptap): one ProseMirror node per block type with `id` and `depth` attributes; the code block node
  is named `codeBlock` inside the editor (the inline mark is `code`). See `apps/web/src/components/editor/convert.ts`.
- Mac: SwiftUI rows with an `NSTextView` per text block; see `docs/MACOS.md`.

## Import / export

Markdown import (`markdownToBlocks`) keeps headings, lists (nested), checklists (with `(due YYYY-MM-DD HH:mm)`),
links, code fences (language normalized), quotes, GitHub-style callouts, tables, images (absolute URLs or
uploaded files), display math (`$$…$$` → formula), page breaks (`<div style="page-break-after: always"></div>`),
front matter; HTML blocks, footnotes, reference links and unresolved images are kept as
text and reported as warnings. Markdown/HTML export (`blocksToMarkdown`, `blocksToHtml`) is used for page
exports, workspace ZIPs and version previews. Formulas export as `$$…$$` (HTML: MathML from KaTeX when
the caller passes `renderMath`, otherwise the LaTeX source), whiteboards as an inline SVG (Markdown: an SVG
data-URL image), flowcharts as an inline SVG (Markdown: a ` ```mermaid ` flowchart, so they stay portable) and page breaks as a `page-break-after` div.
