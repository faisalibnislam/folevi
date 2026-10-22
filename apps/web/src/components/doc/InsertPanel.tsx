"use client";

// Inspector → Insert: a searchable grid of picture tiles for everything that can go into a page (after
// Craft's Insert tool), grouped into sections: Suggested, Text, Lists and tasks, Visuals, Media, Data and
// more (the slash menu has the same groups). Every tile inserts below the current block on click (or Enter /
// Space), or where it's dropped when dragged into the page. Data and more ends with a table-size picker.
import type { Editor } from "@tiptap/react";
import { useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CHART_DEFAULT_HEIGHT, FLOWCHART_DEFAULT_HEIGHT, MINDMAP_DEFAULT_HEIGHT, STICKIES_DEFAULT_HEIGHT, WHITEBOARD_DEFAULT_HEIGHT, WIREFRAME_DEFAULT_HEIGHT } from "@folevi/editor-schema";
import { emptyTableRows, focusInsideBlock, insertBlockAfterCurrent, insertBlockAt } from "@/components/editor/commands";
import { requestSpecialInsert, type SpecialInsert } from "@/components/editor/EditorMenus";
import { beginPointerDrag } from "@/components/editor/blockDrag";
import { newFormulaAttrs } from "@/components/editor/FormulaView";
import { DIVIDER_STYLES, MERMAID_SAMPLE } from "@/components/editor/insertCatalog";
import { requestSyncedInsert } from "@/components/editor/synced/actions";
import { nativeApp } from "@/lib/nativeApp";
import { useNativeDevice } from "@/lib/nativeDevice";
import { useIphoneApp } from "@/lib/iphone";
import { InsertPreview, type PreviewKind } from "./insertPreviews";
import { useCapabilities } from "@/lib/mode";

/** What an insert does: a plain block (optionally with text), or a special flow run by the editor. */
export interface InsertAction {
  label: string;
  type?: string;
  attrs?: () => Record<string, unknown>;
  text?: string;
  special?: SpecialInsert;
  /** An insert the editor runs itself (a synced block: synced/actions.ts). */
  run?: (editor: Editor) => void;
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
  { label: "Mind map", type: "mindmap", attrs: () => ({ data: "", height: MINDMAP_DEFAULT_HEIGHT }), preview: "mindmap", keywords: "mindmap ideas brainstorm branches tree outline whimsical miro" },
  { label: "Chart", type: "chart", attrs: () => ({ data: "", height: CHART_DEFAULT_HEIGHT }), preview: "chart", keywords: "graph bar line pie donut area scatter bubble org venn data numbers" },
  { label: "Sticky notes", type: "stickies", attrs: () => ({ data: "", height: STICKIES_DEFAULT_HEIGHT }), preview: "stickies", keywords: "stickies post-it board brainstorm workshop retro votes" },
  { label: "Wireframe", type: "wireframe", attrs: () => ({ data: "", height: WIREFRAME_DEFAULT_HEIGHT }), preview: "wireframe", keywords: "mockup screen ui ux layout prototype app website sketch" },
  { label: "Synced block", run: requestSyncedInsert, preview: "synced", keywords: "synced sync shared reuse mirror same content several notes everywhere" },
];

// Only in the iOS app (lib/nativeDevice.ts): the camera's scanner where the device has one, and pages from photos.
const SCAN: InsertItem[] = [
  { label: "Scan document", special: "scan", preview: "scan", keywords: "scanner camera paper receipt ocr text" },
  { label: "Scan from photos", special: "scanPhotos", preview: "scan", keywords: "scanner photos paper receipt ocr text" },
];

// Rows of columns: 2, 3 or 4 side by side (editor/columns/), each starting with an empty line.
const COLUMNS: InsertItem[] = [
  { label: "2 columns", special: "columns2", preview: "columns2", keywords: "columns side by side layout two split" },
  { label: "3 columns", special: "columns3", preview: "columns3", keywords: "columns side by side layout three split" },
  { label: "4 columns", special: "columns4", preview: "columns4", keywords: "columns side by side layout four split" },
];

const COLLECTIONS: InsertItem[] = [
  { label: "Table", special: "collection", preview: "table", keywords: "collection database table rows" },
  { label: "Gallery", special: "gallery", preview: "gallery", keywords: "collection database cards grid" },
  { label: "Kanban", special: "board", preview: "kanban", keywords: "collection database board columns" },
  { label: "Calendar", special: "calendarView", preview: "monthGrid", keywords: "collection database calendar month dates" },
];

