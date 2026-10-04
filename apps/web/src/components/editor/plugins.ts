import { Extension, InputRule, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { LIMITS, normalizeLanguage, ulid } from "@folevi/editor-schema";
import { blocksInSelection, changeDepth, deleteBlocks, duplicateBlocks, moveBlock, normalizeDepths, turnInto } from "./commands";
import { TEXT_NODES } from "./convert";
import { hiddenIndices, neighbourIndex } from "./blockSelectionState";
import { sliceToText } from "./clipboardText";

/** Every top-level block has a unique id; depth is always valid. Runs after every transaction. */
export const BlockIdentity = Extension.create({
  name: "blockIdentity",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIdentity"),
        props: {
          // A right-click (or Control-click) is for the note's menu, which sets the selection itself;
          // ProseMirror's own handling would move focus back into the text under the open menu.
          handleDOMEvents: {
            mousedown: (_view, event) => event.button === 2 || (event.button === 0 && event.ctrlKey && /Mac/.test(navigator.platform)),
            // An input method (Chinese, Japanese…) starting over a range through a collapsed toggle, or over a
            // selected block: make room the same way typing does, before the composition begins.
            compositionstart: (view) => {
              const visible = deleteVisibleRange(view.state);
              if (visible) {
                view.dispatch(visible);
                return false;
              }
              const sel = view.state.selection;
              if (sel instanceof NodeSelection && sel.node.isBlock && sel.$from.depth === 0) {
                const at = afterSubtree(view.state, sel.$from.index(0));
                const tr = view.state.tr.insert(at, view.state.schema.nodes.paragraph!.create({ id: null, depth: sel.node.attrs.depth }));
                tr.setSelection(TextSelection.create(tr.doc, at + 1));
                view.dispatch(tr);
              }
              return false;
            },
          },
          // Text for other apps: one line per block, Markdown-style.
          clipboardTextSerializer: (slice) => sliceToText(slice),
          // Typing while a whole block (an image, a table, a divider…) is selected writes on a new line after
          // it instead of replacing it.
          handleTextInput: (view, _from, _to, text) => {
            const sel = view.state.selection;
            // Typing over a range that crosses a collapsed toggle replaces only what's visible.
            const visible = deleteVisibleRange(view.state);
            if (visible) {
              visible.insertText(text);
              view.dispatch(visible.scrollIntoView());
              return true;
            }
            if (!(sel instanceof NodeSelection) || !sel.node.isBlock || sel.$from.depth !== 0) return false;
            const { state } = view;
            // After the block and anything nested under it.
            const at = afterSubtree(state, sel.$from.index(0));
            const next = state.doc.nodeAt(at);
            const tr = state.tr;
            if (at === sel.to && next && next.type.name === "paragraph" && next.content.size === 0) {
              tr.insertText(text, at + 1);
              tr.setSelection(TextSelection.create(tr.doc, at + 1 + text.length));
            } else {
              tr.insert(at, state.schema.nodes.paragraph!.create({ id: null, depth: sel.node.attrs.depth }, state.schema.text(text)));
              tr.setSelection(TextSelection.create(tr.doc, at + 1 + text.length));
            }
            view.dispatch(tr.scrollIntoView());
            return true;
          },
          // Pasted (or dropped-in) blocks are copies: they get new ids, so the original keeps its comments,
          // links and sync identity. A block dragged within the note is a move and keeps its id.
          transformPasted: (slice, view) => {
            if ((view as unknown as { dragging?: { move?: boolean } | null }).dragging?.move) return slice;
            // Part of one line (a word, a sentence): just its text, so it never changes the line it lands in.
            const only = slice.content.childCount === 1 ? slice.content.firstChild : null;
            if (only && only.isTextblock && slice.openStart > 0 && slice.openEnd > 0 && view.state.selection.$from.parent.isTextblock) {
              return new Slice(only.content, 0, 0);
            }
            // Whole blocks: new ids (they're copies), nested relative to the line they're pasted on.
            const $from = view.state.selection.$from;
            const caretDepth = $from.depth >= 1 ? Number($from.node(1).attrs.depth ?? 0) : 0;
            let minDepth = Infinity;
            slice.content.forEach((node) => {
              if (node.attrs.depth !== undefined) minDepth = Math.min(minDepth, Number(node.attrs.depth ?? 0));
            });
            const shift = Number.isFinite(minDepth) && slice.openStart === 0 ? caretDepth - minDepth : 0;
            let changed = false;
            const content: PMNode[] = [];
            slice.content.forEach((node) => {
              if (node.attrs.id || (shift && node.attrs.depth !== undefined)) {
                changed = true;
                const depth = node.attrs.depth === undefined ? undefined : Math.max(0, Math.min(LIMITS.maxDepth, Number(node.attrs.depth ?? 0) + shift));
                content.push(node.type.create({ ...node.attrs, id: null, ...(depth === undefined ? {} : { depth }) }, node.content, node.marks));
              } else content.push(node);
            });
            return changed ? new Slice(Fragment.from(content), slice.openStart, slice.openEnd) : slice;
          },
        },
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          let pos = 0;
          let prevDepth = -1;
          let depthFixed = false;
          state.doc.forEach((node) => {
            const id = node.attrs.id as string | null;
            let depth = Number(node.attrs.depth ?? 0);
            const max = Math.min(LIMITS.maxDepth, prevDepth + 1);
            const fixDepth = depth > max || depth < 0;
            if (fixDepth) depthFixed = true;
            if (fixDepth) depth = Math.max(0, max);
            if (!id || seen.has(id) || fixDepth) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: !id || seen.has(id) ? ulid() : id, depth });
            }
            seen.add(id && !seen.has(id) ? id : "");
            prevDepth = depth;
            pos += node.nodeSize;
          });
          if (!tr.docChanged) return null;
          // Id fixes stay out of the undo history; a depth fix belongs to the edit that caused it, so undoing
          // that edit restores the nesting too.
          const remote = transactions.every((t) => t.getMeta("remote") || t.getMeta("addToHistory") === false);
          if (!depthFixed || remote) tr.setMeta("addToHistory", false);
          if (transactions.every((t) => t.getMeta("remote"))) tr.setMeta("remote", true);
          return tr;
        },
      }),
    ];
  },
});

