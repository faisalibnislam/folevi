"use client";

// The board being edited (StickiesView.tsx): local state first (so dragging is smooth), written to the
// block's `data` shortly after changes settle, with its own undo history. A workshop board is edited by
// several people at once, so nothing anyone does is dropped:
//
// - A change from elsewhere that arrives while this person has unsaved changes is merged with them
//   (mergeStickies: note by note, votes per person), not swapped in.
// - When the server refuses this person's save because someone else saved first (a sync conflict), the
//   two versions are merged here and saved again, instead of asking which to keep.
// - Undo and redo take back only this person's own change, on the board as it is now.
// - A board from before someone else's change that comes back later (a drag or an edit being cancelled, the
//   `before` of a finished change) is brought up to date first, so putting it back keeps their work.
//
// Like the other canvases, text being typed is also written while it is typed (800 ms after the last key), so
// a long note is not lost if the app stops before the edit is finished.
//
// `base` is the last version known to be on the server, which every merge starts from.
import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, mergeStickies, parseStickies, serializeStickies, type StickiesData } from "@folevi/editor-schema";
import type { SyncEngine } from "@/lib/sync/engine";
import { StickyHistory } from "./ops";
import { useLeaveFlush, type CanvasWrite } from "../canvas/leaveFlush";

const SAVE_DELAY = 400;
/** After the last keystroke or drag frame of a change still being made. */
const LIVE_SAVE_DELAY = 800;
/** How many changes from elsewhere are remembered, to bring a board from before them up to date (`fresh`). */
const MAX_TAKEN = 64;