const MORE: InsertItem[] = [
  { label: "Heading 1", type: "heading", attrs: () => ({ level: 1 }), preview: "h1", keywords: "title h1" },
  { label: "Heading 2", type: "heading", attrs: () => ({ level: 2 }), preview: "h2", keywords: "subtitle h2" },
  { label: "Heading 3", type: "heading", attrs: () => ({ level: 3 }), preview: "h3", keywords: "h3" },
  { label: "To-do", type: "todo", attrs: () => ({ checked: false }), preview: "todo", keywords: "todo task checkbox checklist" },
  { label: "Bulleted list", type: "bulleted", preview: "bulleted", keywords: "bullets unordered" },
  { label: "Numbered list", type: "numbered", preview: "numbered", keywords: "numbers ordered" },
  { label: "Toggle", type: "toggle", attrs: () => ({ collapsed: false }), preview: "toggle", keywords: "collapse disclosure details" },
  { label: "Tabs", special: "tabs", preview: "tabs", keywords: "tabs tabbed sections panes switch" },
  { label: "Quote", type: "quote", preview: "quote", keywords: "blockquote citation" },
  { label: "Callout", type: "callout", attrs: () => ({ tone: "note" }), preview: "callout", keywords: "note tip info warning" },
  { label: "Bookmark", special: "bookmark", preview: "bookmark", keywords: "web link url" },
  { label: "Embed", special: "embed", preview: "embed", keywords: "video youtube vimeo loom figma map google maps iframe" },
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

const ITEMS = new Map([...MAIN, ...MORE, ...COLLECTIONS, ...SCAN, ...COLUMNS].map((i) => [i.label, i]));

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

// The same groups as the slash menu (EditorMenus). Data and more ends with the table-size picker. Its Table is
// a collection (as in Suggested), with the collection's other views after it; the picker adds a plain table.
const DATA = "Data and more";
const SECTIONS: { title: string; tiles: Tile[] }[] = [
  { title: "Suggested", tiles: tiles("suggested", ["Text", "Page", "Card", "To-do", "Table", "Image"]) },
  { title: "Text", tiles: tiles("text", ["Heading 1", "Heading 2", "Heading 3", "Quote", "Callout"]) },
  { title: "Lists and tasks", tiles: tiles("lists", ["Bulleted list", "Numbered list", "To-do", "Toggle", "Tabs"]) },
  { title: "Layout", tiles: tiles("layout", ["2 columns", "3 columns", "4 columns"]) },
  { title: "Visuals", tiles: tiles("visuals", ["Flowchart", "Mind map", "Chart", "Sticky notes", "Wireframe", "Whiteboard", "Mermaid diagram"]) },
  { title: "Media", tiles: tiles("media", ["Image", "Image from Unsplash", "File attachment", "Audio recording", "Bookmark", "Embed"]) },
  { title: DATA, tiles: [...tiles("data", ["Table", "Gallery", "Kanban", "Calendar", "Page", "Card", "Synced block", "Date", "Code block", "TeX formula"]), ...SEPARATORS] },
];

// Words starting with what's typed ("tab" finds Table, not "database"); a query with spaces matches as a phrase.
const matches = (q: string, text: string) => {
  if (!q) return true;
  const t = text.toLowerCase();
  return q.includes(" ") ? t.includes(q) : t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q));
};

/** Runs an insert below the current block. */
function runInsert(editor: Editor, a: InsertAction) {
  if (a.run) a.run(editor);
  else if (a.special) requestSpecialInsert(editor, a.special);
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
          if (action.run) {
            // An empty line where it was dropped, with the caret in it: the insert takes its place.
            const index = insertBlockAt(editor, t.index, t.depth, "paragraph");
            if (index < 0) return null;
            let pos = 1;
            for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
            editor.chain().focus().setTextSelection(pos).run();
            action.run(editor);
            return { index, count: 1 };
          }
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
// two tools read as one set on any note theme, light or dark.
const PICTURE = "grid h-14 w-full place-items-center overflow-hidden rounded-chip bg-sunken/80 transition-[background-color,transform] duration-150";
const PICTURE_LIVE = "group-hover:bg-accent-soft/70 group-active:scale-[0.97]";

// The iPhone layout: each picture in its block's own colour family (lines and its one detail), so the grid
// reads at a glance; the tiles are touch-sized and nothing drags out of a sheet there.
const TILE_HUE: Partial<Record<PreviewKind, string>> = {
  todo: "moss", table: "moss", gallery: "moss", kanban: "moss", monthGrid: "moss",
  image: "ember", unsplash: "ember", scan: "ember", audio: "ember", file: "ember",
  flowchart: "plum", mindmap: "plum", whiteboard: "plum", wireframe: "plum", mermaid: "plum",
  chart: "marigold", stickies: "marigold", callout: "marigold", date: "marigold",
  bookmark: "coral", embed: "coral",
};

function PhoneTile({ tile, editor, disabled }: { tile: Tile; editor: Editor | null; disabled: boolean }) {
  const hue = TILE_HUE[(tile.action as InsertItem).preview];
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={tile.name ?? tile.label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!editor || disabled) return;
        runInsert(editor, tile.action);
      }}
      className="group flex min-w-0 select-none flex-col items-center gap-1 rounded-chip outline-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span
        aria-hidden
        className="iphone-insert-art grid h-14 w-full place-items-center overflow-hidden rounded-panel transition-transform duration-150 group-active:scale-[0.96]"
        style={hue ? ({ color: `var(--color-${hue})`, ["--color-accent" as string]: `var(--color-${hue})` } as React.CSSProperties) : undefined}
      >
        {tile.picture}
      </span>
      <span className="line-clamp-2 w-full break-words px-0.5 text-center text-[13px] leading-4 text-ink">{tile.label}</span>
    </button>
  );
}