export interface CommentSummary {
  /** Comments in the block's open threads. */
  count: number;
  lastActivityAt: number;
  unread: boolean;
  /** The latest people to comment (up to three). */
  authors: { name: string; avatarUrl: string | null }[];
}

export interface DecorationInputs {
  presence: { blockId: string; color: string; name: string }[];
  commentBlocks: Set<string>;
  selectedBlocks: Set<string>;
  conflictBlocks: Set<string>;
  /** Blocks with open comments get a small "2 comments · 8:18 AM" line under them. */
  commentSummaries?: Map<string, CommentSummary>;
  /** Opens a block's comment thread (from that line). Keep it stable: lines are cached by content. */
  onOpenComments?: (blockId: string) => void;
}

/** The top-level elements of blocks, in document order (skipping lines drawn between blocks, like comment lines). */
export function blockElements(dom: HTMLElement): HTMLElement[] {
  return ([...dom.children] as HTMLElement[]).filter((c) => !c.hasAttribute("data-fb-widget"));
}

const LIST_BLOCKS = new Set(["bulleted", "numbered", "todo"]);

function commentTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The "2 comments · 8:18 AM" line under a commented block (plain DOM: it's a ProseMirror widget). */
function commentLine(blockId: string, depth: number, list: boolean, s: CommentSummary, open?: (blockId: string) => void): HTMLElement {
  const line = document.createElement("div");
  line.className = "fb-comment-line";
  line.setAttribute("data-fb-widget", "comments");
  line.contentEditable = "false";
  line.style.setProperty("--depth", String(depth));
  if (list) line.style.setProperty("--pad-list", "1.6em");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fb-comment-chip";
  btn.dataset.commentChip = blockId;
  const count = `${s.count} ${s.count === 1 ? "comment" : "comments"}`;
  const time = commentTime(s.lastActivityAt);
  btn.setAttribute("aria-label", `${count}, latest ${time}${s.unread ? ", unread" : ""}. Open comments`);
  btn.setAttribute("aria-haspopup", "dialog");
  const faces = document.createElement("span");
  faces.className = "fb-comment-faces";
  faces.setAttribute("aria-hidden", "true");
  for (const a of s.authors.slice(0, 3)) {
    if (a.avatarUrl) {
      const img = document.createElement("img");
      img.src = a.avatarUrl;
      img.alt = "";
      faces.appendChild(img);
    } else {
      const face = document.createElement("span");
      face.textContent = (a.name.trim()[0] ?? "?").toUpperCase();
      faces.appendChild(face);
    }
  }
  const label = document.createElement("span");
  label.setAttribute("aria-hidden", "true");
  label.textContent = `${count} · ${time}`;
  btn.append(faces, label);
  if (s.unread) {
    const dot = document.createElement("span");
    dot.className = "fb-comment-unread";
    dot.setAttribute("aria-hidden", "true");
    btn.appendChild(dot);
  }
  // Keep the editor's selection; open on click.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    open?.(blockId);
  });
  line.appendChild(btn);
  return line;
}

export const decorationsKey = new PluginKey<DecorationInputs>("foleviDecorations");

