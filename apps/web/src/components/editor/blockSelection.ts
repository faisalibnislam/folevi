// Block-level multi-selection (see blockSelectionState.ts for the state shape).
//
// Enter it with Escape (selects the current block), Shift+↑/↓ at the edge of a block, or Shift-click on
// a block's grip. While active: Shift+↑/↓ extend or shrink it, ⌥⇧↑/↓ move, ⌘D duplicates, Tab/⇧Tab
// indent, Backspace/Delete delete, ⌘C/⌘X copy/cut, ⌘. opens the block menu for all selected blocks,
// Escape/↑/↓/click/typing return to normal text editing. The text caret stays collapsed meanwhile.
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { blockAt, changeDepth, deleteBlocks, duplicateBlocks, moveBlock } from "./commands";
import { blockSelectionKey, blockSelectionRange, indexOfBlock, neighbourIndex, syncDomSelection, type BlockSelection, type BlockSelectionMeta } from "./blockSelectionState";

export { blockSelectionKey, blockSelectionRange };

function idAt(state: EditorState, index: number): string | null {
  return (state.doc.maybeChild(index)?.attrs.id as string | null | undefined) ?? null;
}

/** Selects blocks `anchor`..`head` (top-level indices). */
export function setBlockSelection(view: EditorView, anchor: number, head: number): boolean {
  const a = idAt(view.state, anchor);
  const h = idAt(view.state, head);
  if (!a || !h) return false;
  // Park the caret inside the head block so "leaving" the selection lands somewhere sensible.
  const ref = blockAt(view.state, head)!;
  const tr = view.state.tr.setMeta(blockSelectionKey, { set: { anchor: a, head: h } } satisfies BlockSelectionMeta);
  if (ref.node.isTextblock) tr.setSelection(TextSelection.create(tr.doc, ref.pos + 1 + ref.node.content.size));
  view.dispatch(tr.setMeta("addToHistory", false));
  return true;
}

export function clearBlockSelection(view: EditorView): void {
  if (!blockSelectionKey.getState(view.state)) return;
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true } satisfies BlockSelectionMeta).setMeta("addToHistory", false));
}

/** Extends the block selection (or starts one from the current block) up to block `index`. */
export function extendBlockSelectionTo(view: EditorView, index: number): boolean {
  const sel = blockSelectionKey.getState(view.state);
  const anchorIndex = sel ? indexOfBlock(view.state, sel.anchor) : view.state.selection.$anchor.index(0);
  return setBlockSelection(view, anchorIndex < 0 ? index : anchorIndex, index);
}

/** Puts a collapsed caret at the start or end of block `index` (the transaction must not change the doc). */
function placeCaret(state: EditorState, index: number, atEnd: boolean, tr: Transaction) {
  const ref = blockAt(state, index);
  if (!ref) return;
  const pos = ref.node.isTextblock ? ref.pos + 1 + (atEnd ? ref.node.content.size : 0) : ref.pos;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), atEnd ? -1 : 1));
}

function copySelection(view: EditorView, event: ClipboardEvent): boolean {
  const range = blockSelectionRange(view.state);
  if (!range || !event.clipboardData) return false;
  const start = blockAt(view.state, range.from)!.pos;
  const last = blockAt(view.state, range.to)!;
  const slice = view.state.doc.slice(start, last.pos + last.node.nodeSize);
  const { dom, text } = view.serializeForClipboard(slice);
  event.preventDefault();
  event.clipboardData.clearData();
  event.clipboardData.setData("text/html", dom.innerHTML);
  event.clipboardData.setData("text/plain", text);
  return true;
}

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Fn"]);

