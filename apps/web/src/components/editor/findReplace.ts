import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { hiddenIndices } from "./blockSelectionState";

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

/** The plugin also keeps the painted matches, so an update that doesn't change them doesn't repaint them. */
interface FindPluginState extends FindState {
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindPluginState>("foleviFind");

const EMPTY: FindPluginState = { query: "", caseSensitive: false, index: 0, matches: [], decorations: DecorationSet.empty };

/** Lower-cased text, with where each of its characters came from in the original (one past the end at the end). */
function foldCase(raw: string): { text: string; rawAt: number[] } {
  let text = "";
  const rawAt: number[] = [];
  for (let i = 0; i < raw.length; ) {
    const cp = raw.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const lower = ch.toLocaleLowerCase();
    for (let k = 0; k < lower.length; k++) rawAt.push(i);
    text += lower;
    i += ch.length;
  }
  rawAt.push(raw.length);
  return { text, rawAt };
}

/** Every occurrence of `query` in the note's text (or in the blocks between `from` and `to`), in document order (at most MAX_MATCHES). */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean, from = 0, to = doc.content.size): FindMatch[] {
  if (!query) return [];
  // Folded the same way as the text, a character at a time (lower-casing "ΟΔΟΣ" whole gives a final "ς",
  // which the text's "σ" wouldn't match).
  const needle = caseSensitive ? query : foldCase(query).text;
  const out: FindMatch[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (out.length >= MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    const raw = node.textBetween(0, node.content.size, undefined, OBJECT);
    const { text, rawAt } = caseSensitive ? { text: raw, rawAt: null } : foldCase(raw);
    let at = text.indexOf(needle);
    while (at !== -1 && out.length < MAX_MATCHES) {
      // Positions in the original text (lower-casing can change a string's length, as with "İ").
      const start = rawAt ? rawAt[at]! : at;
      const end = rawAt ? rawAt[at + needle.length]! : at + needle.length;
      out.push({ from: pos + 1 + start, to: pos + 1 + end });
      at = text.indexOf(needle, at + needle.length);
    }
    return false;
  });
  return out;
}

/**
 * The matches after an edit: the blocks it touched are searched again and every other match moves with the
 * text, so typing in a long note doesn't search all of it on each key. A full search when that's simpler.
 */
function updateMatches(prev: FindState, tr: Transaction): FindMatch[] {
  const { doc, mapping } = tr;
  if (prev.matches.length >= MAX_MATCHES) return findMatches(doc, prev.query, prev.caseSensitive);
  // What each step replaced, in the final document, widened to whole top-level blocks.
  const ranges: [number, number][] = [];
  mapping.maps.forEach((map, i) => {
    const rest = mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const $a = doc.resolve(Math.min(rest.map(newStart, -1), doc.content.size));
      const $b = doc.resolve(Math.min(rest.map(newEnd, 1), doc.content.size));
      const first = Math.max(0, $a.index(0) - ($a.depth === 0 ? 1 : 0));
      const last = Math.min(doc.childCount - 1, $b.index(0));
      if (last < first) return;
      ranges.push([$a.posAtIndex(first, 0), $b.posAtIndex(last, 0) + doc.child(last).nodeSize]);
    });
  });
  // Marks and block attributes don't move or change text.
  if (!ranges.length) return prev.matches;
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const top = merged[merged.length - 1];
    if (top && r[0] <= top[1]) top[1] = Math.max(top[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  if (merged.reduce((n, [a, b]) => n + b - a, 0) > doc.content.size / 2) return findMatches(doc, prev.query, prev.caseSensitive);
  const out: FindMatch[] = [];
  for (const m of prev.matches) {
    const from = mapping.map(m.from, 1);
    const to = mapping.map(m.to, -1);
    if (from < to && !merged.some(([a, b]) => from < b && to > a)) out.push({ from, to });
  }
  for (const [a, b] of merged) out.push(...findMatches(doc, prev.query, prev.caseSensitive, a, b));
  return out.sort((x, y) => x.from - y.from).slice(0, MAX_MATCHES);
}

function paint(doc: PMNode, matches: FindMatch[], index: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? "fb-find-match fb-find-current" : "fb-find-match" })),
  );
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
      new Plugin<FindPluginState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply: (tr, prev) => {
            const meta = tr.getMeta(findKey) as Partial<Pick<FindState, "query" | "caseSensitive" | "index">> | undefined;
            if (!meta && (!tr.docChanged || !prev.query)) return prev;
            const next = { ...prev, ...meta };
            const matches =
              meta?.query !== undefined || meta?.caseSensitive !== undefined
                ? findMatches(tr.doc, next.query, next.caseSensitive)
                : tr.docChanged && next.query
                  ? updateMatches(prev, tr)
                  : prev.matches;
            const index = matches.length ? ((next.index % matches.length) + matches.length) % matches.length : 0;
            const decorations = matches === prev.matches && index === prev.index ? prev.decorations : paint(tr.doc, matches, index);
            return { ...next, matches, index, decorations };
          },
        },
        props: {
          decorations: (state) => findKey.getState(state)?.decorations ?? null,
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
  // A match folded away in a collapsed toggle: open the toggles around it, so it can be seen (and replaced).
  const { state } = editor;
  const index = state.doc.resolve(m.from).index(0);
  if (hiddenIndices(state).has(index)) {
    const tr = state.tr;
    let depth = Number(state.doc.child(index).attrs.depth ?? 0);
    const starts: number[] = [];
    state.doc.forEach((_n, offset) => starts.push(offset));
    for (let i = index - 1; i >= 0 && depth > 0; i--) {
      const node = state.doc.child(i);
      const d = Number(node.attrs.depth ?? 0);
      if (d >= depth) continue;
      if (node.type.name === "toggle" && node.attrs.collapsed) tr.setNodeMarkup(starts[i]!, undefined, { ...node.attrs, collapsed: false });
      depth = d;
    }
    if (tr.docChanged) editor.view.dispatch(tr);
  }
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