/** Numbering, hidden blocks, selection, conflicts, presence and comment lines for the whole note. */
function buildDecorations(doc: PMNode, inputs: DecorationInputs): DecorationSet {
  const decos: Decoration[] = [];
  const counters: number[] = [];
  let hideBelow: number | null = null;
  let pos = 0;
  doc.forEach((node) => {
    const depth = Number(node.attrs.depth ?? 0);
    const id = node.attrs.id as string | null;
    const end = pos + node.nodeSize;
    if (hideBelow !== null && depth <= hideBelow) hideBelow = null;
    const attrs: Record<string, string> = {};
    const classes: string[] = [];
    if (hideBelow !== null) classes.push("fb-hidden");
    if (node.type.name === "numbered") {
      counters.length = depth + 1;
      counters[depth] = (counters[depth] ?? 0) + 1;
      attrs["data-index"] = String(counters[depth]);
    } else {
      counters.length = depth;
    }
    if (node.type.name === "toggle" && node.attrs.collapsed && hideBelow === null) hideBelow = depth;
    if (id && inputs.selectedBlocks.has(id)) classes.push("fb-selected");
    if (id && inputs.conflictBlocks.has(id)) classes.push("fb-conflict");
    if (id && inputs.commentBlocks.has(id)) attrs["data-has-comments"] = "true";
    const who = id ? inputs.presence.find((p) => p.blockId === id) : undefined;
    if (who) {
      classes.push("fb-presence");
      attrs.style = `--presence:var(--color-${who.color === "accent" ? "accent" : who.color})`;
      attrs["data-presence"] = who.name;
    }
    if (classes.length || Object.keys(attrs).length) decos.push(Decoration.node(pos, end, { ...attrs, class: classes.join(" ") }));
    const summary = id ? inputs.commentSummaries?.get(id) : undefined;
    if (summary && id && !classes.includes("fb-hidden")) {
      const key = `comments:${id}:${depth}:${summary.count}:${summary.lastActivityAt}:${summary.unread}:${summary.authors.map((a) => a.name + (a.avatarUrl ?? "")).join("|")}`;
      const list = LIST_BLOCKS.has(node.type.name);
      decos.push(Decoration.widget(end, () => commentLine(id, depth, list, summary, inputs.onOpenComments), { side: -1, key, ignoreSelection: true, stopEvent: () => true }));
    }
    pos = end;
  });
  return DecorationSet.create(doc, decos);
}

/**
 * Whether a transaction changes only text inside lines (typing, marks): then the decorations just move
 * with it. Anything that adds, removes, reorders or retypes blocks rebuilds them (numbering, hiding).
 */
function onlyEditsText(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
    if (!(step instanceof ReplaceStep)) return false;
    const doc = tr.docs[i]!;
    const { from, to } = step as unknown as { from: number; to: number };
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if ($from.depth < 1 || !$from.sameParent($to) || !$from.parent.isTextblock) return false;
    let blocks = false;
    step.slice.content.forEach((n) => {
      if (n.isBlock) blocks = true;
    });
    return !blocks;
  });
}

const decoCacheKey = new PluginKey<DecorationSet>("foleviDecorationCache");

/** Numbering, collapsed toggles, presence, comment markers, block selection and conflict markers. */
export const BlockDecorations = Extension.create({
  name: "blockDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationInputs>({
        key: decorationsKey,
        state: {
          init: () => ({ presence: [], commentBlocks: new Set(), selectedBlocks: new Set(), conflictBlocks: new Set() }),
          apply: (tr, value) => (tr.getMeta(decorationsKey) as DecorationInputs | undefined) ?? value,
        },
      }),
      // The decorations themselves, kept between updates: a long note doesn't rebuild them on every key.
      new Plugin<DecorationSet>({
        key: decoCacheKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, decorationsKey.getState(state)!),
          apply: (tr, set, _old, state) => {
            if (tr.getMeta(decorationsKey)) return buildDecorations(state.doc, decorationsKey.getState(state)!);
            if (!tr.docChanged) return set;
            if (onlyEditsText(tr)) return set.map(tr.mapping, tr.doc);
            return buildDecorations(state.doc, decorationsKey.getState(state)!);
          },
        },
        props: {
          decorations: (state) => decoCacheKey.getState(state),
        },
      }),
    ];
  },
});

function currentBlock(state: EditorState) {
  const $from = state.selection.$from;
  if ($from.depth < 1) return null;
  return { node: $from.parent, pos: $from.before(1), atStart: $from.parentOffset === 0, empty: $from.parent.content.size === 0 };
}

const LIST_TYPES = new Set(["bulleted", "numbered", "todo"]);

/** Block styling that follows the text onto a new line (see BlockFormat in extensions.ts). */
const CARRIED_FORMAT = ["decoration", "color", "align", "font", "group"] as const;
const FORMATTABLE_TYPES = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote"]);

/** Attributes for the new block a split creates: a fresh id, its depth, and the styling that carries over. */
function splitAttrs(from: PMNode, toType: string, depth: number): Record<string, unknown> {
  const attrs: Record<string, unknown> = { id: ulid(), depth };
  if (FORMATTABLE_TYPES.has(from.type.name) && FORMATTABLE_TYPES.has(toType)) {
    for (const k of CARRIED_FORMAT) if (from.attrs[k] != null) attrs[k] = from.attrs[k];
  }
  if (toType === "heading") attrs.level = from.attrs.level;
  if (toType === "paragraph" && from.type.name === "paragraph" && from.attrs.textStyle != null) attrs.textStyle = from.attrs.textStyle;
  return attrs;
}

