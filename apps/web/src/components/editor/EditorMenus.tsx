"use client";

import type { Editor } from "@tiptap/react";
import { beginPointerDrag, isDragging } from "./blockDrag";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Code2,
  Copy,
  Eraser,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  Link2,
  List,
  ListOrdered,
  MessageSquare,
  Minus,
  MoveDown,
  MoveUp,
  Paperclip,
  Plus,
  Quote,
  Strikethrough,
  Table2,
  Text,
  Trash2,
  Underline,
  StickyNote,
  LayoutList,
  Palette,
} from "lucide-react";
import { addDays, sanitizeHref, ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import type { SyncEngine } from "@/lib/sync/engine";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { deleteBlocks, duplicateBlocks, insertBlockAfterCurrent, moveBlock, turnInto } from "./commands";
import type { TriggerState } from "./plugins";

interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

function Popover({ anchor, children, label, width = 300 }: { anchor: { left: number; top: number; bottom: number } | null; children: React.ReactNode; label: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const h = ref.current.offsetHeight;
    const below = anchor.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : below;
    setPos({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), top });
  }, [anchor, width, children]);
  if (!anchor) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 6, width, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-50 max-h-[min(420px,70vh)] overflow-y-auto ui-pop p-1.5 animate-[folio-rise_120ms_var(--ease-folio)]"
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function ListMenu({ items, active, setActive, onRun, emptyLabel, listId }: { items: MenuItem[]; active: number; setActive: (i: number) => void; onRun: (i: MenuItem) => void; emptyLabel: string; listId: string }) {
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);
  if (!items.length) return <p className="px-3 py-2 text-sm text-muted">{emptyLabel}</p>;
  return (
    <ul role="listbox" id={listId} aria-label="Suggestions">
      {items.map((item, i) => (
        <li
          key={item.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          onClick={() => onRun(item)}
          className={`flex cursor-pointer items-center gap-2.5 rounded-[14px] px-2 py-1.5 text-sm transition-colors ${i === active ? "bg-accent-soft text-heading" : ""}`}
        >
          <span className="grid h-7 w-7 flex-none place-items-center rounded-[9px] bg-surface text-heading shadow-[var(--shadow-control)]" aria-hidden>
            {item.icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint ? <span className="text-xs text-faint">{item.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function EditorMenus({
  editor,
  documentId,
  engine,
  trigger,
  editable,
  onInsertFiles,
  onDropBlock,
  onCommentBlock,
}: {
  editor: Editor;
  documentId: string;
  engine: SyncEngine;
  trigger: TriggerState | null;
  editable: boolean;
  onInsertFiles: (files: File[]) => Promise<void>;
  onDropBlock: (from: number, to: number, depth: number) => { index: number; count: number } | null;
  onCommentBlock?: (blockId: string) => void;
}) {
  const { workspace, today } = useAppState();
  const { navigate } = useAppRouter();
  const toast = useToast();
  const createCollection = useMutation(api.collections.create);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = useId();
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [bookmarkPrompt, setBookmarkPrompt] = useState(false);

  const triggerKey = trigger ? `${trigger.kind}:${trigger.from}` : null;
  const open = trigger && editable && dismissed !== triggerKey ? trigger : null;
  useEffect(() => setActive(0), [trigger?.query, trigger?.kind]);

  const anchor = useMemo(() => {
    if (!open) return null;
    try {
      const c = editor.view.coordsAtPos(open.from);
      return { left: c.left, top: c.top, bottom: c.bottom };
    } catch {
      return null;
    }
  }, [open, editor]);

  const clearTrigger = useCallback(() => {
    if (!trigger) return;
    editor.chain().focus().deleteRange({ from: trigger.from, to: trigger.to }).run();
  }, [editor, trigger]);

  const createNestedPage = useCallback(
    async (title: string, asLink: boolean) => {
      const childId = ulid();
      engine.createDocument({ id: childId, parentDocumentId: documentId, folderId: null, kind: "document", title, icon: null });
      if (asLink) {
        editor.chain().focus().insertContent({ type: "pageLink", attrs: { documentId: childId, label: title || "Untitled" } }).insertContent(" ").run();
      } else {
        insertBlockAfterCurrent(editor, "page", { documentId: childId, display: "card", titleCache: title || "Untitled" });
      }
      return childId;
    },
    [engine, documentId, editor],
  );

  // ---------------------------------------------------------------- slash menu
  const slashItems: MenuItem[] = useMemo(
    () => [
      { id: "p", label: "Text", keywords: "text paragraph plain", icon: <Text size={15} />, run: () => void turnInto(editor, "paragraph") },
      { id: "h1", label: "Heading 1", hint: "#", keywords: "heading title h1 large", icon: <Heading1 size={15} />, run: () => void turnInto(editor, "heading", { level: 1 }) },
      { id: "h2", label: "Heading 2", hint: "##", keywords: "heading subtitle h2", icon: <Heading2 size={15} />, run: () => void turnInto(editor, "heading", { level: 2 }) },
      { id: "h3", label: "Heading 3", hint: "###", keywords: "heading h3 small", icon: <Heading3 size={15} />, run: () => void turnInto(editor, "heading", { level: 3 }) },
      { id: "todo", label: "To-do", hint: "[]", keywords: "todo task checklist checkbox", icon: <CheckSquare size={15} />, run: () => void turnInto(editor, "todo", { checked: false }) },
      { id: "ul", label: "Bulleted list", hint: "-", keywords: "bullet list unordered", icon: <List size={15} />, run: () => void turnInto(editor, "bulleted") },
      { id: "ol", label: "Numbered list", hint: "1.", keywords: "numbered ordered list", icon: <ListOrdered size={15} />, run: () => void turnInto(editor, "numbered") },
      { id: "toggle", label: "Toggle", keywords: "toggle disclosure collapse details", icon: <ChevronRight size={15} />, run: () => void turnInto(editor, "toggle", { collapsed: false }) },
      { id: "quote", label: "Quote", hint: ">", keywords: "quote blockquote citation", icon: <Quote size={15} />, run: () => void turnInto(editor, "quote") },
      { id: "callout", label: "Callout", keywords: "callout note info warning tip", icon: <StickyNote size={15} />, run: () => void turnInto(editor, "callout", { tone: "note" }) },
      { id: "code", label: "Code", hint: "```", keywords: "code snippet programming", icon: <Code2 size={15} />, run: () => void turnInto(editor, "code", { language: "plaintext" }) },
      { id: "divider", label: "Divider", hint: "---", keywords: "divider rule separator line", icon: <Minus size={15} />, run: () => void insertBlockAfterCurrent(editor, "divider") },
      {
        id: "table",
        label: "Table",
        keywords: "table grid spreadsheet",
        icon: <Table2 size={15} />,
        run: () => void insertBlockAfterCurrent(editor, "table", { headerRow: true, rows: [[[], [], []], [[], [], []], [[], [], []]] }),
      },
      { id: "page", label: "Page", keywords: "page nested subpage child", icon: <FileText size={15} />, run: async () => navigate(`/d/${await createNestedPage("", false)}?new=1`) },
      { id: "link", label: "Link to page", hint: "[[", keywords: "link page reference backlink", icon: <Link2 size={15} />, run: () => void editor.chain().focus().insertContent("[[").run() },
      { id: "image", label: "Image", keywords: "image picture photo upload", icon: <ImageIcon size={15} />, run: () => imageInput.current?.click() },
      { id: "file", label: "File", keywords: "file attachment upload pdf", icon: <Paperclip size={15} />, run: () => fileInput.current?.click() },
      { id: "bookmark", label: "Bookmark", keywords: "bookmark web link url embed", icon: <LinkIcon size={15} />, run: () => setBookmarkPrompt(true) },
      {
        id: "collection",
        label: "Collection",
        keywords: "collection database table board gallery kanban",
        icon: <LayoutList size={15} />,
        run: async () => {
          try {
            const r = await createCollection({ documentId, name: "Collection" });
            insertBlockAfterCurrent(editor, "collection", { collectionId: r.collectionId, viewId: r.viewId });
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        },
      },
      { id: "date", label: "Today’s date", keywords: "date today mention calendar", icon: <CalendarDays size={15} />, run: () => void editor.chain().focus().insertContent({ type: "dateMention", attrs: { date: today } }).insertContent(" ").run() },
    ],
    [editor, today, navigate, createNestedPage, createCollection, documentId, toast],
  );

  const q = open?.query.toLowerCase() ?? "";
  const filteredSlash = open?.kind === "slash" ? slashItems.filter((i) => !q || i.label.toLowerCase().includes(q) || i.keywords.includes(q)) : [];

  // ---------------------------------------------------------------- page links
  const debounced = useDebounced(open?.kind === "page" ? open.query.trim() : "", 120);
  const searchResults = useQuery(api.search.documents, open?.kind === "page" && debounced ? { workspaceId: workspace.id, query: debounced, limit: 8 } : "skip");
  const recent = useQuery(api.documents.recent, open?.kind === "page" && !debounced ? { workspaceId: workspace.id, limit: 8 } : "skip");
  const pageItems: MenuItem[] = useMemo(() => {
    if (open?.kind !== "page") return [];
    const docs = (debounced ? searchResults : recent) ?? [];
    const items: MenuItem[] = docs
      .filter((d) => d.id !== documentId)
      .map((d) => ({
        id: d.id,
        label: d.title || "Untitled",
        keywords: "",
        icon: <span>{d.icon ?? "📄"}</span>,
        run: () => void editor.chain().focus().insertContent({ type: "pageLink", attrs: { documentId: d.id, label: d.title || "Untitled" } }).insertContent(" ").run(),
      }));
    if (debounced) {
      items.push({ id: "__create", label: `Create page “${debounced}”`, keywords: "", icon: <Plus size={15} />, run: () => void createNestedPage(debounced, true) });
    }
    return items;
  }, [open?.kind, debounced, searchResults, recent, editor, documentId, createNestedPage]);

  // ---------------------------------------------------------------- mentions & dates
  const members = useQuery(api.workspaces.members, open?.kind === "mention" ? { workspaceId: workspace.id } : "skip");
  const mentionItems: MenuItem[] = useMemo(() => {
    if (open?.kind !== "mention") return [];
    const mq = open.query.toLowerCase();
    const dates = [
      { label: "Today", date: today },
      { label: "Tomorrow", date: addDays(today, 1) },
      { label: "Next week", date: addDays(today, 7) },
    ];
    const explicit = /^\d{4}-\d{2}-\d{2}$/.test(open.query.trim()) ? [{ label: formatDate(open.query.trim()), date: open.query.trim() }] : [];
    const dateItems: MenuItem[] = [...explicit, ...dates]
      .filter((d) => !mq || d.label.toLowerCase().includes(mq) || d.date.startsWith(mq) || explicit.length)
      .map((d) => ({
        id: `date-${d.date}-${d.label}`,
        label: d.label,
        hint: formatDate(d.date),
        keywords: "",
        icon: <CalendarDays size={15} />,
        run: () => void editor.chain().focus().insertContent({ type: "dateMention", attrs: { date: d.date } }).insertContent(" ").run(),
      }));
    const people: MenuItem[] = (members?.members ?? [])
      .filter((m) => !mq || m.displayName.toLowerCase().includes(mq))
      .slice(0, 8)
      .map((m) => ({
        id: m.profileId,
        label: m.displayName,
        hint: m.isYou ? "you" : undefined,
        keywords: "",
        icon: <span className="text-xs font-semibold">{m.displayName.slice(0, 1)}</span>,
        run: () => void editor.chain().focus().insertContent({ type: "mention", attrs: { userId: m.profileId, label: m.displayName } }).insertContent(" ").run(),
      }));
    return [...people, ...dateItems];
  }, [open, members, today, editor]);

  const items = open?.kind === "slash" ? filteredSlash : open?.kind === "page" ? pageItems : mentionItems;

  const run = useCallback(
    (item: MenuItem) => {
      clearTrigger();
      void item.run();
    },
    [clearTrigger],
  );

  // Keyboard handling for the open menu (captured before ProseMirror).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setActive((a) => Math.min(items.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setActive((a) => Math.max(0, a - 1));
      } else if ((e.key === "Enter" || e.key === "Tab") && items[active]) {
        e.preventDefault();
        e.stopImmediatePropagation();
        run(items[active]!);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setDismissed(triggerKey);
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
  }, [open, items, active, run, editor, triggerKey]);

  return (
    <>
      <Popover anchor={open ? anchor : null} label={open?.kind === "slash" ? "Insert block" : open?.kind === "page" ? "Link to page" : "Mention"}>
        <ListMenu items={items} active={active} setActive={setActive} onRun={run} listId={listId} emptyLabel={open?.kind === "page" ? "Type to search pages" : "No matches"} />
        <p className="sr-only" aria-live="polite">
          {open ? `${items.length} suggestion${items.length === 1 ? "" : "s"}` : ""}
        </p>
      </Popover>
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void onInsertFiles(files);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void onInsertFiles(files);
        }}
      />
      {bookmarkPrompt ? (
        <BookmarkPrompt
          onClose={() => setBookmarkPrompt(false)}
          onSubmit={(url) => {
            let host = url;
            try {
              host = new URL(url).host;
            } catch {
              /* keep */
            }
            insertBlockAfterCurrent(editor, "bookmark", { url, title: host });
            setBookmarkPrompt(false);
          }}
        />
      ) : null}
      {editable ? <SelectionBubble editor={editor} onComment={onCommentBlock} /> : null}
      {editable ? <BlockHandle editor={editor} onDropBlock={onDropBlock} onCommentBlock={onCommentBlock} /> : null}
      {editable ? <TaskDetails editor={editor} /> : null}
    </>
  );
}

function BookmarkPrompt({ onClose, onSubmit }: { onClose: () => void; onSubmit: (url: string) => void }) {
  const [value, setValue] = useState("https://");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-scrim)]" onClick={onClose}>
      <form
        className="w-[min(92vw,420px)] ui-pop rounded-[20px] p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const href = sanitizeHref(value);
          if (!href || !/^https?:\/\//.test(href)) {
            setError("Enter a web address starting with http:// or https://");
            return;
          }
          onSubmit(href);
        }}
      >
        <label htmlFor="bm-url" className="text-sm font-medium">
          Bookmark URL
        </label>
        <input id="bm-url" autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="mt-2 h-10 w-full ui-input rounded-full px-4" aria-invalid={Boolean(error)} aria-describedby={error ? "bm-err" : undefined} />
        {error ? (
          <p id="bm-err" className="mt-1 text-xs text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="ui-btn ui-btn-quiet h-8 px-3.5 text-sm">
            Cancel
          </button>
          <button type="submit" className="ui-btn ui-btn-primary h-8 px-4 text-sm">
            Add bookmark
          </button>
        </div>
      </form>
    </div>
  );
}

const COLORS = ["muted", "accent", "moss", "marigold", "plum", "coral"] as const;
const HIGHLIGHTS = ["yellow", "green", "blue", "pink"] as const;

function SelectionBubble({ editor, onComment }: { editor: Editor; onComment?: (blockId: string) => void }) {
  const [state, setState] = useState<{ left: number; top: number } | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [colors, setColors] = useState(false);
  const [href, setHref] = useState("");
  useEffect(() => {
    const update = () => {
      const { selection } = editor.state;
      if (selection.empty || !editor.isFocused || editor.state.selection.$from.parent.type.name === "codeBlock" || !selection.$from.parent.isTextblock) {
        setState(null);
        setLinkMode(false);
        setColors(false);
        return;
      }
      const start = editor.view.coordsAtPos(selection.from);
      const end = editor.view.coordsAtPos(selection.to);
      setState({ left: (start.left + end.left) / 2, top: Math.min(start.top, end.top) });
    };
    editor.on("selectionUpdate", update);
    editor.on("blur", () => setTimeout(update, 120));
    editor.on("focus", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("focus", update);
    };
  }, [editor]);
  if (!state) return null;
  const btn = (label: string, isActive: boolean, onClick: () => void, icon: React.ReactNode) => (
    <button type="button" aria-label={label} title={label} aria-pressed={isActive} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${isActive ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_25%,transparent)]" : "text-muted hover:bg-accent-soft hover:text-heading"}`}>
      {icon}
    </button>
  );
  return (
    <div role="toolbar" aria-label="Text formatting" className="fixed z-40 -translate-x-1/2 -translate-y-[calc(100%+8px)] ui-pop rounded-full p-1 animate-[folio-rise_120ms_var(--ease-folio)]" style={{ left: state.left, top: state.top }} onMouseDown={(e) => e.preventDefault()}>
      {linkMode ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const safe = sanitizeHref(href);
            if (safe) editor.chain().focus().extendMarkRange("link").setMark("link", { href: safe }).run();
            setLinkMode(false);
          }}
        >
          <input autoFocus value={href} onChange={(e) => setHref(e.target.value)} placeholder="Paste or type a link" aria-label="Link address" className="ui-input h-8 w-60 rounded-full px-3 text-sm" onMouseDown={(e) => e.stopPropagation()} />
          <button type="submit" className="ui-btn ui-btn-primary h-8 px-3 text-xs">
            Apply
          </button>
          {editor.isActive("link") ? (
            <button type="button" className="ui-btn ui-btn-quiet h-8 px-2.5 text-xs" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetMark("link").run(); setLinkMode(false); }}>
              Remove
            </button>
          ) : null}
        </form>
      ) : colors ? (
        <div className="flex items-center gap-1 p-0.5">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Text color ${c}`} onClick={() => editor.chain().focus().setMark("textColor", { value: c }).run()} className="grid h-7 w-7 place-items-center rounded-full hover:bg-accent-soft">
              <span className={`fb-color-${c} text-sm font-semibold`}>A</span>
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {HIGHLIGHTS.map((h) => (
            <button key={h} type="button" aria-label={`Highlight ${h}`} onClick={() => editor.chain().focus().setMark("highlight", { value: h }).run()} className="grid h-7 w-7 place-items-center rounded-full hover:bg-accent-soft">
              <span className={`fb-hl-${h} h-4 w-4 rounded-[3px]`} />
            </button>
          ))}
          <button type="button" className="ui-btn ui-btn-quiet h-7 px-2.5 text-xs" onClick={() => editor.chain().focus().unsetMark("textColor").unsetMark("highlight").run()}>
            Reset
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          {btn("Bold (⌘B)", editor.isActive("bold"), () => editor.chain().focus().toggleMark("bold").run(), <Bold size={15} />)}
          {btn("Italic (⌘I)", editor.isActive("italic"), () => editor.chain().focus().toggleMark("italic").run(), <Italic size={15} />)}
          {btn("Underline (⌘U)", editor.isActive("underline"), () => editor.chain().focus().toggleMark("underline").run(), <Underline size={15} />)}
          {btn("Strikethrough (⌘⇧X)", editor.isActive("strike"), () => editor.chain().focus().toggleMark("strike").run(), <Strikethrough size={15} />)}
          {btn("Inline code (⌘E)", editor.isActive("code"), () => editor.chain().focus().toggleMark("code").run(), <Code2 size={15} />)}
          {btn("Link", editor.isActive("link"), () => {
            setHref(String(editor.getAttributes("link").href ?? ""));
            setLinkMode(true);
          }, <LinkIcon size={15} />)}
          {btn("Color and highlight", false, () => setColors(true), <Palette size={15} />)}
          {btn("Highlight (⌘⇧H)", editor.isActive("highlight"), () => editor.chain().focus().toggleMark("highlight", { value: "yellow" }).run(), <Highlighter size={15} />)}
          {btn("Clear formatting", false, () => editor.chain().focus().unsetAllMarks().run(), <Eraser size={15} />)}
          {onComment ? (
            <>
              <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
              {btn("Comment on this block", false, () => {
                const id = editor.state.selection.$from.node(1)?.attrs.id as string | undefined;
                if (id) onComment(id);
              }, <MessageSquare size={15} />)}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Hover gutter with a drag handle and block menu; also reachable from the keyboard with ⌘. (Ctrl+.). */
function BlockHandle({ editor, onDropBlock, onCommentBlock }: { editor: Editor; onDropBlock: (from: number, to: number, depth: number) => { index: number; count: number } | null; onCommentBlock?: (blockId: string) => void }) {
  const [hover, setHover] = useState<{ index: number; top: number; left: number; height: number } | null>(null);
  const [menu, setMenu] = useState<{ index: number; left: number; top: number; bottom: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const justDragged = useRef(false);
  const toast = useToast();

  const blockDomAt = useCallback(
    (index: number): HTMLElement | null => {
      const dom = editor.view.dom as HTMLElement;
      return (dom.children[index] as HTMLElement | undefined) ?? null;
    },
    [editor],
  );

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onMove = (e: MouseEvent) => {
      if (menu || isDragging()) return;
      const children = [...dom.children] as HTMLElement[];
      const idx = children.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2 && !c.classList.contains("fb-hidden");
      });
      if (idx < 0) return;
      const r = children[idx]!.getBoundingClientRect();
      const depth = Number(children[idx]!.dataset.depth ?? 0);
      setHover({ index: idx, top: r.top, left: r.left + depth * 24, height: Math.min(r.height, 32) });
    };
    const parent = dom.parentElement?.parentElement ?? dom;
    parent.addEventListener("mousemove", onMove);
    return () => parent.removeEventListener("mousemove", onMove);
  }, [editor, menu]);

  useEffect(() => {
    const onScroll = () => setHover(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  // Keyboard: ⌘. / Ctrl+. opens the block menu for the current block.
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        const index = editor.state.selection.$from.index(0);
        const el = blockDomAt(index);
        if (!el) return;
        const r = el.getBoundingClientRect();
        setMenu({ index, left: r.left, top: r.top, bottom: r.top + 24 });
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor, blockDomAt]);

  const selectBlock = (index: number) => {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
    const node = editor.state.doc.child(index);
    if (node.isTextblock) editor.chain().focus().setTextSelection({ from: pos + 1, to: pos + 1 + node.content.size }).run();
    else editor.chain().focus().setNodeSelection(pos).run();
  };

  const act = (fn: () => void) => {
    if (!menu) return;
    selectBlock(menu.index);
    fn();
    setMenu(null);
  };

  const node = menu ? editor.state.doc.maybeChild(menu.index) : null;
  const isText = node?.isTextblock && node.type.name !== "codeBlock";

  return (
    <>
      {hover && !menu && !dragging ? (
        <div
          className="ui-raised fixed z-30 flex items-center gap-px rounded-full p-0.5 opacity-90 transition-opacity hover:opacity-100 animate-[folio-rise_120ms_var(--ease-folio)]"
          style={{ top: hover.top + Math.max(0, (hover.height - 28) / 2), left: hover.left - 58 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            aria-label="Insert block below"
            className="grid h-6 w-6 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-heading"
            onClick={() => {
              selectBlock(hover.index);
              const at = (() => {
                let p = 0;
                for (let i = 0; i <= hover.index; i++) p += editor.state.doc.child(i).nodeSize;
                return p;
              })();
              const depth = editor.state.doc.child(hover.index).attrs.depth;
              editor.chain().insertContentAt(at, { type: "paragraph", attrs: { id: ulid(), depth } }).focus(at + 1).insertContent("/").run();
            }}
          >
            <Plus size={14} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Drag to move, click for block options"
            className="grid h-6 w-5 cursor-grab touch-none place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-heading active:cursor-grabbing"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              const index = hover.index;
              beginPointerDrag({
                editor,
                payload: { kind: "block", index },
                event: e,
                onStart: () => {
                  justDragged.current = true;
                  setDragging(true);
                  setHover(null);
                },
                onDrop: (t) => onDropBlock(index, t.index, t.depth),
                onEnd: () => {
                  setDragging(false);
                  window.setTimeout(() => (justDragged.current = false), 0);
                },
              });
            }}
            onClick={() => {
              if (justDragged.current) return;
              const el = blockDomAt(hover.index);
              const r = el?.getBoundingClientRect();
              setMenu({ index: hover.index, left: hover.left - 40, top: r?.top ?? hover.top, bottom: (r?.top ?? hover.top) + 24 });
            }}
          >
            <GripVertical size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      {menu ? (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
          <Popover anchor={menu} label="Block options" width={240}>
            <div className="p-1 text-sm" role="menu" aria-label="Block options" onKeyDown={(e) => e.key === "Escape" && setMenu(null)}>
              {isText ? (
                <>
                  <p className="ui-caps px-2 pb-1.5 pt-1">Turn into</p>
                  <div className="grid grid-cols-2 gap-0.5">
                    {(
                      [
                        ["paragraph", "Text", {}],
                        ["heading", "Heading 1", { level: 1 }],
                        ["heading", "Heading 2", { level: 2 }],
                        ["heading", "Heading 3", { level: 3 }],
                        ["todo", "To-do", { checked: false }],
                        ["bulleted", "Bulleted", {}],
                        ["numbered", "Numbered", {}],
                        ["toggle", "Toggle", { collapsed: false }],
                        ["quote", "Quote", {}],
                        ["callout", "Callout", { tone: "note" }],
                        ["code", "Code", { language: "plaintext" }],
                      ] as const
                    ).map(([type, label, attrs]) => (
                      <button key={label} type="button" role="menuitem" className="rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-accent-soft hover:text-heading focus:bg-accent-soft" onClick={() => act(() => turnInto(editor, type, attrs))}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mx-2 my-1.5 h-px bg-line" />
                </>
              ) : null}
              {[
                { label: "Duplicate", hint: "⌘D", icon: <Copy size={14} />, run: () => act(() => duplicateBlocks(editor)) },
                { label: "Move up", hint: "⌥⇧↑", icon: <MoveUp size={14} />, run: () => act(() => moveBlock(editor, -1)) },
                { label: "Move down", hint: "⌥⇧↓", icon: <MoveDown size={14} />, run: () => act(() => moveBlock(editor, 1)) },
                ...(onCommentBlock && node?.attrs.id ? [{ label: "Comment", hint: "", icon: <MessageSquare size={14} />, run: () => { onCommentBlock(node.attrs.id as string); setMenu(null); } }] : []),
                {
                  label: "Copy link to block",
                  hint: "",
                  icon: <Link2 size={14} />,
                  run: () => {
                    const url = `${location.origin}${location.pathname}#block-${node?.attrs.id}`;
                    void navigator.clipboard.writeText(url).then(() => toast.show("Link copied"));
                    setMenu(null);
                  },
                },
                { label: "Delete", hint: "⌘⇧⌫", icon: <Trash2 size={14} />, danger: true, run: () => act(() => deleteBlocks(editor, [menu.index])) },
              ].map((item) => (
                <button key={item.label} type="button" role="menuitem" onClick={item.run} className={`flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-accent-soft hover:text-heading focus:bg-accent-soft ${"danger" in item && item.danger ? "text-danger" : ""}`}>
                  <span className="text-muted" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  <span className="text-xs text-faint">{item.hint}</span>
                </button>
              ))}
            </div>
          </Popover>
        </>
      ) : null}
    </>
  );
}

