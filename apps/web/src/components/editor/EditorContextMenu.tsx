"use client";

// The note's right-click menu: actions for what's under the pointer (a link, a page link, a date, an image,
// a to-do, a toggle, code), the clipboard, text formatting and the block itself, with "Turn into", "Insert
// below" and colour submenus. Also opens with the context-menu key or Shift+F10. Shift-right-click keeps the
// browser's own menu (spelling suggestions live there).
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { visibleBottom } from "@/lib/hooks/useVisualViewport";
import {
  Bold,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  ClipboardType,
  Code2,
  Copy,
  CopyPlus,
  FoldVertical,
  Eraser,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  MessageSquare,
  Minus,
  MoveDown,
  MoveUp,
  Palette,
  Pencil,
  Plus,
  Quote,
  Repeat2,
  Scissors,
  SquareCheck,
  Square,
  StickyNote,
  Strikethrough,
  Table2,
  Trash2,
  Type,
  Underline,
  Unlink,
  X,
} from "lucide-react";
import { CODE_LANGUAGES } from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { openInlineAi, useAiEnabled } from "@/components/ai/useAi";
import { useToast } from "@/components/ui/Toast";
import { useAppRouter } from "@/lib/app/router";
import { emptyTableRows, focusInsideBlock, HIGHLIGHT_COLORS, TEXT_COLORS, blocksInSelection, changeDepth, clearFormatting, deleteBlocks, duplicateBlocks, insertBlockAt, moveBlock, removeLink, selectedSpan, setHighlight, setTextColor, turnInto } from "./commands";
import { blockSelectionRange, clearBlockSelection } from "./blockSelection";
import { syncDomSelection } from "./blockSelectionState";
import { blockElements } from "./plugins";
import { colorName, useNotePalette } from "./notePalette";
import { EDIT_BOOKMARK_EVENT } from "./NodeViews";
import { keyLabel } from "@/lib/shortcuts";
import { isLongPress } from "@/lib/touchContextMenu";

/** Asks the selection toolbar to open its link field (the "Edit link…" item). */
export const EDIT_LINK_EVENT = "folevi:edit-link";

interface Item {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
}
interface Sub {
  label: string;
  icon?: ReactNode;
  items: Entry[];
}
type Entry = Item | Sub | "separator";

const isSub = (e: Entry): e is Sub => typeof e !== "string" && "items" in e;

const LANGUAGE_NAMES: Record<string, string> = {
  plaintext: "Plain text",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  graphql: "GraphQL",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  latex: "LaTeX",
  php: "PHP",
  sql: "SQL",
  toml: "TOML",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};
const languageName = (lang: string) => LANGUAGE_NAMES[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);

/** What the pointer was on when the menu opened. */
interface Target {
  /** Top-level block index. */
  index: number;
  link: { href: string } | null;
  pageLink: { documentId: string } | null;
  date: { pos: number } | null;
  image: { src: string } | null;
}

const TURN_INTO: [string, string, Record<string, unknown>, ReactNode][] = [
  ["paragraph", "Text", {}, <Type key="i" size={14} />],
  ["heading", "Heading 1", { level: 1 }, <Heading1 key="i" size={14} />],
  ["heading", "Heading 2", { level: 2 }, <Heading2 key="i" size={14} />],
  ["heading", "Heading 3", { level: 3 }, <Heading3 key="i" size={14} />],
  ["todo", "To-do", { checked: false }, <SquareCheck key="i" size={14} />],
  ["bulleted", "Bulleted list", {}, <List key="i" size={14} />],
  ["numbered", "Numbered list", {}, <ListOrdered key="i" size={14} />],
  ["toggle", "Toggle", { collapsed: false }, <ChevronRight key="i" size={14} />],
  ["quote", "Quote", {}, <Quote key="i" size={14} />],
  ["callout", "Callout", { tone: "note" }, <StickyNote key="i" size={14} />],
  ["code", "Code", { language: "plaintext" }, <Code2 key="i" size={14} />],
];

const INSERT_BELOW: [string, string, Record<string, unknown>, ReactNode][] = [
  ...TURN_INTO,
  ["divider", "Divider", {}, <Minus key="i" size={14} />],
  ["table", "Table", { headerRow: true }, <Table2 key="i" size={14} />],
];

