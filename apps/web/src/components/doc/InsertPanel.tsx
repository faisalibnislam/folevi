"use client";

// Inspector → Insert: a searchable list of everything that can go into a page (after Craft's Insert
// tab). Every row inserts below the current block on click, or where it's dropped when dragged into
// the page. Below the list: divider styles, a page break and a table-size picker.
import type { Editor } from "@tiptap/react";
import { useId, useRef, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Code2,
  Columns3,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Network,
  Link as LinkIcon,
  List,
  ListOrdered,
  Paperclip,
  PenTool,
  Quote,
  Search,
  Sigma,
  SquareStack,
  StickyNote,
  Table2,
  Text,
  Workflow,
} from "lucide-react";
import { FLOWCHART_DEFAULT_HEIGHT, WHITEBOARD_DEFAULT_HEIGHT } from "@folevi/editor-schema";
import { emptyTableRows, insertBlockAfterCurrent, insertBlockAt } from "@/components/editor/commands";
import { requestSpecialInsert, type SpecialInsert } from "@/components/editor/EditorMenus";
import { beginPointerDrag } from "@/components/editor/blockDrag";
import { newFormulaAttrs } from "@/components/editor/FormulaView";
import { DIVIDER_STYLES, MERMAID_SAMPLE } from "@/components/editor/insertCatalog";

/** What an insert does: a plain block (optionally with text), or a special flow run by the editor. */
export interface InsertAction {
  label: string;
  type?: string;
  attrs?: () => Record<string, unknown>;
  text?: string;
  special?: SpecialInsert;
}

interface InsertItem extends InsertAction {
  icon: React.ReactNode;
  keywords?: string;
}

const i16 = { size: 16, "aria-hidden": true } as const;

const MAIN: InsertItem[] = [
  { label: "Text", type: "paragraph", icon: <Text {...i16} />, keywords: "paragraph plain" },
  { label: "Page", special: "page", icon: <FileText {...i16} />, keywords: "nested subpage child link" },
  { label: "Card", special: "card", icon: <SquareStack {...i16} />, keywords: "page nested subpage child" },
  { label: "File Attachment", special: "file", icon: <Paperclip {...i16} />, keywords: "file attachment upload pdf document" },
  { label: "Image", special: "image", icon: <ImageIcon {...i16} />, keywords: "picture photo upload" },
  { label: "Image from Unsplash", special: "unsplash", icon: <ImagePlus {...i16} />, keywords: "picture photo stock unsplash search" },
  { label: "Code Block", type: "code", attrs: () => ({ language: "plaintext" }), icon: <Code2 {...i16} />, keywords: "code snippet programming" },
  { label: "TeX Formula", type: "formula", attrs: () => newFormulaAttrs(), icon: <Sigma {...i16} />, keywords: "formula math latex tex equation katex" },
  { label: "Mermaid Diagram", type: "code", attrs: () => ({ language: "mermaid" }), text: MERMAID_SAMPLE, icon: <Workflow {...i16} />, keywords: "mermaid diagram flowchart chart graph" },
  { label: "Flowchart", type: "flowchart", attrs: () => ({ data: "", height: FLOWCHART_DEFAULT_HEIGHT }), icon: <Network {...i16} />, keywords: "flowchart diagram process flow chart shapes boxes arrows whimsical miro" },
  { label: "Whiteboard", type: "whiteboard", attrs: () => ({ data: "", height: WHITEBOARD_DEFAULT_HEIGHT }), icon: <PenTool {...i16} />, keywords: "drawing sketch draw pen canvas" },
];

const COLLECTIONS: InsertItem[] = [
  { label: "Table", special: "collection", icon: <Table2 {...i16} />, keywords: "collection database table rows" },
  { label: "Gallery", special: "gallery", icon: <LayoutGrid {...i16} />, keywords: "collection database cards grid" },
  { label: "Kanban", special: "board", icon: <Columns3 {...i16} />, keywords: "collection database board columns" },
];

const MORE: InsertItem[] = [
  { label: "Heading 1", type: "heading", attrs: () => ({ level: 1 }), icon: <Heading1 {...i16} />, keywords: "title h1" },
  { label: "Heading 2", type: "heading", attrs: () => ({ level: 2 }), icon: <Heading2 {...i16} />, keywords: "subtitle h2" },
  { label: "Heading 3", type: "heading", attrs: () => ({ level: 3 }), icon: <Heading3 {...i16} />, keywords: "h3" },
  { label: "To-do", type: "todo", attrs: () => ({ checked: false }), icon: <CheckSquare {...i16} />, keywords: "task checkbox checklist" },
  { label: "Bulleted List", type: "bulleted", icon: <List {...i16} />, keywords: "bullets unordered" },
  { label: "Numbered List", type: "numbered", icon: <ListOrdered {...i16} />, keywords: "numbers ordered" },
  { label: "Toggle", type: "toggle", attrs: () => ({ collapsed: false }), icon: <ChevronRight {...i16} />, keywords: "collapse disclosure details" },
  { label: "Quote", type: "quote", icon: <Quote {...i16} />, keywords: "blockquote citation" },
  { label: "Callout", type: "callout", attrs: () => ({ tone: "note" }), icon: <StickyNote {...i16} />, keywords: "note tip info warning" },
  { label: "Bookmark", special: "bookmark", icon: <LinkIcon {...i16} />, keywords: "web link url embed" },
  { label: "Date", special: "pickDate", icon: <CalendarDays {...i16} />, keywords: "day calendar mention today" },
];

