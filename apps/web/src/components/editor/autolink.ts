// Links typed or pasted as plain text become links: an address followed by a space or Enter ("example.com",
// "www.example.com/page", "https://…"), and a pasted address (linking the selected text, when there is one).
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { sanitizeHref } from "@folevi/editor-schema";

// Bare names ("involets.com") only count with a common top-level domain, so "notes.txt" or "v2.final" stay text.
const LONG_TLDS = "com|org|net|app|dev|edu|gov|xyz|info|biz|page|site|online|store|tech|blog|design|studio|cloud|link";
// Two-letter endings are also everyday words ("it", "in", "so", "to", "me"), file types ("install.sh",
// "lib.so", "script.pl") and the start of a sentence after a missing space ("Thanks.It"). A bare name ending
// in one is an address only when something else says so: a path or a port after it ("bit.ly/abc"), a second
// level before it ("bbc.co.uk"), or one of the few endings that are hardly anything but addresses, typed in
// lower case ("github.io", "claude.ai"). With "https://" or "www." in front, anything goes.
const SHORT_TLDS = "io|co|ai|me|us|uk|ca|de|fr|es|it|nl|se|no|dk|fi|ch|at|be|au|nz|in|bd|jp|cn|kr|sg|hk|br|mx|ru|pl|cz|ie|pt|eu|tv|so|gg|sh|fm|ly|to";
const PLAIN_SHORT_TLDS = /\.(?:io|co|ai|tv|fm|gg|eu|uk)$/;
const HOST = "(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+";
const REST = '[^\\s<>"]*';
const ADDRESS = new RegExp(
  "^(?:" +
    [
      `https?:\\/\\/[^\\s<>"]+`,
      `mailto:[^\\s<>"]+@[^\\s<>"]+`,
      `www\\.[^\\s<>"]+\\.[^\\s<>"]+`,
      `${HOST}(?:${LONG_TLDS})(?::\\d+)?(?:[/?#]${REST})?`,
      `${HOST}(?:co|com|org|net|gov|ac|edu)\\.[a-z]{2}(?::\\d+)?(?:[/?#]${REST})?`,
      `${HOST}(?:${SHORT_TLDS})(?::\\d+(?:[/?#]${REST})?|\\/${REST})`,
    ].join("|") +
    ")$",
  "i",
);
/** A bare name with a two-letter ending and nothing after it ("github.io"): see PLAIN_SHORT_TLDS. */
const BARE_SHORT = new RegExp(`^${HOST}[a-z]{2}$`, "i");

