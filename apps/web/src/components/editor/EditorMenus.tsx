"use client";

import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { beginPointerDrag, isDragging } from "./blockDrag";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { AudioRecorder } from "./AudioRecorder";
import {
  Bold,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Code2,
  CopyPlus,
  Eraser,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  Link2,
  List,
  ListOrdered,
  MessageSquare,
  Minus,
  MoveDown,
  MoveUp,
  Mic,
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
  SeparatorHorizontal,
  Sigma,
  Workflow,
  Network,
  PenTool,
  SquareStack,
  ImagePlus,
  LayoutGrid,
  Columns3,
} from "lucide-react";
import { FLOWCHART_DEFAULT_HEIGHT, WHITEBOARD_DEFAULT_HEIGHT, addDays, sanitizeHref, ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useEditorEnvironment } from "./environment";
import type { SyncEngine } from "@/lib/sync/engine";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/format";
import {
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  applyLink,
  blocksInSelection,
  changeDepth,
  clearFormatting,
  deleteBlocks,
  duplicateBlocks,
  emptyTableRows,
  focusInsideBlock,
  insertBlockAfterCurrent,
  moveBlock,
  removeLink,
  subtreeRange,
  setHighlight,
  setTextColor,
  turnInto,
} from "./commands";
import { blockSelectionRange, clearBlockSelection, extendBlockSelectionTo, setBlockSelection } from "./blockSelection";
import { syncDomSelection } from "./blockSelectionState";
import { blockElements, type TriggerState } from "./plugins";
import { UnsplashDialog, unsplashCredit } from "./UnsplashDialog";
import { colorName, useNotePalette } from "./notePalette";
import { useShowInTopLayer } from "@/components/ui/topLayer";
import { INLINE_AI_EVENT, openInlineAi, useAiEnabled, type InlineAiOpen } from "@/components/ai/useAi";
import { InlineAi, type InlineAiRequest } from "@/components/ai/InlineAi";
import { newFormulaAttrs } from "./FormulaView";
import { DIVIDER_STYLES, MERMAID_SAMPLE } from "./insertCatalog";
import { Select } from "@/components/ui/Select";
import { Calendar, DateField, DateTimeField, TimeField } from "@/components/ui/DateField";
import { EDIT_LINK_EVENT, EditorContextMenu } from "./EditorContextMenu";
import { keyLabel, withKeyLabels } from "@/lib/shortcuts";
import { setRangeHighlight } from "./blockHighlight";

interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

/** Everything the Insert panel (and the slash menu) can add that needs more than a plain block. */
export type SpecialInsert = "image" | "unsplash" | "file" | "record" | "page" | "card" | "bookmark" | "collection" | "gallery" | "board" | "date" | "pickDate";

/** Asks the editor's menus to run a special insert (the Insert panel lives outside the editor). */
export function requestSpecialInsert(editor: Editor, kind: SpecialInsert) {
  editor.view.dom.dispatchEvent(new CustomEvent("folevi:insert", { detail: { kind } }));
}

type Anchor = { left: number; top: number; bottom: number };

function Popover({
  anchor,
  children,
  label,
  width = 300,
  role = "dialog",
  scroll = true,
  onKeyDown,
  popRef,
  tall = false,
  follow,
}: {
  anchor: Anchor | null;
  children: React.ReactNode;
  label: string;
  width?: number;
  role?: "dialog" | "presentation";
  scroll?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  popRef?: React.RefObject<HTMLDivElement | null>;
  /** A taller limit (the block menu). */
  tall?: boolean;
  /** Where the anchor is now: the popover follows it when the page scrolls. */
  follow?: () => Anchor | null;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = popRef ?? ownRef;
  const followRef = useRef(follow);
  followRef.current = follow;
  const [moved, setMoved] = useState<Anchor | null>(null);
  useEffect(() => setMoved(null), [anchor]);
  useEffect(() => {
    if (!anchor || !followRef.current) return;
    const on = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      const next = followRef.current?.();
      if (next) setMoved(next);
    };
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [anchor, ref]);
  const at = moved ?? anchor;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // In the top layer, so no panel or stacking order can clip or cover it (it stays in the editor's DOM).
  useShowInTopLayer(Boolean(anchor), ref);
  // A field marked data-autofocus takes focus once the popover is showing (React's autoFocus fires earlier,
  // while it's still hidden, and is lost).
  const placed = pos !== null;
  useEffect(() => {
    // Once it's visible (focusing a hidden field does nothing).
    if (!anchor || !placed) return;
    const field = ref.current?.querySelector<HTMLElement>("[data-autofocus]");
    if (field && !ref.current?.contains(document.activeElement)) field.focus();
  }, [anchor, placed, ref]);
  // Which side of the anchor it opened on: kept while it's open, so it doesn't jump as its list shrinks.
  const side = useRef<"below" | "above" | null>(null);
  useLayoutEffect(() => {
    if (!at) side.current = null;
    if (!at || !ref.current) return;
    const h = ref.current.offsetHeight;
    const below = at.bottom + 6;
    if (side.current === null) side.current = below + h > window.innerHeight - 8 && at.top - h - 6 >= 8 ? "above" : "below";
    const top = side.current === "above" ? Math.max(8, at.top - h - 6) : Math.min(below, Math.max(8, window.innerHeight - h - 8));
    setPos({ left: Math.max(8, Math.min(at.left, window.innerWidth - width - 8)), top });
  }, [at, width, children, ref]);
  if (!anchor) return null;
  return (
    <div
      ref={ref}
      role={role}
      aria-label={role === "dialog" ? label : undefined}
      popover="manual"
      style={{ position: "fixed", margin: 0, right: "auto", bottom: "auto", left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 6, width, visibility: pos ? "visible" : "hidden" }}
      className={`z-[100] border-0 text-ink ${scroll ? `${tall ? "max-h-[min(600px,85vh)]" : "max-h-[min(420px,70vh)]"} overflow-y-auto` : ""} ui-pop p-1.5 animate-[folio-rise_120ms_var(--ease-folio)]`}
      onMouseDown={(e) => {
        // Keep focus in the editor, except for form controls inside the popover (fields, and Folevi's own
        // dropdowns and date fields, which are buttons that open a list).
        const t = e.target as HTMLElement;
        if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || t.closest?.('[role="combobox"], [aria-haspopup]')) return;
        e.preventDefault();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        // A dialog keeps Tab inside it (it floats outside the page's own order). Keys from a calendar or list
        // opened from inside it (in the page's top layer, elsewhere in the document) are theirs.
        if (role !== "dialog" || e.key !== "Tab" || e.defaultPrevented || !ref.current || !ref.current.contains(document.activeElement)) return;
        const items = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"]')].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items[items.length - 1]!.focus();
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault();
          items[0]!.focus();
        }
      }}
    >
      {children}
    </div>
  );
}

