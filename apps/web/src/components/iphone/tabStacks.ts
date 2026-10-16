"use client";

// The iPhone app's tabs each keep their own stack of screens, as on iOS: Home > a folder > a note, then
// Tasks, then back to Home shows that note again, where it was scrolled to. Tapping the tab you're on goes
// back to its first screen (or, already there, to the top).
//
// The browser's history is always the current tab's stack (lib/app/historyNav.ts rewriteHistory), so Back,
// the edge swipe and the router's canBack all mean "back in this tab". Switching tabs rewrites it to the
// other tab's stack. The stacks (each screen's address and how far it was scrolled) live here, and in
// sessionStorage so a reload of the web view keeps them.

import { useSyncExternalStore } from "react";
import { parseRoute, type Route } from "@/lib/app/router";
import { cameFromHistory, historyNavSnapshot, rewriteHistory } from "@/lib/app/historyNav";

export type Tab = "home" | "tasks" | "calendar";

export const TAB_ROOT: Record<Tab, string> = { home: "/documents", tasks: "/tasks/today", calendar: "/calendar" };

/** Which tab a screen opens in when it's a tab's own first screen: Tasks and Calendar, else Home. */
export function tabOf(route: Route): Tab {
  return route.name === "tasks" ? "tasks" : route.name === "calendar" ? "calendar" : "home";
}

/** A tab's first screen (any of Tasks' views, any month). */
export function isTabRoot(route: Route): boolean {
  return route.name === "documents" || route.name === "tasks" || route.name === "calendar";
}

interface Entry {
  href: string;
  /** How far its screen was scrolled when it was last on screen. */
  scroll?: number;
}

interface Stacks {
  current: Tab;
  stacks: Record<Tab, Entry[]>;
}

const STORE_KEY = "folevi:iphone-tabs";
let data: Stacks | null = null;
const listeners = new Set<() => void>();
// A tab switch's rewrite, until the router reaches the screen it leads to: that screen is restored, not new.
let expected: { href: string; at: number } | null = null;
let restoreHref: string | null = null;
// The router's position the last time it moved: a higher one is a push, the same one a replace.
let lastAt = 0;

function load(): Stacks {
  if (data) return data;
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null") as Stacks | null;
    if (raw && raw.stacks && (raw.current === "home" || raw.current === "tasks" || raw.current === "calendar")) data = raw;
  } catch {
    // Nothing kept, or not readable: start fresh.
  }
  data ??= { current: "home", stacks: { home: [], tasks: [], calendar: [] } };
  return data;
}

function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the stacks still work for this page.
  }
}