export function useStickiesDoc({ data, write, me, blockId, engine }: { data: string; write: (data: string, how?: CanvasWrite) => void; me: string; blockId: string | null; engine: SyncEngine | null }) {
  const [doc, setDocState] = useState<StickiesData>(() => parseStickies(data));
  const docRef = useRef(doc);
  const lastWritten = useRef(data);
  const baseData = useRef(data);
  /** Changes here not written to the block yet (live gestures and the save delay). */
  const dirty = useRef(false);
  /** Everything unsaved here came from the board's own undo or redo (the write is then no step of the note's). */
  const undoing = useRef(false);
  const history = useRef(new StickyHistory());
  const [, setTick] = useState(0);
  const timer = useRef<number | null>(null);
  const liveTimer = useRef<number | null>(null);
  /** The last write was of a change still being made: the note's step for it is still open. */
  const liveOpen = useRef(false);
  /** The changes from elsewhere taken in so far, oldest first (the first `dropped` of them are forgotten). */
  const taken = useRef<{ base: StickiesData; theirs: StickiesData }[]>([]);
  const dropped = useRef(0);
  /** For each board held here: how many changes from elsewhere it already had in it. */
  const seen = useRef<WeakMap<object, number> | null>(null);
  if (!seen.current) {
    seen.current = new WeakMap();
    seen.current.set(doc, 0);
  }
  const [tooLarge, setTooLarge] = useState(false);
  const writeRef = useRef(write);
  writeRef.current = write;
  const meRef = useRef(me);
  meRef.current = me;
  /** A merge waiting for the server's version to show after a conflict was settled. */
  const pendingMerge = useRef<{ theirs: string; merged: StickiesData } | null>(null);

  /** Writes what is unsaved. `live` is the save of a change still being made (text being typed). */
  const flush = useCallback((live = false) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
    timer.current = null;
    liveTimer.current = null;
    const s = serializeStickies(docRef.current);
    if (s.length > LIMITS.maxStickiesDataLength) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    dirty.current = false;
    const undo = undoing.current;
    undoing.current = false;
    if (s === lastWritten.current) {
      // The change is finished and its last save while it was being made already holds all of it: the note
      // is told that step is over (canvas/noteUndo.ts).
      if (!live && liveOpen.current) {
        liveOpen.current = false;
        writeRef.current(s, { kind: "end" });
      }
      return;
    }
    lastWritten.current = s;
    liveOpen.current = live && !undo;
    writeRef.current(s, undo ? { kind: "undo" } : live ? { kind: "live", me: meRef.current } : { me: meRef.current });
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
    liveTimer.current = null;
    timer.current = window.setTimeout(() => flush(), SAVE_DELAY);
  }, [flush]);

  const show = useCallback((next: StickiesData) => {
    if (!seen.current!.has(next)) seen.current!.set(next, dropped.current + taken.current.length);
    docRef.current = next;
    setDocState(next);
  }, []);

  /** Shows a board that came from elsewhere (or was merged with it): boards from before it are now out of date. */
  const take = useCallback(
    (next: StickiesData) => {
      taken.current.push({ base: docRef.current, theirs: next });
      if (taken.current.length > MAX_TAKEN) {
        taken.current.shift();
        dropped.current += 1;
      }
      show(next);
    },
    [show],
  );

  /** `b` with every change from elsewhere it has not seen: the board itself when it is current. */
  const fresh = useCallback((b: StickiesData): StickiesData => {
    const at = seen.current!.get(b);
    const total = dropped.current + taken.current.length;
    if (at === undefined) seen.current!.set(b, total);
    if (at === undefined || at >= total) return b;
    let out = b;
    for (const t of taken.current.slice(Math.max(0, at - dropped.current))) out = mergeStickies(t.base, t.theirs, out, meRef.current);
    seen.current!.set(out, total);
    return out;
  }, []);

  // Changes from elsewhere (another person, another device, the note's own undo): merged with unsaved
  // changes here, otherwise taken as they are.
  useEffect(() => {
    if (data === lastWritten.current) return;
    lastWritten.current = data;
    const outside = parseStickies(data);
    const waiting = pendingMerge.current;
    let next = outside;
    if (waiting) {
      pendingMerge.current = null;
      next = data === waiting.theirs ? waiting.merged : mergeStickies(parseStickies(waiting.theirs), outside, waiting.merged, meRef.current);
    } else if (dirty.current) {
      next = mergeStickies(parseStickies(baseData.current), outside, docRef.current, meRef.current);
    }
    baseData.current = data;
    take(next);
    setTick((t) => t + 1);
    if (next !== outside && serializeStickies(next) !== data) {
      undoing.current = false;
      dirty.current = true;
      schedule();
    }
  }, [data, schedule, take]);

  // The server's side: once this block has nothing waiting to sync, what it shows is what the server has
  // (the base of the next merge). A conflict over this board is settled by merging both versions.
  useEffect(() => {
    if (!engine || !blockId) return;
    const check = () => {
      const s = engine.state;
      const conflict = s.conflicts.find((c) => c.blockId === blockId && c.reason === "content" && c.server?.type === "stickies" && c.client?.type === "stickies");
      if (conflict && conflict.server) {
        const theirs = String((conflict.server.props as { data?: unknown }).data ?? "");
        const merged = mergeStickies(parseStickies(baseData.current), parseStickies(theirs), docRef.current, meRef.current);
        pendingMerge.current = { theirs, merged };
        baseData.current = theirs;
        engine.resolveConflict(conflict.id, "theirs");
        // Normally the server's version shows in a moment (and the merge follows it); if it was already
        // showing, save the merge now.
        window.setTimeout(() => {
          const waiting = pendingMerge.current;
          if (!waiting) return;
          pendingMerge.current = null;
          take(waiting.merged);
          setTick((t) => t + 1);
          dirty.current = true;
          lastWritten.current = theirs;
          schedule();
        }, 600);
        return;
      }
      if (dirty.current || timer.current !== null) return;
      const busy = [...s.pending, ...s.inflight].some((op) => op.kind === "block.upsert" && op.block.id === blockId);
      if (busy) return;
      const entity = s.blocks[blockId];
      const shown = entity ? String((entity.block.props as { data?: unknown }).data ?? "") : null;
      if (shown !== null && shown === lastWritten.current) baseData.current = shown;
    };
    check();
    return engine.subscribe(check);
  }, [engine, blockId, schedule, take]);

  // Write any pending change when the block goes away, and whenever the block, the page or the app is
  // being left (canvas/leaveFlush.ts).
  useLeaveFlush(() => {
    if (dirty.current || timer.current !== null) flush();
  });
  const flushNow = useCallback(() => flush(), [flush]);
  useEffect(
    () => () => {
      if (dirty.current || timer.current !== null) flush();
    },
    [flush],
  );

  const apply = useCallback(
    (next: StickiesData, save = false) => {
      if (next === docRef.current && !save) return;
      dirty.current = true;
      show(next);
      if (save) {
        schedule();
        return;
      }
      // A change still being made (text being typed, a note being dragged): written a moment after it
      // pauses, unless a save is already on its way.
      if (timer.current !== null) return;
      if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
      liveTimer.current = window.setTimeout(() => flush(true), LIVE_SAVE_DELAY);
    },
    [schedule, show, flush],
  );

  /** Shows a state without recording it (live dragging and typing); `save` also schedules a write. */
  const setLive = useCallback(
    (given: StickiesData, save = false) => {
      const next = fresh(given);
      if (next !== docRef.current || save) undoing.current = false;
      apply(next, save);
    },
    [apply, fresh],
  );

  /** A finished change: recorded for undo (from `before`, default the current board) and saved. */
  const commit = useCallback(
    (given: StickiesData, opts: { before?: StickiesData; key?: string } = {}) => {
      if ((opts.before ?? docRef.current) === given) return;
      const before = fresh(opts.before ?? docRef.current);
      const next = fresh(given);
      history.current.push({ before, after: next }, opts.key);
      setLive(next, true);
      setTick((t) => t + 1);
    },
    [setLive, fresh],
  );

  // Undo puts back what this change had, on the board as it is now (others' later edits and votes stay).
  const undo = useCallback(() => {
    const step = history.current.undo();
    if (!step) return false;
    // (Mixed with a change not yet saved, the write is a step like any other.)
    if (!dirty.current) undoing.current = true;
    apply(mergeStickies(step.after, docRef.current, step.before, meRef.current), true);
    setTick((t) => t + 1);
    return true;
  }, [apply]);

  const redo = useCallback(() => {
    const step = history.current.redo();
    if (!step) return false;
    if (!dirty.current) undoing.current = true;
    apply(mergeStickies(step.before, docRef.current, step.after, meRef.current), true);
    setTick((t) => t + 1);
    return true;
  }, [apply]);

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
