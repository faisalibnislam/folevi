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
//
// `base` is the last version known to be on the server, which every merge starts from.
import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, mergeStickies, parseStickies, serializeStickies, type StickiesData } from "@folevi/editor-schema";
import type { SyncEngine } from "@/lib/sync/engine";
import { StickyHistory } from "./ops";

const SAVE_DELAY = 400;

export function useStickiesDoc({ data, write, me, blockId, engine }: { data: string; write: (data: string) => void; me: string; blockId: string | null; engine: SyncEngine | null }) {
  const [doc, setDocState] = useState<StickiesData>(() => parseStickies(data));
  const docRef = useRef(doc);
  const lastWritten = useRef(data);
  const baseData = useRef(data);
  /** Changes here not written to the block yet (live gestures and the save delay). */
  const dirty = useRef(false);
  const history = useRef(new StickyHistory());
  const [, setTick] = useState(0);
  const timer = useRef<number | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const writeRef = useRef(write);
  writeRef.current = write;
  const meRef = useRef(me);
  meRef.current = me;
  /** A merge waiting for the server's version to show after a conflict was settled. */
  const pendingMerge = useRef<{ theirs: string; merged: StickiesData } | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const s = serializeStickies(docRef.current);
    if (s.length > LIMITS.maxStickiesDataLength) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    dirty.current = false;
    if (s === lastWritten.current) return;
    lastWritten.current = s;
    writeRef.current(s);
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  const show = useCallback((next: StickiesData) => {
    docRef.current = next;
    setDocState(next);
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
    show(next);
    setTick((t) => t + 1);
    if (next !== outside && serializeStickies(next) !== data) {
      dirty.current = true;
      schedule();
    }
  }, [data, schedule, show]);

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
          show(waiting.merged);
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
  }, [engine, blockId, schedule, show]);

  // Write any pending change when the block goes away.
  useEffect(
    () => () => {
      if (timer.current !== null) flush();
    },
    [flush],
  );

  /** Shows a state without recording it (live dragging and typing); `save` also schedules a write. */
  const setLive = useCallback(
    (next: StickiesData, save = false) => {
      if (next === docRef.current && !save) return;
      dirty.current = true;
      show(next);
      if (save) schedule();
    },
    [schedule, show],
  );

  /** A finished change: recorded for undo (from `before`, default the current board) and saved. */
  const commit = useCallback(
    (next: StickiesData, opts: { before?: StickiesData; key?: string } = {}) => {
      const before = opts.before ?? docRef.current;
      if (before === next) return;
      history.current.push({ before, after: next }, opts.key);
      setLive(next, true);
      setTick((t) => t + 1);
    },
    [setLive],
  );

  // Undo puts back what this change had, on the board as it is now (others' later edits and votes stay).
  const undo = useCallback(() => {
    const step = history.current.undo();
    if (!step) return false;
    setLive(mergeStickies(step.after, docRef.current, step.before, meRef.current), true);
    setTick((t) => t + 1);
    return true;
  }, [setLive]);

  const redo = useCallback(() => {
    const step = history.current.redo();
    if (!step) return false;
    setLive(mergeStickies(step.before, docRef.current, step.after, meRef.current), true);
    setTick((t) => t + 1);
    return true;
  }, [setLive]);

  return {
    doc,
    docRef,
    setLive,
    commit,
    undo,
    redo,
    flush,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
    tooLarge,
  };
}