/** Top-level index and position of the block after `index` that isn't nested in it (its subtree's end). */
function afterSubtree(state: EditorState, index: number): number {
  const base = Number(state.doc.child(index).attrs.depth ?? 0);
  let pos = 0;
  for (let i = 0; i <= index; i++) pos += state.doc.child(i).nodeSize;
  for (let i = index + 1; i < state.doc.childCount; i++) {
    const n = state.doc.child(i);
    if (Number(n.attrs.depth ?? 0) <= base) break;
    pos += n.nodeSize;
  }
  return pos;
}

/**
 * A text range from a collapsed toggle's line into a later block would also delete the toggle's hidden
 * blocks, which the person can't see. This deletes only the visible part (the selected text, visible
 * blocks in between) and joins the rest of the last line onto the toggle's line. Null when the range
 * doesn't cross hidden blocks.
 */
export function deleteVisibleRange(state: EditorState): Transaction | null {
  const sel = state.selection;
  if (sel.empty || !(sel instanceof TextSelection)) return null;
  const { $from, $to } = sel;
  if ($from.depth < 1 || $to.depth < 1) return null;
  const a = $from.index(0);
  const b = $to.index(0);
  if (a === b) return null;
  const hidden = hiddenIndices(state);
  let crosses = false;
  for (let i = a + 1; i < b; i++) if (hidden.has(i)) crosses = true;
  const codeEnd = $from.parent.type.name === "codeBlock" || $to.parent.type.name === "codeBlock";
  if (codeEnd) {
    // A range from text into code (or out of it): each end keeps its own block, so code never turns into text
    // or text into code. Visible blocks in between go; hidden ones stay with their toggle.
    const tr = state.tr;
    const starts: number[] = [];
    state.doc.forEach((_n, offset) => starts.push(offset));
    tr.delete($to.start(), $to.pos);
    for (let i = b - 1; i > a; i--) {
      if (hidden.has(i)) continue;
      tr.delete(starts[i]!, starts[i]! + state.doc.child(i).nodeSize);
    }
    tr.delete($from.pos, $from.end());
    tr.setSelection(TextSelection.create(tr.doc, $from.pos));
    normalizeDepths(tr);
    return tr;
  }
  if (!crosses) return null;
  const tr = state.tr;
  const bPos = $to.before(1);
  const rest = $to.parent.content.cut($to.parentOffset);
  tr.delete(bPos, bPos + $to.parent.nodeSize);
  const starts: number[] = [];
  state.doc.forEach((_n, offset) => starts.push(offset));
  for (let i = b - 1; i > a; i--) {
    if (hidden.has(i)) continue;
    const n = state.doc.child(i);
    tr.delete(starts[i]!, starts[i]! + n.nodeSize);
  }
  const pos = $from.pos;
  tr.delete(pos, $from.end());
  if (rest.size) tr.insert(pos, rest);
  tr.setSelection(TextSelection.create(tr.doc, pos));
  normalizeDepths(tr);
  return tr;
}

/** ↑/↓/←/→ at the edge of a block whose neighbour is hidden in a collapsed toggle: go to the next visible block. */
function skipHidden(editor: Editor, dir: 1 | -1, edge: "up" | "down" | "left" | "right"): boolean {
  const { state, view } = editor;
  const sel = state.selection;
  let index: number;
  if (sel instanceof NodeSelection && sel.$from.depth === 0) index = sel.$from.index(0);
  else {
    if (!sel.empty || sel.$from.depth < 1 || !view.endOfTextblock(edge)) return false;
    index = sel.$from.index(0);
  }
  const next = index + dir;
  if (next < 0 || next >= state.doc.childCount || !hiddenIndices(state).has(next)) return false;
  const target = neighbourIndex(state, index, dir);
  if (target === null) return true;
  let pos = 0;
  for (let i = 0; i < target; i++) pos += state.doc.child(i).nodeSize;
  const node = state.doc.child(target);
  const folded = node.type.name === "codeBlock" && node.attrs.language === "mermaid" && node.textContent.trim();
  const tr = state.tr;
  if (node.isTextblock && !folded) tr.setSelection(TextSelection.create(tr.doc, dir > 0 ? pos + 1 : pos + node.nodeSize - 1));
  else tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Shift+Tab in code: up to two spaces off the start of each selected line. False when there were none. */
function outdentCodeLines(editor: Editor): boolean {
  const { state } = editor;
  const { $from, $to } = state.selection;
  if ($from.parent !== $to.parent || $from.parent.type.name !== "codeBlock") return false;
  const start = $from.start();
  const text = $from.parent.textContent;
  const fromOff = $from.parentOffset;
  const toOff = $to.parentOffset;
  const tr = state.tr;
  let lineStart = text.lastIndexOf("\n", fromOff - 1) + 1;
  const edits: [number, number][] = [];
  while (lineStart <= toOff) {
    const spaces = /^ {1,2}/.exec(text.slice(lineStart))?.[0].length ?? 0;
    if (spaces) edits.push([lineStart, spaces]);
    const nl = text.indexOf("\n", lineStart);
    if (nl < 0 || nl >= toOff) break;
    lineStart = nl + 1;
  }
  if (!edits.length) return false;
  for (const [at, n] of edits.reverse()) tr.delete(start + at, start + at + n);
  editor.view.dispatch(tr);
  return true;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** → at the end of a line ending in inline code: what's typed next is plain text (the caret can't move further). */
function leaveInlineCode(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.depth < 1 || $from.parentOffset !== $from.parent.content.size) return false;
  const code = state.schema.marks.code;
  const marks = state.storedMarks ?? $from.marks();
  if (!code || !code.isInSet(marks)) return false;
  view.dispatch(state.tr.setStoredMarks(code.removeFromSet(marks)));
  return true;
}

