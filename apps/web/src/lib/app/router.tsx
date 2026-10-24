"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { historyNavServerSnapshot, historyNavSnapshot, locationSnapshot, notifyLocation, pushEntry, replaceEntry, startHistoryNav, subscribeHistoryNav, subscribeLocation } from "./historyNav";
import { APP_ROUTE_HEADS } from "./routes";
import { nativeChrome } from "@/lib/nativeApp";
import { requestNavigation } from "@/lib/engine/navigation";

/**
 * Client-side routing for the product shell. Every product URL is rendered by one catch-all route, and
 * navigation uses history.pushState (which Next keeps in sync with usePathname), so moving around the
 * app works offline and never refetches server components. URLs stay stable and shareable.
 */
export type Route =
  | { name: "documents" }
  | { name: "doc"; id: string }
  /** The AI page: the conversation list and one conversation (or a new one). */
  | { name: "ai"; id: string | null }
  /** The graph view: notes, links and (on Pro) the people, projects and topics they mention. */
  | { name: "graph" }
  /** The person's Inbox page in the current place (folevi://inbox): resolved, then opened as /d/<id>. */
  | { name: "inbox" }
  | { name: "tasks"; view: "inbox" | "today" | "upcoming" | "all" | "completed" | "mine" }
  | { name: "calendar"; month: string | null }
  /** Reviews: flashcards due today (spaced repetition). `?note=` reviews one note's cards. */
  | { name: "review" }
  /** Changes: what others changed in your notes since you last looked. */
  | { name: "changes" }
  | { name: "daily"; date: string | null }
  | { name: "shared" }
  | { name: "templates" }
  | { name: "starred" }
  | { name: "archive" }
  | { name: "trash" }
  | { name: "unsorted" }
  | { name: "folder"; id: string }
  | { name: "folders" }
  | { name: "notes" }
  | { name: "tags" }
  | { name: "tag"; id: string }
  | { name: "settings"; section: "account" | "ai" | "billing" | "security" | "privacy" | "devices" | "connected-apps" | "appearance" | "notifications" | "workspace" | "members" | "workspace-guests" | "workspace-billing" | "workspace-data" | "workspace-privacy" | "sync" | "library" | "data" | "desktop" | "this-device" }
  | { name: "help" }
  | { name: "onboarding" }
  /** The Mac app's Quick Add window (apps/mac QuickAddPanel.swift). */
  | { name: "quick-add" }
  /** A place kept in sync behind the scenes (several places at once): no window shows it (components/places/PlaceSync.tsx). */
  | { name: "place-sync" }
  /** Save to Folevi: a share from another app (share target) or the bookmarklet, saved to an Inbox. */
  | { name: "share" }
  /** Connecting an app (MCP) to Folevi: the OAuth consent screen. */
  | { name: "oauth-consent" }
  | { name: "invite"; token: string }
  | { name: "share-invite"; token: string }
  /** The native apps' idle page (native chrome mode, docs/NATIVE_APP_PLAN.md section 8): the engine, nothing drawn. */
  | { name: "native" }
  | { name: "not_found" };

const TASK_VIEWS = ["inbox", "today", "upcoming", "all", "completed", "mine"] as const;
const SETTINGS = ["account", "ai", "billing", "security", "privacy", "devices", "connected-apps", "appearance", "notifications", "workspace", "members", "workspace-guests", "workspace-billing", "workspace-data", "workspace-privacy", "sync", "library", "data", "desktop", "this-device"] as const;

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a] = parts;
  switch (head) {
    case "documents":
      return { name: "documents" };
    case "notes":
      return { name: "notes" };
    case "d":
      return a ? { name: "doc", id: a } : { name: "not_found" };
    case "ai":
      return { name: "ai", id: a && /^[0-9A-Za-z]{1,64}$/.test(a) ? a : null };
    case "graph":
      return { name: "graph" };
    case "inbox":
      return { name: "inbox" };
    case "tasks":
      return { name: "tasks", view: (TASK_VIEWS as readonly string[]).includes(a ?? "") ? (a as (typeof TASK_VIEWS)[number]) : "today" };
    case "calendar":
      return { name: "calendar", month: a && /^\d{4}-\d{2}$/.test(a) ? a : null };
    case "daily":
      return { name: "daily", date: a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : null };
    case "review":
    case "changes":
    case "shared":
    case "templates":
    case "starred":
    case "archive":
    case "trash":
    case "help":
    case "onboarding":
    case "quick-add":
    case "place-sync":
    case "share":
      return { name: head };
    // Drafts was called Unsorted; old /unsorted links keep working.
    case "drafts":
    case "unsorted":
      return { name: "unsorted" };
    case "folders":
      return a ? { name: "folder", id: a } : { name: "folders" };
    case "tags":
      return a ? { name: "tag", id: a } : { name: "tags" };
    case "settings":
      return { name: "settings", section: (SETTINGS as readonly string[]).includes(a ?? "") ? (a as (typeof SETTINGS)[number]) : "account" };
    case "oauth":
      return a === "consent" ? { name: "oauth-consent" } : { name: "not_found" };
    case "invite":
      return a ? { name: "invite", token: a } : { name: "not_found" };
    case "share-invite":
      return a ? { name: "share-invite", token: a } : { name: "not_found" };
    case "native":
      return { name: "native" };
    default:
      return { name: "not_found" };
  }
}

