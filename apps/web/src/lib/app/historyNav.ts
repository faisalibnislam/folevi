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
  window.addEventListener("popstate", (e) => {
    popped = true;
    const at = (e.state as Record<string, unknown> | null)?.[KEY];
    if (typeof at === "number") emit({ at, top: Math.max(state.top, at) });
  });
}

/** A new page: one step forward, and anything that was ahead is gone (as in a browser). */
export function pushEntry(href: string) {
  popped = false;
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
