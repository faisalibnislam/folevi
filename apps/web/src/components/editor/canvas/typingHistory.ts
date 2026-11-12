"use client";

import { useRef } from "react";

/** A pause this long between keys starts a new undo step. */
const PAUSE = 700;

/**
 * Undo for a label being written in a canvas (an idea, a sticky note, a wireframe part). These fields are
 * drawn from the canvas's own data on every key, so the browser keeps no undo for them: Cmd+Z used to end the
 * edit and take the whole label away. This remembers what the field said at each pause, word and change of
 * direction (typing, then deleting), so Cmd+Z steps back through the writing first, as it does in any text
 * field, and only reaches the canvas's own undo when the writing has nothing left to take back.
 */
export class TypingHistory {
  private past: string[] = [];
  private future: string[] = [];
  private last = 0;
  private growing: boolean | null = null;

  constructor(private value: string) {}

  /** The field now says `next` (typed, pasted or deleted). */
  record(next: string, now = Date.now()) {
    if (next === this.value) return;
    const growing = next.length >= this.value.length;
    // A new step: the first key, after a pause, when typing turns into deleting (or back), at the start of a
    // word, and for anything bigger than a key (a paste, a cut).
    const jump = Math.abs(next.length - this.value.length) > 1;
    const word = growing && /\s$/.test(this.value) && !/\s$/.test(next);
    if (!this.past.length || now - this.last > PAUSE || growing !== this.growing || jump || word) this.past.push(this.value);
    this.value = next;
    this.future = [];
    this.last = now;
    this.growing = growing;
  }

  /** What the field said a step ago, or null when there is nothing typed left to undo. */
  undo(): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.value);
    this.value = prev;
    this.last = 0;
    return prev;
  }

  /** The step just undone, or null. */
  redo(): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.value);
    this.value = next;
    this.last = 0;
    return next;
  }
}

/**
 * The typing history of the field being written in. `key` names it (the item's id, or null when nothing is
 * being edited); a new key starts a new history from `value`.
 */
export function useTypingHistory(key: string | null, value: string): TypingHistory | null {
  const held = useRef<{ key: string; history: TypingHistory } | null>(null);
  if (key === null) held.current = null;
  else if (held.current?.key !== key) held.current = { key, history: new TypingHistory(value) };
  return held.current?.history ?? null;
}

/**
 * Cmd+Z, Shift+Cmd+Z or Cmd+Y in such a field: steps through the writing and says what the field should now
 * hold. Null when the key is not undo or redo, or the writing has no step that way (the caller then lets the
 * canvas's own undo have it).
 */
export function typingUndoKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, history: TypingHistory | null): string | null {
  const key = e.key.toLowerCase();
  if (!(e.metaKey || e.ctrlKey) || e.altKey || (key !== "z" && key !== "y") || !history) return null;
  return key === "y" || e.shiftKey ? history.redo() : history.undo();
}
