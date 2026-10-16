"use client";

// Back and Forward inside the app, like a browser's: every in-app move is a history entry that carries its
// position (`foleviAt` in history.state), so the app knows whether there's a page to go back or forward
// to without ever leaving the app (the first page opened in this window is position 0).

type State = { at: number; top: number };

let state: State = { at: 0, top: 0 };
const listeners = new Set<() => void>();
let started = false;
// Whether the page on screen came from Back or Forward (not a link): it gets its own tab back.
let popped = false;

const KEY = "foleviAt";

// Told just before the page on screen changes (a new page, or Back/Forward), while the old one is still
// drawn: the iPhone app's push and pop animations keep a picture of it (components/iphone/transitions.ts).
const moveListeners = new Set<(kind: "push" | "pop") => void>();
export function onHistoryMove(listener: (kind: "push" | "pop") => void): () => void {
  moveListeners.add(listener);
  return () => moveListeners.delete(listener);
}
const moving = (kind: "push" | "pop") => {
  for (const l of moveListeners) l(kind);
};

function emit(next: State) {
  if (next.at === state.at && next.top === state.top) return;
  state = next;
  for (const l of listeners) l();
}

// Only our position: Next.js treats an entry that carries its own internal state as its own navigation and
// wouldn't follow the address (usePathname) then.
const stateWith = (at: number): Record<string, unknown> => ({ [KEY]: at });

/** Reads (or stamps) the current entry's position and follows Back/Forward from now on. Idempotent. */
export function startHistoryNav() {
  if (started || typeof window === "undefined") return;
  started = true;
  const at = window.history.state?.[KEY];
  if (typeof at === "number") emit({ at, top: at });
  else window.history.replaceState(stateWith(0), "");
}

// Before anything else hears it, so it's listened for as soon as this module loads (before Next's router
// listens, in an effect; listeners on window run in the order they were added): React draws the page a
// popstate leads to straight away, inside Next's listener, and the old page must still be on screen for
// the iPhone app's picture of it.
function onPopState(e: PopStateEvent) {
  // The step back that starts rewriting the history (rewriteHistory), or one into entries it left
  // behind: nobody else hears it, so the page on screen doesn't change.
  if (swallow(e)) return;
  moving("pop");
  // The position too, before the page is drawn: what it draws (the iPhone app's tab stacks, a screen
  // coming back to where it was scrolled) reads it.
  popped = true;
  const at = (e.state as Record<string, unknown> | null)?.[KEY];
  if (typeof at === "number") emit({ at, top: Math.max(state.top, at) });
}
if (typeof window !== "undefined") {
  // (Once: a module loaded again while developing replaces its listener.)
  const w = window as unknown as { __foleviPopState?: (e: PopStateEvent) => void };
  if (w.__foleviPopState) window.removeEventListener("popstate", w.__foleviPopState, { capture: true });
  w.__foleviPopState = onPopState;
  window.addEventListener("popstate", onPopState, { capture: true });
}

// rewriteHistory: waiting for its step back to entry 0; and the entries past `staleAbove` (left over from
// before it, still Forward in the browser's history) that mustn't be shown again.
let rewinding: (() => void) | null = null;
let staleAbove: number | null = null;
let bouncing = false;

function swallow(e: PopStateEvent): boolean {
  const at = (e.state as Record<string, unknown> | null)?.[KEY];
  if (rewinding) {
    e.stopImmediatePropagation();
    rewinding();
    return true;
  }
  if (bouncing) {
    // Back from an entry that was left behind, to the one on screen: nothing changed.
    bouncing = false;
    e.stopImmediatePropagation();
    return true;
  }
  if (staleAbove !== null && typeof at === "number" && at > staleAbove) {
    e.stopImmediatePropagation();
    bouncing = true;
    window.history.go(staleAbove - at);
    return true;
  }
  return false;
}

/**
 * Makes the browser's history exactly `entries` (oldest first), with the last on screen: the iPhone app's
 * tabs each keep their own stack of screens, and the history is always the current tab's, so Back and the
 * edge swipe step through that tab only. Steps back to the first entry (heard by nobody), then replaces
 * and pushes. No push or pop is announced (nothing slides); the page shows the last entry.
 */
export function rewriteHistory(entries: string[]): Promise<void> {
  startHistoryNav();
  if (!entries.length) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      rewinding = null;
      window.clearTimeout(timer);
      window.history.replaceState(stateWith(0), "", entries[0]);
      for (let i = 1; i < entries.length; i++) window.history.pushState(stateWith(i), "", entries[i]);
      const top = entries.length - 1;
      // With one entry nothing was pushed, so what was ahead of it is still there: never go forward into it.
      staleAbove = top;
      popped = false;
      emit({ at: top, top });
      resolve();
    };
    let timer = 0;
    if (state.at <= 0) return finish();
    rewinding = finish;
    // (If the step back never arrives, carry on from where the page is.)
    timer = window.setTimeout(() => rewinding?.(), 1000);
    window.history.go(-state.at);
  });
}

/** A new page: one step forward, and anything that was ahead is gone (as in a browser). */
export function pushEntry(href: string) {
  staleAbove = null;
  popped = false;
  moving("push");
  const at = state.at + 1;
  window.history.pushState(stateWith(at), "", href);
  emit({ at, top: at });
}

/** The same step, a different address (the position stays). */
export function replaceEntry(href: string) {
  window.history.replaceState(stateWith(state.at), "", href);
}

/** Whether the latest move was Back or Forward. */
export const cameFromHistory = () => popped;

export function subscribeHistoryNav(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const historyNavSnapshot = () => state;
const SERVER: State = { at: 0, top: 0 };
export const historyNavServerSnapshot = () => SERVER;