export function EditorContextMenu({ editor, editable, onCommentBlock }: { editor: Editor; editable: boolean; onCommentBlock?: (blockId: string) => void }) {
  // `y` is where the menu opens downward from; `top` (the caret line's top, from the keyboard) is where it
  // ends when it opens upward, so it never covers the line.
  const [menu, setMenu] = useState<{ x: number; y: number; top: number; target: Target; keyboard: boolean } | null>(null);
  const aiOn = useAiEnabled();
  const toast = useToast();
  const palette = useNotePalette();
  const { navigate } = useAppRouter();

  const targetAt = useCallback(
    (pos: number, el: HTMLElement | null): Target => {
      const { state } = editor;
      const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
      const index = Math.min($pos.index(0), state.doc.childCount - 1);
      const linkMark = $pos.marks().find((m) => m.type.name === "link") ?? $pos.nodeAfter?.marks.find((m) => m.type.name === "link");
      const pageEl = el?.closest<HTMLElement>("a[data-page-link]");
      const dateEl = el?.closest<HTMLElement>("time[data-date]");
      const img = (el?.closest<HTMLElement>("[data-block-id]") ?? blockElements(editor.view.dom as HTMLElement)[index])?.querySelector("img");
      return {
        index,
        link: linkMark ? { href: String(linkMark.attrs.href ?? "") } : null,
        pageLink: pageEl ? { documentId: pageEl.getAttribute("data-page-link") ?? "" } : null,
        date: dateEl ? { pos: editor.view.posAtDOM(dateEl, 0) } : null,
        image: img?.src ? { src: img.src } : null,
      };
    },
    [editor],
  );

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onContext = (e: MouseEvent) => {
      // Shift-right-click: the browser's own menu (spelling suggestions). Fields inside blocks keep theirs too.
      if (e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [data-native-menu]")) return;
      syncDomSelection(editor.view);
      const { state, view } = editor;
      const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
      let pos = hit?.pos ?? null;
      if (pos === null) {
        // Beside the text (the gutter): the block on that line.
        const blocks = blockElements(dom);
        const i = blocks.findIndex((b) => {
          const r = b.getBoundingClientRect();
          return e.clientY >= r.top && e.clientY <= r.bottom;
        });
        if (i < 0) return;
        pos = 0;
        for (let k = 0; k < i; k++) pos += state.doc.child(k).nodeSize;
        pos += 1;
      }
      e.preventDefault();
      const atomPos = hit && hit.inside >= 0 ? hit.inside : null;
      const atom = atomPos !== null ? state.doc.nodeAt(atomPos) : null;
      const target = targetAt(atom?.isAtom ? atomPos! : pos, el);
      const range = blockSelectionRange(state);
      const sel = state.selection;
      const keep =
        (range && target.index >= range.from && target.index <= range.to) ||
        // Inside the selected text (its edges count); a selected block only when the click is within it
        // (its end is the start of the next block).
        (!sel.empty && !(sel instanceof NodeSelection) && pos >= sel.from && pos <= sel.to) ||
        (sel instanceof NodeSelection && (atomPos === sel.from || (pos > sel.from && pos < sel.to)));
      // A folded Mermaid diagram (its picture, not its source): the block is selected and stays folded.
      const diagram = el?.closest(".fb-mermaid-preview, .fb-mermaid-bar") ? view.state.doc.resolve(pos) : null;
      const diagramPos = diagram && diagram.depth >= 1 ? diagram.before(1) : null;
      if (!keep) {
        clearBlockSelection(view);
        const tr = view.state.tr;
        if (diagramPos !== null) tr.setSelection(NodeSelection.create(tr.doc, diagramPos));
        else if (atom && atom.isAtom && atomPos !== null) tr.setSelection(NodeSelection.create(tr.doc, atomPos));
        else tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
        view.dispatch(tr.setMeta("addToHistory", false));
      }
      // (Held on a touch screen: the keyboard stays down, the menu is what was asked for.)
      if (!view.hasFocus() && !isLongPress(e)) view.focus();
      setMenu({ x: e.clientX, y: e.clientY, top: e.clientY, target, keyboard: false });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      // A field inside a block (a caption, a cell) keeps the browser's menu.
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      e.preventDefault();
      syncDomSelection(editor.view);
      const { from } = editor.state.selection;
      let c: { left: number; top: number; bottom: number };
      try {
        c = editor.view.coordsAtPos(from);
      } catch {
        const r = dom.getBoundingClientRect();
        c = { left: r.left, top: r.top, bottom: r.top + 24 };
      }
      const domAt = editor.view.domAtPos(from).node;
      const el = domAt instanceof HTMLElement ? domAt : domAt.parentElement;
      setMenu({ x: c.left, y: c.bottom, top: c.top, target: targetAt(from, el), keyboard: true });
    };
    dom.addEventListener("contextmenu", onContext);
    dom.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("contextmenu", onContext);
      dom.removeEventListener("keydown", onKey);
    };
  }, [editor, targetAt]);

  const close = useCallback(
    (refocus: boolean) => {
      setMenu(null);
      if (refocus && !editor.isDestroyed) editor.view.focus();
    },
    [editor],
  );

  if (!menu) return null;

  const entries = buildEntries({ editor, editable, target: menu.target, aiOn, palette, onCommentBlock, navigate, toast });
  if (!entries.length) return null;
  return <MenuLayer entries={entries} at={{ x: menu.x, y: menu.y, top: menu.top }} keyboard={menu.keyboard} onClose={close} />;
}