/** The address a word stands for (trailing punctuation dropped), or null when it isn't one. */
export function addressIn(word: string): { text: string; href: string } | null {
  // "See example.com." or "(example.com)": the punctuation isn't part of the address (a closing bracket
  // stays when the address has its own opening one, as in some Wikipedia links).
  let text = word.replace(/^[("'[]+/, "");
  while (/[.,;:!?'")\]]$/.test(text)) {
    if (text.endsWith(")") && (text.match(/\(/g)?.length ?? 0) >= (text.match(/\)/g)?.length ?? 0)) break;
    text = text.slice(0, -1);
  }
  if (text.length < 4 || !(ADDRESS.test(text) || (BARE_SHORT.test(text) && PLAIN_SHORT_TLDS.test(text)))) return null;
  const href = sanitizeHref(text);
  return href ? { text, href } : null;
}

/**
 * The web address in what was typed or pasted for a bookmark: the whole text when it's a sound address,
 * otherwise the last http(s) address inside it ("https://" left in the field before a pasted link, or
 * "Address: https://…" copied with its label). Null when there's none.
 */
export function webAddressIn(input: string): string | null {
  const text = input.trim();
  const sound = (s: string) => {
    const href = sanitizeHref(s);
    if (!href || !/^https?:\/\//i.test(href)) return null;
    try {
      const u = new URL(href);
      return u.hostname.includes(".") && !u.username && !u.password ? href : null;
    } catch {
      return null;
    }
  };
  const whole = sound(text);
  if (whole) return whole;
  const at = Math.max(text.lastIndexOf("https://"), text.lastIndexOf("http://"));
  return at > 0 ? sound(text.slice(at).split(/\s/)[0]!) : null;
}

/**
 * Links the address just before `pos` (the caret) in its line, if there is one not linked yet. Returns
 * the range it linked, or null.
 */
export function linkWordBefore(state: EditorState, pos: number, tr: Transaction): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  const before = parent.textBetween(0, $pos.parentOffset, undefined, "￼");
  const word = /(\S+)$/.exec(before)?.[1];
  if (!word) return null;
  const found = addressIn(word);
  if (!found) return null;
  const start = pos - word.length + word.indexOf(found.text);
  const end = start + found.text.length;
  if (state.doc.rangeHasMark(start, end, state.schema.marks.code!)) return null;
  if (state.doc.rangeHasMark(start, end, linkType)) {
    // Typed on from an address that was linked automatically ("example.com" then "/path"): the link grows
    // with it. A link someone set up themselves (other text, another address) is left alone.
    const existing = linkType.isInSet(state.doc.resolve(start + 1).marks());
    let linkedText = "";
    state.doc.nodesBetween(start, end, (n, pos) => {
      if (n.isText && linkType.isInSet(n.marks)) linkedText += n.text!.slice(Math.max(0, start - pos), Math.max(0, end - pos));
    });
    if (!existing || !found.text.startsWith(linkedText) || sanitizeHref(linkedText) !== existing.attrs.href || existing.attrs.href === found.href) return null;
    tr.removeMark(start, end, linkType);
  }
  tr.addMark(start, end, linkType.create({ href: found.href }));
  return { from: start, to: end };
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

/** The link the last key made by itself, and where the caret was left: Backspace right there takes it back. */
interface MadeLink {
  from: number;
  to: number;
  caret: number;
}
const autolinkKey = new PluginKey<MadeLink | null>("autolink");

export const Autolink = Extension.create({
  name: "autolink",
  // Before the block keymap, so Enter links the address before splitting the line.
  priority: 1200,
  addProseMirrorPlugins() {
    return [
      new Plugin<MadeLink | null>({
        key: autolinkKey,
        state: {
          init: () => null,
          // Remembered only until the next edit or move of the caret.
          apply: (tr, made) => {
            const meta = tr.getMeta(autolinkKey) as MadeLink | null | undefined;
            if (meta !== undefined) return meta;
            if (!made) return null;
            // (A follow-up the editor adds to the same key press, such as a new line's id, moves it along.)
            if (tr.getMeta("appendedTransaction")) return { from: tr.mapping.map(made.from), to: tr.mapping.map(made.to), caret: tr.mapping.map(made.caret) };
            return !tr.docChanged && !tr.selectionSet ? made : null;
          },
        },
        props: {
          handleTextInput: (view, from, to, text) => {
            if (from !== to || !/^\s$/.test(text) || view.composing) return false;
            const tr = view.state.tr;
            const linked = linkWordBefore(view.state, from, tr);
            if (!linked) return false;
            tr.insertText(text, from, to);
            view.dispatch(tr.setMeta(autolinkKey, { ...linked, caret: from + text.length } satisfies MadeLink));
            return true;
          },
          handleKeyDown: (view, event) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
            // Backspace right after a word became a link by itself: the link goes, the text (and the space)
            // stays. The next Backspace deletes as usual.
            if (event.key === "Backspace" && !event.shiftKey) {
              const made = autolinkKey.getState(view.state);
              const { selection, schema } = view.state;
              if (!made || !selection.empty || selection.from !== made.caret || !view.state.doc.rangeHasMark(made.from, made.to, schema.marks.link!)) return false;
              view.dispatch(view.state.tr.removeMark(made.from, made.to, schema.marks.link!).setMeta(autolinkKey, null));
              return true;
            }
            // Enter, Shift+Enter (a line break) and Tab end an address too.
            if (event.key !== "Enter" && event.key !== "Tab") return false;
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
