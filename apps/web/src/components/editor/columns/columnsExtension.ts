// Columns in the editor (packages/editor-schema/src/columns.ts): the row's line (it reserves the row's height
// and holds the handles that resize the columns), each column's own line (never seen), the layout that puts
// the columns side by side (columnsLayout.ts), the repair after local edits and the keys that keep typing
// inside a column.
import "./columns.css";
import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import { MIN_COLUMN_WIDTH } from "@folevi/editor-schema";
import { blocksInSelection, turnInto } from "../commands";
import { neighbourIndex } from "../blockSelectionState";
import { COLUMN, ROW, baseDepth, columnsModel, rowOf } from "./columnsModel";
import { ColumnsLayoutView, columnsLayoutOf, columnsSnapshot } from "./columnsLayout";
import { repairColumns, setColumnShares } from "./columnsCommands";
import { haptic } from "@/lib/nativeApp";

const lineAttrs = {
  id: { default: null, keepOnSplit: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-block-id"), renderHTML: (a: Record<string, unknown>) => (a.id ? { "data-block-id": a.id } : {}) },
  depth: {
    default: 0,
    parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-depth") ?? 0) || 0,
    renderHTML: (a: Record<string, unknown>) => ({ "data-depth": a.depth, style: `--depth:${a.depth ?? 0}` }),
  },
};

/** A row of columns: its line is where the row sits on the page (columnsLayout.ts places the columns over it). */
export const ColumnsBlock = Node.create({
  name: ROW,
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes: () => lineAttrs,
  parseHTML: () => [{ tag: 'div[data-block="columns"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block": ROW, class: "fb fb-columns", role: "presentation" })],
  addNodeView() {
    return ({ node, editor, getPos }) => new RowView(node, editor as Editor, getPos as () => number | undefined);
  },
});

/** A column: a line of its own that holds nothing (its blocks are the lines nested under it). */
export const ColumnBlock = Node.create({
  name: COLUMN,
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes: () => ({
    ...lineAttrs,
    width: {
      default: null,
      parseHTML: (el: HTMLElement) => {
        const v = Number(el.getAttribute("data-width"));
        return Number.isFinite(v) && v > 0 ? v : null;
      },
      renderHTML: (a: Record<string, unknown>) => (a.width ? { "data-width": String(a.width) } : {}),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-block="column"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-block": COLUMN, class: "fb fb-column", "aria-hidden": "true", contenteditable: "false" })],
});

/** The row's line: a box as tall as the row, holding the handles in the gaps between columns. */
class RowView implements NodeView {
  dom: HTMLElement;
  private drag: { pointer: number; gap: number; startX: number; start: number[]; avail: number; rowId: string; row: number; shares: number[] } | null = null;

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "fb fb-columns";
    this.dom.dataset.block = ROW;
    this.dom.contentEditable = "false";
    this.dom.setAttribute("role", "presentation");
    this.render();
    this.dom.addEventListener("pointerdown", this.onDown);
    this.dom.addEventListener("dblclick", this.onDouble);
    this.dom.addEventListener("keydown", this.onKey);
    // A press on the row's empty space (under a short column) leaves the caret where it was.
    this.dom.addEventListener("mousedown", (e) => {
      if (e.target === this.dom) e.preventDefault();
    });
  }

  private render() {
    this.dom.dataset.blockId = String(this.node.attrs.id ?? "");
    this.dom.dataset.depth = String(this.node.attrs.depth ?? 0);
    this.dom.style.setProperty("--depth", String(this.node.attrs.depth ?? 0));
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation() {
    return true;
  }

  stopEvent(e: Event) {
    return e.target instanceof Element && Boolean(e.target.closest(".fb-columns-gutter"));
  }

  destroy() {
    this.dom.removeEventListener("pointerdown", this.onDown);
  }

  /** The row (its index among the note's lines) and its drawn columns. */
  private rowNow() {
    const pos = this.getPos();
    if (typeof pos !== "number") return null;
    const index = this.editor.state.doc.resolve(pos).index(0);
    const snap = columnsSnapshot(this.editor.view.dom as HTMLElement)?.rows.find((r) => r.index === index);
    if (!snap || snap.stacked) return null;
    const avail = snap.width - snap.gap * (snap.columns.length - 1);
    return { index, snap, avail, shares: snap.columns.map((c) => c.width / avail) };
  }

  private onDown = (e: PointerEvent) => {
    const g = e.target instanceof Element ? e.target.closest<HTMLElement>(".fb-columns-gutter") : null;
    if (!g || e.button !== 0 || !this.editor.isEditable) return;
    const now = this.rowNow();
    const gap = Number(g.dataset.gap);
    if (!now || !Number.isInteger(gap)) return;
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    g.dataset.active = "true";
    document.documentElement.classList.add("fb-columns-resizing");
    this.drag = { pointer: e.pointerId, gap, startX: e.clientX, start: now.shares, avail: now.avail, rowId: now.snap.id, row: now.index, shares: now.shares };
    const move = (m: PointerEvent) => {
      const d = this.drag;
      if (!d || m.pointerId !== d.pointer) return;
      d.shares = resized(d.start, d.gap, (m.clientX - d.startX) / d.avail, d.avail);
      columnsLayoutOf(this.editor.view.dom as HTMLElement)?.setPreview({ rowId: d.rowId, shares: d.shares });
    };
    const up = (u: PointerEvent) => {
      const d = this.drag;
      if (!d || u.pointerId !== d.pointer) return;
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", up);
      g.removeEventListener("pointercancel", up);
      delete g.dataset.active;
      document.documentElement.classList.remove("fb-columns-resizing");
      this.drag = null;
      const moved = d.shares.some((s, k) => Math.abs(s - d.start[k]!) > 0.002);
      if (moved && u.type === "pointerup") setColumnShares(this.editor, d.row, d.shares);
      columnsLayoutOf(this.editor.view.dom as HTMLElement)?.setPreview(null);
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
    g.addEventListener("pointercancel", up);
  };

  /** A double click on a gap: every column the same width again. */
  private onDouble = (e: MouseEvent) => {
    const g = e.target instanceof Element ? e.target.closest<HTMLElement>(".fb-columns-gutter") : null;
    const now = this.rowNow();
    if (!g || !now || !this.editor.isEditable) return;
    e.preventDefault();
    setColumnShares(this.editor, now.index, null);
    haptic("light");
  };

  /** ← and → on a focused gap move it (5% of the row a press). */
  private onKey = (e: KeyboardEvent) => {
    const g = e.target instanceof Element ? e.target.closest<HTMLElement>(".fb-columns-gutter") : null;
    if (!g || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !this.editor.isEditable) return;
    const now = this.rowNow();
    if (!now) return;
    e.preventDefault();
    const gap = Number(g.dataset.gap);
    setColumnShares(this.editor, now.index, resized(now.shares, gap, e.key === "ArrowLeft" ? -0.05 : 0.05, now.avail));
    requestAnimationFrame(() => (this.dom.querySelector<HTMLElement>(`.fb-columns-gutter[data-gap="${gap}"]`) ?? g).focus());
  };
}

/** Shares after moving the gap after column `gap` by `delta` of the row: only its two columns change. */
function resized(start: number[], gap: number, delta: number, avail: number): number[] {
  const min = Math.max(MIN_COLUMN_WIDTH, 0.1, 110 / Math.max(1, avail));
  const pair = start[gap]! + start[gap + 1]!;
  const a = Math.max(min, Math.min(pair - min, start[gap]! + delta));
  const out = [...start];
  out[gap] = a;
  out[gap + 1] = pair - a;
  return out;
}

const repairKey = new PluginKey("foleviColumnsRepair");

/** Where the caret is when it's at a column's own level (not nested under another line in the column). */
function atColumnLevel(state: EditorState) {
  const { selection } = state;
  if (!selection.empty || selection.$from.depth < 1) return null;
  const index = selection.$from.index(0);
  const inRow = rowOf(state.doc, index);
  if (!inRow || inRow.column < 0) return null;
  const node = state.doc.child(index);
  if (Number(node.attrs.depth ?? 0) !== baseDepth(inRow.row)) return null;
  const column = inRow.row.columns[inRow.column]!;
  const starts = columnsModel(state.doc).starts;
  return { index, node, pos: starts[index]!, row: inRow.row, column, starts };
}

const LIST_LIKE = new Set(["bulleted", "numbered", "todo", "quote", "toggle", "callout"]);

export const ColumnsExtension = Extension.create({
  name: "columnsLayout",
  // Before the note's own keys (plugins.ts BlockKeymap): at a column's own level, outdenting would only take
  // a line out of its column and back (the repair puts it back), so these keys mean what they do at the left
  // edge of the page.
  priority: 1100,

  addProseMirrorPlugins() {
    return [
      new Plugin({ view: (view: EditorView) => new ColumnsLayoutView(view) }),
      new Plugin({
        key: repairKey,
        appendTransaction: (trs, oldState, newState) => {
          if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta("remote"))) return null;
          const start = oldState.doc.content.findDiffStart(newState.doc.content);
          if (start === null) return null;
          const end = oldState.doc.content.findDiffEnd(newState.doc.content);
          const to = end ? Math.max(start, end.b) : start;
          return repairColumns(newState, { from: start, to });
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const editor = this.editor as Editor;
    return {
      Backspace: () => {
        const { state } = editor;
        const at = atColumnLevel(state);
        if (!at || !at.node.isTextblock || state.selection.$from.parentOffset !== 0) return false;
        // Another kind of line becomes text first (as at the left edge of the page); code stays as it is.
        if (at.node.type.name !== "paragraph") return false;
        const empty = at.node.content.size === 0;
        const nested = at.index + 1 < at.column.end && Number(state.doc.child(at.index + 1).attrs.depth ?? 0) > baseDepth(at.row);
        if (at.index === at.column.start) {
          if (!empty || nested) return true;
          const tr = state.tr;
          if (at.column.end === at.index + 1 && at.column.index >= 0) {
            // The column's only line: the column goes (and with one column left, the row becomes its lines). The
            // caret goes to the end of the column before (the start of the next, for the first column).
            const first = at.row.columns.indexOf(at.column) === 0;
            tr.delete(at.column.pos, at.pos + at.node.nodeSize);
            const anchor = tr.doc.resolve(Math.min(tr.mapping.map(at.column.pos), tr.doc.content.size));
            // (A table or picture there is selected.)
            const sel = Selection.findFrom(anchor, first ? 1 : -1) ?? Selection.findFrom(anchor, first ? -1 : 1);
            if (sel) tr.setSelection(sel);
          } else {
            tr.delete(at.pos, at.pos + at.node.nodeSize);
            const sel = TextSelection.findFrom(tr.doc.resolve(Math.min(at.pos, tr.doc.content.size)), 1, true);
            if (sel) tr.setSelection(sel);
          }
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
        // Join the line above in the same column (as at the left edge of the page), never one in the column before.
        const prevIndex = neighbourIndex(state, at.index, -1);
        if (prevIndex === null || prevIndex <= at.column.index) return true;
        const prev = state.doc.child(prevIndex);
        const prevPos = at.starts[prevIndex]!;
        if (prev.type.name === "codeBlock") {
          const tr = state.tr;
          if (empty && !nested) tr.delete(at.pos, at.pos + at.node.nodeSize);
          editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, prevPos + prev.nodeSize - 1)).scrollIntoView());
          return true;
        }
        if (!prev.isTextblock) {
          const tr = state.tr;
          if (empty && !nested) tr.delete(at.pos, at.pos + at.node.nodeSize);
          editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, prevPos)).scrollIntoView());
          return true;
        }
        const end = prevPos + prev.nodeSize - 1;
        const tr = state.tr.delete(at.pos, at.pos + at.node.nodeSize);
        if (at.node.content.size) tr.insert(end, at.node.content);
        tr.setSelection(TextSelection.create(tr.doc, end));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      Delete: () => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty || !selection.$from.parent.isTextblock || selection.$from.parentOffset !== selection.$from.parent.content.size) return false;
        const index = selection.$from.index(0);
        const next = state.doc.maybeChild(index + 1);
        // At the end of a column's last line: nothing (the next column's text doesn't come over).
        const inRow = rowOf(state.doc, index);
        if (inRow && (!next || index + 1 >= inRow.row.end || next.type.name === COLUMN)) return true;
        // Just before a row: into its first column.
        if (next?.type.name === ROW) {
          const sel = TextSelection.findFrom(state.doc.resolve(selection.$from.after(1)), 1, true);
          if (sel) editor.view.dispatch(state.tr.setSelection(sel).scrollIntoView());
          return true;
        }
        return false;
      },
      Enter: () => {
        const at = atColumnLevel(editor.state);
        // An empty list item at a column's own level ends the list (instead of outdenting out of the column).
        if (!at || at.node.content.size || !LIST_LIKE.has(at.node.type.name)) return false;
        return turnInto(editor, "paragraph");
      },
      "Shift-Tab": () => {
        const { state } = editor;
        if (state.selection.$from.parent.type.name === "codeBlock") return false;
        const refs = blocksInSelection(state);
        // Already at their columns' own level: nowhere further out to go (it stays in its column).
        return refs.length > 0 && refs.every((r) => {
          const inRow = rowOf(state.doc, r.index);
          return Boolean(inRow) && Number(r.node.attrs.depth ?? 0) <= baseDepth(inRow!.row);
        });
      },
    };
  },
});
