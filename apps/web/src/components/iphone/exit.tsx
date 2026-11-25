"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/native/physics";

/**
 * Rows leaving a list, the iOS way: the row fades (a swiped one has already slid off), then its height folds
 * away so the rows below glide up, and only then is it taken out of the list. About 300 ms in all, on UIKit's
 * ease-out. Reduce Motion: a short fade, nothing moves.
 */
export const EXIT_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const EXIT_MS = 300;
const FADE_MS = 170;
const FOLD_DELAY_MS = 80;

/** Fades `el` and folds its height (and margins) to nothing; null when it can't animate (it goes at once). */
export function collapseOut(el: HTMLElement): Animation[] | null {
  if (typeof el.animate !== "function") return null;
  if (prefersReducedMotion()) return [el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-out", fill: "forwards" })];
  const cs = getComputedStyle(el);
  const height = el.getBoundingClientRect().height;
  return [
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EXIT_EASE, fill: "forwards" }),
    el.animate(
      [
        { height: `${height}px`, marginTop: cs.marginTop, marginBottom: cs.marginBottom },
        { height: "0px", marginTop: "0px", marginBottom: "0px" },
      ],
      { duration: EXIT_MS - FOLD_DELAY_MS, delay: FOLD_DELAY_MS, easing: EXIT_EASE, fill: "forwards" },
    ),
  ];
}

/** Runs `collapseOut` on `ref` while `leaving`, then calls `onDone`. Undone half way (it comes back), it snaps back. */
export function useCollapseOut(ref: RefObject<HTMLElement | null>, leaving: boolean, onDone?: () => void) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!leaving || !el) return;
    const anims = collapseOut(el);
    if (!anims) {
      done.current?.();
      return;
    }
    let live = true;
    Promise.all(anims.map((a) => a.finished)).then(
      () => {
        if (live) done.current?.();
      },
      () => {},
    );
    return () => {
      live = false;
      // A finished fold stays folded until the row is gone; one still running is put back (Undo).
      if (anims.some((a) => a.playState !== "finished")) anims.forEach((a) => a.cancel());
    };
  }, [leaving, ref]);
}

/** A list row that folds away while `leaving`, then calls `onDone` (which takes it out of the list). */
export function ExitLi({ leaving, onDone, children }: { leaving: boolean; onDone: () => void; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  useCollapseOut(ref, leaving, onDone);
  return (
    <li ref={ref} data-leaving={leaving ? "" : undefined} inert={leaving || undefined} className={leaving ? "overflow-hidden" : undefined}>
      {children}
    </li>
  );
}

/** A group that folds away with its last rows (they take it out of the list when they're done). */
export function ExitSection({ leaving, className = "", children, ...rest }: { leaving: boolean; className?: string; children: ReactNode; "aria-label"?: string }) {
  const ref = useRef<HTMLElement>(null);
  useCollapseOut(ref, leaving);
  return (
    <section ref={ref} {...rest} data-leaving={leaving ? "" : undefined} inert={leaving || undefined} className={`${className} ${leaving ? "overflow-hidden" : ""}`}>
      {children}
    </section>
  );
}

/**
 * For a row whose component is going away while it may still be on screen (a swiped note sent to the
 * Trash): a stand-in copy takes its place and folds away. Call it as the row unmounts (a layout effect's
 * cleanup, while it is still in the page). Only when the row's list item really leaves the page; a row
 * already folded by its list (`data-leaving`) is left alone.
 */
export function ghostOut(el: HTMLElement) {
  const host = el.parentElement?.tagName === "LI" ? el.parentElement : el;
  const parent = host.parentNode;
  if (!parent || !host.isConnected || host.closest("[data-leaving]") || typeof host.animate !== "function") return;
  if (host.getBoundingClientRect().height < 1) return;
  const ghost = host.cloneNode(true) as HTMLElement;
  const next = host.nextSibling;
  ghost.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.style.pointerEvents = "none";
  ghost.style.overflow = "hidden";
  // Decided once React has finished: if the list item stayed (only the swipe wrapper went), no stand-in.
  queueMicrotask(() => {
    if (host.isConnected || !parent.isConnected) return;
    parent.insertBefore(ghost, next && next.parentNode === parent ? next : null);
    const anims = collapseOut(ghost);
    if (!anims) return ghost.remove();
    Promise.all(anims.map((a) => a.finished)).then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
  });
}

interface Entry<T> {
  item: T;
  key: string;
  leaving: boolean;
}

const fresh = <T,>(items: readonly T[], keyOf: (t: T) => string): Entry<T>[] => items.map((item) => ({ item, key: keyOf(item), leaving: false }));

/**
 * The rows a list shows: `items`, plus the ones that just left it after the person acted on them (`expect`),
 * kept where they were and marked `leaving` until `finish` takes them out (their fold is done). Rows that go
 * for other reasons (filtering, another device) go at once. A new `reset` (another view) starts over.
 */
export function useExitingList<T>(items: readonly T[], keyOf: (t: T) => string, idOf: (t: T) => string, reset: string) {
  const [state, setState] = useState(() => ({ items, reset, entries: fresh(items, keyOf), acted: new Set<string>() as ReadonlySet<string> }));
  let current = state;
  if (state.items !== items || state.reset !== reset) {
    current = { ...state, items, reset, entries: state.reset !== reset ? fresh(items, keyOf) : merge(state.entries, items, keyOf, (t) => state.acted.has(idOf(t))) };
    setState(current);
  }

  const timers = useRef(new Map<string, number>());
  const finish = useCallback((key: string) => {
    setState((s) => (s.entries.some((e) => e.leaving && e.key === key) ? { ...s, entries: s.entries.filter((e) => !(e.leaving && e.key === key)) } : s));
  }, []);
  const expect = useCallback((id: string) => {
    setState((s) => ({ ...s, acted: new Set(s.acted).add(id) }));
    window.setTimeout(() => {
      setState((s) => {
        const acted = new Set(s.acted);
        acted.delete(id);
        return { ...s, acted };
      });
    }, 5000);
  }, []);

  // A row that never gets to fold (its group is folded away, say) still leaves.
  const entries = current.entries;
  useEffect(() => {
    const live = timers.current;
    for (const e of entries) if (e.leaving && !live.has(e.key)) live.set(e.key, window.setTimeout(() => finish(e.key), EXIT_MS + 900));
    for (const [key, t] of live) {
      if (!entries.some((e) => e.leaving && e.key === key)) {
        window.clearTimeout(t);
        live.delete(key);
      }
    }
  }, [entries, finish]);
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const t of live.values()) window.clearTimeout(t);
      live.clear();
    };
  }, []);

  return { entries, finish, expect };
}

/** `items` in order, with the rows that just left kept after the row they followed. */
function merge<T>(previous: Entry<T>[], items: readonly T[], keyOf: (t: T) => string, animates: (t: T) => boolean): Entry<T>[] {
  const keys = new Set(items.map(keyOf));
  const after = new Map<string | null, Entry<T>[]>();
  let anchor: string | null = null;
  for (const e of previous) {
    if (keys.has(e.key)) anchor = e.key;
    else if (e.leaving || animates(e.item)) after.set(anchor, [...(after.get(anchor) ?? []), { ...e, leaving: true }]);
  }
  const out: Entry<T>[] = [...(after.get(null) ?? [])];
  for (const item of items) {
    const key = keyOf(item);
    out.push({ item, key, leaving: false });
    out.push(...(after.get(key) ?? []));
  }
  return out;
}