// ------------------------------------------------------------------------------------------------ items

function buildEntries({
  editor,
  editable,
  target,
  aiOn,
  palette,
  onCommentBlock,
  navigate,
  toast,
}: {
  editor: Editor;
  editable: boolean;
  target: Target;
  aiOn: boolean;
  palette: ReturnType<typeof useNotePalette>;
  onCommentBlock?: (blockId: string) => void;
  navigate: (href: string) => void;
  toast: ReturnType<typeof useToast>;
}): Entry[] {
  const { state } = editor;
  const sel = state.selection;
  const range = blockSelectionRange(state);
  const refs = blocksInSelection(state);
  const count = range ? range.to - range.from + 1 : 1;
  const block = state.doc.maybeChild(target.index);
  const blockId = (block?.attrs.id as string | null) ?? null;
  // Actions look the block up again when they run (the note may have changed while the menu was open).
  const live = (): { pos: number; node: NonNullable<typeof block> } | null => {
    let found: { pos: number; node: NonNullable<typeof block> } | null = null;
    editor.state.doc.forEach((n, offset) => {
      if (!found && blockId && n.attrs.id === blockId) found = { pos: offset, node: n };
    });
    return found;
  };
  const blockPos = (() => {
    let p = 0;
    for (let i = 0; i < target.index; i++) p += state.doc.child(i).nodeSize;
    return p;
  })();
  const inCode = sel.$from.parent.type.name === "codeBlock";
  const textSelected = !range && !sel.empty && !(sel instanceof NodeSelection) && !inCode;
  const hasSelection = Boolean(range) || !sel.empty;
  const copyText = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.show(done),
      () => toast.show("Couldn’t copy. Your browser blocked clipboard access.", { tone: "error" }),
    );

  const sections: Entry[][] = [];

  // What's under the pointer.
  const context: Entry[] = [];
  if (target.pageLink?.documentId) {
    const href = `/d/${target.pageLink.documentId}`;
    context.push(
      { label: "Open page", icon: <ExternalLink size={14} />, run: () => navigate(href) },
      { label: "Open in new tab", icon: <ExternalLink size={14} />, run: () => window.open(href, "_blank", "noopener") },
      { label: "Copy page link", icon: <Link2 size={14} />, run: () => void copyText(`${location.origin}${href}`, "Link copied") },
    );
  } else if (target.link?.href) {
    const href = target.link.href;
    context.push(
      { label: "Open link", icon: <ExternalLink size={14} />, run: () => window.open(href, "_blank", "noopener,noreferrer") },
      { label: "Copy link address", icon: <Link2 size={14} />, run: () => void copyText(href, "Link copied") },
    );
    if (editable) {
      context.push(
        { label: "Edit link…", icon: <Pencil size={14} />, shortcut: "⌘⇧K", run: () => editor.view.dom.dispatchEvent(new CustomEvent(EDIT_LINK_EVENT)) },
        { label: "Remove link", icon: <Unlink size={14} />, run: () => removeLink(editor) },
      );
    }
  }
  if (target.date && editable) {
    // Where the date sits inside its block, so it's found again even if text above it changed.
    const inBlock = target.date.pos - blockPos;
    const datePos = () => {
      const at = live();
      const p = at ? at.pos + inBlock : -1;
      return p >= 0 && editor.state.doc.nodeAt(p)?.type.name === "dateMention" ? p : null;
    };
    context.push(
      {
        label: "Change date…",
        icon: <CalendarDays size={14} />,
        run: () => {
          // The date's own click handler opens the picker.
          const p = datePos();
          const el = p === null ? null : editor.view.nodeDOM(p);
          if (el instanceof HTMLElement) el.click();
        },
      },
      {
        label: "Remove date",
        icon: <X size={14} />,
        run: () => {
          const p = datePos();
          const node = p === null ? null : editor.state.doc.nodeAt(p);
          if (p !== null && node) editor.view.dispatch(editor.state.tr.delete(p, p + node.nodeSize));
        },
      },
    );
  }
  if (block && !range) {
    const name = block.type.name;
    if (name === "image" && target.image) {
      const src = target.image.src;
      context.push(
        { label: "Open image in new tab", icon: <ExternalLink size={14} />, run: () => window.open(src, "_blank", "noopener") },
        { label: "Copy image address", icon: <Link2 size={14} />, run: () => void copyText(src, "Image address copied") },
      );
    } else if (name === "bookmark" && block.attrs.url) {
      const url = String(block.attrs.url);
      context.push(
        { label: "Open link", icon: <ExternalLink size={14} />, run: () => window.open(url, "_blank", "noopener,noreferrer") },
        { label: "Copy link address", icon: <Link2 size={14} />, run: () => void copyText(url, "Link copied") },
      );
      if (editable) {
        context.push({
          label: "Edit bookmark…",
          icon: <Pencil size={14} />,
          run: () => blockElements(editor.view.dom as HTMLElement)[target.index]?.querySelector("[data-bookmark]")?.dispatchEvent(new CustomEvent(EDIT_BOOKMARK_EVENT)),
        });
      }
    } else if (name === "codeBlock") {
      context.push({ label: "Copy code", icon: <Copy size={14} />, run: () => void copyText(block.textContent, "Code copied") });
      if (editable) {
        const current = String(block.attrs.language ?? "plaintext");
        context.push({
          label: "Language",
          icon: <Code2 size={14} />,
          items: CODE_LANGUAGES.map(
            (lang): Item => ({
              label: languageName(lang),
              checked: lang === current,
              run: () => {
                const at = live();
                if (at?.node.type.name === "codeBlock") editor.view.dispatch(editor.state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, language: lang }));
              },
            }),
          ),
        });
      }
    } else if (name === "todo" && editable) {
      const checked = Boolean(block.attrs.checked);
      context.push(
        {
          label: checked ? "Mark as not done" : "Mark as done",
          icon: checked ? <Square size={14} /> : <SquareCheck size={14} />,
          shortcut: "⌘↵",
          run: () => {
            const at = live();
            if (at?.node.type.name !== "todo") return;
            const next = !at.node.attrs.checked;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, checked: next, completedAt: next ? Date.now() : null }));
          },
        },
        {
          label: "Task details…",
          icon: <ListChecks size={14} />,
          shortcut: "⌘⇧D",
          run: () => {
            const el = blockElements(editor.view.dom as HTMLElement)[target.index];
            const anchor = el?.querySelector<HTMLElement>(".fb-content") ?? el;
            if (el && anchor) el.dispatchEvent(new CustomEvent("folevi:task-details", { bubbles: true, detail: { pos: blockPos, blockId: block.attrs.id, anchor } }));
          },
        },
      );
    } else if (name === "toggle") {
      const collapsed = Boolean(block.attrs.collapsed);
      context.push({
        label: collapsed ? "Expand" : "Collapse",
        icon: collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />,
        shortcut: "⌘↵",
        run: () => {
          const at = live();
          if (at?.node.type.name === "toggle") editor.view.dispatch(editor.state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, collapsed: !at.node.attrs.collapsed }).setMeta("addToHistory", false));
        },
      });
    } else if (name === "pageBreak" && editable) {
      // The pages either side join up again (the break was the only thing between them).
      context.push({
        label: "Unbreak page",
        icon: <FoldVertical size={14} />,
        run: () => {
          const at = live();
          if (at?.node.type.name === "pageBreak") editor.view.dispatch(editor.state.tr.delete(at.pos, at.pos + at.node.nodeSize).scrollIntoView());
        },
      });
    }
  }
  sections.push(context);

  // Clipboard.
  const clipboard: Entry[] = [];
  if (editable) clipboard.push({ label: "Cut", icon: <Scissors size={14} />, shortcut: "⌘X", disabled: !hasSelection, run: () => clipboardCommand(editor, "cut", toast) });
  clipboard.push({ label: "Copy", icon: <Copy size={14} />, shortcut: "⌘C", disabled: !hasSelection, run: () => clipboardCommand(editor, "copy", toast) });
  if (editable) {
    clipboard.push(
      { label: "Paste", icon: <ClipboardPaste size={14} />, shortcut: "⌘V", run: () => void pasteFromClipboard(editor, false, toast) },
      { label: "Paste as plain text", icon: <ClipboardType size={14} />, shortcut: "⌘⇧V", run: () => void pasteFromClipboard(editor, true, toast) },
    );
  }
  sections.push(clipboard);

  if (editable && textSelected) {
    const mark = (name: string, label: string, icon: ReactNode, shortcut: string, attrs?: Record<string, unknown>): Item => ({
      label,
      icon,
      shortcut,
      checked: editor.isActive(name),
      run: () => editor.chain().focus().toggleMark(name, attrs).run(),
    });
    const format: Entry[] = [
      mark("bold", "Bold", <Bold size={14} />, "⌘B"),
      mark("italic", "Italic", <Italic size={14} />, "⌘I"),
      mark("underline", "Underline", <Underline size={14} />, "⌘U"),
      mark("strike", "Strikethrough", <Strikethrough size={14} />, "⌘⇧X"),
      mark("code", "Inline code", <Code2 size={14} />, "⌘E"),
      mark("highlight", "Highlight", <Highlighter size={14} />, "⌘⇧H", { value: "yellow" }),
      "separator",
      {
        label: "Text color",
        icon: <Palette size={14} />,
        items: [
          ...TEXT_COLORS.map((c): Item => ({ label: colorName(palette, c), icon: <span className={`fb-color-${c} w-3.5 text-center text-[13px] font-semibold`}>A</span>, checked: editor.isActive("textColor", { value: c }), run: () => setTextColor(editor, c) })),
          "separator",
          { label: "Default", run: () => setTextColor(editor, null) },
        ],
      },
      {
        label: "Highlight color",
        icon: <Highlighter size={14} />,
        items: [
          ...HIGHLIGHT_COLORS.map((h): Item => ({ label: colorName(palette, h), icon: <span className={`fb-hl-${h} fb-swatch block h-3.5 w-3.5 rounded-[3px]`} />, checked: editor.isActive("highlight", { value: h }), run: () => setHighlight(editor, h) })),
          "separator",
          { label: "None", run: () => setHighlight(editor, null) },
        ],
      },
      "separator",
      { label: "Clear formatting", icon: <Eraser size={14} />, run: () => clearFormatting(editor) },
    ];
    const text: Entry[] = [{ label: "Format", icon: <Bold size={14} />, items: format }];
    if (!target.link) text.push({ label: "Link…", icon: <LinkIcon size={14} />, shortcut: "⌘⇧K", run: () => editor.view.dom.dispatchEvent(new CustomEvent(EDIT_LINK_EVENT)) });
    sections.push(text);
  }

  // The block (or every selected block).
  const blockEntries: Entry[] = [];
  const anyText = refs.some((r) => r.node.isTextblock);
  if (editable) {
    if (aiOn && (textSelected || anyText)) {
      blockEntries.push({
        label: "Ask AI…",
        icon: <AiIcon size={14} className="text-[#7c6cf0]" />,
        shortcut: "⌘J",
        run: () => {
          let { from, to } = editor.state.selection;
          if (range || from === to) {
            const span = selectedSpan(editor.state);
            from = span.start + 1;
            to = span.end - 1;
          }
          const text = editor.state.doc.textBetween(from, to, "\n");
          clearBlockSelection(editor.view);
          openInlineAi(editor.view.dom, { target: text.trim() ? { from, to, text } : null });
        },
      });
    }
    if (onCommentBlock && count === 1 && block?.attrs.id) {
      const id = String(block.attrs.id);
      blockEntries.push({ label: "Comment", icon: <MessageSquare size={14} />, shortcut: "⌘⌥M", run: () => onCommentBlock(id) });
    }
    if (blockEntries.length) blockEntries.push("separator");
    if (anyText) {
      blockEntries.push({
        label: "Turn into",
        icon: <Repeat2 size={14} />,
        items: TURN_INTO.map(([type, label, attrs, icon]): Item => ({
          label,
          icon,
          checked: refs.length === 1 && refs[0]!.node.type.name === (type === "code" ? "codeBlock" : type) && (type !== "heading" || refs[0]!.node.attrs.level === attrs.level),
          run: () => turnInto(editor, type, attrs),
        })),
      });
    }
    blockEntries.push({
      label: "Insert below",
      icon: <Plus size={14} />,
      items: INSERT_BELOW.map(([type, label, attrs, icon]): Item => ({
        label,
        icon,
        run: () => {
          const span = selectedSpan(editor.state);
          clearBlockSelection(editor.view);
          const depth = Number(editor.state.doc.child(span.first).attrs.depth ?? 0);
          const at = insertBlockAt(editor, span.last + 1, depth, type, type === "table" ? { ...attrs, rows: emptyTableRows(3, 3) } : attrs);
          // A new table starts with the caret in its first cell.
          if (type === "table" && at >= 0) {
            let pos = 0;
            for (let i = 0; i < at; i++) pos += editor.state.doc.child(i).nodeSize;
            focusInsideBlock(editor, pos);
          }
        },
      })),
    });
    blockEntries.push(
      "separator",
      { label: "Duplicate", icon: <CopyPlus size={14} />, shortcut: "⌘D", run: () => duplicateBlocks(editor) },
      { label: "Move up", icon: <MoveUp size={14} />, shortcut: "⌥⇧↑", disabled: selectedSpan(state).first === 0, run: () => moveBlock(editor, -1) },
      { label: "Move down", icon: <MoveDown size={14} />, shortcut: "⌥⇧↓", disabled: selectedSpan(state).last >= state.doc.childCount - 1, run: () => moveBlock(editor, 1) },
      { label: "Indent", icon: <IndentIncrease size={14} />, shortcut: "Tab", run: () => changeDepth(editor, 1) },
      { label: "Outdent", icon: <IndentDecrease size={14} />, shortcut: "⇧Tab", disabled: refs.every((r) => !Number(r.node.attrs.depth ?? 0)), run: () => changeDepth(editor, -1) },
    );
  }
  if (count === 1 && block?.attrs.id) {
    const id = String(block.attrs.id);
    blockEntries.push({ label: "Copy link to block", icon: <Link2 size={14} />, run: () => void copyText(`${location.origin}${location.pathname}#block-${id}`, "Link copied") });
  }
  if (editable) {
    const doomed = new Set((range ? Array.from({ length: count }, (_, i) => range.from + i) : refs.map((r) => r.index)).map((i) => state.doc.maybeChild(i)?.attrs.id as string));
    blockEntries.push("separator", {
      label: count > 1 ? `Delete ${count} blocks` : "Delete block",
      icon: <Trash2 size={14} />,
      shortcut: "⌘⇧⌫",
      danger: true,
      run: () => {
        // By id: an edit elsewhere since the menu opened would shift the indices onto other blocks.
        const now: number[] = [];
        editor.state.doc.forEach((n, _offset, i) => {
          if (doomed.has(n.attrs.id as string)) now.push(i);
        });
        clearBlockSelection(editor.view);
        if (now.length) deleteBlocks(editor, now);
      },
    });
  }
  sections.push(blockEntries);

  // Join the sections with single separators (no leading, trailing or doubled ones).
  const out: Entry[] = [];
  for (const section of sections) {
    if (!section.length) continue;
    if (out.length) out.push("separator");
    out.push(...section);
  }
  return out.filter((e, i, all) => e !== "separator" || (i > 0 && i < all.length - 1 && all[i - 1] !== "separator"));
}