/** ⌘↑ / ⌘↓: the caret to the start or end of the note, or the image or divider there selected. */
function edgeOfNote(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const doc = state.doc;
  const index = dir < 0 ? 0 : doc.childCount - 1;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const node = doc.child(index);
  const tr = state.tr;
  if (node.isTextblock) tr.setSelection(TextSelection.create(doc, dir < 0 ? pos + 1 : pos + node.nodeSize - 1));
  else tr.setSelection(NodeSelection.create(doc, pos));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const BlockKeymap = Extension.create({
  name: "blockKeymap",
  priority: 1000,
  addKeyboardShortcuts() {
    const editor = this.editor as Editor;
    return {
      Enter: () => {
        const sel0 = editor.state.selection;
        if (sel0 instanceof NodeSelection && sel0.$from.depth === 0) {
          const node = sel0.node;
          const st = editor.state;
          // A folded Mermaid diagram: Enter opens its source.
          if (node.type.name === "codeBlock") {
            editor.view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, sel0.from + 1 + node.content.size)).scrollIntoView());
            return true;
          }
          // Any other selected block: a new line after it (and after what's nested under it).
          const at = afterSubtree(st, sel0.$from.index(0));
          const tr = st.tr.insert(at, st.schema.nodes.paragraph!.create({ id: null, depth: node.attrs.depth }));
          tr.setSelection(TextSelection.create(tr.doc, at + 1));
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
        if (!editor.state.selection.empty) {
          if (editor.state.selection instanceof NodeSelection) return false;
          const visible = deleteVisibleRange(editor.state);
          if (visible) editor.view.dispatch(visible);
          else editor.commands.deleteSelection();
        }
        const { state } = editor;
        const cur = currentBlock(state);
        if (!cur) return false;
        const type = cur.node.type.name;
        if (type === "codeBlock" || !cur.node.isTextblock) return false;
        const depth = Number(cur.node.attrs.depth ?? 0);
        const $from = state.selection.$from;
        const index = $from.index(0);
        const listLike = LIST_TYPES.has(type) || type === "quote" || type === "toggle" || type === "callout";
        if (cur.empty && listLike) {
          // An empty list item ends the list (or outdents when nested).
          if (depth > 0) return changeDepth(editor, -1);
          return turnInto(editor, "paragraph");
        }
        // At the start of a line with text: a new empty line above. The block itself keeps its id, type,
        // task details and styling (so comments and links to it stay attached).
        if (cur.atStart && !cur.empty) {
          const above = LIST_TYPES.has(type) ? cur.node.type : state.schema.nodes.paragraph!;
          editor.view.dispatch(state.tr.insert(cur.pos, above.create({ id: ulid(), depth })).scrollIntoView());
          return true;
        }
        const atEnd = $from.parentOffset === cur.node.content.size;
        const nextType = LIST_TYPES.has(type) ? type : type === "heading" ? (atEnd ? "paragraph" : "heading") : "paragraph";
        // Bold and colour continue on the new line; inline code doesn't.
        const marks = (state.storedMarks ?? ($from.parentOffset ? $from.marks() : null))?.filter((m) => !m.type.spec.code) ?? null;
        // A collapsed toggle: the new line goes after its hidden blocks, taking the text after the caret.
        if (type === "toggle" && cur.node.attrs.collapsed) {
          const rest = cur.node.content.cut($from.parentOffset);
          const at = afterSubtree(state, index);
          const tr = state.tr.insert(at, state.schema.nodes.paragraph!.create(splitAttrs(cur.node, "paragraph", depth), rest));
          tr.delete($from.pos, $from.end());
          const caret = tr.mapping.slice(1).map(at) + 1;
          tr.setSelection(TextSelection.create(tr.doc, caret));
          if (marks) tr.ensureMarks(marks);
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
        // An open toggle's new line is its first nested line; so is a split of a block with nested blocks
        // (they stay under the line they belonged to instead of moving to the new one).
        const next = state.doc.maybeChild(index + 1);
        const hasChildren = Boolean(next && Number(next.attrs.depth ?? 0) > depth);
        const newDepth = Math.min(LIMITS.maxDepth, type === "toggle" || hasChildren ? depth + 1 : depth);
        const tr = state.tr.split($from.pos, 1, [{ type: state.schema.nodes[nextType]!, attrs: splitAttrs(cur.node, nextType, newDepth) }]);
        if (marks) tr.ensureMarks(marks);
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      Backspace: () => backspace(),
      "Shift-Backspace": () => backspace(),
      // Word and line deletes only need the block rules at the start of a line or over a range; mid-line
      // they keep their usual meaning (backspace() lets them through then).
      "Mod-Backspace": () => backspace(),
      "Alt-Backspace": () => backspace(),
      Delete: () => del(),
      "Shift-Delete": () => del(),
      "Mod-Delete": () => del(),
      "Alt-Delete": () => del(),
      // The Mac's Control keys for the same (Ctrl+H, Ctrl+D) and Ctrl+K, delete to the end of the line.
      ...(isMac ? { "Ctrl-h": () => backspace(), "Ctrl-d": () => del(), "Ctrl-k": () => killToLineEnd() } : {}),
      // ⌘↑ / ⌘↓: the start or end of the note (selecting an image or divider there).
      "Mod-ArrowUp": () => edgeOfNote(editor, -1),
      "Mod-ArrowDown": () => edgeOfNote(editor, 1),
      // Tab never leaves the page: it indents (or does nothing when it can't). Code blocks indent their text.
      Tab: () => (editor.state.selection.$from.parent.type.name === "codeBlock" ? false : (changeDepth(editor, 1), true)),
      "Shift-Tab": () => (editor.state.selection.$from.parent.type.name === "codeBlock" ? (outdentCodeLines(editor) || changeDepth(editor, -1), true) : (changeDepth(editor, -1), true)),
      // Past hidden blocks (inside a collapsed toggle), the arrows go to the next visible one.
      ArrowDown: () => skipHidden(editor, 1, "down"),
      ArrowRight: () => leaveInlineCode(editor) || skipHidden(editor, 1, "right"),
      ArrowUp: () => skipHidden(editor, -1, "up"),
      ArrowLeft: () => skipHidden(editor, -1, "left"),
      "Alt-Shift-ArrowUp": () => moveBlock(editor, -1),
      "Alt-Shift-ArrowDown": () => moveBlock(editor, 1),
      "Mod-Alt-0": () => turnInto(editor, "paragraph"),
      "Mod-Alt-1": () => turnInto(editor, "heading", { level: 1 }),
      "Mod-Alt-2": () => turnInto(editor, "heading", { level: 2 }),
      "Mod-Alt-3": () => turnInto(editor, "heading", { level: 3 }),
      "Mod-Shift-7": () => turnInto(editor, "numbered"),
      "Mod-Shift-8": () => turnInto(editor, "bulleted"),
      "Mod-Shift-9": () => turnInto(editor, "todo", { checked: false }),
      "Mod-Enter": () => {
        const cur = currentBlock(editor.state);
        if (!cur) return false;
        if (cur.node.type.name === "todo") {
          const checked = !cur.node.attrs.checked;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(cur.pos, undefined, { ...cur.node.attrs, checked, completedAt: checked ? Date.now() : null }));
          return true;
        }
        if (cur.node.type.name === "toggle") {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(cur.pos, undefined, { ...cur.node.attrs, collapsed: !cur.node.attrs.collapsed }));
          return true;
        }
        return false;
      },
      "Mod-d": () => duplicateBlocks(editor),
      "Mod-Shift-Backspace": () => deleteBlocks(editor),
    };

    /** Backspace (and its word/line variants): the block rules at the start of a line or over a range. */
    function backspace(): boolean {
      const { state } = editor;
      if (!state.selection.empty) {
        const visible = deleteVisibleRange(state);
        if (!visible) return false;
        editor.view.dispatch(visible.scrollIntoView());
        return true;
      }
      const cur = currentBlock(state);
      if (!cur || !cur.atStart) return false;
      const type = cur.node.type.name;
      if (type !== "paragraph" && TEXT_NODES.has(type)) return turnInto(editor, "paragraph");
      // Code at the start: an empty block becomes text; one with code stays put (merging would flatten it).
      if (type === "codeBlock") return cur.empty ? turnInto(editor, "paragraph") : true;
      if (Number(cur.node.attrs.depth ?? 0) > 0) return changeDepth(editor, -1);
      const index = state.selection.$from.index(0);
      if (index === 0) return false;
      const prev = state.doc.child(index - 1);
      const hiddenAbove = hiddenIndices(state).has(index - 1);
      // Code above: move into it (merging would put this text inside the code, unformatted).
      if (!hiddenAbove && prev.type.name === "codeBlock") {
        editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, cur.pos - 1)).scrollIntoView());
        return true;
      }
      // Deleting into an atom block above (an image, a divider…) selects it first instead of removing it.
      if (prev.isAtom && !hiddenAbove) {
        if (cur.empty) return deleteBlocks(editor, [index], false);
        editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, cur.pos - prev.nodeSize)).scrollIntoView());
        return true;
      }
      // The block above is hidden inside a collapsed toggle: join with the toggle's own line instead.
      if (hiddenAbove) {
        const target = neighbourIndex(state, index, -1);
        if (target === null) return true;
        let tPos = 0;
        for (let i = 0; i < target; i++) tPos += state.doc.child(i).nodeSize;
        const tNode = state.doc.child(target);
        if (!tNode.isTextblock) return true;
        const end = tPos + tNode.nodeSize - 1;
        const tr = state.tr;
        // This line's own nested blocks would end up hidden in the toggle: open it.
        const next = state.doc.maybeChild(index + 1);
        if (tNode.type.name === "toggle" && next && Number(next.attrs.depth ?? 0) > Number(cur.node.attrs.depth ?? 0)) tr.setNodeMarkup(tPos, undefined, { ...tNode.attrs, collapsed: false });
        tr.delete(cur.pos, cur.pos + cur.node.nodeSize);
        if (cur.node.content.size && tNode.type.name !== "codeBlock") tr.insert(end, cur.node.content);
        tr.setSelection(TextSelection.create(tr.doc, end));
        normalizeDepths(tr);
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      }
      return false;
    }

    /** Delete (and its word/line variants): the block rules at the end of a line or over a range. */
    function del(): boolean {
      const { state } = editor;
      if (!state.selection.empty) {
        const visible = deleteVisibleRange(state);
        if (!visible) return false;
        editor.view.dispatch(visible.scrollIntoView());
        return true;
      }
      const cur = currentBlock(state);
      if (!cur || state.selection.$from.parentOffset !== cur.node.content.size) return false;
      const index = state.selection.$from.index(0);
      const nextBlock = state.doc.maybeChild(index + 1);
      // Code below: move into it rather than pulling the code into this line.
      if (nextBlock?.type.name === "codeBlock" && !hiddenIndices(state).has(index + 1) && cur.node.type.name !== "codeBlock") {
        editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, cur.pos + cur.node.nodeSize + 1)).scrollIntoView());
        return true;
      }
      // Deleting into an atom below (an image, a divider…) selects it first instead of removing it.
      if (nextBlock?.isAtom && !hiddenIndices(state).has(index + 1)) {
        if (cur.empty && cur.node.type.name === "paragraph") return deleteBlocks(editor, [index], false);
        editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, cur.pos + cur.node.nodeSize)).scrollIntoView());
        return true;
      }
      // At the end of a collapsed toggle the next block in the document is hidden: join the next visible
      // line (when it has nothing nested under it) instead of pulling hidden text into the toggle.
      if (cur.node.type.name !== "toggle" || !cur.node.attrs.collapsed) return false;
      const target = neighbourIndex(state, index, 1);
      if (target === null) return true;
      let tPos = 0;
      for (let i = 0; i < target; i++) tPos += state.doc.child(i).nodeSize;
      const tNode = state.doc.child(target);
      const after = state.doc.maybeChild(target + 1);
      if (!tNode.isTextblock || tNode.type.name === "codeBlock" || (after && Number(after.attrs.depth ?? 0) > Number(tNode.attrs.depth ?? 0))) return true;
      const end = state.selection.from;
      const tr = state.tr.delete(tPos, tPos + tNode.nodeSize).insert(end, tNode.content);
      tr.setSelection(TextSelection.create(tr.doc, end));
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    }

    /** Ctrl+K (Mac): delete to the end of the line; at the end, join the next line like Delete does. */
    function killToLineEnd(): boolean {
      const { state } = editor;
      const { $from, empty } = state.selection;
      if (!empty || $from.depth < 1 || !$from.parent.isTextblock) return false;
      if ($from.parentOffset < $from.parent.content.size) {
        editor.view.dispatch(state.tr.delete($from.pos, $from.end()).scrollIntoView());
        return true;
      }
      return del() || editor.commands.joinForward();
    }
  },
});

