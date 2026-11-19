"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { imeKey } from "../canvas/wheel";
import { FLUSH_BLOCKS_EVENT } from "../canvas/leaveFlush";

// ------------------------------------------------------------------------------ typing that isn't saved yet
// A collection field keeps what is typed in it until it is left, and saves it then. "Left" used to mean the
// blur event only, and several ways of leaving never send one: the note closing (Back in the browser), the
// page or the app closing, the app going to the background on a phone, and the field's own row going away
// under it (deleted or filtered out by a live update). Each of those lost the typing. Every field is listed
// here while it is on the page, and each saves what it holds when any of those things happens.

const typing = new Set<() => void>();
let listening = false;

/**
 * Saves what is typed and not yet saved in every collection field on the page (a value, a row's name, a new
 * row's name), as leaving the field would. Called here when the page hides or closes and when the note asks
 * its blocks to write their work (FLUSH_BLOCKS_EVENT); the note can also call it itself, before its last save.
 */
export function commitTypedFields(): void {
  for (const commit of [...typing]) commit();
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // (In the capture phase: the page's own last save listens for the same events, and these run first.)
  window.addEventListener("pagehide", commitTypedFields, true);
  window.addEventListener(
    "visibilitychange",
    () => {
      // A phone app sent to the background may never be heard from again, and sends no "pagehide".
      if (document.visibilityState === "hidden") commitTypedFields();
    },
    true,
  );
  // The note, before it is saved for the last time (canvas/leaveFlush.ts).
  window.addEventListener(FLUSH_BLOCKS_EVENT, commitTypedFields);
}

/**
 * Runs `commit` when the field's typing would otherwise be lost: the field going away (its row removed, the
 * note closed), the page hiding or closing, and the note asking. `commit` is the latest one given; it is run
 * whether or not anything was typed, so it must do nothing when there is nothing to save, and nothing the
 * second time.
 */
export function useCommitOnLeave(commit: () => void): void {
  const ref = useRef(commit);
  ref.current = commit;
  useEffect(() => {
    listen();
    const run = () => ref.current();
    typing.add(run);
    return () => {
      typing.delete(run);
      // The field is going away. Its typing is saved now: there will be no blur.
      run();
    };
  }, []);
}

/** What a field knows about its text that the text doesn't say. */
export interface TypedField {
  /**
   * The browser can't read what was typed as the field's kind of value (letters in a number field): the text
   * it reports is then empty, which is not the person clearing the field.
   */
  badInput: boolean;
}

/**
 * A text field over a value of the collection. The collection is live: the value can change (someone else's
 * edit, or this device's own change coming back from the server) while the field has the keyboard. Text typed
 * and not saved yet is never replaced by it: the field keeps the typing until it's left, and the typing is then
 * what's saved (the later of the two wins). A field nobody has typed in simply follows the value, and leaving
 * it saves nothing. Enter leaves the field; Escape leaves it and gives the typing up. Typing is also saved
 * when the field is left without a blur (see useCommitOnLeave).
 */
export function LiveInput({ value, onCommit, ...rest }: { value: string; /** What was typed, as the field is left. */ onCommit: (typed: string, field: TypedField) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown">) {
  // What has been typed here and not saved yet (null: nothing, the field shows the value as it is now).
  const [typed, setTyped] = useState<string | null>(null);
  // The same, readable when the field is going away (the state of a field being removed can't be asked).
  const pending = useRef<string | null>(null);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // Whether the browser could read the last thing typed (asked at each key: the field itself is out of reach
  // by the time it is being removed).
  const unread = useRef(false);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  const set = (text: string | null) => {
    pending.current = text;
    setTyped(text);
  };
  /** Saves the typing (unless it was given up) and shows the value again. Once: there is nothing left to save after. */
  const leave = () => {
    const text = pending.current;
    const keep = !cancelled.current;
    cancelled.current = false;
    if (text === null) return;
    const badInput = input.current ? input.current.validity?.badInput === true : unread.current;
    unread.current = false;
    set(null);
    if (keep) latest.current(text, { badInput });
  };
  useCommitOnLeave(leave);
  return (
    <input
      {...rest}
      ref={input}
      value={typed ?? value}
      onChange={(e) => {
        unread.current = e.target.validity?.badInput === true;
        set(e.target.value);
      }}
      onBlur={leave}
      onKeyDown={(e) => {
        if (imeKey(e)) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