function clipboardCommand(editor: Editor, command: "copy" | "cut", toast: ReturnType<typeof useToast>) {
  editor.view.focus();
  // ProseMirror (and the block selection) handle the copy/cut events this raises, so blocks keep their types.
  let ok: boolean;
  try {
    ok = document.execCommand(command);
  } catch {
    ok = false;
  }
  if (!ok) toast.show(`Your browser blocked ${command === "cut" ? "cutting" : "copying"} from the menu. Press ${command === "cut" ? "⌘X" : "⌘C"} instead.`, { tone: "error" });
}

async function pasteFromClipboard(editor: Editor, plain: boolean, toast: ReturnType<typeof useToast>) {
  const data = new DataTransfer();
  try {
    if (!plain && navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === "text/html" || type === "text/plain") data.setData(type, await blob.text());
          else if (type.startsWith("image/")) data.items.add(new File([blob], `Pasted image.${type.slice(6).replace("jpeg", "jpg")}`, { type }));
        }
      }
    } else {
      data.setData("text/plain", await navigator.clipboard.readText());
    }
  } catch {
    toast.show("Your browser blocked reading the clipboard. Press ⌘V to paste.", { tone: "error" });
    return;
  }
  editor.view.focus();
  if (plain) {
    const text = data.getData("text/plain");
    if (text) editor.view.pasteText(text);
    return;
  }
  // The editor's own paste handling (Markdown, Folevi blocks, web pages, images) reads this event.
  editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}