function blockRule(find: RegExp, type: string, attrs: (m: RegExpMatchArray) => Record<string, unknown> = () => ({})) {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const $start = state.doc.resolve(range.from);
      const node = $start.parent;
      if ($start.depth !== 1) return null;
      if (!TEXT_NODES.has(node.type.name)) return null;
      const pos = $start.before(1);
      const schemaType = state.schema.nodes[type]!;
      const tr = state.tr.delete(range.from, range.to);
      if (type === "codeBlock") {
        // Any text after the shortcut becomes the code.
        const rest = tr.doc.nodeAt(pos)!.textContent;
        tr.replaceWith(pos, pos + tr.doc.nodeAt(pos)!.nodeSize, schemaType.create({ id: node.attrs.id, depth: node.attrs.depth, ...attrs(match) }, rest ? state.schema.text(rest) : null));
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
      } else {
        // Like "Turn into": the line keeps its styling (and a to-do its task details).
        const kept: Record<string, unknown> = {};
        if (FORMATTABLE_TYPES.has(type) && FORMATTABLE_TYPES.has(node.type.name)) for (const k of CARRIED_FORMAT) if (node.attrs[k] != null) kept[k] = node.attrs[k];
        if (type === node.type.name) Object.assign(kept, node.attrs);
        tr.setNodeMarkup(pos, schemaType, { ...kept, id: node.attrs.id, depth: node.attrs.depth, ...attrs(match) });
      }
    },
  });
}

