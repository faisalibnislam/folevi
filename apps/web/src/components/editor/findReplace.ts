import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** Inline atoms (mentions, dates, page links) read as one object character, so offsets map to positions. */
const OBJECT = "￼";
const MAX_MATCHES = 1000;

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  /** The current match (wraps; clamped to the matches there are). */
  index: number;
  matches: FindMatch[];
}

export const findKey = new PluginKey<FindState>("foleviFind");

const EMPTY: FindState = { query: "", caseSensitive: false, index: 0, matches: [] };

/** Every occurrence of `query` in the note's text, in document order (at most MAX_MATCHES). */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): FindMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (out.length >= MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    const raw = node.textBetween(0, node.content.size, undefined, OBJECT);
    const text = caseSensitive ? raw : raw.toLocaleLowerCase();
    let at = text.indexOf(needle);
    while (at !== -1 && out.length < MAX_MATCHES) {
      out.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
      at = text.indexOf(needle, at + needle.length);
    }
    return false;
  });
  return out;
}

/**
 * Find & replace inside the note. The plugin holds the query and the current match and paints every
 * match (and the current one more strongly) with decorations; it never changes the document itself.
 * Replacing goes through ordinary editor transactions, so it syncs like typing and ⌘Z undoes it.
 */
export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply: (tr, prev) => {
            const meta = tr.getMeta(findKey) as Partial<Pick<FindState, "query" | "caseSensitive" | "index">> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const next = { ...prev, ...meta };
            const matches = meta?.query !== undefined || meta?.caseSensitive !== undefined || tr.docChanged ? findMatches(tr.doc, next.query, next.caseSensitive) : prev.matches;
            const index = matches.length ? ((next.index % matches.length) + matches.length) % matches.length : 0;
            return { ...next, matches, index };
          },
        },
        props: {
          decorations: (state) => {
            const s = findKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? "fb-find-match fb-find-current" : "fb-find-match" })),
            );
          },
        },
      }),
    ];
  },
});

export function findState(editor: Editor): FindState {
  return findKey.getState(editor.state) ?? EMPTY;
}

/** Updates the search (query, case, current match) and brings the current match into view. */
export function setFind(editor: Editor, patch: Partial<Pick<FindState, "query" | "caseSensitive" | "index">>, reveal = true) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, patch).setMeta("addToHistory", false));
  if (reveal) revealCurrent(editor);
}

export function clearFind(editor: Editor) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: "", index: 0 }).setMeta("addToHistory", false));
}

/** Scrolls the current match into the middle of the view (without moving focus from the find bar). */
export function revealCurrent(editor: Editor) {
  const s = findState(editor);
  const m = s.matches[s.index];
  if (!m) return;
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    try {
      const { node } = editor.view.domAtPos(m.from);
      const el = node instanceof Element ? node : node.parentElement;
      el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } catch {
      /* the match moved while we waited */
    }
  });
}

/** Replaces the current match and moves on to the next one. Returns whether anything changed. */
export function replaceCurrent(editor: Editor, replacement: string): boolean {
  const s = findState(editor);
  const m = s.matches[s.index];
  if (!m || !editor.isEditable) return false;
  const tr = replacement ? editor.state.tr.insertText(replacement, m.from, m.to) : editor.state.tr.delete(m.from, m.to);
  // The replaced text is no longer a match, so the same index is now the next one, unless the
  // replacement itself contains the query, in which case step past it.
  const stillMatches = s.caseSensitive ? replacement.includes(s.query) : replacement.toLocaleLowerCase().includes(s.query.toLocaleLowerCase());
  tr.setSelection(TextSelection.create(tr.doc, m.from + replacement.length));
  tr.setMeta(findKey, { index: stillMatches ? s.index + 1 : s.index });
  editor.view.dispatch(tr.scrollIntoView());
  revealCurrent(editor);
  return true;
}

/** Replaces every match in one transaction (one undo step). Returns how many were replaced. */
export function replaceAll(editor: Editor, replacement: string): number {
  const s = findState(editor);
  if (!s.matches.length || !editor.isEditable) return 0;
  const tr = editor.state.tr;
  // Back to front, so earlier positions stay valid.
  for (const m of [...s.matches].reverse()) {
    if (replacement) tr.insertText(replacement, m.from, m.to);
    else tr.delete(m.from, m.to);
  }
  tr.setMeta(findKey, { index: 0 });
  editor.view.dispatch(tr);
  return s.matches.length;
}
