"use client";

// The editor of the table cell being edited.
//
// Why a small editor for the cell: a table is one block whose cells live in its props (`rows`), and the
// note's editor is a flat list of blocks (convert.ts). Making cells real nested content of the note would
// change the document model under every block plugin (Markdown shortcuts, the "/" menu, Enter and Backspace,
// block selection, find, remote edits, comments) and let a selection run across cells and merge them. Instead
// the cell being edited gets a ProseMirror editor of its own with the note's marks and inline atoms (bold,
// italic, underline, strike, code, links, colour, highlight, mentions, dates, page links), and every other
// cell is drawn from its stored content.
//
// One editor per table, made the first time a cell is edited and moved from cell to cell: Tab, Enter or a
// click puts it in the next cell, with that cell's content, in the same key press, so nothing typed straight
// after lands anywhere else (an editor made for each cell would take a moment to appear). Each change is
// written straight back to the table as one note transaction, so the note's undo covers it (⌘Z here undoes
// in the note), and changes from elsewhere (undo, another device) replace the cell's text. The selection
// toolbar and the Format panel find this editor through cellEditorStore.ts.
import { Editor, Node as TiptapNode, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { canonicalJson, normalizeInline, type InlineNode } from "@folevi/editor-schema";
import { ALL_MARKS, DateMention, Mention, PageLink, Text } from "../extensions";
import { inlineToPM, pmInline } from "../convert";
import { clearActiveCell, setActiveCell } from "./cellEditorStore";

const CellDoc = TiptapNode.create({ name: "doc", topNode: true, content: "paragraph" });
const CellParagraph = TiptapNode.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }, { tag: "div" }],
  renderHTML: () => ["p", { class: "fb-cell-line" }, 0],
});
const CellBreak = TiptapNode.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
});

const CELL_EXTENSIONS = [CellDoc, CellParagraph, Text, CellBreak, Mention, DateMention, PageLink, ...ALL_MARKS];

const docOf = (nodes: readonly InlineNode[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: inlineToPM(nodes) }] });
const keyOf = (nodes: readonly InlineNode[]) => canonicalJson(normalizeInline(nodes));

/** Where the caret starts: under the pointer, at the end, at the start, or with everything selected. */
export type CaretStart = { x: number; y: number } | "end" | "start" | "all" | number;

export interface CellKeyEvent {
  event: KeyboardEvent;
  view: EditorView;
  /** The caret can't go further that way inside the cell. */
  atEdge: (dir: "up" | "down" | "left" | "right") => boolean;
}

export interface CellEditorHandlers {
  onChange: (next: InlineNode[]) => void;
  /** A key the table handles (moving between cells, Escape…): return true when it did. */
  onKey: (e: CellKeyEvent) => boolean;
  /** Text pasted from a spreadsheet or with several lines: return true when the table took it. */
  onPaste: (data: DataTransfer) => boolean;
  /** Focus left the cell (to `to`, if anywhere). */
  onBlur: (to: Element | null) => void;
}

/** The table's cell editor: open it in a cell, keep it in step with the cell, insert references. */
export class CellEditor {
  readonly editor: Editor;
  private last = "";
  private echoes = new Set<string>();