/** Markdown-style shortcuts at the start of a block. */
export const MarkdownShortcuts = Extension.create({
  name: "markdownShortcuts",
  addInputRules() {
    return [
      blockRule(/^(#{1,3})\s$/, "heading", (m) => ({ level: m[1]!.length })),
      blockRule(/^[-*+]\s$/, "bulleted"),
      blockRule(/^1[.)]\s$/, "numbered"),
      blockRule(/^\[( |x)?\]\s$/, "todo", (m) => ({ checked: m[1] === "x" })),
      blockRule(/^>\s$/, "quote"),
      blockRule(/^!!\s$/, "callout", () => ({ tone: "note" })),
      blockRule(/^```([\w+#.-]*)\s$/, "codeBlock", (m) => ({ language: normalizeLanguage(m[1] || "plaintext") })),
      new InputRule({
        find: /^(---|\*\*\*)$/,
        handler: ({ state, range }) => {
          const $start = state.doc.resolve(range.from);
          if ($start.depth !== 1 || $start.parent.type.name !== "paragraph") return null;
          const pos = $start.before(1);
          const node = $start.parent;
          const tr = state.tr;
          // Text after the caret moves below the divider and keeps the line's id (and its comments); on an
          // empty line the divider takes its place.
          const rest = node.content.cut(range.to - $start.start());
          const divider = state.schema.nodes.divider!.create({ id: rest.size ? ulid() : node.attrs.id, depth: node.attrs.depth });
          const para = state.schema.nodes.paragraph!.create({ ...(rest.size ? node.attrs : {}), id: rest.size ? node.attrs.id : ulid(), depth: node.attrs.depth }, rest);
          tr.replaceWith(pos, pos + node.nodeSize, [divider, para]);
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos + divider.nodeSize + 1)));
        },
      }),
      // Inline marks: **bold**, _italic_, `code`, ~~strike~~
      markRule(/(?:^|\s)(\*\*([^*]+)\*\*)$/, "bold"),
      markRule(/(?:^|\s)(_([^_]+)_)$/, "italic"),
      markRule(/(?:^|\s)(`([^`]+)`)$/, "code"),
      markRule(/(?:^|\s)(~~([^~]+)~~)$/, "strike"),
    ];
  },
});

function markRule(find: RegExp, mark: string) {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const full = match[1]!;
      const inner = match[2]!;
      // range.from is where the whole match (including a leading space) starts in the document; the
      // last typed character is part of the match but not yet in the document, so start from `from`.
      const start = range.from + (match[0].length - full.length);
      const markType = state.schema.marks[mark]!;
      const tr = state.tr;
      // The text keeps the formatting it already had (italic, a colour, a link) and gains this one.
      const existing = state.doc.resolve(Math.min(start + 1, range.to)).marks();
      tr.replaceWith(start, range.to, state.schema.text(inner, markType.create().addToSet(existing)));
      tr.removeStoredMark(markType);
    },
  });
}

