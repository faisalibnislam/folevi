"use client";

// Inspector → Insert: a searchable grid of picture tiles for everything that can go into a page (after
// Craft's Insert tool), grouped into sections. Every tile inserts below the current block on click (or
// Enter / Space), or where it's dropped when dragged into the page. Last: a table-size picker.
import type { Editor } from "@tiptap/react";
import { useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { FLOWCHART_DEFAULT_HEIGHT, WHITEBOARD_DEFAULT_HEIGHT } from "@folevi/editor-schema";
import { emptyTableRows, focusInsideBlock, insertBlockAfterCurrent, insertBlockAt } from "@/components/editor/commands";
import { requestSpecialInsert, type SpecialInsert } from "@/components/editor/EditorMenus";
import { beginPointerDrag } from "@/components/editor/blockDrag";
import { newFormulaAttrs } from "@/components/editor/FormulaView";
import { DIVIDER_STYLES, MERMAID_SAMPLE } from "@/components/editor/insertCatalog";
import { InsertPreview, type PreviewKind } from "./insertPreviews";

/** What an insert does: a plain block (optionally with text), or a special flow run by the editor. */
export interface InsertAction {
  label: string;
  type?: string;
  attrs?: () => Record<string, unknown>;
  text?: string;
  special?: SpecialInsert;
}

interface InsertItem extends InsertAction {
  preview: PreviewKind;
  keywords?: string;
}

const MAIN: InsertItem[] = [
  { label: "Text", type: "paragraph", preview: "text", keywords: "paragraph plain" },
  { label: "Page", special: "page", preview: "page", keywords: "nested subpage child link" },
  { label: "Card", special: "card", preview: "card", keywords: "page nested subpage child" },
  { label: "File attachment", special: "file", preview: "file", keywords: "file attachment upload pdf document" },
  { label: "Image", special: "image", preview: "image", keywords: "picture photo upload" },
  { label: "Audio recording", special: "record", preview: "audio", keywords: "audio record recording voice memo microphone mic sound" },
  { label: "Image from Unsplash", special: "unsplash", preview: "unsplash", keywords: "picture photo stock unsplash search" },
  { label: "Code block", type: "code", attrs: () => ({ language: "plaintext" }), preview: "code", keywords: "code snippet programming" },
  { label: "TeX formula", type: "formula", attrs: () => newFormulaAttrs(), preview: "formula", keywords: "formula math latex tex equation katex" },
  { label: "Mermaid diagram", type: "code", attrs: () => ({ language: "mermaid" }), text: MERMAID_SAMPLE, preview: "mermaid", keywords: "mermaid diagram flowchart chart graph" },
  { label: "Flowchart", type: "flowchart", attrs: () => ({ data: "", height: FLOWCHART_DEFAULT_HEIGHT }), preview: "flowchart", keywords: "flowchart diagram process flow chart shapes boxes arrows whimsical miro" },
  { label: "Whiteboard", type: "whiteboard", attrs: () => ({ data: "", height: WHITEBOARD_DEFAULT_HEIGHT }), preview: "whiteboard", keywords: "drawing sketch draw pen canvas" },
];

const COLLECTIONS: InsertItem[] = [
  { label: "Table", special: "collection", preview: "table", keywords: "collection database table rows" },
  { label: "Gallery", special: "gallery", preview: "gallery", keywords: "collection database cards grid" },
  { label: "Kanban", special: "board", preview: "kanban", keywords: "collection database board columns" },
];

const MORE: InsertItem[] = [
  { label: "Heading 1", type: "heading", attrs: () => ({ level: 1 }), preview: "h1", keywords: "title h1" },
  { label: "Heading 2", type: "heading", attrs: () => ({ level: 2 }), preview: "h2", keywords: "subtitle h2" },
  { label: "Heading 3", type: "heading", attrs: () => ({ level: 3 }), preview: "h3", keywords: "h3" },
  { label: "To-do", type: "todo", attrs: () => ({ checked: false }), preview: "todo", keywords: "todo task checkbox checklist" },
  { label: "Bulleted list", type: "bulleted", preview: "bulleted", keywords: "bullets unordered" },
  { label: "Numbered list", type: "numbered", preview: "numbered", keywords: "numbers ordered" },
  { label: "Toggle", type: "toggle", attrs: () => ({ collapsed: false }), preview: "toggle", keywords: "collapse disclosure details" },
  { label: "Quote", type: "quote", preview: "quote", keywords: "blockquote citation" },
  { label: "Callout", type: "callout", attrs: () => ({ tone: "note" }), preview: "callout", keywords: "note tip info warning" },
  { label: "Bookmark", special: "bookmark", preview: "bookmark", keywords: "web link url embed" },
  { label: "Date", special: "pickDate", preview: "date", keywords: "day calendar mention today" },
];

/** One tile: what it inserts, its picture, and the words search looks at. */
interface Tile {
  key: string;
  label: string;
  /** Accessible name when it should say more than the label (the divider styles). */
  name?: string;
  action: InsertAction;
  picture: React.ReactNode;
  keywords: string;
}

const ITEMS = new Map([...MAIN, ...MORE, ...COLLECTIONS].map((i) => [i.label, i]));

const tiles = (section: string, labels: string[]): Tile[] =>
  labels.map((label) => {
    const item = ITEMS.get(label);
    if (!item) throw new Error(`Insert: no item called ${label}`);
    return { key: `${section}:${label}`, label, action: item, picture: <InsertPreview kind={item.preview} />, keywords: `${label} ${item.keywords ?? ""}` };
  });

const SEPARATORS: Tile[] = [
  ...DIVIDER_STYLES.map(({ style, label }) => {
    const name = `Divider, ${label.toLowerCase()}`;
    return {
      key: `separators:${style}`,
      label,
      name,
      action: { label: name, type: "divider", attrs: () => ({ style }) },
      picture: (
        <span className="block w-full px-3">
          <span className="fb-line-preview" data-style={style} />
        </span>
      ),
      keywords: `${label} line divider separator rule`,
    };
  }),
  { key: "separators:pageBreak", label: "Page break", action: { label: "Page break", type: "pageBreak" }, picture: <InsertPreview kind="pageBreak" />, keywords: "page break print pdf separator" },
];

const SECTIONS: { title: string; tiles: Tile[] }[] = [
  { title: "Suggested", tiles: tiles("suggested", ["Text", "Page", "Card", "To-do", "Table", "Image"]) },
  {
    title: "Blocks",
    tiles: tiles("blocks", ["Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Toggle", "Quote", "Callout", "Code block", "TeX formula", "Mermaid diagram", "Flowchart", "Whiteboard", "Bookmark", "Date"]),
  },
  { title: "Media", tiles: tiles("media", ["Image", "Image from Unsplash", "File attachment", "Audio recording"]) },
  { title: "Collections", tiles: tiles("collections", ["Table", "Gallery", "Kanban"]) },
  { title: "Nested content", tiles: tiles("nested", ["Page", "Card"]) },
  { title: "Separators", tiles: SEPARATORS },
];

// Words starting with what's typed ("tab" finds Table, not "database"); a query with spaces matches as a phrase.
const matches = (q: string, text: string) => {
  if (!q) return true;
  const t = text.toLowerCase();
  return q.includes(" ") ? t.includes(q) : t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q));
};

