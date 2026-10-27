// Find in a note (the page sidebar's Find tab, and the native sidebar's through the bridge's `find`): every match
// of a text in the editor's text blocks, a snippet around each, and the CSS Custom Highlights that paint them.
import type { Editor } from "@tiptap/core";

export interface NoteMatch {
  from: number;
  to: number;
  snippet: { before: string; hit: string; after: string };
}

/** At most this many matches are found. */
export const MAX_MATCHES = 500;

const OBJECT = "￼";

/** A short excerpt around a match that starts and ends on word boundaries. */
export function snippetAround(text: string, at: number, length: number) {
  const clean = (t: string) => t.replaceAll(OBJECT, "…");
  let before = text.slice(Math.max(0, at - 32), at);
  if (at > 32) before = `…${before.slice(before.indexOf(" ") + 1)}`;
  let after = text.slice(at + length, at + length + 48);
  if (at + length + 48 < text.length) after = `${after.slice(0, Math.max(after.lastIndexOf(" "), 0))}…`;
  return { before: clean(before), hit: text.slice(at, at + length), after: clean(after) };
}

export function findMatches(editor: Editor, query: string): NoteMatch[] {
  const q = query.toLocaleLowerCase();
  if (!q) return [];
  const out: NoteMatch[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Inline atoms (mentions, dates, page links) count as one object character, so string offsets map
    // straight onto document positions.
    const text = node.textBetween(0, node.content.size, undefined, OBJECT);
    const lower = text.toLocaleLowerCase();
    let at = lower.indexOf(q);
    while (at !== -1 && out.length < MAX_MATCHES) {
      out.push({
        from: pos + 1 + at,
        to: pos + 1 + at + q.length,
        snippet: snippetAround(text, at, q.length),
      });
      at = lower.indexOf(q, at + Math.max(1, q.length));
    }
    return false;
  });
  return out;
}

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
export function highlights(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === "function" ? css.highlights : null;
}

/** The DOM range of a match, or null when the editor can't map it. */
export function matchRange(editor: Editor, m: NoteMatch): Range | null {
  try {
    const a = editor.view.domAtPos(m.from);
    const b = editor.view.domAtPos(m.to);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  } catch {
    return null;
  }
}

/** Paints every match, and the current one more strongly (no DOM changes). */
export function paintMatches(editor: Editor, matches: NoteMatch[], current: number): void {
  const reg = highlights();
  if (!reg) return;
  const H = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
  const all = matches.map((m) => matchRange(editor, m)).filter((r): r is Range => r !== null);
  reg.set("folevi-find", new H(...all));
  const cur = current >= 0 && matches[current] ? matchRange(editor, matches[current]) : null;
  reg.set("folevi-find-current", new H(...(cur ? [cur] : [])));
}

export function clearMatches(): void {
  const reg = highlights();
  reg?.delete("folevi-find");
  reg?.delete("folevi-find-current");
}

/** Smooth scrolling, unless the person asked for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Scrolls a match to the middle of the note. */
export function revealMatch(editor: Editor, m: NoteMatch): void {
  const r = matchRange(editor, m);
  const el = r?.startContainer instanceof Element ? r.startContainer : r?.startContainer.parentElement;
  el?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
}
