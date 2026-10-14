// Live carets: where other people's selections are in the note, drawn as a thin caret in their colour with
// their first name, and a soft highlight over what they've selected. Selections travel as (block id, offset
// into the block's text) at each end, or as whole blocks, never as positions or text: positions differ from
// one copy of the note to the next while edits are on their way. `selectionToCursor` makes one from this
// editor's selection; `setRemoteCarets(view, carets)` hands in other people's (a meta transaction, so a caret
// moving re-renders nothing but its decorations), and they move with edits until the next update.
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { blockSelectionKey } from "./blockSelectionState";
import { personInk } from "./plugins";

export interface CaretPoint {
  blockId: string;
  offset: number;
}

/** A selection as it travels between people: both ends, and whether it's whole blocks. */
export interface CursorSpec {
  anchor: CaretPoint;
  head: CaretPoint;
  block?: boolean;
}

/** Someone else's selection, as the server sends it. */
export interface RemoteCursor extends CursorSpec {
  key: string;
  name: string;
  color: string;
}

/** A remote selection placed in this editor's document. */
interface PlacedCaret {
  key: string;
  name: string;
  color: string;
  /** The caret (the selection's head) and the other end. */
  head: number;
  anchor: number;
  /** Whole blocks: the first and last selected block's positions. */
  block: boolean;
  /** Bumped when the caret moves, which shows its name again for a moment. */
  moved: number;
}

/** The top-level block at each id, with its position. */
function blockPositions(doc: PMNode): Map<string, { pos: number; node: PMNode }> {
  const out = new Map<string, { pos: number; node: PMNode }>();
  doc.forEach((node, pos) => {
    const id = node.attrs.id as string | null | undefined;
    if (id && !out.has(id)) out.set(id, { pos, node });
  });
  return out;
}

/** A position in the document as (top-level block id, offset into that block's content). */
export function pointAt(doc: PMNode, pos: number): CaretPoint | null {
  if (!doc.childCount) return null;
  const at = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(at);
  // Between blocks (a gap cursor, or the very end): the block after it, or the last one.
  const index = $pos.depth >= 1 ? $pos.index(0) : Math.min($pos.index(0), doc.childCount - 1);
  let start = 0;
  if ($pos.depth >= 1) start = $pos.before(1);
  else for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
  const node = doc.child(index);
  const id = node.attrs.id as string | null | undefined;
  if (!id) return null;
  const offset = Math.max(0, Math.min(at - start - 1, node.content.size));
  return { blockId: id, offset: $pos.depth >= 1 ? offset : 0 };
}

/** This editor's selection as a cursor to send, or null when there's nothing to show. */
export function selectionToCursor(state: EditorState): CursorSpec | null {
  const blocks = blockSelectionKey.getState(state);
  if (blocks) return { anchor: { blockId: blocks.anchor, offset: 0 }, head: { blockId: blocks.head, offset: 0 }, block: true };
  const sel = state.selection;
  // A picture, a table or another block chosen whole.
  if (sel instanceof NodeSelection && sel.$from.depth === 0) {
    const id = sel.node.attrs.id as string | null | undefined;
    return id ? { anchor: { blockId: id, offset: 0 }, head: { blockId: id, offset: 0 }, block: true } : null;
  }
  const anchor = pointAt(state.doc, sel.anchor);
  const head = pointAt(state.doc, sel.head);
  return anchor && head ? { anchor, head } : null;
}

export function sameCursor(a: CursorSpec | null, b: CursorSpec | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.anchor.blockId === b.anchor.blockId &&
    a.anchor.offset === b.anchor.offset &&
    a.head.blockId === b.head.blockId &&
    a.head.offset === b.head.offset &&
    Boolean(a.block) === Boolean(b.block)
  );
}

/**
 * Where a cursor falls in this document: positions for both ends, clamped to what the blocks hold now.
 * Null when a block it names isn't here (deleted, or not synced yet): such a caret is dropped quietly.
 */
export function cursorToRange(doc: PMNode, cursor: CursorSpec, positions = blockPositions(doc)): { anchor: number; head: number; block: boolean } | null {
  const a = positions.get(cursor.anchor.blockId);
  const h = positions.get(cursor.head.blockId);
  if (!a || !h) return null;
  // A block without text (a picture, a divider) can only be selected whole.
  const block = Boolean(cursor.block) || !h.node.isTextblock || !a.node.isTextblock;
  if (block) return { anchor: a.pos, head: h.pos, block: true };
  const place = (p: { pos: number; node: PMNode }, offset: number) => p.pos + 1 + Math.min(offset, p.node.content.size);
  return { anchor: place(a, cursor.anchor.offset), head: place(h, cursor.head.offset), block: false };
}

const key = new PluginKey<{ carets: PlacedCaret[]; set: DecorationSet }>("foleviRemoteCarets");

