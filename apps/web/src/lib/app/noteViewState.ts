"use client";
// Where each note was left in this window (docs/MAC_WEBKIT_PLAN.md "Memory", step 3): a note's page is unloaded as
// soon as its tab is hidden (only the tab on screen is a page; the strip keeps titles), and coming back to the tab
// shows it as it was: the same scroll position, and the caret or selection where it was, with the keyboard back in
// the note if it was there. Kept in sessionStorage (per window, gone when the window goes); what was typed is
// already saved by the editor as it's typed, so nothing else needs keeping.
import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

export interface NoteViewState {
  scrollTop: number;
  /** The editor's selection (ProseMirror positions). */
  anchor: number;
  head: number;
  /** Whether the keyboard was in the note. */
  focused: boolean;
  at: number;
}

const KEY = "folevi:note-view";
/** At most this many notes remembered per window (the tab strip holds 12). */
const MAX = 30;
/** A note left this soon after a press or key outside it was left by that press: the place before it counts. */
const LEAVING_MS = 5000;

function readAll(): Record<string, NoteViewState> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, NoteViewState>) : {};
  } catch {
    return {};
  }
}

const valid = (s: unknown): s is NoteViewState => {
  const v = s as NoteViewState | null;
  return !!v && [v.scrollTop, v.anchor, v.head, v.at].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) && typeof v.focused === "boolean";
};

export function readNoteView(documentId: string): NoteViewState | null {
  const s = readAll()[documentId];
  return valid(s) ? s : null;
}

export function saveNoteView(documentId: string, state: NoteViewState): void {
  try {
    const all = readAll();
    all[documentId] = state;
    const ids = Object.keys(all).sort((a, b) => (all[b]?.at ?? 0) - (all[a]?.at ?? 0));
    for (const id of ids.slice(MAX)) delete all[id];
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage off or full: the note opens at its top, as before.
  }
}

/** Whether the address asks for a place in the note (a block, a comment, a new note's title): that wins. */
export function hasExplicitTarget(location: { hash: string; search: string }): boolean {
  if (location.hash) return true;
  const q = new URLSearchParams(location.search);
  return q.get("new") === "1" || q.has("find");
}

/**
 * Keeps and gives back a note's place in this window: saved when the note's page goes (its tab hidden, another
 * note opened, the window closing), given back once its content is in (`ready`). A person who scrolls or types
 * first keeps their own place.
 */
export function useNoteViewState(documentId: string, scrollEl: HTMLElement | null, editor: Editor | null, ready: boolean): void {
  // The place as it is now, kept as it changes (at the way out the page may already be taken apart), and as it was
  // the moment the person reached for something outside the note: leaving moves things first (the click on another
  // tab takes the keyboard out of the note, the page shifts as its bars go), and that isn't where they were.
  const now = useRef<{ scrollTop: number; anchor: number; head: number; focused: boolean } | null>(null);
  const leaving = useRef<{ place: NonNullable<typeof now.current>; at: number } | null>(null);
  const restored = useRef(false);
  const moved = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!scrollEl) return;
    const read = () => {
      now.current = { ...(now.current ?? { anchor: 0, head: 0, focused: false }), scrollTop: Math.round(scrollEl.scrollTop) };
    };
    // The person moved first: theirs wins over what's given back.
    const mark = () => {
      moved.current = true;
    };
    // A press or a key anywhere else (a tab, the sidebar, a shortcut): the place as it is now is the one to keep.
    const reach = (e: Event) => {
      if (now.current && !(e.target instanceof Node && scrollEl.contains(e.target))) leaving.current = { place: now.current, at: Date.now() };
      if (e.type === "keydown" && (e as KeyboardEvent).metaKey && now.current) leaving.current = { place: now.current, at: Date.now() };
    };
    const opts = { passive: true } as const;
    scrollEl.addEventListener("scroll", read, opts);
    for (const e of ["wheel", "touchstart", "pointerdown", "keydown"]) scrollEl.addEventListener(e, mark, opts);
    window.addEventListener("pointerdown", reach, true);
    window.addEventListener("keydown", reach, true);
    return () => {
      scrollEl.removeEventListener("scroll", read);
      for (const e of ["wheel", "touchstart", "pointerdown", "keydown"]) scrollEl.removeEventListener(e, mark);
      window.removeEventListener("pointerdown", reach, true);
      window.removeEventListener("keydown", reach, true);
    };
  }, [scrollEl]);

  useEffect(() => {
    if (!editor) return;
    const read = () => {
      if (editor.isDestroyed) return;
      const { anchor, head } = editor.state.selection;
      now.current = { scrollTop: now.current?.scrollTop ?? 0, anchor, head, focused: editor.isFocused };
    };
    editor.on("selectionUpdate", read);
    editor.on("focus", read);
    editor.on("blur", read);
    return () => {
      editor.off("selectionUpdate", read);
      editor.off("focus", read);
      editor.off("blur", read);
    };
  }, [editor]);

  // Saved on the way out (and when the window hides: a reload or a closed window keeps it too). A note left
  // before its place was given back keeps the place it had.
  useEffect(() => {
    const save = () => {
      // What it was when the person reached out, if that's what took them away (moments ago).
      const reached = leaving.current && Date.now() - leaving.current.at < LEAVING_MS ? leaving.current.place : null;
      const place = reached ?? now.current;
      if (!place || (!restored.current && readNoteView(documentId))) return;
      saveNoteView(documentId, { ...place, at: Date.now() });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      timers.current.forEach(clearTimeout);
      save();
    };
  }, [documentId]);

  // Given back once the note's content is in, and again as late blocks (images, canvases) grow the page.
  useEffect(() => {
    if (restored.current || !ready || !scrollEl || !editor || editor.isDestroyed) return;
    restored.current = true;
    const saved = readNoteView(documentId);
    if (!saved || hasExplicitTarget(window.location)) return;
    const size = editor.state.doc.content.size;
    const clamp = (n: number) => Math.max(0, Math.min(n, size));
    if (saved.anchor || saved.head) {
      try {
        editor.commands.setTextSelection({ from: clamp(saved.anchor), to: clamp(saved.head) });
      } catch {
        // The note changed meanwhile so that place is gone: the caret stays where the editor put it.
      }
    }
    if (saved.focused) editor.commands.focus(undefined, { scrollIntoView: false });
    now.current = { scrollTop: saved.scrollTop, anchor: saved.anchor, head: saved.head, focused: saved.focused };
    const scroll = () => {
      if (!moved.current) scrollEl.scrollTop = saved.scrollTop;
    };
    scroll();
    timers.current = [0, 250, 800].map((ms) => setTimeout(scroll, ms));
  }, [documentId, ready, scrollEl, editor]);
}