export { APP_ROUTE_HEADS } from "./routes";

export interface RouterValue {
  route: Route;
  pathname: string;
  search: URLSearchParams;
  /** `engine`: the native apps' engine moving the page (native chrome mode; everything else asks native). */
  navigate: (href: string, opts?: { replace?: boolean; engine?: boolean }) => void;
  back: () => void;
  /** Back and Forward inside the app (lib/app/historyNav.ts): whether there's a page each way. */
  forward?: () => void;
  canBack?: boolean;
  canForward?: boolean;
}

const RouterContext = createContext<RouterValue | null>(null);

const noLocation = () => null;

export function AppRouterProvider({ children }: { children: ReactNode }) {
  const nextPathname = usePathname() ?? "/documents";
  const searchParams = useSearchParams();
  const nextSearch = searchParams?.toString() ?? "";
  // The address as it changes (historyNav tells at once), not when Next.js's own transition catches up: the
  // next page draws on the frame after the tap instead of a render or two later (docs/IOS_PERFORMANCE.md).
  // Until hydrated, and for an address outside the app (a sign-in page Next.js is about to draw), Next's.
  const live = useSyncExternalStore(subscribeLocation, locationSnapshot, noLocation);
  const at = live ? live.indexOf("?") : -1;
  const livePath = live ? (at < 0 ? live : live.slice(0, at)) : null;
  const inApp = livePath !== null && APP_ROUTE_HEADS.has(livePath.split("/").filter(Boolean)[0] ?? "");
  const pathname = inApp ? livePath : nextPathname;
  const searchString = inApp ? (at < 0 ? "" : live!.slice(at + 1)) : nextSearch;
  // Anything else that moved the address (Next's own router, a replaceState of the query) is read again.
  useEffect(() => notifyLocation(), [nextPathname, nextSearch]);
  // When the offline shell is served for a different URL, re-sync the router with the address bar.
  useEffect(() => {
    startHistoryNav();
    if (typeof window !== "undefined" && window.location.pathname !== nextPathname) {
      replaceEntry(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nav = useSyncExternalStore(subscribeHistoryNav, historyNavSnapshot, historyNavServerSnapshot);
  const route = useMemo(() => parseRoute(pathname), [pathname]);
  const navigate = useCallback((href: string, opts?: { replace?: boolean; engine?: boolean }) => {
    startHistoryNav();
    // Native chrome mode: only the engine moves the page, and always in place; anything else that would navigate
    // asks native (lib/engine/navigation.ts), except a change of the same page's query (a note's ?new=1 cleared).
    if (nativeChrome()) {
      const here = window.location.pathname;
      const to = new URL(href, window.location.href);
      if (opts?.engine || (to.origin === window.location.origin && to.pathname === here) || !requestNavigation(href)) replaceEntry(href);
      return;
    }
    if (opts?.replace) replaceEntry(href);
    else pushEntry(href);
    // Move focus to the main region for screen-reader users after navigation.
    // Only when focus was lost (e.g. the focused element was removed). Never steal it from the new view.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) document.getElementById("main")?.focus({ preventScroll: true });
    });
  }, []);
  const back = useCallback(() => window.history.back(), []);
  const forward = useCallback(() => window.history.forward(), []);
  const canBack = nav.at > 0;
  const canForward = nav.at < nav.top;
  const search = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const value = useMemo(() => ({ route, pathname, search, navigate, back, forward, canBack, canForward }), [route, pathname, search, navigate, back, forward, canBack, canForward]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/** A fixed router, for the editor on the public site (where nothing navigates inside the app). */
export function StaticRouterProvider({ value, children }: { value: RouterValue; children: ReactNode }) {
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useAppRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useAppRouter outside AppRouterProvider");
  return ctx;
}

/** Anchor that navigates in-app on plain clicks; modifier/Alt clicks open a new tab (native behavior). */
export function AppLink({
  href,
  children,
  onClick,
  replace,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode; /** Takes the current page's place in history (a view switcher). */ replace?: boolean }) {
  const { navigate } = useAppRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.altKey) {
      e.preventDefault();
      window.open(href, "_blank", "noopener");
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || rest.target === "_blank") return;
    e.preventDefault();
    navigate(href, replace ? { replace: true } : undefined);
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