function TileButton({ tile, editor, disabled }: { tile: Tile; editor: Editor | null; disabled: boolean }) {
  const handlers = useInsertDrag(editor, disabled, tile.action);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={tile.name ?? tile.label}
      title={tile.label}
      {...handlers}
      className={`group flex min-w-0 touch-none select-none flex-col items-center gap-1.5 rounded-control p-0.5 disabled:opacity-45 ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
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
        className="grid grid-cols-8 gap-1 rounded-control bg-[color-mix(in_oklab,var(--color-ink)_4%,var(--color-surface-raised))] p-2.5 shadow-[0_0_0_1px_var(--color-line)]"
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
function Section({ title, children, phone }: { title: string; children: React.ReactNode; phone?: boolean }) {
  return (
    <div role="group" aria-label={title} className={phone ? "mt-6" : "mt-5"}>
      <h3 className={phone ? "ui-caption-caps mb-2.5 px-1" : "ui-caps mb-2 px-1"}>{title}</h3>
      {children}
    </div>
  );
}

export function InsertPanel({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const d = disabled || !editor;
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const device = useNativeDevice();
  const scans = device && nativeApp()?.scanDocument ? tiles("media", device.scanner ? ["Scan document", "Scan from photos"] : ["Scan from photos"]) : [];
  const showTable = matches(query, "table grid rows columns size");
  // Unsplash is searched through Folevi's servers: not in local mode.
  const stockPhotos = useCapabilities().stockPhotos;
  // Search runs across every group; a group with nothing that matches goes.
  const phone = useIphoneApp();
  const sections = SECTIONS.map((s) => ({ ...s, tiles: [...s.tiles, ...(s.title === "Media" ? scans : [])].filter((t) => matches(query, t.keywords) && (stockPhotos || t.action.special !== "unsplash")) })).filter((s) => s.tiles.length || (s.title === DATA && showTable));
  return (
    <div>
      {phone ? (
        // Under the sheet's title, staying there while the tiles scroll (it isn't focused on open: that would
        // bring the keyboard up over the tiles).
        <div className="iphone-insert-search sticky top-0 z-10 -mx-4 px-4 pb-2 pt-0.5">
          <label className="flex h-10 items-center gap-2 rounded-control bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] px-3 text-[17px] text-muted">
            <Search size={17} strokeWidth={2.2} aria-hidden />
            <input type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search blocks" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-[var(--color-ink-faint)] [&::-webkit-search-cancel-button]:hidden" />
          </label>
        </div>
      ) : (
        <>
          <p className="mb-2 px-1 text-[12.5px] text-muted">Drag and drop any item to the document</p>
          <label className="ui-well flex h-9 items-center gap-2 rounded-chip px-3 text-[13px] text-muted focus-within:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_22%,transparent)]">
            <Search size={14} aria-hidden />
            <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search blocks" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-[var(--color-ink-faint)]" />
          </label>
        </>
      )}
      {sections.map((s) => (
        <Section key={s.title} title={s.title} phone={phone}>
          {s.tiles.length ? (
            phone ? (
              <div className="grid grid-cols-4 gap-x-2 gap-y-3.5">
                {s.tiles.map((t) => (
                  <PhoneTile key={t.key} tile={t} editor={editor} disabled={d} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-x-2 gap-y-3">
                {s.tiles.map((t) => (
                  <TileButton key={t.key} tile={t} editor={editor} disabled={d} />
                ))}
              </div>
            )
          ) : null}
          {s.title === DATA && showTable ? (
            <div role="group" aria-label="Quick table" className={s.tiles.length ? "mt-4" : ""}>
              <h4 className="mb-1.5 px-1 text-[12px] font-medium text-ink">Quick table</h4>
              <TableSizePicker editor={editor} disabled={d} />
            </div>
          ) : null}
        </Section>
      ))}
      {!sections.length && !showTable ? (
        <div className="mt-8 px-2 text-center">
          <p className="text-[13px] font-medium text-ink">No matches</p>
          <p className="mt-1 text-[12px] text-muted">Nothing called “{q.trim()}”. Try another word.</p>
        </div>
      ) : null}
    </div>
  );
}