  constructor(
    private readonly note: Editor,
    private readonly handlers: { current: CellEditorHandlers },
  ) {
    const element = document.createElement("div");
    element.className = "fb-cell-host";
    this.editor = new Editor({
      element,
      extensions: CELL_EXTENSIONS,
      content: docOf([]),
      editorProps: {
        attributes: {
          class: "fb-cell-editor block w-full min-w-[6rem] px-2.5 py-1.5 outline-none",
          role: "textbox",
          "aria-multiline": "false",
          // A block's own field: the note's shortcuts leave it alone (EditorMenus' inBlockField).
          "data-draft": "",
          spellcheck: "true",
        },
        handleKeyDown: (view, event) => this.keyDown(view, event),
        handlePaste: (_view, event) => {
          const data = event.clipboardData;
          if (data && this.handlers.current.onPaste(data)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        // Dropping files or blocks into a cell isn't a thing: the note handles drops.
        handleDrop: () => true,
      },
      onFocus: () => setActiveCell({ editor: this.editor, note: this.note }),
      onBlur: ({ event }) => {
        const to = (event as FocusEvent).relatedTarget as Element | null;
        // A moment later: moving the editor into its next cell drops focus for an instant.
        window.setTimeout(() => {
          if (this.editor.isDestroyed || this.editor.view.hasFocus()) return;
          this.handlers.current.onBlur(to);
        }, 0);
      },
      onUpdate: ({ transaction }) => {
        if (!transaction.docChanged || transaction.getMeta("cell-load")) return;
        const first = this.editor.state.doc.firstChild;
        const next = first ? pmInline(first) : [];
        const k = keyOf(next);
        this.last = k;
        this.echoes.add(k);
        this.handlers.current.onChange(next);
      },
    });
  }

  /** Its element, for the cell it's in. */
  get element(): HTMLElement {
    return this.editor.options.element as HTMLElement;
  }

  private keyDown(view: EditorView, event: KeyboardEvent): boolean {
    if (event.isComposing || event.keyCode === 229) return false;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    // Undo and redo are the note's (each change here is one of its steps).
    if (mod && !event.altKey && (key === "z" || (key === "y" && !event.shiftKey))) {
      event.preventDefault();
      event.stopPropagation();
      if (key === "y" || event.shiftKey) this.note.commands.redo();
      else this.note.commands.undo();
      return true;
    }
    if (event.key === "Enter" && event.shiftKey && !mod) {
      event.preventDefault();
      const { state } = view;
      view.dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hardBreak!.create()).scrollIntoView());
      return true;
    }
    const atEdge = (dir: "up" | "down" | "left" | "right") => {
      const sel = view.state.selection;
      if (dir === "left") return sel.empty && sel.from <= 1;
      if (dir === "right") return sel.empty && sel.to >= view.state.doc.content.size - 1;
      return view.endOfTextblock(dir);
    };
    if (this.handlers.current.onKey({ event, view, atEdge })) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  /** Puts the editor in `host` with a cell's content and the caret, and focuses it. */
  open(host: HTMLElement, cell: InlineNode[], label: string, caret: CaretStart): void {
    if (this.editor.isDestroyed) return;
    if (this.element.parentElement !== host) host.appendChild(this.element);
    this.editor.view.dom.setAttribute("aria-label", label);
    this.load(cell, caret);
    this.editor.view.focus();
    setActiveCell({ editor: this.editor, note: this.note });
  }

  /** A cell's content, replacing what's there (not saved: it's the cell's own). */
  private load(cell: InlineNode[], caret: CaretStart): void {
    const k = keyOf(cell);
    this.last = k;
    this.echoes.clear();
    const { view } = this.editor;
    const doc = view.state.schema.nodeFromJSON(docOf(cell));
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta("cell-load", true).setMeta("addToHistory", false);
    const end = tr.doc.content.size - 1;
    let sel: TextSelection;
    if (typeof caret === "number") sel = TextSelection.create(tr.doc, Math.max(1, Math.min(end, caret)));
    else if (caret === "all") sel = TextSelection.create(tr.doc, 1, end);
    else if (caret === "start") sel = TextSelection.create(tr.doc, 1);
    else if (caret === "end") sel = TextSelection.create(tr.doc, end);
    else sel = TextSelection.create(tr.doc, end);
    view.dispatch(tr.setSelection(sel));
    if (typeof caret === "object") {
      // Under the pointer, now that the cell's text is laid out in its cell.
      const at = view.posAtCoords({ left: caret.x, top: caret.y });
      if (at) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.max(1, Math.min(view.state.doc.content.size - 1, at.pos)))).setMeta("addToHistory", false));
    }
  }

  /** The cell changed elsewhere (the note's undo, another device): its text is replaced, the caret kept near. */
  sync(cell: InlineNode[]): void {
    if (this.editor.isDestroyed) return;
    const k = keyOf(cell);
    if (k === this.last) {
      this.echoes.clear();
      return;
    }
    if (this.echoes.has(k)) return;
    this.load(cell, this.editor.state.selection.from);
  }

  /** Puts `text` at the caret (or over `range`), the caret after it; returns where it went. */
  insert(text: string, range?: { from: number; to: number }): { from: number; to: number } | null {
    if (this.editor.isDestroyed) return null;
    const { state } = this.editor;
    const from = range?.from ?? state.selection.from;
    const to = range?.to ?? state.selection.to;
    const tr = state.tr.insertText(text, from, to);
    tr.setSelection(TextSelection.create(tr.doc, from + text.length));
    this.editor.view.dispatch(tr);
    if (!this.editor.view.hasFocus()) this.editor.view.focus();
    return { from, to: from + text.length };
  }

  /** Out of its cell (kept for the next one). */
  close(): void {
    this.element.remove();
    clearActiveCell(this.editor);
  }

  destroy(): void {
    clearActiveCell(this.editor);
    this.editor.destroy();
    this.element.remove();
  }
}