function ListMenu({ items, active, setActive, onRun, emptyLabel, listId, label }: { items: MenuItem[]; active: number; setActive: (i: number) => void; onRun: (i: MenuItem) => void; emptyLabel: string; listId: string; label: string }) {
  // The pointer only takes over when it actually moves (not when the list scrolls under a resting mouse).
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);
  if (!items.length) return <p className="px-3 py-2 text-sm text-muted">{emptyLabel}</p>;
  return (
    // The list is the scroll container. It is focusable (axe: scrollable-region-focusable) but focus
    // normally stays in the editor, which points at the active option with aria-activedescendant.
    <ul role="listbox" id={listId} aria-label={label} tabIndex={0} className="max-h-[min(400px,65vh)] overflow-y-auto rounded-[6px] outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)]">
      {items.map((item, i) => (
        <li
          key={item.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          onMouseMove={(e) => {
            const last = lastPointer.current;
            lastPointer.current = { x: e.clientX, y: e.clientY };
            if (last && last.x === e.clientX && last.y === e.clientY) return;
            if (i !== active) setActive(i);
          }}
          onClick={() => onRun(item)}
          className={`flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-sm transition-colors ${i === active ? "ui-row-active" : ""}`}
        >
          <span className="grid h-7 w-7 flex-none place-items-center rounded-[6px] bg-surface text-heading shadow-[var(--shadow-control)]" aria-hidden>
            {item.icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint ? <span className="text-xs text-faint">{keyLabel(item.hint)}</span> : null}
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

/**
 * Where a block's indented content starts on screen (the handle sits just left of it): the block's own
 * left edge plus its nesting indent (1.6em per level in the block's font size), ignoring any margin.
 */
function blockIndentLeft(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const depth = Number(el.dataset.depth ?? 0);
  return el.getBoundingClientRect().left - (parseFloat(cs.marginLeft) || 0) + depth * 1.6 * (parseFloat(cs.fontSize) || 16);
}

/**
 * Where a block's handle sits: level with its first line of text (a callout's text inside its padding, a
 * table's first row below its column tools), not the top of its box.
 */
function handleLine(el: HTMLElement): { top: number; height: number } {
  const box = el.getBoundingClientRect();
  const row = el.querySelector<HTMLElement>(".fb-table tbody tr");
  if (row) {
    const r = row.getBoundingClientRect();
    return { top: r.top, height: Math.min(r.height, 32) };
  }
  const content = el.classList.contains("fb-callout") ? el.querySelector<HTMLElement>(".fb-content") : null;
  if (content) {
    const r = content.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(content).lineHeight) || 24;
    return { top: r.top, height: Math.min(r.height, line, 32) };
  }
  return { top: box.top, height: Math.min(box.height, 32) };
}

/** Top-level block index → its rendered element. */
function blockDom(editor: Editor, index: number): HTMLElement | null {
  return blockElements(editor.view.dom as HTMLElement)[index] ?? null;
}

export function EditorMenus({
  editor,
  documentId,
  engine,
  trigger,
  editable,
  onInsertFiles,
  onInsertAudio,
  onDropBlock,
  onCommentBlock,
}: {
  editor: Editor;
  documentId: string;
  engine: SyncEngine;
  trigger: TriggerState | null;
  editable: boolean;
  onInsertFiles: (files: File[]) => Promise<void>;
  onInsertAudio: (file: File, durationSeconds: number) => Promise<void>;
  onDropBlock: (from: number, to: number, depth: number) => { index: number; count: number } | null;
  onCommentBlock?: (blockId: string) => void;
}) {
  const { scope, today } = useAppState();
  const { navigate } = useAppRouter();
  const env = useEditorEnvironment();
  const toast = useToast();
  const createCollection = useMutation(api.collections.create);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = useId();
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [bookmarkPrompt, setBookmarkPrompt] = useState(false);
  const [unsplashOpen, setUnsplashOpen] = useState(false);
  const [datePicker, setDatePicker] = useState<{ mode: "insert" } | { mode: "edit"; pos: number } | null>(null);
  const [datePickerAnchor, setDatePickerAnchor] = useState<Anchor | null>(null);
  const [recorderAnchor, setRecorderAnchor] = useState<Anchor | null>(null);

  const triggerKey = trigger ? `${trigger.kind}:${trigger.from}` : null;
  // Escape closes a menu for that "/", "@" or "[[" only: once the trigger is gone, the next one opens again.
  useEffect(() => {
    if (!trigger) setDismissed(null);
  }, [trigger]);
  // Suggestions belong to the text being typed: hidden while the note isn't focused.
  const [focused, setFocused] = useState(() => editor.isFocused);
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);
  const open = trigger && editable && focused && dismissed !== triggerKey ? trigger : null;
  useEffect(() => setActive(0), [trigger?.query, trigger?.kind]);
  // The menu stays next to its "/" while the page scrolls.
  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    const on = () => setScrollTick((n) => n + 1);
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [trigger]);
  const aiOn = useAiEnabled();

  // The inline AI composer: opened by ⌘J, the "/" AI commands, the toolbar's Ask AI and the block menu.
  const [inlineAi, setInlineAi] = useState<InlineAiRequest | null>(null);
  useEffect(() => {
    if (!aiOn || !editable) return;
    const dom = editor.view.dom as HTMLElement;
    const onOpen = (e: Event) => setInlineAi({ id: Date.now(), ...(e as CustomEvent<InlineAiOpen>).detail });
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        // In a note, ⌘J writes here (the app-wide ⌘J opens Ask AI).
        e.preventDefault();
        e.stopPropagation();
        const { from, to, empty } = editor.state.selection;
        const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
        setInlineAi({ id: Date.now(), target: text.trim() ? { from, to, text } : null });
      }
    };
    dom.addEventListener(INLINE_AI_EVENT, onOpen);
    dom.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener(INLINE_AI_EVENT, onOpen);
      dom.removeEventListener("keydown", onKey);
    };
  }, [editor, aiOn, editable]);

  const anchor = useMemo(() => {
    if (!open) return null;
    try {
      const c = editor.view.coordsAtPos(open.from);
      return { left: c.left, top: c.top, bottom: c.bottom };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollTick re-measures on scroll
  }, [open, editor, scrollTick]);

  const clearTrigger = useCallback(() => {
    if (!trigger) return;
    // Focus now, not a frame later (a popover the item opens takes focus meanwhile).
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.delete(trigger.from, trigger.to));
  }, [editor, trigger]);

  const createNestedPage = useCallback(
    async (title: string, asLink: boolean, display: "link" | "card" = "card") => {
      const childId = ulid();
      engine.createDocument({ id: childId, parentDocumentId: documentId, folderId: null, kind: "document", title, icon: null });
      if (asLink) {
        editor.chain().focus().insertContent({ type: "pageLink", attrs: { documentId: childId, label: title || "Untitled" } }).insertContent(" ").run();
      } else {
        insertBlockAfterCurrent(editor, "page", { documentId: childId, display, titleCache: title || "Untitled" });
      }
      return childId;
    },
    [engine, documentId, editor],
  );

  const caretAnchor = useCallback((): Anchor => {
    try {
      const c = editor.view.coordsAtPos(editor.state.selection.from);
      return { left: c.left, top: c.top, bottom: c.bottom };
    } catch {
      const r = (editor.view.dom as HTMLElement).getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.top + 24 };
    }
  }, [editor]);

  /** Inline inserts need a caret in a text block (not a selected image, a code block…). */
  const ensureTextCaret = useCallback(() => {
    const { selection } = editor.state;
    const parent = selection.$from.parent;
    if (selection instanceof NodeSelection || !parent.isTextblock || parent.type.name === "codeBlock") insertBlockAfterCurrent(editor, "paragraph");
  }, [editor]);

  // ---------------------------------------------------------------- special inserts (slash menu + Insert panel)
  const insertCollection = useCallback(
    async (view: "table" | "gallery" | "board", name: string) => {
      try {
        // A brand-new page may still be on its way to the server; the collection needs it to exist.
        await engine.whenDocumentOnServer(documentId);
        const r = await createCollection({ documentId, name, view });
        insertBlockAfterCurrent(editor, "collection", { collectionId: r.collectionId, viewId: r.viewId });
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
      }
    },
    [engine, documentId, createCollection, editor, toast],
  );

  const special = useMemo<Record<SpecialInsert, () => void | Promise<void>>>(() => {
    // Without an account (the site's demo note), inserts that need the server ask to sign up instead.
    const account = (feature: string, run: () => void | Promise<void>) => (env.demo ? () => env.unavailable(feature) : run);
    return {
      image: account("Images", () => imageInput.current?.click()),
      unsplash: account("Images", () => setUnsplashOpen(true)),
      file: account("Files", () => fileInput.current?.click()),
      record: account("Audio recordings", () => setRecorderAnchor(caretAnchor())),
      page: account("Sub-pages", async () => navigate(`/d/${await createNestedPage("", false, "link")}?new=1`)),
      card: account("Sub-pages", async () => navigate(`/d/${await createNestedPage("", false, "card")}?new=1`)),
      bookmark: account("Bookmarks", () => setBookmarkPrompt(true)),
      collection: account("Collections", () => insertCollection("table", "Collection")),
      gallery: account("Collections", () => insertCollection("gallery", "Gallery")),
      board: account("Collections", () => insertCollection("board", "Kanban")),
      date: () => {
        ensureTextCaret();
        editor.chain().focus().insertContent({ type: "dateMention", attrs: { date: today } }).insertContent(" ").run();
      },
      pickDate: () => {
        ensureTextCaret();
        setDatePickerAnchor(caretAnchor());
        setDatePicker({ mode: "insert" });
      },
    };
  }, [env, navigate, createNestedPage, insertCollection, editor, today, caretAnchor, ensureTextCaret]);

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const on = (e: Event) => {
      const kind = (e as CustomEvent<{ kind: SpecialInsert }>).detail?.kind;
      if (kind && editable && special[kind]) void special[kind]();
    };
    dom.addEventListener("folevi:insert", on);
    return () => dom.removeEventListener("folevi:insert", on);
  }, [editor, special, editable]);

  // Where the last press happened (a press and release in different places is a drag that selects text).
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  // ---------------------------------------------------------------- inline page links & dates
  // Plain click opens a [[page link]] in the app; Alt/⌘/Ctrl/Shift-click or middle-click opens a new tab.
  // Clicking a date (or Enter on a selected one) opens the date picker to change it.
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const openLink = (a: HTMLElement, newTab: boolean) => {
      const id = a.getAttribute("data-page-link");
      if (!id) return;
      const href = `/d/${id}`;
      if (newTab) window.open(href, "_blank", "noopener");
      else navigate(href);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const link = target?.closest<HTMLElement>("a[data-page-link]");
      if (link && dom.contains(link)) {
        e.preventDefault();
        openLink(link, e.altKey || e.metaKey || e.ctrlKey || e.shiftKey);
        return;
      }
      // Web links open in a new tab on click (right-click › Edit link… changes them). Shift-click extends the
      // selection, and dragging across a link selects text, as usual.
      const web = target?.closest<HTMLAnchorElement>("a.fb-link");
      if (web && dom.contains(web)) {
        e.preventDefault();
        const href = sanitizeHref(web.getAttribute("href") ?? "");
        const down = pressedAt.current;
        const dragged = down !== null && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
        if (href && !e.shiftKey && !e.altKey && !dragged) window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      const time = target?.closest<HTMLElement>("time[data-date]");
      if (time && dom.contains(time) && editable) {
        const pos = editor.view.posAtDOM(time, 0);
        const r = time.getBoundingClientRect();
        setDatePickerAnchor({ left: r.left, top: r.top, bottom: r.bottom });
        setDatePicker({ mode: "edit", pos });
      }
    };
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const link = (e.target as HTMLElement | null)?.closest<HTMLElement>("a[data-page-link]");
      if (link && dom.contains(link)) {
        e.preventDefault();
        openLink(link, true);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const sel = editor.state.selection;
      if (!(sel instanceof NodeSelection)) return;
      if (sel.node.type.name === "pageLink") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const id = String(sel.node.attrs.documentId);
        if (e.altKey || e.metaKey || e.ctrlKey) window.open(`/d/${id}`, "_blank", "noopener");
        else navigate(`/d/${id}`);
      } else if (sel.node.type.name === "dateMention" && editable) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const c = editor.view.coordsAtPos(sel.from);
        setDatePickerAnchor({ left: c.left, top: c.top, bottom: c.bottom });
        setDatePicker({ mode: "edit", pos: sel.from });
      }
    };
    const onDown = (e: MouseEvent) => {
      pressedAt.current = { x: e.clientX, y: e.clientY };
    };
    dom.addEventListener("mousedown", onDown, true);
    dom.addEventListener("click", onClick);
    dom.addEventListener("auxclick", onAux);
    dom.addEventListener("keydown", onKey, true);
    return () => {
      dom.removeEventListener("mousedown", onDown, true);
      dom.removeEventListener("click", onClick);
      dom.removeEventListener("auxclick", onAux);
      dom.removeEventListener("keydown", onKey, true);
    };
  }, [editor, navigate, editable]);

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
      ...DIVIDER_STYLES.map((d) => ({
        id: `divider-${d.style}`,
        label: `Divider: ${d.label}`,
        keywords: `divider rule separator line ${d.label.toLowerCase()} ${d.style}`,
        icon: <Minus size={15} />,
        run: () => void insertBlockAfterCurrent(editor, "divider", { style: d.style }),
      })),
      // AI: opens the inline composer at the cursor (the "/" is already gone), some running a task at once.
      ...(aiOn
        ? ([
            ["ai", "Ask AI…", "ai assistant write generate gemini ask"],
            ["ai-continue", "AI · Continue writing", "ai continue write more next", "continue"],
            ["ai-summarize", "AI · Summarize note", "ai summary summarize tldr", "summarize"],
            ["ai-actions", "AI · Find action items", "ai tasks todo action items follow ups", "actions"],
            ["ai-outline", "AI · Make an outline", "ai outline structure plan", "outline"],
            ["ai-brainstorm", "AI · Brainstorm ideas", "ai ideas brainstorm", "brainstorm"],
          ] as const).map(([id, label, keywords, task]) => ({
            id,
            label,
            keywords,
            hint: id === "ai" ? "⌘J" : undefined,
            icon: <AiIcon size={15} className="text-[#7c6cf0]" />,
            run: () => openInlineAi(editor.view.dom, { target: null, task: task as InlineAiOpen["task"] }),
          }))
        : []),
      { id: "pagebreak", label: "Page break", keywords: "page break print pdf new sheet", icon: <SeparatorHorizontal size={15} />, run: () => void insertBlockAfterCurrent(editor, "pageBreak") },
      {
        id: "table",
        label: "Table",
        keywords: "table grid spreadsheet",
        icon: <Table2 size={15} />,
        run: () => focusInsideBlock(editor, insertBlockAfterCurrent(editor, "table", { headerRow: true, rows: emptyTableRows(3, 3) })),
      },
      { id: "formula", label: "TeX formula", keywords: "formula math latex tex equation katex", icon: <Sigma size={15} />, run: () => void insertBlockAfterCurrent(editor, "formula", newFormulaAttrs()) },
      { id: "mermaid", label: "Mermaid diagram", keywords: "mermaid diagram flowchart chart graph sequence", icon: <Workflow size={15} />, run: () => void insertBlockAfterCurrent(editor, "code", { language: "mermaid" }, MERMAID_SAMPLE) },
      { id: "flowchart", label: "Flowchart", keywords: "flowchart diagram process flow chart shapes boxes arrows", icon: <Network size={15} />, run: () => void insertBlockAfterCurrent(editor, "flowchart", { data: "", height: FLOWCHART_DEFAULT_HEIGHT }) },
      { id: "whiteboard", label: "Whiteboard", keywords: "whiteboard drawing sketch draw pen canvas", icon: <PenTool size={15} />, run: () => void insertBlockAfterCurrent(editor, "whiteboard", { data: "", height: WHITEBOARD_DEFAULT_HEIGHT }) },
      { id: "page", label: "Page", keywords: "page nested subpage child link", icon: <FileText size={15} />, run: special.page },
      { id: "card", label: "Card", keywords: "card page nested subpage child", icon: <SquareStack size={15} />, run: special.card },
      { id: "link", label: "Link to page", hint: "[[", keywords: "link page reference backlink", icon: <Link2 size={15} />, run: () => void editor.chain().focus().insertContent("[[").run() },
      { id: "image", label: "Image", keywords: "image picture photo upload", icon: <ImageIcon size={15} />, run: special.image },
      { id: "unsplash", label: "Image from Unsplash", keywords: "image picture photo unsplash stock search", icon: <ImagePlus size={15} />, run: special.unsplash },
      { id: "file", label: "File", keywords: "file attachment upload pdf", icon: <Paperclip size={15} />, run: special.file },
      { id: "record", label: "Audio recording", keywords: "audio record recording voice memo microphone mic sound dictate", icon: <Mic size={15} />, run: special.record },
      { id: "bookmark", label: "Bookmark", keywords: "bookmark web link url embed", icon: <LinkIcon size={15} />, run: special.bookmark },
      { id: "collection", label: "Collection", keywords: "collection database table", icon: <LayoutList size={15} />, run: special.collection },
      { id: "gallery", label: "Gallery", keywords: "gallery collection database cards grid", icon: <LayoutGrid size={15} />, run: special.gallery },
      { id: "board", label: "Kanban", keywords: "kanban board collection database columns", icon: <Columns3 size={15} />, run: special.board },
      { id: "date", label: "Today’s date", keywords: "date today mention calendar", icon: <CalendarDays size={15} />, run: special.date },
      { id: "pickdate", label: "Date…", keywords: "date pick choose calendar day", icon: <CalendarDays size={15} />, run: special.pickDate },
    ],
    [editor, special, aiOn],
  );

  const q = open?.query.toLowerCase() ?? "";
  // Label matches first (those starting with the query before the rest), then keyword-only matches, so
  // "/flowchart" picks Flowchart rather than a block that merely lists it as a keyword.
  const slashRank = (i: { label: string }) => {
    const label = i.label.toLowerCase();
    return label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
  };
  const filteredSlash =
    open?.kind === "slash"
      ? slashItems.filter((i) => !q || i.label.toLowerCase().includes(q) || i.keywords.includes(q)).sort((a, b) => (q ? slashRank(a) - slashRank(b) : 0))
      : [];

  // ---------------------------------------------------------------- page links
  const debounced = useDebounced(open?.kind === "page" ? open.query.trim() : "", 120);
  const searchResults = useQuery(api.search.documents, open?.kind === "page" && debounced ? { scope, query: debounced, limit: 8 } : "skip");
  const recent = useQuery(api.documents.recent, open?.kind === "page" && !debounced ? { scope, limit: 8 } : "skip");
  const pageItems: MenuItem[] = useMemo(() => {
    if (open?.kind !== "page") return [];
    if (env.demo) {
      // No pages to link to without an account.
      return [{ id: "__account", label: "Sign up to link your pages", keywords: "", icon: <FileText size={15} />, run: () => env.unavailable("Links to pages") }];
    }
    const docs = (debounced ? searchResults : recent) ?? [];
    const items: MenuItem[] = docs
      .filter((d) => d.id !== documentId)
      .map((d) => ({
        id: d.id,
        label: d.title || "Untitled",
        keywords: "",
        icon: <FileText size={15} />,
        run: () => void editor.chain().focus().insertContent({ type: "pageLink", attrs: { documentId: d.id, label: d.title || "Untitled" } }).insertContent(" ").run(),
      }));
    if (debounced) {
      items.push({ id: "__create", label: `Create page “${debounced}”`, keywords: "", icon: <Plus size={15} />, run: () => void createNestedPage(debounced, true) });
    }
    return items;
  }, [env, open?.kind, debounced, searchResults, recent, editor, documentId, createNestedPage]);

  // ---------------------------------------------------------------- mentions & dates
  const people = useQuery(api.comments.mentionable, open?.kind === "mention" ? { documentId } : "skip");
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
        hint: d.label === formatDate(d.date) ? undefined : formatDate(d.date),
        keywords: "",
        icon: <CalendarDays size={15} />,
        run: () => void editor.chain().focus().insertContent({ type: "dateMention", attrs: { date: d.date } }).insertContent(" ").run(),
      }));
    if (!mq || "pick a date".includes(mq) || "date".startsWith(mq)) {
      dateItems.push({ id: "date-pick", label: "Pick a date…", keywords: "", icon: <CalendarDays size={15} />, run: special.pickDate });
    }
    const peopleItems: MenuItem[] = (people ?? [])
      .filter((m) => !mq || m.displayName.toLowerCase().includes(mq))
      .slice(0, 8)
      .map((m) => ({
        id: m.profileId,
        label: m.displayName,
        hint: m.isYou ? "you" : m.guest ? "guest" : undefined,
        keywords: "",
        icon: <span className="text-xs font-semibold">{m.displayName.slice(0, 1)}</span>,
        run: () => void editor.chain().focus().insertContent({ type: "mention", attrs: { userId: m.profileId, label: m.displayName } }).insertContent(" ").run(),
      }));
    return [...peopleItems, ...dateItems];
  }, [open, people, today, editor, special.pickDate]);

  const items = open?.kind === "slash" ? filteredSlash : open?.kind === "page" ? pageItems : mentionItems;
  const menuLabel = open?.kind === "slash" ? "Insert block" : open?.kind === "page" ? "Link to page" : "Mention a person or date";

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
      // Keys that confirm or move an input method's composition belong to it, not to the menu.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setActive((a) => Math.max(0, Math.min(items.length - 1, a + 1)));
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

  // Combobox-style semantics on the editor while a suggestion list is open, so screen readers announce
  // the active option as it changes (aria-expanded isn't allowed on role=textbox; the list is linked
  // with aria-controls and the option with aria-activedescendant).
  const menuShown = Boolean(open && anchor);
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    if (!menuShown) {
      for (const a of ["aria-activedescendant", "aria-controls", "aria-autocomplete", "aria-haspopup"]) dom.removeAttribute(a);
      return;
    }
    dom.setAttribute("aria-autocomplete", "list");
    dom.setAttribute("aria-haspopup", "listbox");
    dom.setAttribute("aria-controls", listId);
    if (items.length) dom.setAttribute("aria-activedescendant", `${listId}-${Math.min(active, items.length - 1)}`);
    else dom.removeAttribute("aria-activedescendant");
  }, [editor, menuShown, listId, active, items.length]);
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    return () => {
      for (const a of ["aria-activedescendant", "aria-controls", "aria-autocomplete", "aria-haspopup"]) dom.removeAttribute(a);
    };
  }, [editor]);

  return (
    <>
      <Popover anchor={open ? anchor : null} label={menuLabel} role="presentation" scroll={false}>
        <ListMenu items={items} active={active} setActive={setActive} onRun={run} listId={listId} label={menuLabel} emptyLabel={open?.kind === "page" ? "Type to search pages" : "No matches"} />
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
      <UnsplashDialog
        open={unsplashOpen}
        onClose={() => {
          setUnsplashOpen(false);
          editor.view.focus();
        }}
        onPick={(photo) => {
          setUnsplashOpen(false);
          insertBlockAfterCurrent(editor, "image", {
            url: photo.url,
            alt: photo.alt || unsplashCredit(photo),
            caption: unsplashCredit(photo),
            naturalWidth: photo.width || null,
            naturalHeight: photo.height || null,
          });
        }}
      />
      <BookmarkPrompt
        open={bookmarkPrompt}
        onClose={() => {
          setBookmarkPrompt(false);
          editor.view.focus();
        }}
        onSubmit={(url) => {
          let host = url;
          try {
            host = new URL(url).host;
          } catch {
            /* keep */
          }
          setBookmarkPrompt(false);
          insertBlockAfterCurrent(editor, "bookmark", { url, title: host });
        }}
      />
      {recorderAnchor ? (
        <Popover anchor={recorderAnchor} label="Audio recording" width={320} scroll={false}>
          <AudioRecorder
            onSave={onInsertAudio}
            onClose={() => {
              setRecorderAnchor(null);
              editor.view.focus();
            }}
          />
        </Popover>
      ) : null}
      {datePicker && datePickerAnchor ? (
        <DatePopover
          editor={editor}
          anchor={datePickerAnchor}
          mode={datePicker}
          today={today}
          onClose={() => {
            setDatePicker(null);
            editor.view.focus();
          }}
        />
      ) : null}
      {editable && aiOn && inlineAi ? <InlineAi key={inlineAi.id} editor={editor} documentId={documentId} request={inlineAi} onClose={() => setInlineAi(null)} /> : null}
      <EditorContextMenu editor={editor} editable={editable} onCommentBlock={onCommentBlock} />
      {editable ? <SelectionBubble editor={editor} onComment={onCommentBlock} /> : null}
      {editable ? <BlockHandle editor={editor} onDropBlock={onDropBlock} onCommentBlock={onCommentBlock} /> : null}
      {editable ? <TaskDetails editor={editor} /> : null}
    </>
  );
}

