import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import type { InlineNode } from "@folevi/editor-schema";
import { hiddenIndices } from "./blockSelectionState";
import { openAncestors } from "./commands";
import { layoutOf } from "./tabs/tabsState";
import { openTab } from "./tabs/tabsExtension";

/** Inline atoms (mentions, dates, page links) read as one object character, so offsets map to positions. */
const OBJECT = "￼";
/** How many matches are kept, counted and painted while searching. */
const MAX_MATCHES = 1000;
/** How many Replace all changes in one go (every match in any real note; a bound all the same). */
const MAX_REPLACED = 200_000;

/**
 * Where a match is when it isn't in a line's text but in a block's own fields: an image's caption, or a
 * run of text in a table's cell. `at` and `length` are in that caption or run.
 */
export type MatchField = { field: "caption"; at: number; length: number } | { field: "cell"; row: number; cell: number; run: number; at: number; length: number };

export interface FindMatch {
  from: number;
  to: number;
  /** Set for a match in a block's own fields: `from`..`to` is then the whole block. */
  inside?: MatchField;
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

/** Where `needle` (folded already, unless case matters) occurs in `raw`, as offsets into `raw`. */
function occurrences(raw: string, needle: string, caseSensitive: boolean, limit: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (!raw || limit <= 0) return out;
  const { text, rawAt } = caseSensitive ? { text: raw, rawAt: null } : foldCase(raw);
  let at = text.indexOf(needle);
  while (at !== -1 && out.length < limit) {
    // Positions in the original text (lower-casing can change a string's length, as with "İ").
    out.push({ start: rawAt ? rawAt[at]! : at, end: rawAt ? rawAt[at + needle.length]! : at + needle.length });
    at = text.indexOf(needle, at + needle.length);
  }
  return out;
}

/** The text a block keeps in its own fields rather than as a line: an image's caption, a table's cells. */
function fieldsOf(node: PMNode): { text: string; where: (at: number, length: number) => MatchField }[] {
  if (node.type.name === "image") {
    const caption = typeof node.attrs.caption === "string" ? node.attrs.caption : "";
    return caption ? [{ text: caption, where: (at, length) => ({ field: "caption", at, length }) }] : [];
  }
  if (node.type.name !== "table" || !Array.isArray(node.attrs.rows)) return [];
  const out: { text: string; where: (at: number, length: number) => MatchField }[] = [];
  (node.attrs.rows as InlineNode[][][]).forEach((cells, row) => {
    if (!Array.isArray(cells)) return;
    cells.forEach((runs, cell) => {
      if (!Array.isArray(runs)) return;
      runs.forEach((n, run) => {
        if (n?.type === "text" && n.text) out.push({ text: n.text, where: (at, length) => ({ field: "cell", row, cell, run, at, length }) });
      });
    });
  });
  return out;
}

/**
 * Every occurrence of `query` in the note (or in the blocks between `from` and `to`), in document order, at
 * most `limit`: in the text of lines, in image captions and in table cells (a cell is searched a run of
 * formatting at a time).
 */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean, from = 0, to = doc.content.size, limit = MAX_MATCHES): FindMatch[] {
  if (!query) return [];
  // Folded the same way as the text, a character at a time (lower-casing "ΟΔΟΣ" whole gives a final "ς",
  // which the text's "σ" wouldn't match).
  const needle = caseSensitive ? query : foldCase(query).text;
  const out: FindMatch[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (out.length >= limit) return false;
    if (node.isTextblock) {
      const raw = node.textBetween(0, node.content.size, undefined, OBJECT);
      for (const m of occurrences(raw, needle, caseSensitive, limit - out.length)) out.push({ from: pos + 1 + m.start, to: pos + 1 + m.end });
      return false;
    }
    for (const f of fieldsOf(node)) {
      for (const m of occurrences(f.text, needle, caseSensitive, limit - out.length)) out.push({ from: pos, to: pos + node.nodeSize, inside: f.where(m.start, m.end - m.start) });
    }
    return true;
  });
  return out;
}

/** A block's attributes with the text of one or more matches in its fields replaced. */
function replacedFields(node: PMNode, fields: MatchField[], replacement: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = { ...node.attrs };
  const swap = (text: string, at: number, length: number) => text.slice(0, at) + replacement + text.slice(at + length);
  let rows: InlineNode[][][] | null = null;
  // Later matches first, so the earlier ones' offsets in the same caption or run still hold.
  for (const f of [...fields].sort((x, y) => y.at - x.at)) {
    if (f.field === "caption") {
      attrs.caption = swap(String(attrs.caption ?? ""), f.at, f.length);
      continue;
    }
    rows ??= (attrs.rows as InlineNode[][][]).map((cells) => cells.map((runs) => runs.map((n) => ({ ...n }))));
    const run = rows[f.row]?.[f.cell]?.[f.run];
    if (run?.type === "text") run.text = swap(run.text, f.at, f.length);
  }
  // A run left with no text goes (a run of text is never empty).
  if (rows) attrs.rows = rows.map((cells) => cells.map((runs) => runs.filter((n) => n.type !== "text" || n.text !== "")));
  return attrs;
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
    if (from < to && !merged.some(([a, b]) => from < b && to > a)) out.push(m.inside ? { from, to, inside: m.inside } : { from, to });
  }
  for (const [a, b] of merged) out.push(...findMatches(doc, prev.query, prev.caseSensitive, a, b));
  return out.sort((x, y) => x.from - y.from).slice(0, MAX_MATCHES);
}