/** Runs an insert below the current block. */
function runInsert(editor: Editor, a: InsertAction) {
  if (a.special) requestSpecialInsert(editor, a.special);
  else if (a.type) insertBlockAfterCurrent(editor, a.type, a.attrs?.() ?? {}, a.text);
}

/**
 * Pointer handlers shared by every insertable control: a press-and-move drags the item into the page
 * (reusing the block drag machinery), a plain click inserts it below the current block.
 */
function useInsertDrag(editor: Editor | null, disabled: boolean, action: InsertAction) {
  const dragged = useRef(false);
  return {
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onPointerDown: (e: React.PointerEvent) => {
      if (!editor || disabled || e.button !== 0) return;
      beginPointerDrag({
        editor,
        payload: { kind: "insert", label: action.label },
        event: e,
        onStart: () => (dragged.current = true),
        onDrop: (t) => {
          if (action.special) {
            // Make room where it was dropped, then let the editor run the insert there.
            const index = insertBlockAt(editor, t.index, t.depth, "paragraph");
            if (index < 0) return null;
            requestSpecialInsert(editor, action.special, String(editor.state.doc.child(index).attrs.id ?? "") || undefined);
            return { index, count: 1 };
          }
          const index = insertBlockAt(editor, t.index, t.depth, action.type!, action.attrs?.() ?? {}, action.text);
          return index < 0 ? null : { index, count: 1 };
        },
        onEnd: () => window.setTimeout(() => (dragged.current = false), 0),
      });
    },
    onClick: () => {
      if (dragged.current || !editor || disabled) return;
      runInsert(editor, action);
    },
  };
}

// The picture card: the same soft fill as the Format panel's buttons (bg-sunken/80, accent wash on hover), so the
// two tools read as one set on any note style, light or dark.
const PICTURE = "grid h-14 w-full place-items-center overflow-hidden rounded-[6px] bg-sunken/80 transition-[background-color,transform] duration-150";
const PICTURE_LIVE = "group-hover:bg-accent-soft/70 group-active:scale-[0.97]";