/** Due date, time, priority, assignee and reminder for a task block. */
function TaskDetails({ editor }: { editor: Editor }) {
  const { workspace } = useAppState();
  const [target, setTarget] = useState<{ pos: number; left: number; top: number; bottom: number } | null>(null);
  const members = useQuery(api.workspaces.members, target ? { workspaceId: workspace.id } : "skip");
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const on = (e: Event) => {
      const detail = (e as CustomEvent<{ pos: number; anchor: HTMLElement }>).detail;
      const r = detail.anchor.getBoundingClientRect();
      setTarget({ pos: detail.pos, left: r.left, top: r.top, bottom: r.bottom });
    };
    dom.addEventListener("folevi:task-details", on);
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧D opens task details for the current to-do.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyD") {
        const $from = editor.state.selection.$from;
        if ($from.depth >= 1 && $from.node(1).type.name === "todo") {
          e.preventDefault();
          const pos = $from.before(1);
          const c = editor.view.coordsAtPos(pos + 1);
          setTarget({ pos, left: c.left, top: c.top, bottom: c.bottom });
        }
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("folevi:task-details", on);
      dom.removeEventListener("keydown", onKey);
    };
  }, [editor]);
  if (!target) return null;
  const node = editor.state.doc.nodeAt(target.pos);
  if (!node || node.type.name !== "todo") return null;
  const set = (patch: Record<string, unknown>) => editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, ...patch }));
  const reminder = node.attrs.reminderAt ? new Date(node.attrs.reminderAt as number) : null;
  const reminderValue = reminder ? new Date(reminder.getTime() - reminder.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={() => setTarget(null)} />
      <Popover anchor={target} label="Task details" width={300}>
        <form className="grid gap-3 p-2 text-sm" onSubmit={(e) => { e.preventDefault(); setTarget(null); editor.commands.focus(); }} onKeyDown={(e) => e.key === "Escape" && (setTarget(null), editor.commands.focus())}>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Due date</span>
            <input type="date" autoFocus value={(node.attrs.dueDate as string) ?? ""} onChange={(e) => set({ dueDate: e.target.value || null, dueTime: e.target.value ? node.attrs.dueTime : null })} className="h-8 ui-input rounded-full px-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Time (leave empty for all day)</span>
            <input type="time" disabled={!node.attrs.dueDate} value={(node.attrs.dueTime as string) ?? ""} onChange={(e) => set({ dueTime: e.target.value || null })} className="h-8 ui-input rounded-full px-3 disabled:opacity-50" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Priority</span>
            <select value={(node.attrs.priority as string) ?? "none"} onChange={(e) => set({ priority: e.target.value === "none" ? null : e.target.value })} className="h-8 ui-input rounded-full px-3">
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          {members && members.members.length > 1 ? (
            <label className="grid gap-1">
              <span className="text-xs text-muted">Assignee</span>
              <select value={(node.attrs.assigneeId as string) ?? ""} onChange={(e) => set({ assigneeId: e.target.value || null })} className="h-8 ui-input rounded-full px-3">
                <option value="">Unassigned</option>
                {members.members.map((m) => (
                  <option key={m.profileId} value={m.profileId}>
                    {m.displayName}
                    {m.isYou ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1">
            <span className="text-xs text-muted">Reminder</span>
            <input type="datetime-local" value={reminderValue} onChange={(e) => set({ reminderAt: e.target.value ? new Date(e.target.value).getTime() : null })} className="h-8 ui-input rounded-full px-3" />
          </label>
          <div className="flex justify-between">
            <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => set({ dueDate: null, dueTime: null, priority: null, reminderAt: null, assigneeId: null })}>
              Clear all
            </button>
            <button type="submit" className="h-8 ui-btn ui-btn-primary px-3.5 text-xs">
              Done
            </button>
          </div>
        </form>
      </Popover>
    </>
  );
}