export const BlockSelectionExtension = Extension.create({
  name: "blockSelection",
  // Runs before the block keymap so Tab, ⌘D, arrows etc. act on the whole block selection.
  priority: 1100,
  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    return [
      new Plugin<BlockSelection | null>({
        key: blockSelectionKey,
        state: {
          init: () => null,
          apply: (tr, value, _old, next) => {
            const meta = tr.getMeta(blockSelectionKey) as BlockSelectionMeta | undefined;
            if (meta && "clear" in meta) return null;
            if (meta && "set" in meta) return meta.set;
            if (!value) return null;
            // A pointer selection elsewhere ends the block selection.
            if (tr.getMeta("pointer")) return null;
            if (tr.docChanged) {
              let hasAnchor = false;
              let hasHead = false;
              next.doc.forEach((n) => {
                if (n.attrs.id === value.anchor) hasAnchor = true;
                if (n.attrs.id === value.head) hasHead = true;
              });
              if (!hasAnchor || !hasHead) return null;
            }
            return value;
          },
        },
        props: {
          decorations: (state) => {
            const range = blockSelectionRange(state);
            if (!range) return null;
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset, index) => {
              if (index >= range.from && index <= range.to) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "fb-selected", "aria-selected": "true" }));
            });
            return DecorationSet.create(state.doc, decos);
          },
          attributes: (state): Record<string, string> => (blockSelectionKey.getState(state) ? { class: "fb-block-selecting" } : {}),
          handleDOMEvents: {
            copy: (view, event) => copySelection(view, event),
            cut: (view, event) => {
              if (!copySelection(view, event)) return false;
              const range = blockSelectionRange(view.state)!;
              const indices: number[] = [];
              for (let i = range.from; i <= range.to; i++) indices.push(i);
              deleteBlocks(editor, indices);
              return true;
            },
            mousedown: (view, event) => {
              const range = blockSelectionRange(view.state);
              if (!range) return false;
              if (event.shiftKey) {
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (pos) {
                  event.preventDefault();
                  extendBlockSelectionTo(view, view.state.doc.resolve(pos.pos).index(0));
                  return true;
                }
              }
              clearBlockSelection(view);
              return false;
            },
          },
          handleKeyDown: (view, event) => {
            if (event.key === "Escape" || (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp"))) syncDomSelection(view);
            const { state } = view;
            const range = blockSelectionRange(state);
            const mod = event.metaKey || event.ctrlKey;
            if (!range) {
              if (event.defaultPrevented || event.isComposing) return false;
              // Escape selects the block the caret is in (the keyboard way into block selection).
              if (event.key === "Escape" && !mod && !event.shiftKey && !event.altKey && !document.querySelector(".fb-drag-ghost")) {
                const $from = state.selection.$from;
                const $to = state.selection.$to;
                return setBlockSelection(view, $from.index(0), Math.min($to.index(0), state.doc.childCount - 1));
              }
              // Shift+↑/↓ at the edge of a block grows the selection to whole blocks.
              if (event.shiftKey && !mod && !event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                const dir = event.key === "ArrowDown" ? 1 : -1;
                if (!view.endOfTextblock(dir > 0 ? "down" : "up")) return false;
                const anchorIndex = state.selection.$anchor.index(0);
                const headIndex = state.selection.$head.index(0);
                const next = neighbourIndex(state, headIndex, dir);
                if (next === null) return false;
                event.preventDefault();
                return setBlockSelection(view, anchorIndex, next);
              }
              return false;
            }
            if (MODIFIER_KEYS.has(event.key)) return false;
            const sel = blockSelectionKey.getState(state)!;
            const headIndex = indexOfBlock(state, sel.head);
            const anchorIndex = indexOfBlock(state, sel.anchor);
            const leave = (index: number, atEnd: boolean) => {
              const tr = state.tr.setMeta(blockSelectionKey, { clear: true } satisfies BlockSelectionMeta).setMeta("addToHistory", false);
              placeCaret(state, index, atEnd, tr);
              view.dispatch(tr.scrollIntoView());
              return true;
            };
            switch (event.key) {
              case "Escape":
                event.preventDefault();
                return leave(headIndex, true);
              case "ArrowUp":
              case "ArrowDown": {
                const dir = event.key === "ArrowDown" ? 1 : -1;
                if (event.altKey && event.shiftKey) {
                  event.preventDefault();
                  moveBlock(editor, dir);
                  return true;
                }
                if (event.shiftKey) {
                  event.preventDefault();
                  const next = neighbourIndex(state, headIndex, dir);
                  if (next !== null) setBlockSelection(view, anchorIndex, next);
                  return true;
                }
                event.preventDefault();
                return leave(dir > 0 ? range.to : range.from, dir > 0);
              }
              case "Backspace":
              case "Delete": {
                event.preventDefault();
                const indices: number[] = [];
                for (let i = range.from; i <= range.to; i++) indices.push(i);
                return deleteBlocks(editor, indices);
              }
              case "Tab":
                event.preventDefault();
                changeDepth(editor, event.shiftKey ? -1 : 1);
                return true;
              case "Enter":
                event.preventDefault();
                return leave(headIndex, true);
            }
            if (mod && event.key.toLowerCase() === "d" && !event.shiftKey) {
              event.preventDefault();
              return duplicateBlocks(editor);
            }
            if (mod && event.key.toLowerCase() === "a") {
              event.preventDefault();
              return setBlockSelection(view, 0, state.doc.childCount - 1);
            }
            // Copy/cut are handled by the clipboard events; ⌘. by the block menu; other shortcuts pass through.
            if (mod) return false;
            // Anything else (typing) goes back to text editing at the end of the selection.
            const tr = state.tr.setMeta(blockSelectionKey, { clear: true } satisfies BlockSelectionMeta).setMeta("addToHistory", false);
            view.dispatch(tr);
            return false;
          },
        },
      }),
    ];
  },
});