/** Sets the remote carets shown in the note (an empty list clears them). */
export function setRemoteCarets(view: EditorView, cursors: readonly RemoteCursor[]) {
  if (view.isDestroyed) return;
  const before = key.getState(view.state);
  if (!before) return;
  if (!cursors.length && !before.carets.length) return;
  view.dispatch(view.state.tr.setMeta(key, cursors).setMeta("addToHistory", false).setMeta("remote", true));
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

const safeColor = (color: string) => (/^[a-z0-9-]+$/i.test(color) ? color : "ink-muted");

function caretWidget(c: PlacedCaret): HTMLElement {
  const caret = document.createElement("span");
  caret.className = "fb-remote-caret";
  caret.setAttribute("data-fb-widget", "caret");
  caret.setAttribute("data-remote-caret", firstName(c.name));
  caret.setAttribute("aria-hidden", "true");
  caret.style.setProperty("--caret", `var(--color-${c.color})`);
  caret.style.setProperty("--caret-ink", personInk(c.color));
  const label = document.createElement("span");
  label.className = "fb-remote-caret-label";
  label.textContent = firstName(c.name);
  caret.appendChild(label);
  return caret;
}

function build(doc: PMNode, carets: PlacedCaret[]): DecorationSet {
  if (!carets.length) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const c of carets) {
    const style = `--caret:var(--color-${c.color})`;
    if (c.block) {
      const from = Math.min(c.anchor, c.head);
      const to = Math.max(c.anchor, c.head);
      doc.forEach((node, pos) => {
        if (pos >= from && pos <= to) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "fb-remote-block", style }));
      });
      const first = doc.nodeAt(c.head);
      if (first) decos.push(Decoration.widget(c.head + (first.isTextblock ? 1 : 0), () => caretWidget(c), { key: `caret:${c.key}:${c.head}:${c.moved}`, side: -1, ignoreSelection: true }));
      continue;
    }
    if (c.anchor !== c.head) decos.push(Decoration.inline(Math.min(c.anchor, c.head), Math.max(c.anchor, c.head), { class: "fb-remote-range", style }));
    decos.push(Decoration.widget(c.head, () => caretWidget(c), { key: `caret:${c.key}:${c.head}:${c.moved}`, side: 1, ignoreSelection: true }));
  }
  return DecorationSet.create(doc, decos);
}

/** Places the cursors in `doc`, keeping how recently each one moved. */
function place(doc: PMNode, cursors: readonly RemoteCursor[], before: PlacedCaret[]): PlacedCaret[] {
  const positions = blockPositions(doc);
  const prev = new Map(before.map((c) => [c.key, c]));
  const out: PlacedCaret[] = [];
  for (const cursor of cursors) {
    const range = cursorToRange(doc, cursor, positions);
    if (!range) continue;
    const was = prev.get(cursor.key);
    const moved = was && was.head === range.head && was.anchor === range.anchor && was.block === range.block ? was.moved : (was?.moved ?? 0) + 1;
    out.push({ key: cursor.key, name: cursor.name, color: safeColor(cursor.color), ...range, moved });
  }
  return out;
}

function mapCarets(tr: Transaction, carets: PlacedCaret[]): PlacedCaret[] {
  const out: PlacedCaret[] = [];
  for (const c of carets) {
    // (Text typed at a caret goes before it: most often it's that person's own typing arriving.)
    const head = tr.mapping.mapResult(c.head, 1);
    const anchor = tr.mapping.mapResult(c.anchor, 1);
    // Blocks that were deleted take their carets with them.
    if (c.block && (head.deleted || anchor.deleted)) continue;
    const size = tr.doc.content.size;
    out.push({ ...c, head: Math.min(head.pos, size), anchor: Math.min(anchor.pos, size) });
  }
  return out;
}

export const RemoteCarets = Extension.create({
  name: "remoteCarets",
  addProseMirrorPlugins() {
    return [
      new Plugin<{ carets: PlacedCaret[]; set: DecorationSet }>({
        key,
        state: {
          init: () => ({ carets: [], set: DecorationSet.empty }),
          apply: (tr, value, _old, state) => {
            const next = tr.getMeta(key) as RemoteCursor[] | undefined;
            if (next) {
              const carets = place(state.doc, next, value.carets);
              return { carets, set: build(state.doc, carets) };
            }
            if (!tr.docChanged || !value.carets.length) return value;
            const carets = mapCarets(tr, value.carets);
            // Block highlights follow whole blocks: rebuilt. A text caret just moves with the edit.
            return { carets, set: carets.some((c) => c.block) ? build(tr.doc, carets) : value.set.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.set ?? null,
          // With carets showing, the name on a line someone is in is the caret's (editor.css).
          attributes: (state): Record<string, string> => (key.getState(state)?.carets.length ? { class: "fb-has-carets" } : {}),
        },
      }),
    ];
  },
});

/** The carets placed in the editor now (tests and debugging). */
export function remoteCaretsOf(state: EditorState): readonly { key: string; head: number; anchor: number; block: boolean }[] {
  return key.getState(state)?.carets ?? [];
}
