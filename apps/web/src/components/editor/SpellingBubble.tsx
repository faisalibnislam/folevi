"use client";
// A click (or tap) on a word with a red underline shows a small bubble under it: the likeliest spellings, then
// Add to dictionary and Ignore (docs/SPELLING_PLAN.md). It doesn't take the focus, so writing goes on; typing,
// moving away or Esc closes it; scrolling carries it with its word. From the keyboard the same choices are in the menu Shift+F10 (or
// the menu key) opens on the word, and F7 goes to the next misspelt word with them (EditorContextMenu.tsx).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { isSealedDocument } from "@/lib/e2ee/router/hooks";
import { ignoreWebSpelling, learnWebSpelling, webSpelling } from "@/lib/spelling/web";
import { LANGUAGES } from "@/lib/spelling/languages";
import { misspeltAt, type SpellcheckStorage } from "./spellcheck";

interface Open {
  word: string;
  from: number;
  to: number;
  rtl: boolean;
  x: number;
  y: number;
  guesses: string[] | null;
}

/** Guesses shown in the bubble, at most (the menu shows five). */
const SHOWN = 4;

export function SpellingBubble({ editor }: { editor: TiptapEditor }) {
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const dom = editor.view.dom;
    // The word under the pointer as it goes down: by the time it comes up the caret is in the word, and its
    // underline (never drawn under the word being written) is gone, so the browser sends no click at all.
    let pressed: { hit: NonNullable<ReturnType<typeof misspeltAt>>; rect: DOMRect; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      pressed = null;
      if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = (e.target as HTMLElement | null)?.closest?.(".fb-misspelt");
      if (!el || !editor.isEditable) return;
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      const hit = at ? misspeltAt(editor.state, at.pos) : null;
      if (hit) pressed = { hit, rect: el.getBoundingClientRect(), x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const p = pressed;
      pressed = null;
      // (A drag to select isn't a click on the word.)
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) return;
      // After the editor has placed the caret.
      setTimeout(() => openAt(p), 0);
    };
    const openAt = (p: NonNullable<typeof pressed>) => {
      if (editor.isDestroyed || !editor.state.selection.empty) return;
      const { hit, rect: r } = p;
      const rtl = LANGUAGES[hit.lang].rtl === true;
      const next: Open = { word: hit.word, from: hit.from, to: hit.to, rtl, x: rtl ? r.right : r.left, y: r.bottom + 4, guesses: null };
      setOpen(next);
      void webSpelling(hit.word, hit.lang).then((a) => {
        if (openRef.current?.from === next.from && openRef.current.word === next.word) setOpen({ ...next, guesses: a?.guesses ?? [] });
      });
    };
    dom.addEventListener("pointerdown", onDown, true);
    dom.addEventListener("pointerup", onUp, true);
    return () => {
      dom.removeEventListener("pointerdown", onDown, true);
      dom.removeEventListener("pointerup", onUp, true);
    };
  }, [editor]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onUpdate = () => {
      const { from } = editor.state.selection;
      // Typing in it, or the caret elsewhere: gone.
      if (editor.state.doc.textBetween(open.from, Math.min(open.to, editor.state.doc.content.size)) !== open.word || from < open.from || from > open.to) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    // Scrolled: it moves with its word (gone when the word is out of sight).
    const follow = () => {
      if (editor.isDestroyed) return close();
      let at: { left: number; right: number; bottom: number };
      try {
        const start = editor.view.coordsAtPos(open.from);
        const end = editor.view.coordsAtPos(open.to);
        at = { left: Math.min(start.left, end.left), right: Math.max(start.right, end.right), bottom: Math.max(start.bottom, end.bottom) };
      } catch {
        return close();
      }
      if (at.bottom < 0 || at.bottom > window.innerHeight) return close();
      const x = open.rtl ? at.right : at.left;
      const y = at.bottom + 4;
      if (Math.abs(x - open.x) > 0.5 || Math.abs(y - open.y) > 0.5) setOpen((o) => (o ? { ...o, x, y } : o));
    };
    editor.on("transaction", onUpdate);
    editor.on("blur", close);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", close);
    editor.view.dom.addEventListener("keydown", onKey, true);
    return () => {
      editor.off("transaction", onUpdate);
      editor.off("blur", close);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", close);
      editor.view.dom.removeEventListener("keydown", onKey, true);
    };
  }, [open, editor]);

  if (!open || typeof document === "undefined") return null;
  const noteId = (editor.storage as { spellcheck?: SpellcheckStorage }).spellcheck?.documentId ?? null;
  const deviceOnly = noteId ? isSealedDocument(noteId) : false;
  const done = () => {
    setOpen(null);
    editor.view.focus();
  };
  const replace = (guess: string) => {
    const { state } = editor;
    if (state.doc.textBetween(open.from, open.to) !== open.word) return done();
    editor.view.dispatch(state.tr.insertText(guess, open.from, open.to));
    done();
  };
  // (Buttons keep the editor's focus: pressing one doesn't move the caret out of the note.)
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const style: React.CSSProperties = open.rtl ? { top: open.y, right: Math.max(8, window.innerWidth - open.x) } : { top: open.y, left: Math.max(8, Math.min(open.x, window.innerWidth - 240)) };
  return createPortal(
    <div className="fb-spell-bubble" role="toolbar" aria-label={`Spelling suggestions for ${open.word}`} dir={open.rtl ? "rtl" : undefined} style={style} onMouseDown={keep}>
      {open.guesses === null ? (
        <span className="fb-spell-bubble__note">Checking…</span>
      ) : open.guesses.length ? (
        open.guesses.slice(0, SHOWN).map((g) => (
          <button key={g} type="button" className="fb-spell-bubble__guess" onClick={() => replace(g)}>
            {g}
          </button>
        ))
      ) : (
        <span className="fb-spell-bubble__note">No suggestions</span>
      )}
      <span className="fb-spell-bubble__sep" aria-hidden="true" />
      <button type="button" className="fb-spell-bubble__action" dir="auto" onClick={() => (learnWebSpelling(open.word, deviceOnly), done())}>
        Add to dictionary
      </button>
      <button type="button" className="fb-spell-bubble__action" onClick={() => (ignoreWebSpelling(open.word, deviceOnly), done())}>
        Ignore
      </button>
    </div>,
    document.body,
  );
}