const matches = (q: string, text: string) => !q || text.toLowerCase().includes(q);

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
            requestSpecialInsert(editor, action.special);
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

function InsertRow({ item, editor, disabled }: { item: InsertItem; editor: Editor | null; disabled: boolean }) {
  const handlers = useInsertDrag(editor, disabled, item);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={item.label}
      title={`${item.label} — click to insert below the current block, or drag into the page`}
      {...handlers}
      className="fb-insert-row group ui-raised"
    >
      <span className="fb-insert-row-icon" aria-hidden>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
      <GripVertical size={14} aria-hidden className="fb-insert-grip" />
    </button>
  );
}

function DividerTile({ style, label, editor, disabled }: { style: string; label: string; editor: Editor | null; disabled: boolean }) {
  const handlers = useInsertDrag(editor, disabled, { label: `Divider, ${label.toLowerCase()}`, type: "divider", attrs: () => ({ style }) });
  return (
    <button type="button" disabled={disabled} aria-label={`Divider, ${label.toLowerCase()}`} title={`${label} line`} {...handlers} className="fb-insert-tile ui-raised">
      <span className="fb-line-preview" data-style={style} aria-hidden />
    </button>
  );
}

function PageBreakTile({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const handlers = useInsertDrag(editor, disabled, { label: "Page break", type: "pageBreak" });
  return (
    <button type="button" disabled={disabled} aria-label="Page break" title="Page break — starts a new page when printed" {...handlers} className="fb-insert-tile fb-insert-tile-wide ui-raised">
      <span className="fb-pagebreak-preview" aria-hidden>
        <span />
        <span />
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
    insertBlockAfterCurrent(editor, "table", { headerRow: true, rows: emptyTableRows(r, c) });
  };
  const move = (r: number, c: number) => {
    const next = { r: Math.max(1, Math.min(GRID_ROWS, r)), c: Math.max(1, Math.min(GRID_COLS, c)) };
    setCursor(next);
    cells.current[(next.r - 1) * GRID_COLS + (next.c - 1)]?.focus();
  };
  return (
    <div>
      <p id={hintId} className="px-1 text-[12.5px] leading-snug text-muted">
        Insert a table with the highlighted number of rows and columns.
      </p>
      <div
        role="group"
        aria-label="Table size"
        aria-describedby={hintId}
        className="fb-table-picker ui-raised"
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
      <p className="mt-1.5 px-1 text-center text-[12.5px] font-medium tabular-nums text-muted" aria-live="polite">
        {active ? `${active.r} × ${active.c}` : " "}
      </p>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="mt-5 first:mt-3" aria-labelledby={title ? id : undefined}>
      {title ? (
        <h3 id={id} className="mb-2 px-1 text-[13.5px] font-semibold text-heading">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

export function InsertPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const d = disabled || !editor;
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filter = (items: InsertItem[]) => items.filter((i) => matches(query, `${i.label} ${i.keywords ?? ""}`));
  const main = filter(MAIN);
  const collections = filter(COLLECTIONS);
  const more = filter(MORE);
  const showLines = matches(query, "insert line divider separator rule extra light regular strong");
  const showBreak = matches(query, "insert page break print pdf");
  const showTable = matches(query, "insert table grid rows columns");
  const nothing = !main.length && !collections.length && !more.length && !showLines && !showBreak && !showTable;
  const list = (items: InsertItem[]) => (
    <ul className="grid gap-1.5">
      {items.map((item) => (
        <li key={item.label}>
          <InsertRow item={item} editor={editor} disabled={d} />
        </li>
      ))}
    </ul>
  );
  return (
    <div>
      <p className="mb-2 px-1 text-[12.5px] text-muted">Drag and drop any item to the document</p>
      <label className="ui-well flex h-9 items-center gap-2 rounded-[6px] px-3 text-[13px] text-muted focus-within:shadow-[0_0_0_2px_var(--color-focus)]">
        <Search size={14} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search blocks" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-[var(--color-ink-faint)]" />
      </label>
      {main.length ? <Section>{list(main)}</Section> : null}
      {collections.length ? <Section title="Collections">{list(collections)}</Section> : null}
      {showLines ? (
        <Section title="Insert Line">
          <div className="grid grid-cols-2 gap-1.5">
            {DIVIDER_STYLES.map((s) => (
              <DividerTile key={s.style} style={s.style} label={s.label} editor={editor} disabled={d} />
            ))}
          </div>
        </Section>
      ) : null}
      {showBreak ? (
        <Section title="Insert Page Break">
          <PageBreakTile editor={editor} disabled={d} />
        </Section>
      ) : null}
      {showTable ? (
        <Section title="Insert Table">
          <TableSizePicker editor={editor} disabled={d} />
        </Section>
      ) : null}
      {more.length ? <Section title="Text & Blocks">{list(more)}</Section> : null}
      {nothing ? <p className="mt-6 text-center text-sm text-muted">No blocks match “{q}”.</p> : null}
    </div>
  );
}
