// Links typed or pasted as plain text become links: an address followed by a space or Enter ("example.com",
// "www.example.com/page", "https://…"), and a pasted address (linking the selected text, when there is one).
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { sanitizeHref } from "@folevi/editor-schema";

// Bare names ("involets.com") only count with a common top-level domain, so "notes.txt" or "v2.final" stay text.
const TLDS = "com|org|net|io|co|app|dev|ai|edu|gov|me|xyz|info|biz|us|uk|ca|de|fr|es|it|nl|se|no|dk|fi|ch|at|be|au|nz|in|bd|jp|cn|kr|sg|hk|br|mx|ru|pl|cz|ie|pt|eu|tv|so|gg|sh|fm|ly|to|page|site|online|store|tech|blog|design|studio|cloud|link";
const ADDRESS = new RegExp(
  `^(?:https?:\\/\\/[^\\s<>"]+|mailto:[^\\s<>"]+@[^\\s<>"]+|www\\.[^\\s<>"]+\\.[^\\s<>"]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?::\\d+)?(?:[/?#][^\\s<>"]*)?)$`,
  "i",
);

/** The address a word stands for (trailing punctuation dropped), or null when it isn't one. */
export function addressIn(word: string): { text: string; href: string } | null {
  // "See example.com." or "(example.com)": the punctuation isn't part of the address (a closing bracket
  // stays when the address has its own opening one, as in some Wikipedia links).
  let text = word.replace(/^[("'[]+/, "");
  while (/[.,;:!?'")\]]$/.test(text)) {
    if (text.endsWith(")") && (text.match(/\(/g)?.length ?? 0) >= (text.match(/\)/g)?.length ?? 0)) break;
    text = text.slice(0, -1);
  }
  if (text.length < 4 || !ADDRESS.test(text)) return null;
  const href = sanitizeHref(text);
  return href ? { text, href } : null;
}

/** Links the address just before `pos` (the caret) in its line, if there is one not linked yet. */
export function linkWordBefore(state: EditorState, pos: number, tr: Transaction): boolean {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock || parent.type.spec.code) return false;
  const linkType = state.schema.marks.link;
  if (!linkType) return false;
  const before = parent.textBetween(0, $pos.parentOffset, undefined, "￼");
  const word = /(\S+)$/.exec(before)?.[1];
  if (!word) return false;
  const found = addressIn(word);
  if (!found) return false;
  const start = pos - word.length + word.indexOf(found.text);
  const end = start + found.text.length;
  if (state.doc.rangeHasMark(start, end, linkType) || state.doc.rangeHasMark(start, end, state.schema.marks.code!)) return false;
  tr.addMark(start, end, linkType.create({ href: found.href }));
  return true;
}

/**
 * A pasted address: links the selected text to it, or goes in as a link. Returns whether it handled the
 * paste (only plain addresses: one word of text, or HTML that is just that address).
 */
export function pasteAddress(view: EditorView, data: DataTransfer | null): boolean {
  if (!data) return false;
  const text = data.getData("text/plain").trim();
  if (!text || /\s/.test(text)) return false;
  const html = data.getData("text/html");
  if (html && new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() !== text) return false;
  const found = addressIn(text);
  if (!found || found.text !== text) return false;
  const { state } = view;
  const { from, to, empty, $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const link = state.schema.marks.link!.create({ href: found.href });
  const tr = state.tr;
  if (!empty && $from.sameParent(state.selection.$to)) tr.addMark(from, to, link);
  else {
    tr.replaceSelectionWith(state.schema.text(text, [link]), false);
    tr.removeStoredMark(state.schema.marks.link!);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const Autolink = Extension.create({
  name: "autolink",
  // Before the block keymap, so Enter links the address before splitting the line.
  priority: 1200,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("autolink"),
        props: {
          handleTextInput: (view, from, to, text) => {
            if (from !== to || !/^\s$/.test(text) || view.composing) return false;
            const tr = view.state.tr;
            if (!linkWordBefore(view.state, from, tr)) return false;
            tr.insertText(text, from, to);
            view.dispatch(tr);
            return true;
          },
          handleKeyDown: (view, event) => {
            if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
            const { selection } = view.state;
            if (!selection.empty) return false;
            const tr = view.state.tr;
            if (linkWordBefore(view.state, selection.from, tr)) view.dispatch(tr.setMeta("addToHistory", true));
            // Enter itself is handled by the block keymap.
            return false;
          },
        },
      }),
    ];
  },
});
