"use client";
// An iPhone Duo folding or unfolding swaps the phone's layout for the tablet's (Shell.tsx), and the note's page is
// made again in the other one. Where it was (its scroll, the caret or selection, the keyboard) is kept here for a
// moment as the old page goes, and the new page takes it back before it first shows (the owner's rule: the open
// note, caret and keyboard carry over across folds, docs/claude-context/memory/iphone-duo-decisions.md).
import type { Editor } from "@tiptap/react";

export type NoteLayout = "phone" | "tablet";

export interface NoteCarry {
  /** The layout the page was left in: only a page made again in the other one takes it. */
  layout: NoteLayout;
  /** The selection (ProseMirror positions, anchor then head). */
  from: number;
  to: number;
  /** Whether the keyboard was in the note. */
  focused: boolean;
  /** Which scrolled: the note's own scroller or the window. */
  scroller: "note" | "window";
  scrollTop: number;
  /**
   * What sat in view: the caret (when it was on screen) or the first block, and how far down the view it was. The
   * other layout is wider or narrower, so the text wraps differently and the same scrollTop shows another place.
   */
  mark: { pos: number; offset: number; caret: boolean } | null;
  at: number;
}

/** Only a page made again this soon after the old one went takes its place. */
export const CARRY_MS = 1500;
/** The keyboard counts as in the note if it left only this long before the page went (the fold took it). */
const BLUR_GRACE_MS = 400;

const kept = new Map<string, NoteCarry>();

const scrolls = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1;

function viewOf(kind: "note" | "window", scrollEl: HTMLElement): { el: HTMLElement; top: number; height: number } {
  const page = document.scrollingElement as HTMLElement | null;
  if (kind === "window" && page) return { el: page, top: 0, height: window.innerHeight };
  return { el: scrollEl, top: scrollEl.getBoundingClientRect().top, height: scrollEl.clientHeight };
}

/** Called as the note's page goes (its DOM still in place). */
export function keepNoteCarry(documentId: string, layout: NoteLayout, editor: Editor, scrollEl: HTMLElement, blurredAt: number): void {
  if (editor.isDestroyed || !editor.view.dom.isConnected) return;
  const kind = scrolls(scrollEl) || !document.scrollingElement ? "note" : "window";
  const view = viewOf(kind, scrollEl);
  const { anchor, head } = editor.state.selection;
  const focused = editor.isFocused || editor.view.hasFocus() || (blurredAt > 0 && Date.now() - blurredAt < BLUR_GRACE_MS);
  let mark: NoteCarry["mark"] = null;
  if (view.el.scrollTop >= 1) {
    try {
      const offset = editor.view.coordsAtPos(head).top - view.top;
      if (focused && offset >= 0 && offset < view.height) mark = { pos: head, offset, caret: true };
    } catch {
      // No place for the caret: the first block in view stands in.
    }
    if (!mark) {
      for (const child of Array.from(editor.view.dom.children)) {
        const r = child.getBoundingClientRect();
        if (r.bottom <= view.top + 1) continue;
        try {
          const $pos = editor.state.doc.resolve(editor.view.posAtDOM(child, 0));
          mark = { pos: $pos.depth >= 1 ? $pos.before(1) : $pos.pos, offset: r.top - view.top, caret: false };
        } catch {
          // Not a block the editor knows: the scrollTop alone.
        }
        break;
      }
    }
  }
  kept.set(documentId, { layout, from: anchor, to: head, focused, scroller: kind, scrollTop: view.el.scrollTop, mark, at: Date.now() });
}

/** The place a page of this note left in the other layout moments ago, once (null otherwise). */
export function takeNoteCarry(documentId: string, layout: NoteLayout): NoteCarry | null {
  const carry = kept.get(documentId) ?? null;
  kept.delete(documentId);
  for (const [id, c] of kept) if (Date.now() - c.at > CARRY_MS) kept.delete(id);
  if (!carry || carry.layout === layout || Date.now() - carry.at > CARRY_MS) return null;
  return carry;
}

/** Gives the place back once the new page's content is in. Returns the scrollTop it ends at. */
export function applyNoteCarry(carry: NoteCarry, editor: Editor, scrollEl: HTMLElement): number {
  const size = editor.state.doc.content.size;
  const clamp = (n: number) => Math.max(0, Math.min(n, size));
  try {
    editor.commands.setTextSelection({ from: clamp(carry.from), to: clamp(carry.to) });
  } catch {
    // The note changed so that place is gone: the caret stays where the editor put it.
  }
  // The scroller of the layout it's in now (the one that scrolls), whichever scrolled before.
  const kind = scrolls(scrollEl) || !document.scrollingElement ? "note" : "window";
  const view = viewOf(kind, scrollEl);
  view.el.scrollTop = carry.scrollTop;
  if (carry.mark) {
    try {
      let top: number | null = null;
      if (carry.mark.caret) top = editor.view.coordsAtPos(clamp(carry.mark.pos)).top;
      else {
        const dom = editor.view.nodeDOM(clamp(carry.mark.pos));
        if (dom instanceof Element) top = dom.getBoundingClientRect().top;
      }
      // (A caret low in a taller view stays on screen in a shorter one.)
      const offset = Math.max(0, Math.min(carry.mark.offset, view.height - 64));
      if (top !== null) view.el.scrollTop += top - view.top - offset;
    } catch {
      // Gone from the note: the scrollTop it had.
    }
  }
  if (carry.focused) editor.commands.focus(undefined, { scrollIntoView: false });
  return view.el.scrollTop;
}