function emit() {
  save();
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The tab on screen. */
export function useCurrentTab(): Tab {
  return useSyncExternalStore(
    subscribe,
    () => load().current,
    () => "home",
  );
}

export const currentTab = (): Tab => load().current;

/** The current tab's stack, as addresses. */
export const currentStack = (): string[] => load().stacks[load().current].map((e) => e.href);

/**
 * The router moved (IphoneShell calls this for every address): the current tab's stack follows. Opening
 * another tab's first screen (a link to Tasks or Calendar, Home from a menu) switches to that tab, starting
 * it again from there.
 */
export function recordRoute(route: Route, href: string, first: boolean) {
  const s = load();
  const { at } = historyNavSnapshot();
  if (expected) {
    const match = expected.href === href && expected.at === at;
    if (match) {
      expected = null;
      lastAt = at;
      return;
    }
  }
  if (first) {
    // The page (re)opened: a kept stack that matches where it is carries on; otherwise start from here.
    const kept = s.stacks[s.current];
    if (kept[at]?.href !== href) {
      s.current = tabOf(route);
      const stack = s.stacks[s.current].slice(0, at);
      while (stack.length < at) stack.push({ href: TAB_ROOT[s.current] });
      stack[at] = { href };
      s.stacks[s.current] = stack;
    }
    lastAt = at;
    emit();
    return;
  }
  const popped = cameFromHistory();
  // Home or Calendar opened from deeper in their own tab (a menu, a place switched): back to its start, as
  // iOS pops to a tab's root. (Tasks' other views, like Completed, are pushed on purpose.)
  const ownRootAgain = isTabRoot(route) && tabOf(route) === s.current && route.name !== "tasks" && at > 0;
  if (!popped && isTabRoot(route) && (tabOf(route) !== s.current || ownRootAgain)) {
    s.current = tabOf(route);
    s.stacks[s.current] = [{ href }];
    expected = { href, at: 0 };
    lastAt = 0;
    emit();
    if (at > 0) void rewriteHistory([href]);
    else expected = null;
    return;
  }
  const stack = s.stacks[s.current];
  if (popped) {
    // Back (or Forward) to a screen this tab has: it keeps how far it was scrolled.
    if (stack[at]?.href !== href) stack[at] = { href };
  } else if (at > lastAt) {
    restoreHref = null;
    // A new screen on top: what was ahead of it is gone (as in a browser).
    const next = stack.slice(0, at);
    while (next.length < at) next.push({ href: TAB_ROOT[s.current] });
    next.push({ href });
    s.stacks[s.current] = next;
  } else if (stack[at]?.href !== href) {
    // The same screen with another address (another task view, the next month).
    while (stack.length < at) stack.push({ href: TAB_ROOT[s.current] });
    stack[at] = { href };
  }
  lastAt = at;
  emit();
}

/** Shows another tab where it was left (its stack, the screen on top scrolled as it was). */
export function selectTab(tab: Tab) {
  const s = load();
  if (tab === s.current) return;
  // The tab being left keeps the screens up to the one on show (none it went Back from).
  s.stacks[s.current] = s.stacks[s.current].slice(0, historyNavSnapshot().at + 1);
  s.current = tab;
  const stack = s.stacks[tab].length ? s.stacks[tab] : [{ href: TAB_ROOT[tab] }];
  s.stacks[tab] = stack;
  expected = { href: stack[stack.length - 1]!.href, at: stack.length - 1 };
  restoreHref = stack[stack.length - 1]!.href;
  emit();
  void rewriteHistory(stack.map((e) => e.href));
}

/** How deep the current tab is (0: its first screen), and whether that first screen is the tab's own. */
export function stackDepth(): { depth: number; rootIsTab: boolean } {
  const s = load();
  const first = s.stacks[s.current][0];
  const route = first ? parseRoute(first.href.split(/[?#]/)[0]!) : null;
  return { depth: historyNavSnapshot().at, rootIsTab: route !== null && isTabRoot(route) && tabOf(route) === s.current };
}

/** The current tab from its own first screen again (a link opened it on another screen). */
export function resetToRoot() {
  const s = load();
  s.stacks[s.current] = [{ href: TAB_ROOT[s.current] }];
  expected = { href: TAB_ROOT[s.current], at: 0 };
  emit();
  void rewriteHistory([TAB_ROOT[s.current]]);
}

/** Another place (a workspace, Personal): every tab starts again from its first screen. */
export function resetAllTabs() {
  const s = load();
  for (const tab of ["home", "tasks", "calendar"] as Tab[]) if (tab !== s.current) s.stacks[tab] = [];
  emit();
}

/** Remembers how far a screen is scrolled (its tab, its place in the stack, its address). */
export function saveScroll(tab: Tab, at: number, href: string, top: number) {
  const entry = load().stacks[tab][at];
  if (entry && entry.href === href) {
    entry.scroll = top;
    save();
  }
}

/**
 * How far a screen that's coming back should scroll: after Back, or switching to its tab (never for a
 * screen that's new).
 */
export function scrollToRestore(href: string): number | null {
  // (A tab switch's screen only: the history is rewritten through its first screen on the way. Asked again
  // if the screen is drawn again while it loads, until the next move.)
  const restoring = restoreHref === href || cameFromHistory();
  if (!restoring) return null;
  const s = load();
  const entry = s.stacks[s.current][historyNavSnapshot().at];
  return entry && entry.href === href && entry.scroll ? entry.scroll : null;
}