// ------------------------------------------------------------------------------------------------ menu

/** The pointer's last known position on the page (so a menu can tell a resting pointer from a moving one). */
let pointerAt: { x: number; y: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (e) => (pointerAt = { x: e.clientX, y: e.clientY }), { passive: true, capture: true });
}

/** Every open panel carries this, so clicks inside any of them don't count as "outside". */
const PANEL_ATTR = "data-fb-context-menu";

function MenuLayer({ entries, at, keyboard, onClose }: { entries: Entry[]; at: { x: number; y: number; top: number }; keyboard: boolean; onClose: (refocus: boolean) => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && Boolean((t instanceof Element ? t : t.parentElement)?.closest(`[${PANEL_ATTR}]`));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) onCloseRef.current(false);
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onCloseRef.current(false);
    };
    const onResize = () => onCloseRef.current(false);
    const onBlur = () => onCloseRef.current(false);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const anchor = useMemo(() => ({ left: at.x, right: at.x, top: at.top, bottom: at.y }), [at.x, at.y, at.top]);
  return <Panel entries={entries} anchor={anchor} root highlightFirst={keyboard} onCloseAll={(refocus) => onClose(refocus)} onBack={() => onClose(true)} label="Note actions" />;
}

type Rect = { left: number; right: number; top: number; bottom: number };