function BookmarkPrompt({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (url: string) => void }) {
  const [value, setValue] = useState("https://");
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  useEffect(() => {
    if (open) {
      setValue("https://");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a bookmark"
      size="sm"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            Add bookmark
          </Button>
        </>
      }
    >
      <form
        id={formId}
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
        <label htmlFor={`${formId}-url`} className="text-sm font-medium">
          Web address
        </label>
        <input
          id={`${formId}-url`}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 h-10 w-full ui-input rounded-[6px] px-4"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${formId}-err` : undefined}
        />
        {error ? (
          <p id={`${formId}-err`} className="mt-1 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Picks a date to insert, or changes/removes an existing date mention. */
function DatePopover({ editor, anchor, mode, today, onClose }: { editor: Editor; anchor: Anchor; mode: { mode: "insert" } | { mode: "edit"; pos: number }; today: string; onClose: () => void }) {
  const current = mode.mode === "edit" ? editor.state.doc.nodeAt(mode.pos) : null;
  const initial = current?.type.name === "dateMention" ? String(current.attrs.date) : null;
  const apply = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    if (mode.mode === "insert") {
      editor.chain().focus().insertContent({ type: "dateMention", attrs: { date: value } }).insertContent(" ").run();
    } else {
      const node = editor.state.doc.nodeAt(mode.pos);
      if (node?.type.name === "dateMention") editor.view.dispatch(editor.state.tr.setNodeMarkup(mode.pos, undefined, { ...node.attrs, date: value }));
      editor.view.focus();
    }
    onClose();
  };
  const remove = () => {
    if (mode.mode !== "edit") return;
    const node = editor.state.doc.nodeAt(mode.pos);
    if (node?.type.name === "dateMention") editor.view.dispatch(editor.state.tr.delete(mode.pos, mode.pos + node.nodeSize));
    onClose();
  };
  if (mode.mode === "edit" && current?.type.name !== "dateMention") return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} aria-hidden />
      <Popover
        anchor={anchor}
        label={mode.mode === "insert" ? "Insert a date" : "Change date"}
        width={266}
        scroll={false}
        follow={() => {
          try {
            const c = editor.view.coordsAtPos(mode.mode === "edit" ? mode.pos : editor.state.selection.from);
            return { left: c.left, top: c.top, bottom: c.bottom };
          } catch {
            return null;
          }
        }}
      >
        <div
          className="grid gap-2.5 p-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        >
          <Calendar value={initial} today={today} onPick={apply} autoFocus />
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              ["Today", today],
              ["Tomorrow", addDays(today, 1)],
              ["Next week", addDays(today, 7)],
            ].map(([label, date]) => (
              <button key={label} type="button" className="ui-chip ui-raised text-ink" onClick={() => apply(date!)} aria-pressed={initial === date}>
                {label}
              </button>
            ))}
            {mode.mode === "edit" ? (
              <button type="button" className="ui-btn ui-btn-quiet ml-auto h-7 px-2.5 text-xs text-danger" onClick={remove}>
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </Popover>
    </>
  );
}

/**
 * Floating formatting toolbar for a text selection. Reachable from the keyboard: Alt+F10 moves focus
 * into it (←/→ between buttons, Escape back to the text); ⌘⇧K (Ctrl+Shift+K) edits the link directly,
 * also with no selection (the address is inserted as a link).
 */
function SelectionBubble({ editor, onComment }: { editor: Editor; onComment?: (blockId: string) => void }) {
  // The note style's text colours and highlights (its own names), when it has them.
  const palette = useNotePalette();
  const aiOn = useAiEnabled();
  // The selection's box: centre x, top and bottom. The toolbar sits above it (below near the top of the window).
  const [state, setState] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const [mode, setMode] = useState<"marks" | "link" | "colors">("marks");
  // While the link field has focus the browser stops showing the text selection: keep it looking selected.
  useEffect(() => {
    if (mode !== "link" || editor.isDestroyed) return;
    const { from, to, empty } = editor.state.selection;
    if (!empty) setRangeHighlight(editor.view, { from, to });
    return () => {
      if (!editor.isDestroyed) setRangeHighlight(editor.view, null);
    };
  }, [mode, editor]);
  const [, rerender] = useState(0);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkErrorId = useId();
  const forced = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  useShowInTopLayer(Boolean(state), ref);
  // The link field takes focus once the toolbar is showing (autoFocus would fire while it's still hidden).
  useLayoutEffect(() => {
    if (mode !== "link" || !state || !placed) return;
    const input = ref.current?.querySelector<HTMLInputElement>('input[aria-label="Link address"]');
    if (input && document.activeElement !== input) input.focus();
  }, [mode, state, placed]);

  const position = useCallback(() => {
    const { selection } = editor.state;
    try {
      const start = editor.view.coordsAtPos(selection.from);
      const end = editor.view.coordsAtPos(selection.to);
      return { left: (start.left + end.left) / 2, top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
    } catch {
      return null;
    }
  }, [editor]);

  const close = useCallback(() => {
    forced.current = false;
    setMode("marks");
    setLinkError(null);
    setState(null);
  }, []);

  const update = useCallback(() => {
    // Keep the toolbar while focus is inside it (keyboard use, the link field).
    if (ref.current?.contains(document.activeElement)) return;
    const { selection } = editor.state;
    const textSelection = !selection.empty && selection.$from.parent.isTextblock && selection.$from.parent.type.name !== "codeBlock";
    if (!editor.isFocused || (!textSelection && !forced.current)) {
      close();
      return;
    }
    if (!forced.current) setMode((m) => (m === "link" && !textSelection ? "marks" : m));
    setState(position());
  }, [editor, position, close]);

  // Measured once it renders: kept inside the window, flipped below the text when there's no room above.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!state || !el) {
      setPlaced(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, state.left - w / 2), window.innerWidth - w - 8);
    const top = state.top - h - 8 >= 8 ? state.top - h - 8 : state.bottom + 8;
    setPlaced({ left, top });
  }, [state, mode]);

  // Pressed states follow every change (⌘B, undo…); the toolbar follows the text when the page scrolls.
  useEffect(() => {
    if (!state) return;
    const onTr = () => rerender((n) => n + 1);
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      const p = position();
      if (p) setState(p);
    };
    editor.on("transaction", onTr);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      editor.off("transaction", onTr);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editor, state !== null, position]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const onBlur = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(update, 120);
    };
    const onSelection = () => {
      forced.current = false;
      update();
    };
    editor.on("selectionUpdate", onSelection);
    editor.on("focus", update);
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", onSelection);
      editor.off("focus", update);
      editor.off("blur", onBlur);
      if (blurTimer) clearTimeout(blurTimer);
    };
  }, [editor, update]);

  const openLink = useCallback(() => {
    setHref(String(editor.getAttributes("link").href ?? ""));
    setLinkError(null);
    setMode("link");
  }, [editor]);

  // Keyboard entry points.
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && !e.altKey && e.code === "KeyK") {
        // Not the command palette (⌘K): stop it reaching the window-level shortcut handler.
        e.preventDefault();
        e.stopPropagation();
        syncDomSelection(editor.view);
        if (editor.state.selection.$from.parent.type.name === "codeBlock") return;
        forced.current = true;
        setState(position());
        openLink();
      } else if (e.altKey && e.key === "F10") {
        syncDomSelection(editor.view);
        const { selection } = editor.state;
        if (selection.empty) return;
        e.preventDefault();
        e.stopPropagation();
        forced.current = true;
        focusFirst.current = true;
        setMode("marks");
        setState(position());
      }
    };
    // "Edit link…" / "Link…" in the right-click menu.
    const onEditLink = () => {
      if (editor.state.selection.$from.parent.type.name === "codeBlock") return;
      forced.current = true;
      setState(position());
      openLink();
    };
    dom.addEventListener("keydown", onKey);
    dom.addEventListener(EDIT_LINK_EVENT, onEditLink);
    return () => {
      dom.removeEventListener("keydown", onKey);
      dom.removeEventListener(EDIT_LINK_EVENT, onEditLink);
    };
  }, [editor, position, openLink]);

  useEffect(() => {
    if (focusFirst.current && state && placed && ref.current) {
      focusFirst.current = false;
      // In the colours row the first colour, not the Back button.
      const first = mode === "colors" ? ref.current.querySelector<HTMLElement>('button[aria-label^="Text color"]') : null;
      (first ?? ref.current.querySelector<HTMLElement>("button, input"))?.focus();
    }
  }, [state, mode, placed]);

  if (!state) return null;

  const back = () => {
    close();
    editor.view.focus();
  };
  const roving = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (mode !== "marks" && !forced.current) {
        focusFirst.current = true;
        setMode("marks");
      } else back();
      return;
    }
    if (e.key === "Tab") {
      // The toolbar floats outside the page flow: Tab returns to the text.
      e.preventDefault();
      back();
      return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (!buttons.length) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]!.focus();
  };
  const afterAction = () => {
    // Keyboard users who came in with Alt+F10 go back to the text; pointer users keep the toolbar.
    if (ref.current?.contains(document.activeElement)) back();
  };
  const btn = (label: string, isActive: boolean, onClick: () => void, icon: React.ReactNode, pressable = true) => (
    <button
      type="button"
      aria-label={withKeyLabels(label)}
      title={withKeyLabels(label)}
      aria-pressed={pressable ? isActive : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        // Formatting applied from the keyboard (⌥F10) returns to the text; mode switches keep focus here.
        if (pressable || label === "Clear formatting") afterAction();
      }}
      className={`grid h-8 w-8 place-items-center rounded-[6px] transition-colors focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none ${isActive ? "bg-accent-soft text-heading shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_25%,transparent)]" : "text-muted hover:bg-accent-soft hover:text-heading"}`}
    >
      {icon}
    </button>
  );
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="horizontal"
      popover="manual"
      className="z-[100] ui-pop max-w-[calc(100vw-16px)] rounded-[8px] border-0 p-1 text-ink animate-[folio-rise_120ms_var(--ease-folio)]"
      style={{ position: "fixed", margin: 0, right: "auto", bottom: "auto", left: placed?.left ?? 0, top: placed?.top ?? 0, visibility: placed ? "visible" : "hidden" }}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onKeyDown={roving}
    >
      {mode === "link" ? (
        <form
          className="flex max-w-[22rem] flex-wrap items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!href.trim()) {
              if (editor.isActive("link")) removeLink(editor);
              close();
              return;
            }
            if (!applyLink(editor, href)) {
              setLinkError("That doesn’t look like a web address.");
              return;
            }
            close();
          }}
        >
          <input
            value={href}
            onChange={(e) => {
              setHref(e.target.value);
              setLinkError(null);
            }}
            placeholder="Paste or type a link"
            aria-label="Link address"
            aria-invalid={Boolean(linkError)}
            aria-describedby={linkError ? linkErrorId : undefined}
            className={`ui-input h-8 w-60 rounded-[6px] px-3 text-sm ${linkError ? "shadow-[0_0_0_1.5px_var(--color-danger)]" : ""}`}
          />
          <button type="submit" className="ui-btn ui-btn-primary h-8 px-3 text-xs">
            Apply
          </button>
          {editor.isActive("link") ? (
            <button
              type="button"
              className="ui-btn ui-btn-quiet h-8 px-2.5 text-xs"
              onClick={() => {
                removeLink(editor);
                close();
              }}
            >
              Remove
            </button>
          ) : null}
          {linkError ? (
            <span id={linkErrorId} role="alert" className="basis-full px-1 pb-0.5 pt-1 text-xs text-danger">
              {linkError}
            </span>
          ) : null}
        </form>
      ) : mode === "colors" ? (
        <div className="flex items-center gap-1 p-0.5" {...palette?.attrs}>
          <button
            type="button"
            aria-label="Back to formatting"
            title="Back"
            onClick={() => {
              if (ref.current?.contains(document.activeElement)) focusFirst.current = true;
              setMode("marks");
            }}
            className="grid h-7 w-7 place-items-center rounded-[6px] text-muted hover:bg-accent-soft hover:text-heading focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none"
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Text color: ${colorName(palette, c)}`}
              aria-pressed={editor.isActive("textColor", { value: c })}
              onClick={() => {
                setTextColor(editor, c);
                afterAction();
              }}
              className="grid h-7 w-7 place-items-center rounded-[6px] hover:bg-accent-soft focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none"
            >
              <span className={`fb-color-${c} text-sm font-semibold`} aria-hidden>
                A
              </span>
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {HIGHLIGHT_COLORS.map((h) => (
            <button
              key={h}
              type="button"
              aria-label={`Highlight: ${colorName(palette, h)}`}
              aria-pressed={editor.isActive("highlight", { value: h })}
              onClick={() => {
                setHighlight(editor, h);
                afterAction();
              }}
              className="grid h-7 w-7 place-items-center rounded-[6px] hover:bg-accent-soft focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none"
            >
              <span className={`fb-hl-${h} fb-swatch h-4 w-4 rounded-[3px]`} aria-hidden />
            </button>
          ))}
          <button
            type="button"
            className="ui-btn ui-btn-quiet h-7 px-2.5 text-xs"
            onClick={() => {
              editor.chain().unsetMark("textColor").unsetMark("highlight").run();
              afterAction();
            }}
          >
            Reset
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          {btn("Bold (⌘B)", editor.isActive("bold"), () => editor.chain().toggleMark("bold").run(), <Bold size={15} />)}
          {btn("Italic (⌘I)", editor.isActive("italic"), () => editor.chain().toggleMark("italic").run(), <Italic size={15} />)}
          {btn("Underline (⌘U)", editor.isActive("underline"), () => editor.chain().toggleMark("underline").run(), <Underline size={15} />)}
          {btn("Strikethrough (⌘⇧X)", editor.isActive("strike"), () => editor.chain().toggleMark("strike").run(), <Strikethrough size={15} />)}
          {btn("Inline code (⌘E)", editor.isActive("code"), () => editor.chain().toggleMark("code").run(), <Code2 size={15} />)}
          {btn("Link (⌘⇧K)", editor.isActive("link"), openLink, <LinkIcon size={15} />)}
          {btn(
            "Color and highlight",
            false,
            () => {
              if (ref.current?.contains(document.activeElement)) focusFirst.current = true;
              setMode("colors");
            },
            <Palette size={15} />,
            false,
          )}
          {btn("Highlight (⌘⇧H)", editor.isActive("highlight"), () => editor.chain().toggleMark("highlight", { value: "yellow" }).run(), <Highlighter size={15} />)}
          {btn("Clear formatting", false, () => clearFormatting(editor), <Eraser size={15} />, false)}
          {aiOn ? <span className="mx-0.5 h-5 w-px bg-line" aria-hidden /> : null}
          {aiOn && btn(
            "Ask AI (⌘J)",
            false,
            () => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, "\n");
              setState(null);
              openInlineAi(editor.view.dom, { target: text.trim() ? { from, to, text } : null });
            },
            <AiIcon size={15} className="text-[#7c6cf0]" />,
            false,
          )}
          {onComment ? (
            <>
              <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
              {btn(
                "Comment on this block",
                false,
                () => {
                  const id = editor.state.selection.$from.node(1)?.attrs.id as string | undefined;
                  if (id) onComment(id);
                },
                <MessageSquare size={15} />,
                false,
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

const TURN_INTO = [
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
] as const;

/**
 * Hover gutter with a drag handle and block menu. The menu is also reachable from the keyboard with
 * ⌘. (Ctrl+.): focus moves into it, ↑/↓ move between items, Escape returns to the text. With several
 * blocks selected (Shift-click grips, Shift+↑/↓, Escape) its actions apply to all of them.
 */
function BlockHandle({ editor, onDropBlock, onCommentBlock }: { editor: Editor; onDropBlock: (from: number, to: number, depth: number) => { index: number; count: number } | null; onCommentBlock?: (blockId: string) => void }) {
  const aiOn = useAiEnabled();
  const [hover, setHover] = useState<{ index: number; top: number; left: number; height: number } | null>(null);
  const [menu, setMenu] = useState<{ from: number; to: number; left: number; top: number; bottom: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const justDragged = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onMove = (e: MouseEvent) => {
      if (menu || isDragging()) return;
      const children = blockElements(dom);
      const idx = children.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2 && !c.classList.contains("fb-hidden");
      });
      if (idx < 0) return;
      const line = handleLine(children[idx]!);
      setHover({ index: idx, top: line.top, left: blockIndentLeft(children[idx]!), height: line.height });
    };
    const parent = dom.parentElement?.parentElement ?? dom;
    parent.addEventListener("mousemove", onMove);
    return () => parent.removeEventListener("mousemove", onMove);
  }, [editor, menu]);

  useEffect(() => {
    const onScroll = () => setHover(null);
    window.addEventListener("scroll", onScroll, true);
    // Any change to the note can move or remove the hovered block: the handle reappears on the next move.
    const onUpdate = () => setHover(null);
    editor.on("update", onUpdate);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      editor.off("update", onUpdate);
    };
  }, [editor]);

  // Announce block selections to screen readers.
  useEffect(() => {
    const on = () => {
      const range = blockSelectionRange(editor.state);
      setSelectedCount(range ? range.to - range.from + 1 : 0);
    };
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor]);

  const openMenuFor = useCallback(
    (from: number, to: number, left?: number) => {
      const el = blockDom(editor, from);
      const r = el?.getBoundingClientRect();
      if (!el || !r) return;
      setMenu({ from, to, left: left ?? blockIndentLeft(el), top: r.top, bottom: r.top + 24 });
    },
    [editor],
  );

  // Keyboard: ⌘. / Ctrl+. opens the block menu for the current block (or every selected block).
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === ".") {
        e.preventDefault();
        syncDomSelection(editor.view);
        const refs = blocksInSelection(editor.state);
        openMenuFor(refs[0]!.index, refs[refs.length - 1]!.index);
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor, openMenuFor]);

  // Focus moves into the menu when it opens.
  useEffect(() => {
    if (!menu) return;
    const id = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => cancelAnimationFrame(id);
  }, [menu]);

  const closeMenu = useCallback(
    (refocus = true) => {
      setMenu(null);
      if (refocus) editor.view.focus();
    },
    [editor],
  );

  const selectTargets = (from: number, to: number) => {
    if (from !== to) {
      setBlockSelection(editor.view, from, to);
      return;
    }
    clearBlockSelection(editor.view);
    let pos = 0;
    for (let i = 0; i < from; i++) pos += editor.state.doc.child(i).nodeSize;
    const node = editor.state.doc.child(from);
    if (node.isTextblock) editor.chain().focus().setTextSelection({ from: pos + 1, to: pos + 1 + node.content.size }).run();
    else editor.chain().focus().setNodeSelection(pos).run();
  };

  const act = (fn: () => void) => {
    if (!menu) return;
    editor.view.focus();
    selectTargets(menu.from, menu.to);
    fn();
    // The block's text was selected only so the action applied to it: leave a caret at its end, so the
    // next key typed doesn't replace the text.
    const { selection } = editor.state;
    if (!blockSelectionRange(editor.state) && !selection.empty && !(selection instanceof NodeSelection)) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(selection.$head)).setMeta("addToHistory", false));
    }
    closeMenu();
  };

  const count = menu ? menu.to - menu.from + 1 : 0;
  const nodes = menu ? Array.from({ length: count }, (_, i) => editor.state.doc.maybeChild(menu.from + i)).filter((n): n is NonNullable<typeof n> => Boolean(n)) : [];
  const single = count === 1 ? nodes[0] : null;
  const anyText = nodes.some((n) => n.isTextblock);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => items[(n + items.length) % items.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        focus(i + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        focus(i - 1);
        break;
      case "Home":
        e.preventDefault();
        focus(0);
        break;
      case "End":
        e.preventDefault();
        focus(items.length - 1);
        break;
      case "Escape":
      case "Tab":
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        break;
    }
  };

  const itemClass = "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-accent-soft hover:text-heading focus:bg-accent-soft focus:text-heading focus:outline-none";

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {selectedCount ? `${selectedCount} block${selectedCount === 1 ? "" : "s"} selected` : ""}
      </p>
      {hover && !menu && !dragging ? (
        <div
          className="ui-raised fixed z-30 flex items-center gap-px rounded-[8px] p-0.5 opacity-90 transition-opacity hover:opacity-100 animate-[folio-rise_120ms_var(--ease-folio)]"
          // Kept on screen when the note runs to the window's edge (narrow windows, phones).
          style={{ top: hover.top + Math.max(0, (hover.height - 28) / 2), left: Math.max(4, hover.left - 58) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            aria-label="Insert block below"
            className="grid h-6 w-6 place-items-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading"
            onClick={() => {
              if (hover.index >= editor.state.doc.childCount) return;
              clearBlockSelection(editor.view);
              // Below the block and anything nested under it.
              const at = subtreeRange(editor.state, hover.index).end;
              const depth = editor.state.doc.child(hover.index).attrs.depth;
              editor.chain().insertContentAt(at, { type: "paragraph", attrs: { id: ulid(), depth } }).focus(at + 1).insertContent("/").run();
            }}
          >
            <Plus size={14} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Drag to move, click for block options, Shift-click to select several blocks"
            className="grid h-6 w-5 cursor-grab touch-none place-items-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading active:cursor-grabbing"
            onPointerDown={(e) => {
              if (e.button !== 0 || e.shiftKey) return;
              e.preventDefault();
              const index = hover.index;
              beginPointerDrag({
                editor,
                payload: { kind: "block", index },
                event: e,
                onStart: () => {
                  justDragged.current = true;
                  clearBlockSelection(editor.view);
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
            onContextMenu={(e) => {
              e.preventDefault();
              const range = blockSelectionRange(editor.state);
              if (range && hover.index >= range.from && hover.index <= range.to) openMenuFor(range.from, range.to, hover.left - 40);
              else {
                clearBlockSelection(editor.view);
                openMenuFor(hover.index, hover.index, hover.left - 40);
              }
            }}
            onClick={(e) => {
              if (justDragged.current || hover.index >= editor.state.doc.childCount) return;
              if (e.shiftKey) {
                editor.view.focus();
                extendBlockSelectionTo(editor.view, hover.index);
                return;
              }
              const range = blockSelectionRange(editor.state);
              if (range && hover.index >= range.from && hover.index <= range.to) openMenuFor(range.from, range.to, hover.left - 40);
              else {
                clearBlockSelection(editor.view);
                openMenuFor(hover.index, hover.index, hover.left - 40);
              }
            }}
          >
            <GripVertical size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      {menu ? (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => closeMenu(false)} aria-hidden />
          <Popover anchor={menu} label="Block options" width={240} popRef={menuRef} tall>
            <div className="p-1 text-sm" role="menu" aria-label={count > 1 ? `Options for ${count} blocks` : "Block options"} onKeyDown={onMenuKey}>
              {count > 1 ? <p className="px-2 pb-1 pt-0.5 text-xs text-muted">{count} blocks selected</p> : null}
              {anyText ? (
                <>
                  <p className="ui-caps px-2 pb-1.5 pt-1" aria-hidden>
                    Turn into
                  </p>
                  <div className="grid grid-cols-2 gap-0.5" role="group" aria-label="Turn into">
                    {TURN_INTO.map(([type, label, attrs]) => (
                      <button key={label} type="button" role="menuitem" tabIndex={-1} className={`${itemClass} !w-auto`} onClick={() => act(() => turnInto(editor, type, attrs))}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mx-2 my-1.5 h-px bg-line" role="separator" />
                </>
              ) : null}
              {[
                ...(aiOn && anyText
                  ? [
                      {
                        label: "Ask AI…",
                        hint: "⌘J",
                        icon: <AiIcon size={14} className="text-[#7c6cf0]" />,
                        run: () => {
                          if (!menu) return;
                          // The text of the chosen blocks, as one range.
                          let from = 0;
                          let to = 0;
                          editor.state.doc.forEach((node, offset, index) => {
                            if (index === menu.from) from = offset + 1;
                            if (index === menu.from + count - 1) to = offset + node.nodeSize - 1;
                          });
                          const text = editor.state.doc.textBetween(from, to, "\n");
                          clearBlockSelection(editor.view);
                          closeMenu(false);
                          if (text.trim()) openInlineAi(editor.view.dom, { target: { from, to, text } });
                        },
                      },
                    ]
                  : []),
                ...(onCommentBlock && single?.attrs.id
                  ? [
                      {
                        label: "Comment",
                        hint: "⌘⌥M",
                        icon: <MessageSquare size={14} />,
                        run: () => {
                          onCommentBlock(single.attrs.id as string);
                          closeMenu(false);
                        },
                      },
                    ]
                  : []),
                { label: "Duplicate", hint: "⌘D", icon: <CopyPlus size={14} />, run: () => act(() => duplicateBlocks(editor)) },
                { label: "Move up", hint: "⌥⇧↑", icon: <MoveUp size={14} />, run: () => act(() => moveBlock(editor, -1)) },
                { label: "Move down", hint: "⌥⇧↓", icon: <MoveDown size={14} />, run: () => act(() => moveBlock(editor, 1)) },
                { label: "Indent", hint: "Tab", icon: <IndentIncrease size={14} />, run: () => act(() => changeDepth(editor, 1)) },
                { label: "Outdent", hint: "⇧Tab", icon: <IndentDecrease size={14} />, run: () => act(() => changeDepth(editor, -1)) },
                ...(single
                  ? [
                      {
                        label: "Copy link to block",
                        hint: "",
                        icon: <Link2 size={14} />,
                        run: () => {
                          const url = `${location.origin}${location.pathname}#block-${single.attrs.id}`;
                          navigator.clipboard.writeText(url).then(
                            () => toast.show("Link copied"),
                            () => toast.show("Couldn’t copy the link. Your browser blocked clipboard access.", { tone: "error" }),
                          );
                          closeMenu();
                        },
                      },
                    ]
                  : []),
                {
                  label: count > 1 ? `Delete ${count} blocks` : "Delete block",
                  hint: "⌘⇧⌫",
                  icon: <Trash2 size={14} />,
                  danger: true,
                  run: () => {
                    if (!menu) return;
                    const indices = Array.from({ length: count }, (_, i) => menu.from + i);
                    clearBlockSelection(editor.view);
                    deleteBlocks(editor, indices);
                    closeMenu();
                  },
                },
              ].map((item) => (
                <button key={item.label} type="button" role="menuitem" tabIndex={-1} onClick={item.run} className={`${itemClass} ${"danger" in item && item.danger ? "text-danger" : ""}`}>
                  <span className="text-muted" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  <span className="text-xs text-faint">{keyLabel(item.hint)}</span>
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
  // Tracked by block id (not position) so edits elsewhere in the page can't retarget the popover.
  const [target, setTarget] = useState<{ blockId: string; left: number; top: number; bottom: number } | null>(null);
  const [, rerender] = useState(0);
  const members = useQuery(api.workspaces.members, target && workspace ? { workspaceId: workspace.id } : "skip");
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const on = (e: Event) => {
      const detail = (e as CustomEvent<{ pos: number; blockId: string; anchor: HTMLElement }>).detail;
      const r = detail.anchor.getBoundingClientRect();
      if (detail.blockId) setTarget({ blockId: detail.blockId, left: r.left, top: r.top, bottom: r.bottom });
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
          setTarget({ blockId: String($from.node(1).attrs.id), left: c.left, top: c.top, bottom: c.bottom });
        }
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("folevi:task-details", on);
      dom.removeEventListener("keydown", onKey);
    };
  }, [editor]);
  // Re-render on every editor change so the fields always show the block's current values.
  useEffect(() => {
    if (!target) return;
    const on = () => rerender((n) => n + 1);
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor, target]);
  if (!target) return null;
  const find = () => {
    let found: { pos: number; node: NonNullable<ReturnType<typeof editor.state.doc.maybeChild>> } | null = null;
    editor.state.doc.forEach((n, offset) => {
      if (!found && n.attrs.id === target.blockId) found = { pos: offset, node: n };
    });
    return found as { pos: number; node: NonNullable<ReturnType<typeof editor.state.doc.maybeChild>> } | null;
  };
  const current = find();
  if (!current || current.node.type.name !== "todo") return null;
  const node = current.node;
  // Always patch the latest attrs (rapid successive edits must not overwrite each other).
  const set = (patch: Record<string, unknown>) => {
    const latest = find();
    if (!latest || latest.node.type.name !== "todo") return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(latest.pos, undefined, { ...latest.node.attrs, ...patch }));
  };
  const close = () => {
    setTarget(null);
    editor.commands.focus();
  };
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={() => setTarget(null)} aria-hidden />
      <Popover
        anchor={target}
        label="Task details"
        width={300}
        follow={() => {
          const at = find();
          if (!at) return null;
          const el = editor.view.nodeDOM(at.pos);
          const r = (el instanceof HTMLElement ? (el.querySelector(".fb-due-chip") ?? el.querySelector(".fb-content") ?? el) : null)?.getBoundingClientRect();
          return r ? { left: Math.min(target.left, r.right), top: r.top, bottom: r.bottom } : null;
        }}
      >
        <form
          className="grid gap-3 p-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            close();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        >
          <div className="grid gap-1">
            <span className="text-xs text-muted">Due</span>
            <span className="grid grid-cols-[1fr_auto] gap-1.5">
              <DateField
                autoFocus
                value={(node.attrs.dueDate as string) ?? ""}
                onChange={(v) => set(v ? { dueDate: v } : { dueDate: null, dueTime: null })}
                aria-label="Due date"
              />
              <TimeField value={(node.attrs.dueTime as string) ?? ""} onChange={(v) => set({ dueTime: v || null })} disabled={!node.attrs.dueDate} emptyLabel="All day" aria-label="Due time" />
            </span>
          </div>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Priority</span>
            <Select value={(node.attrs.priority as string) ?? "none"} onChange={(e) => set({ priority: e.target.value === "none" ? null : e.target.value })} className="h-8 ui-input rounded-[6px] px-3">
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </label>
          {members && members.members.length > 1 ? (
            <label className="grid gap-1">
              <span className="text-xs text-muted">Assignee</span>
              <Select value={(node.attrs.assigneeId as string) ?? ""} onChange={(e) => set({ assigneeId: e.target.value || null })} className="h-8 ui-input rounded-[6px] px-3">
                <option value="">Unassigned</option>
                {members.members.map((m) => (
                  <option key={m.profileId} value={m.profileId}>
                    {m.displayName}
                    {m.isYou ? " (you)" : ""}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <div className="grid gap-1">
            <span className="text-xs text-muted">Reminder</span>
            <DateTimeField value={(node.attrs.reminderAt as number | null) ?? null} onChange={(ts) => set({ reminderAt: ts })} aria-label="Reminder" />
          </div>
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
