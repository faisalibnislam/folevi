"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, parseWireframe, serializeWireframe, type WireframeData } from "@folevi/editor-schema";
import { WireHistory } from "./ops";

const SAVE_DELAY = 400;

/**
 * The wireframe being edited: local state first (so dragging is smooth), written to the block's `data`
 * shortly after changes settle, with its own undo history. When `data` changes from outside (another
 * device, or the editor's own undo) the local wireframe and its history are replaced.
 */
export function useWireDoc(data: string, write: (data: string) => void) {
  const [doc, setDocState] = useState<WireframeData>(() => parseWireframe(data));
  const docRef = useRef(doc);
  const lastWritten = useRef(data);
  const history = useRef(new WireHistory<WireframeData>());
  const [, setTick] = useState(0);
  const timer = useRef<number | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const writeRef = useRef(write);
  writeRef.current = write;

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const s = serializeWireframe(docRef.current);
    if (s.length > LIMITS.maxWireframeDataLength) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    if (s === lastWritten.current) return;
    lastWritten.current = s;
    writeRef.current(s);
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  // Outside changes win over unsaved local ones.
  useEffect(() => {
    if (data === lastWritten.current) return;
    lastWritten.current = data;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const next = parseWireframe(data);
    docRef.current = next;
    history.current.clear();
    setDocState(next);
    setTick((t) => t + 1);
  }, [data]);

  // Write any pending change when the block goes away.
  useEffect(() => () => {
    if (timer.current !== null) flush();
  }, [flush]);

  /** Shows a state without recording it (live dragging); `save` also schedules a write. */
  const setLive = useCallback(
    (next: WireframeData, save = false) => {
      docRef.current = next;
      setDocState(next);
      if (save) schedule();
    },
    [schedule],
  );

  /** A finished change: recorded for undo (from `before`, default the current wireframe) and saved. */
  const commit = useCallback(
    (next: WireframeData, opts: { before?: WireframeData; key?: string } = {}) => {
      const before = opts.before ?? docRef.current;
      if (before === next) return;
      history.current.push(before, opts.key);
      setLive(next, true);
      setTick((t) => t + 1);
    },
    [setLive],
  );

  const undo = useCallback(() => {
    const prev = history.current.undo(docRef.current);
    if (!prev) return false;
    setLive(prev, true);
    setTick((t) => t + 1);
    return true;
  }, [setLive]);

  const redo = useCallback(() => {
    const next = history.current.redo(docRef.current);
    if (!next) return false;
    setLive(next, true);
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