export type TriggerKind = "slash" | "page" | "mention";
export interface TriggerState {
  kind: TriggerKind;
  query: string;
  from: number;
  to: number;
}

export const triggerKey = new PluginKey<TriggerState | null>("foleviTrigger");

/** Detects "/" (block menu), "[[" (page link) and "@" (mention/date) while typing. */
export const Triggers = Extension.create<{ onChange: (t: TriggerState | null) => void }>({
  name: "triggers",
  addOptions: () => ({ onChange: () => undefined }),
  addProseMirrorPlugins() {
    const onChange = this.options.onChange;
    let last: string | null = null;
    return [
      new Plugin({
        key: triggerKey,
        view: () => ({
          update: (view) => {
            const { state } = view;
            const sel = state.selection;
            let found: TriggerState | null = null;
            if (sel.empty && sel.$from.parent.isTextblock && sel.$from.parent.type.name !== "codeBlock") {
              const text = sel.$from.parent.textBetween(0, sel.$from.parentOffset, "\n", "￼");
              const start = sel.from - sel.$from.parentOffset;
              // "/" and "@" also in their full-width forms (Japanese and Chinese keyboards); queries in any script.
              let m = /(?:^|\s)[/／]([\p{L}\p{N}_-]{0,24})$/u.exec(text);
              if (m) found = { kind: "slash", query: m[1]!.normalize("NFKC"), from: start + text.length - m[1]!.length - 1, to: sel.from };
              m = /\[\[([^\]\n]{0,60})$/.exec(text);
              if (m) found = { kind: "page", query: m[1]!, from: start + text.length - m[1]!.length - 2, to: sel.from };
              m = /(?:^|\s)[@＠]([\p{L}\p{M}\p{N}' .-]{0,30})$/u.exec(text);
              if (m && !found) found = { kind: "mention", query: m[1]!.normalize("NFKC"), from: start + text.length - m[1]!.length - 1, to: sel.from };
            }
            const key = found ? `${found.kind}:${found.from}:${found.query}` : null;
            if (key !== last) {
              last = key;
              onChange(found);
            }
          },
        }),
      }),
    ];
  },
});

export { blocksInSelection, normalizeDepths };