function Panel({
  entries,
  anchor,
  root = false,
  highlightFirst,
  onCloseAll,
  onBack,
  onEnter,
  label,
}: {
  /** The pointer moved into this submenu (the parent stops switching submenus). */
  onEnter?: () => void;
  entries: Entry[];
  /** A point (the root menu) or the row a submenu opens from. */
  anchor: Rect;
  root?: boolean;
  highlightFirst: boolean;
  onCloseAll: (refocus: boolean) => void;
  /** Escape / ← in a submenu: back to its parent row. */
  onBack: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const actionable = entries.map((e, i) => (e === "separator" || (!isSub(e) && e.disabled) ? -1 : i)).filter((i) => i >= 0);
  const [active, setActive] = useState(highlightFirst ? (actionable[0] ?? -1) : -1);
  const [open, setOpen] = useState<{ index: number; rect: Rect; keyboard: boolean } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the pointer was when this menu appeared: a pointer that hasn't moved since doesn't pick items.
  const lastPointer = useRef<{ x: number; y: number } | null>(pointerAt);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      /* Popover API missing: it still renders, fixed. */
    }
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    // Above the on-screen keyboard, where there is one.
    const bottom = visibleBottom();
    if (root) {
      left = anchor.left + w + margin > window.innerWidth ? anchor.left - w : anchor.left;
      top = anchor.bottom + h + margin > bottom ? anchor.top - h : anchor.bottom;
    } else {
      // Beside the parent row, its first item level with the row.
      left = anchor.right + w + margin > window.innerWidth ? anchor.left - w + 4 : anchor.right - 4;
      top = anchor.top - 6;
    }
    left = Math.min(Math.max(margin, left), window.innerWidth - w - margin);
    top = Math.min(Math.max(margin, top), bottom - h - margin);
    setPos({ left, top });
  }, [anchor, root]);

  // Keyboard focus follows the highlighted row. With none highlighted the root menu holds focus itself; a
  // submenu opened by hovering leaves focus where it is until the pointer moves into it.
  useEffect(() => {
    if (!pos || open?.keyboard) return;
    const el = active >= 0 ? ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`) : root ? ref.current : null;
    el?.focus({ preventScroll: true });
    // A long menu in a short window scrolls to keep the highlighted row in view.
    if (active >= 0) el?.scrollIntoView({ block: "nearest" });
  }, [active, pos, open, root]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const rowRect = (i: number): Rect | null => {
    const r = ref.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
  };
  const openSub = (i: number, keyboard: boolean) => {
    const rect = rowRect(i);
    if (rect) setOpen({ index: i, rect, keyboard });
  };
  const activate = (i: number, keyboard: boolean) => {
    const e = entries[i];
    if (!e || e === "separator") return;
    if (isSub(e)) {
      openSub(i, keyboard);
      return;
    }
    if (e.disabled) return;
    onCloseAll(true);
    e.run();
  };

  const typed = useRef({ current: "", at: 0 }).current;
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys pressed in an open submenu are its own (React bubbles them through portals to this panel).
    if (!ref.current?.contains(e.target as Node)) return;
    e.stopPropagation();
    const at = actionable.indexOf(active);
    // A space while typing a name ("move d") is part of the name, not "activate".
    if (e.key === " " && typed.current && Date.now() - typed.at <= 700) {
      e.preventDefault();
      typed.current += " ";
      typed.at = Date.now();
      return;
    }
    if (e.key.length > 1 && !["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) typed.current = "";
    const move = (to: number) => {
      setOpen(null);
      setActive(actionable[(to + actionable.length) % actionable.length] ?? -1);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(at < 0 ? 0 : at + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(at < 0 ? actionable.length - 1 : at - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(actionable.length - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (active >= 0 && isSub(entries[active]!)) openSub(active, true);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (!root) onBack();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (active >= 0) activate(active, true);
        break;
      case "Escape":
        e.preventDefault();
        if (root) onCloseAll(true);
        else onBack();
        break;
      case "Tab":
        e.preventDefault();
        onCloseAll(true);
        break;
      default: {
        // Typing jumps to the next item starting with what's typed ("d" → Duplicate, then Delete block).
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        const now = Date.now();
        typed.current = now - typed.at > 700 ? e.key : typed.current + e.key;
        typed.at = now;
        const text = typed.current.toLowerCase();
        // One letter pressed again moves on; a longer prefix stays on a row that still matches.
        const same = [...text].every((c) => c === text[0]);
        const needle = same ? text[0]! : text;
        const start = same || at < 0 ? at + 1 : at;
        for (let k = 0; k < actionable.length; k++) {
          const i = actionable[(start + k) % actionable.length]!;
          const entry = entries[i];
          if (entry && entry !== "separator" && entry.label.toLowerCase().startsWith(needle)) {
            setOpen(null);
            setActive(i);
            break;
          }
        }
      }
    }
  };

  const sub = open ? entries[open.index] : null;
  return createPortal(
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        popover="manual"
        {...{ [PANEL_ATTR]: "" }}
        style={{ position: "fixed", margin: 0, right: "auto", bottom: "auto", left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden", maxHeight: "calc(100vh - 16px)" }}
        className="ui-pop z-[100] min-w-56 max-w-72 overflow-y-auto border-0 p-1.5 text-ink outline-none animate-[folio-rise_120ms_var(--ease-folio)] motion-reduce:animate-none"
        onKeyDown={onKeyDown}
        onMouseEnter={onEnter}
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
      >
        {entries.map((entry, i) =>
          entry === "separator" ? (
            <div key={`sep-${i}`} role="separator" className="mx-2 my-1 h-px bg-line" />
          ) : (
            <button
              key={`${entry.label}-${i}`}
              type="button"
              role={!isSub(entry) && entry.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
              aria-checked={!isSub(entry) && entry.checked !== undefined ? entry.checked : undefined}
              aria-haspopup={isSub(entry) ? "menu" : undefined}
              aria-expanded={isSub(entry) ? open?.index === i : undefined}
              data-index={i}
              data-highlighted={active === i || open?.index === i ? "true" : undefined}
              tabIndex={-1}
              disabled={!isSub(entry) && entry.disabled}
              onMouseMove={(e) => {
                // Only real pointer movement counts (not a menu appearing under a resting mouse).
                const last = lastPointer.current;
                lastPointer.current = { x: e.clientX, y: e.clientY };
                if (last && last.x === e.clientX && last.y === e.clientY) return;
                // A row already highlighted (from the keyboard) still opens its submenu when pointed at.
                if (active === i && (!isSub(entry) || open?.index === i)) return;
                setActive(i);
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                // While a submenu is open, wait a moment: the pointer may be passing through on its way into it.
                const wait = open && open.index !== i ? 260 : 80;
                if (isSub(entry)) hoverTimer.current = setTimeout(() => openSub(i, false), wait);
                else if (open) hoverTimer.current = setTimeout(() => setOpen(null), wait);
              }}
              onClick={() => activate(i, false)}
              className={`ui-menu-item !min-h-[30px] !text-[13px] disabled:opacity-40 pointer-coarse:!min-h-11 ${!isSub(entry) && entry.danger ? "!text-danger" : ""}`}
            >
              <span className="grid w-4 flex-none place-items-center text-muted" aria-hidden>
                {entry.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {!isSub(entry) && entry.shortcut ? <span className="flex-none pl-3 text-xs text-faint pointer-coarse:hidden">{keyLabel(entry.shortcut)}</span> : null}
              {!isSub(entry) && entry.checked ? <Check size={14} strokeWidth={2.5} aria-hidden className="flex-none text-heading" /> : null}
              {isSub(entry) ? <ChevronRight size={14} aria-hidden className="flex-none text-faint" /> : null}
            </button>
          ),
        )}
      </div>
      {open && sub && isSub(sub) ? (
        <Panel
          // Opened again from the keyboard (→ on a submenu the pointer opened): a fresh panel with its first row
          // highlighted and focused.
          key={`${open.index}-${open.keyboard ? "k" : "p"}`}
          entries={sub.items}
          anchor={open.rect}
          highlightFirst={open.keyboard}
          onCloseAll={onCloseAll}
          onEnter={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            setActive(open.index);
          }}
          onBack={() => {
            setOpen(null);
            setActive(open.index);
            ref.current?.querySelector<HTMLElement>(`[data-index="${open.index}"]`)?.focus({ preventScroll: true });
          }}
          label={sub.label}
        />
      ) : null}
    </>,
    document.body,
  );
}
