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
/** How many changes from elsewhere are remembered, to bring a state from before them up to date (`fresh`). */
const MAX_TAKEN = 64;
/** A press whose release was never heard stops counting as a gesture after this long. */
const PRESS_MAX = 60_000;

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
 * - While a pointer is down (a shape being dragged works from the canvas as it was at the press, and would put
 *   that back on its next frame) a change from elsewhere waits for the release, whatever is or is not unsaved.
 * - A state from before such a change that comes back later (the canvas's own undo, a drag or an edit being
 *   cancelled, the `before` of a finished edit) is brought up to date first, so putting it back never takes the
 *   other side's work away.
 * - A merge too large to store is not made: this side's work stays as it is, unsaved, with `tooLarge` set.
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
  /** The last write was of a change still being made: the note's step for it is still open. */
  const liveOpen = useRef(false);
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
  const maxRef = useRef(maxLength);
  maxRef.current = maxLength;

  /** The changes from elsewhere taken in so far, oldest first (the first `dropped` of them are forgotten). */
  const taken = useRef<{ base: T; theirs: T }[]>([]);
  const dropped = useRef(0);
  /** For each state this canvas has held: how many changes from elsewhere it already had in it. */
  const seen = useRef<WeakMap<object, number> | null>(null);
  if (!seen.current) {
    seen.current = new WeakMap();
    seen.current.set(doc, 0);
  }
  /** The pointers that are down anywhere on the page, and what explicitly asked for changes to wait (`hold`). */
  const down = useRef(new Map<number, { type: string; at: number }>());
  const holds = useRef(0);
  const busy = () => {
    if (holds.current > 0) return true;
    const now = Date.now();
    for (const [id, p] of down.current) if (now - p.at > PRESS_MAX) down.current.delete(id);
    return down.current.size > 0;
  };

  const clearTimers = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
    timer.current = null;
    liveTimer.current = null;
  };

  /** Makes `next` the state on screen (it has every change from elsewhere so far in it). */
  const put = useCallback((next: T) => {
    if (!seen.current!.has(next)) seen.current!.set(next, dropped.current + taken.current.length);
    docRef.current = next;
  }, []);

  /** A change from elsewhere was taken in: states from before it are brought up to date when they come back. */
  const took = useCallback((base: T, theirs: T) => {
    taken.current.push({ base, theirs });
    if (taken.current.length > MAX_TAKEN) {
      taken.current.shift();
      dropped.current += 1;
    }
  }, []);

  /**
   * `d` with every change from elsewhere it has not seen: the state itself when it is current. Used on any
   * state handed back in from before (the undo history, a gesture's or an edit's `before`).
   */
  const fresh = useCallback((d: T): T => {
    const at = seen.current!.get(d);
    const total = dropped.current + taken.current.length;
    // (Never held here before: taken as current, from now.)
    if (at === undefined) seen.current!.set(d, total);
    if (at === undefined || at >= total) return d;
    let out = d;
    for (const t of taken.current.slice(Math.max(0, at - dropped.current))) out = mergeCanvasData(t.base, t.theirs, out);
    const text = fns.current.serialize(out);
    // (Too large to read back: the canvas stays as it is instead.)
    if (text.length > maxRef.current) return docRef.current;
    const next = fns.current.parse(text);
    seen.current!.set(next, total);
    return next;
  }, []);

  /**
   * Writes what is unsaved. `live` is the save of a change still being made: it never merges in a waiting
   * outside change, because the gesture making it works from the chart as it was when it started and would
   * put that back on its next step.
   */
  const flush = useCallback((live = false) => {
    const { parse: read, serialize: text } = fns.current;
    const max = maxRef.current;
    if (live && outside.current !== null) return;
    clearTimers();
    if (outside.current !== null) {
      const theirs = outside.current;
      const base = read(lastWritten.current);
      const their = read(theirs);
      const mergedText = text(mergeCanvasData(base, their, docRef.current));
      // Over the limit the reader hands back an empty canvas, and saving that would wipe the block for
      // everyone. So the merge is not made: the work here stays as it is, unsaved, and the other side's
      // change stays waiting until there is room for both.
      const merged = mergedText.length > max ? null : read(mergedText);
      const blank = text(read(""));
      if (!merged || (mergedText !== blank && text(merged) === blank)) {
        setTooLarge(true);
        return;
      }
      outside.current = null;
      took(base, their);
      lastWritten.current = theirs;
      put(merged);
      setDocState(merged);
      setTick((t) => t + 1);
      undoing.current = null;
    }
    const s = text(docRef.current);
    if (s.length > max) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    synced.current = docRef.current;
    const kind = undoing.current ?? (live ? "live" : undefined);
    undoing.current = null;
    if (s === lastWritten.current) {
      // The change is finished and its last save while it was being made already holds all of it: the note
      // is told that step is over, or the next change to this canvas would join it however much later.
      if (!live && liveOpen.current) {
        liveOpen.current = false;
        writeRef.current(s, { kind: "end" });
      }
      return;
    }
    lastWritten.current = s;
    liveOpen.current = kind === "live";
    writing.current = true;
    try {
      writeRef.current(s, { kind });
    } finally {
      writing.current = false;
    }
  }, [put, took]);

  /**
   * A save by the clock. While a gesture is under way a waiting change from elsewhere is left for its release
   * (and looked at again a little later, in case that release is never heard).
   */
  const tick = useCallback(
    (live: boolean) => {
      if (outside.current !== null && busy()) {
        clearTimers();
        liveTimer.current = window.setTimeout(() => tick(false), SETTLE_DELAY);
        return;
      }
      flush(live);
    },
    [flush],
  );

  const schedule = useCallback(() => {
    clearTimers();
    timer.current = window.setTimeout(() => tick(false), SAVE_DELAY);
  }, [tick]);

  /** With nothing unsaved here: what came from elsewhere is shown, and this block's undo history starts over. */
  const adopt = useCallback((theirs: string) => {
    clearTimers();
    outside.current = null;
    lastWritten.current = theirs;
    const next = fns.current.parse(theirs);
    took(synced.current, next);
    put(next);
    synced.current = next;
    history.current!.clear();
    setDocState(next);
    setTick((t) => t + 1);
  }, [put, took]);

  /** A gesture ended: a change from elsewhere that waited for it is taken in now. */
  const settle = useCallback(() => {
    if (outside.current === null || busy()) return;
    if (docRef.current === synced.current) {
      adopt(outside.current);
      return;
    }
    if (timer.current === null && liveTimer.current === null) liveTimer.current = window.setTimeout(() => tick(false), SAVE_DELAY);
  }, [adopt, tick]);

  // A change from outside: shown at once when nothing here is unsaved, otherwise merged at the next save.
  useEffect(() => {
    // (An undo that goes through the note's history may pass through older drawings on its way.)
    if (writing.current) return;
    if (data === lastWritten.current) {
      outside.current = null;
      return;
    }
    if (busy()) {
      outside.current = data;
      if (timer.current === null && liveTimer.current === null) liveTimer.current = window.setTimeout(() => tick(false), SETTLE_DELAY);
      return;
    }
    if (docRef.current !== synced.current) {
      outside.current = data;
      if (timer.current === null) {
        if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
        liveTimer.current = window.setTimeout(() => tick(false), SETTLE_DELAY);
      }
      return;
    }
    adopt(data);
  }, [data, tick, adopt]);

  const leave = useCallback(
    (e?: Event) => {
      if (e?.type === "pointerdown") {
        const press = e as PointerEvent;
        // A new first finger (or the mouse, or the pen) means any earlier press of its kind is over, heard
        // or not: a touch let go over something that has since left the page is never reported.
        if (press.isPrimary) for (const [id, p] of down.current) if (p.type === press.pointerType) down.current.delete(id);
        const first = !busy();
        down.current.set(press.pointerId, { type: press.pointerType, at: Date.now() });
        // Another pointer while one is down (a second finger, a palm beside the pen): the gesture under way
        // saves its own work when it ends.
        if (!first) return;
      }
      if (docRef.current !== synced.current || outside.current !== null) flush();
    },
    [flush],
  );
  useLeaveFlush(leave);
  // And when the block goes away.
  useEffect(() => () => leave(), [leave]);

  // The pointers that are down (see `leave` for the press): their release lets a waiting change in, once the
  // canvas's own handlers have ended the gesture and recorded it.
  useEffect(() => {
    const lift = (e: PointerEvent) => {
      if (down.current.delete(e.pointerId)) window.setTimeout(settle, 0);
    };
    window.addEventListener("pointerup", lift, true);
    window.addEventListener("pointercancel", lift, true);
    return () => {
      window.removeEventListener("pointerup", lift, true);
      window.removeEventListener("pointercancel", lift, true);
    };
  }, [settle]);

  const show = useCallback(
    (next: T, save = false) => {
      put(next);
      setDocState(next);
      if (save) {
        schedule();
        return;
      }
      if (timer.current !== null) return;
      if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
      liveTimer.current = next === synced.current && outside.current === null ? null : window.setTimeout(() => tick(outside.current === null), outside.current === null ? LIVE_SAVE_DELAY : SETTLE_DELAY);
    },
    [schedule, tick, put],
  );

  /** Shows a state without recording it (typing, dragging); `save` also schedules a write. */
  const setLive = useCallback(
    (next: T, save = false) => {
      undoing.current = null;
      show(fresh(next), save);
    },
    [show, fresh],
  );

  /** A finished change: recorded for undo (from `before`, default the current state) and saved. */
  const commit = useCallback(
    (next: T, opts: { before?: T; key?: string } = {}) => {
      const before = opts.before ?? docRef.current;
      if (before === next) return;
      history.current!.push(fresh(before), opts.key);
      setLive(next, true);
      setTick((t) => t + 1);
    },
    [setLive, fresh],
  );

  const undo = useCallback(() => {
    const prev = history.current!.undo(docRef.current);
    if (!prev) return false;
    // Written at once, so the note's history and this one move together. (Mixed with a change not yet
    // saved, the write is a step like any other.)
    undoing.current = docRef.current === synced.current || undoing.current === "undo" ? "undo" : null;
    show(fresh(prev), true);
    if (undoing.current) flush();
    setTick((t) => t + 1);
    return true;
  }, [show, flush, fresh]);

  const redo = useCallback(() => {
    const next = history.current!.redo(docRef.current);
    if (!next) return false;
    undoing.current = docRef.current === synced.current || undoing.current === "redo" ? "redo" : null;
    show(fresh(next), true);
    if (undoing.current) flush();
    setTick((t) => t + 1);
    return true;
  }, [show, flush, fresh]);

  const flushNow = useCallback(() => flush(), [flush]);

  /** Changes from elsewhere wait from here until `release` (for a gesture that no pointer on the page shows). */
  const hold = useCallback(() => {
    holds.current += 1;
  }, []);
  const release = useCallback(() => {
    holds.current = Math.max(0, holds.current - 1);
    settle();
  }, [settle]);

  return {
    doc,
    docRef,
    setLive,
    commit,
    undo,
    redo,
    flush: flushNow,
    hold,
    release,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
    tooLarge,
  };
}
