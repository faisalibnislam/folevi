"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Id } from "@/lib/convex/api";

/**
 * Reveals text word by word as it arrives: the shown part catches up with what's been received, a few
 * words per frame (faster when it falls behind), always ending on a word boundary. Reduced motion shows
 * everything at once.
 */
export function useTypewriter(target: string, active: boolean): { text: string; caughtUp: boolean } {
  const [shown, setShown] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (target.length < shown) setShown(0);
  }, [target, shown]);
  useEffect(() => {
    if (!active) {
      setShown(0);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 30) return;
      last = now;
      setShown((n) => {
        const t = targetRef.current;
        if (reduce || n >= t.length) return t.length;
        // A few words per frame, more when far behind (long replies don't make you wait).
        const behind = t.length - n;
        let next = n + Math.max(3, Math.ceil(behind / 28));
        const space = t.slice(next).search(/\s/);
        next = space < 0 ? t.length : next + space;
        return Math.min(next, t.length);
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  if (!active) return { text: target, caughtUp: true };
  return { text: target.slice(0, shown), caughtUp: shown >= target.length };
}

/**
 * One live AI reply: `begin()` opens a stream (pass its id to the AI action), `text` is what's been
 * written so far (revealed word by word), `stop()` asks the AI to stop (the action then returns what it
 * had), `end()` closes it.
 */
export function useAiStream() {
  const start = useMutation(api.ai.startStream);
  const cancel = useMutation(api.ai.cancelStream);
  const [id, setId] = useState<Id<"aiStreams"> | null>(null);
  // The current stream, for callbacks created in earlier renders (an AI call outlives the render that began it).
  const idRef = useRef<Id<"aiStreams"> | null>(null);
  idRef.current = id;
  // The whole reply, once the AI call returns: the typewriter finishes revealing it before it's handed over.
  const [final, setFinal] = useState<string | null>(null);
  const live = useQuery(api.ai.stream, id ? { id } : "skip");
  const { text, caughtUp } = useTypewriter(final ?? live?.text ?? "", Boolean(id));
  const settle = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (final !== null && caughtUp && settle.current) {
      settle.current();
      settle.current = null;
    }
  }, [final, caughtUp]);
  const begin = useCallback(async () => {
    setFinal(null);
    const next = await start({});
    idRef.current = next;
    setId(next);
    return next;
  }, [start]);
  const stop = useCallback(() => {
    if (idRef.current) void cancel({ id: idRef.current });
  }, [cancel]);
  /** Lets the reveal catch up with the whole reply (instantly if nothing was streamed), then closes. */
  const finish = useCallback(
    (full: string) =>
      new Promise<void>((resolve) => {
        if (!idRef.current || !full) {
          setId(null);
          setFinal(null);
          return resolve();
        }
        settle.current = () => {
          setId(null);
          setFinal(null);
          resolve();
        };
        setFinal(full);
      }),
    [],
  );
  const end = useCallback(() => {
    settle.current = null;
    setId(null);
    setFinal(null);
  }, []);
  return { begin, stop, finish, end, text, live: Boolean(id) };
}