function TileButton({ tile, editor, disabled }: { tile: Tile; editor: Editor | null; disabled: boolean }) {
  const handlers = useInsertDrag(editor, disabled, tile.action);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={tile.name ?? tile.label}
      title={tile.label}
      {...handlers}
      className={`group flex min-w-0 touch-none select-none flex-col items-center gap-1.5 rounded-[10px] p-0.5 disabled:opacity-45 ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      <span className={`${PICTURE} ${disabled ? "" : PICTURE_LIVE}`} aria-hidden>
        {tile.picture}
      </span>
      <span className={`line-clamp-2 w-full break-words px-0.5 text-center text-[11.5px] font-medium leading-tight text-muted ${disabled ? "" : "group-hover:text-ink"}`}>
        {tile.label}
      </span>
    </button>
  );
}

const GRID_COLS = 8;
const GRID_ROWS = 5;

/** Hover (or arrow keys) highlights rows × columns from the top-left; click (or Enter) inserts that table. */
function TableSizePicker({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [cursor, setCursor] = useState({ r: 3, c: 3 });
  const [focused, setFocused] = useState(false);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const hintId = useId();
  const active = hover ?? (focused ? cursor : null);
  const insert = (r: number, c: number) => {
    if (!editor || disabled) return;
    focusInsideBlock(editor, insertBlockAfterCurrent(editor, "table", { headerRow: true, rows: emptyTableRows(r, c) }));
  };
  const move = (r: number, c: number) => {
    const next = { r: Math.max(1, Math.min(GRID_ROWS, r)), c: Math.max(1, Math.min(GRID_COLS, c)) };
    setCursor(next);
    cells.current[(next.r - 1) * GRID_COLS + (next.c - 1)]?.focus();
  };
  return (
    <div>
      <p id={hintId} className="mb-2 px-1 text-[12px] leading-snug text-muted">
        Pick a size, then click to add the table.
      </p>
      <div
        role="group"
        aria-label="Table size"
        aria-describedby={hintId}
        className="grid grid-cols-8 gap-1 rounded-[10px] bg-[color-mix(in_oklab,var(--color-ink)_4%,var(--color-surface-raised))] p-2.5 shadow-[0_0_0_1px_var(--color-line)]"
        onPointerLeave={() => setHover(null)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {Array.from({ length: GRID_ROWS }, (_, ri) =>
          Array.from({ length: GRID_COLS }, (_, ci) => {
            const r = ri + 1;
            const c = ci + 1;
            const lit = active ? r <= active.r && c <= active.c : false;
            const isCursor = cursor.r === r && cursor.c === c;
            return (
              <button
                key={`${r}-${c}`}
                ref={(el) => {
                  cells.current[ri * GRID_COLS + ci] = el;
                }}
                type="button"
                disabled={disabled}
                tabIndex={isCursor ? 0 : -1}
                aria-label={`${r} × ${c} table (${r} row${r === 1 ? "" : "s"}, ${c} column${c === 1 ? "" : "s"})`}
                data-lit={lit ? "true" : "false"}
                className="fb-table-cell"
                onMouseDown={(e) => e.preventDefault()}
                onPointerEnter={() => setHover({ r, c })}
                onFocus={() => setCursor({ r, c })}
                onClick={() => insert(r, c)}
                onKeyDown={(e) => {
                  const k = e.key;
                  if (k === "ArrowRight") move(r, c + 1);
                  else if (k === "ArrowLeft") move(r, c - 1);
                  else if (k === "ArrowDown") move(r + 1, c);
                  else if (k === "ArrowUp") move(r - 1, c);
                  else if (k === "Home") move(r, 1);
                  else if (k === "End") move(r, GRID_COLS);
                  else return;
                  e.preventDefault();
                }}
              />
            );
          }),
        )}
      </div>
      <p className="mt-1.5 px-1 text-center text-[11.5px] font-medium tabular-nums text-muted" aria-live="polite">
        {active ? `${active.r} × ${active.c}` : " "}
      </p>
    </div>
  );
}

/** A titled group of tiles (or the table picker); search hides it when nothing in it matches. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="mt-5">
      <h3 className="ui-caps mb-2 px-1">{title}</h3>
      {children}
    </div>
  );
}

export function InsertPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const d = disabled || !editor;
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const sections = SECTIONS.map((s) => ({ ...s, tiles: s.tiles.filter((t) => matches(query, t.keywords)) })).filter((s) => s.tiles.length);
  const showTable = matches(query, "table grid rows columns size");
  return (
    <div>
      <p className="mb-2 px-1 text-[12.5px] text-muted">Drag and drop any item to the document</p>
      <label className="ui-well flex h-9 items-center gap-2 rounded-[6px] px-3 text-[13px] text-muted focus-within:shadow-[0_0_0_2px_var(--color-focus)]">
        <Search size={14} aria-hidden />
        <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search blocks" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-[var(--color-ink-faint)]" />
      </label>
      {sections.map((s) => (
        <Section key={s.title} title={s.title}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-x-2 gap-y-3">
            {s.tiles.map((t) => (
              <TileButton key={t.key} tile={t} editor={editor} disabled={d} />
            ))}
          </div>
        </Section>
      ))}
      {showTable ? (
        <Section title="Quick table">
          <TableSizePicker editor={editor} disabled={d} />
        </Section>
      ) : null}
      {!sections.length && !showTable ? (
        <div className="mt-8 px-2 text-center">
          <p className="text-[13px] font-medium text-ink">No matches</p>
          <p className="mt-1 text-[12px] text-muted">Nothing called “{q.trim()}”. Try another word.</p>
        </div>
      ) : null}
    </div>
  );
}