function paint(doc: PMNode, matches: FindMatch[], index: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  const decos: Decoration[] = [];
  // A block with matches in its own fields is marked once, as the current one when any of them is.
  const blocks = new Map<number, { to: number; current: boolean }>();
  matches.forEach((m, i) => {
    if (!m.inside) decos.push(Decoration.inline(m.from, m.to, { class: i === index ? "fb-find-match fb-find-current" : "fb-find-match" }));
    else blocks.set(m.from, { to: m.to, current: i === index || Boolean(blocks.get(m.from)?.current) });
  });
  for (const [from, b] of blocks) decos.push(Decoration.node(from, b.to, { class: b.current ? "fb-find-block fb-find-current" : "fb-find-block" }));
  return DecorationSet.create(doc, decos);
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

/**
 * Makes the block at `index` (a top-level block) one that can be seen: opens the collapsed toggles it is
 * folded away in, and the tabs it is in when another tab is open. Shared by find, and by anything that jumps
 * to a block (the outline, comments, tasks, Foli AI's suggestions).
 */
export function revealBlock(editor: Editor, index: number): void {
  const { state } = editor;
  if (index < 0 || index >= state.doc.childCount) return;
  if (hiddenIndices(state).has(index)) {
    const tr = state.tr;
    openAncestors(tr, index);
    if (tr.docChanged) editor.view.dispatch(tr);
  }
  // In a tab that isn't open: open that tab (on this device), outermost first.
  for (const g of layoutOf(editor.state).groups) {
    const tab = g.tabs.find((t) => index > t.index && index < t.end);
    if (tab && tab.id !== g.open) openTab(editor.view, g.id, tab.id);
  }
}

/**
 * Puts the caret in the block with `blockId` and brings it into view: at the start of a line of text, or
 * with the block itself selected when it holds no text (an image, a table, a divider). A block folded away
 * in a collapsed toggle or in a tab that isn't open is shown first. False when the note has no such block.
 */
export function focusBlockById(editor: Editor, blockId: string): boolean {
  let index = -1;
  editor.state.doc.forEach((n, _offset, i) => {
    if (index < 0 && n.attrs.id === blockId) index = i;
  });
  if (index < 0) return false;
  revealBlock(editor, index);
  const { state } = editor;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  const node = state.doc.child(index);
  const selection = node.isTextblock ? TextSelection.create(state.doc, pos + 1) : NodeSelection.isSelectable(node) ? NodeSelection.create(state.doc, pos) : TextSelection.near(state.doc.resolve(pos));
  editor.view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  editor.commands.focus();
  return true;
}

/** Scrolls the current match into the middle of the view (without moving focus from the find bar). */
export function revealCurrent(editor: Editor) {
  const s = findState(editor);
  const m = s.matches[s.index];
  if (!m) return;
  // A match folded away in a collapsed toggle, or in a tab that isn't open: shown first, so it can be seen
  // (and replaced).
  revealBlock(editor, editor.state.doc.resolve(m.from).index(0));
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    try {
      const node = m.inside ? editor.view.nodeDOM(m.from) : editor.view.domAtPos(m.from).node;
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
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
  // (Each replacement is an undo step of its own.)
  const tr = closeHistory(editor.state.tr);
  if (m.inside) {
    const node = tr.doc.nodeAt(m.from);
    if (!node) return false;
    tr.setNodeMarkup(m.from, undefined, replacedFields(node, [m.inside], replacement));
  } else {
    if (replacement) tr.insertText(replacement, m.from, m.to);
    else tr.delete(m.from, m.to);
    tr.setSelection(TextSelection.create(tr.doc, m.from + replacement.length));
  }
  // The replaced text is no longer a match, so the same index is now the next one, unless the
  // replacement itself contains the query, in which case step past it.
  const stillMatches = s.caseSensitive ? replacement.includes(s.query) : replacement.toLocaleLowerCase().includes(s.query.toLocaleLowerCase());
  tr.setMeta(findKey, { index: stillMatches ? s.index + 1 : s.index });
  // (A match in a block's fields leaves the caret where it was: nothing to bring into view but the next match.)
  editor.view.dispatch(m.inside ? tr : tr.scrollIntoView());
  revealCurrent(editor);
  return true;
}

/**
 * Replaces every match in the note in one transaction (one undo step): all of them, not only the first
 * thousand that are counted and painted while searching. Returns how many were replaced.
 */
export function replaceAll(editor: Editor, replacement: string): number {
  const s = findState(editor);
  if (!s.matches.length || !editor.isEditable) return 0;
  const { doc } = editor.state;
  const matches = s.matches.length < MAX_MATCHES ? s.matches : findMatches(doc, s.query, s.caseSensitive, 0, doc.content.size, MAX_REPLACED);
  const tr = closeHistory(editor.state.tr);
  // Back to front, so earlier positions stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    if (!m.inside) {
      if (replacement) tr.insertText(replacement, m.from, m.to);
      else tr.delete(m.from, m.to);
      continue;
    }
    // A block's fields change together: every match in this block (they sit next to each other in the list).
    const fields = [m.inside];
    while (i > 0 && matches[i - 1]!.inside && matches[i - 1]!.from === m.from) fields.push(matches[--i]!.inside!);
    const node = doc.nodeAt(m.from);
    if (node) tr.setNodeMarkup(m.from, undefined, replacedFields(node, fields, replacement));
  }
  tr.setMeta(findKey, { index: 0 });
  editor.view.dispatch(tr);
  return matches.length;
}
