"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeCanvasData } from "./canvasMerge";
import { useLeaveFlush, type CanvasWrite } from "./leaveFlush";

/** After a finished change. */
const SAVE_DELAY = 400;
/** After the last keystroke or drag frame of a change still being made (typing in a shape). */
const LIVE_SAVE_DELAY = 800;
/** A change from elsewhere that found unsaved work here is merged in at the latest this long after. */
const SETTLE_DELAY = 1500;

export interface CanvasHistory<T> {
  push(before: T, key?: string): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
  clear(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface Options<T> {
  data: string;
  write: (data: string, how?: CanvasWrite) => void;
  parse: (data: string) => T;
  serialize: (doc: T) => string;
  maxLength: number;
  newHistory: () => CanvasHistory<T>;
}

/**
 * A canvas block's data while it is being edited (flowchart, mind map, wireframe): local state first, so
 * typing and dragging stay smooth, written to the block's `data` shortly after, with its own undo history.
 *
 * Nothing done here is dropped:
 * - A finished change is written 400 ms later; one still being made (text being typed) 800 ms after the last
 *   keystroke; and all of it at once when the block, the page or the app is being left (useLeaveFlush).
 * - A change to the same block from elsewhere (another device, another person) that arrives while there is
 *   unsaved work here waits, and is merged with that work item by item when it is next saved
 *   (canvasMerge.ts). With nothing unsaved here it is simply shown, and this block's undo history starts over.
 */
export function useCanvasDoc<T extends object>({ data, write, parse, serialize, maxLength, newHistory }: Options<T>) {
  const [doc, setDocState] = useState<T>(() => parse(data));
  const docRef = useRef(doc);
  /** The block's `data` as this view last wrote or took it: what unsaved work here started from. */
  const lastWritten = useRef(data);
  /** The state that `lastWritten` holds; anything else in `docRef` is unsaved. */
  const synced = useRef(doc);
  /** `data` from elsewhere, waiting to be merged with the unsaved work here. */
  const outside = useRef<string | null>(null);
  /** Everything unsaved here came from this canvas's own undo (or redo): the write then goes through the note's history. */
  const undoing = useRef<"undo" | "redo" | null>(null);
  /** A write is under way: what it does to `data` on the way is this view's own doing, not a change from elsewhere. */
  const writing = useRef(false);
  const history = useRef<CanvasHistory<T> | null>(null);
  history.current ??= newHistory();
  const [, setTick] = useState(0);
  const timer = useRef<number | null>(null);
  const liveTimer = useRef<number | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const writeRef = useRef(write);
  writeRef.current = write;
  const fns = useRef({ parse, serialize });
  fns.current = { parse, serialize };

  const clearTimers = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
    timer.current = null;
    liveTimer.current = null;
  };

  /**
   * Writes what is unsaved. `live` is the save of a change still being made: it never merges in a waiting
   * outside change, because the gesture making it works from the chart as it was when it started and would
   * put that back on its next step.
   */
  const flush = useCallback(
    (live = false) => {
      const { parse: read, serialize: text } = fns.current;
      if (live && outside.current !== null) return;
      clearTimers();
      if (outside.current !== null) {
        const theirs = outside.current;
        outside.current = null;
        const merged = read(text(mergeCanvasData(read(lastWritten.current), read(theirs), docRef.current)));
        lastWritten.current = theirs;
        docRef.current = merged;
        setDocState(merged);
        setTick((t) => t + 1);
        undoing.current = null;
      }
      const s = text(docRef.current);
      if (s.length > maxLength) {
        setTooLarge(true);
        return;
      }
      setTooLarge(false);
      synced.current = docRef.current;
      const kind = undoing.current ?? (live ? "live" : undefined);
      undoing.current = null;
      if (s === lastWritten.current) return;
      lastWritten.current = s;
      writing.current = true;
      try {
        writeRef.current(s, { kind });
      } finally {
        writing.current = false;
      }
    },
    [maxLength],
  );

  const schedule = useCallback(() => {
    clearTimers();
    timer.current = window.setTimeout(() => flush(), SAVE_DELAY);
  }, [flush]);

  // A change from outside: shown at once when nothing here is unsaved, otherwise merged at the next save.
  useEffect(() => {
    // (An undo that goes through the note's history may pass through older drawings on its way.)
    if (writing.current) return;
    if (data === lastWritten.current) {
      outside.current = null;
      return;
    }
    if (docRef.current !== synced.current) {
      outside.current = data;
      if (timer.current === null) {
        if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
        liveTimer.current = window.setTimeout(() => flush(), SETTLE_DELAY);
      }
      return;
    }
    clearTimers();
    outside.current = null;
    lastWritten.current = data;
    const next = fns.current.parse(data);
    docRef.current = next;
    synced.current = next;
    history.current!.clear();
    setDocState(next);
    setTick((t) => t + 1);
  }, [data, flush]);

  const leave = useCallback(() => {
    if (docRef.current !== synced.current || outside.current !== null) flush();
  }, [flush]);
  useLeaveFlush(leave);
  // And when the block goes away.
  useEffect(() => () => leave(), [leave]);

  const show = useCallback(
    (next: T, save = false) => {
      docRef.current = next;
      setDocState(next);
      if (save) {
        schedule();
        return;
      }
      if (timer.current !== null) return;
      if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
      liveTimer.current = next === synced.current && outside.current === null ? null : window.setTimeout(() => flush(outside.current === null), outside.current === null ? LIVE_SAVE_DELAY : SETTLE_DELAY);
    },
    [schedule, flush],
  );

  /** Shows a state without recording it (typing, dragging); `save` also schedules a write. */
  const setLive = useCallback(
    (next: T, save = false) => {
      undoing.current = null;
      show(next, save);
    },
    [show],
  );

  /** A finished change: recorded for undo (from `before`, default the current state) and saved. */
  const commit = useCallback(
    (next: T, opts: { before?: T; key?: string } = {}) => {
      const before = opts.before ?? docRef.current;
      if (before === next) return;
      history.current!.push(before, opts.key);
      setLive(next, true);
      setTick((t) => t + 1);
    },
    [setLive],
  );

  const undo = useCallback(() => {
    const prev = history.current!.undo(docRef.current);
    if (!prev) return false;
    // Written at once, so the note's history and this one move together. (Mixed with a change not yet
    // saved, the write is a step like any other.)
    undoing.current = docRef.current === synced.current || undoing.current === "undo" ? "undo" : null;
    show(prev, true);
    if (undoing.current) flush();
    setTick((t) => t + 1);
    return true;
  }, [show, flush]);

  const redo = useCallback(() => {
    const next = history.current!.redo(docRef.current);
    if (!next) return false;
    undoing.current = docRef.current === synced.current || undoing.current === "redo" ? "redo" : null;
    show(next, true);
    if (undoing.current) flush();
    setTick((t) => t + 1);
    return true;
  }, [show, flush]);

  const flushNow = useCallback(() => flush(), [flush]);

  return {
    doc,
    docRef,
    setLive,
    commit,
    undo,
    redo,
    flush: flushNow,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
    tooLarge,
  };
}
