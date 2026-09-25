"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/**
 * Client-side routing for the product shell. Every product URL is rendered by one catch-all route, and
 * navigation uses history.pushState (which Next keeps in sync with usePathname), so moving around the
 * app works offline and never refetches server components. URLs stay stable and shareable.
 */
export type Route =
  | { name: "documents" }
  | { name: "doc"; id: string }
  | { name: "tasks"; view: "inbox" | "today" | "upcoming" | "all" | "completed" | "mine" }
  | { name: "calendar"; month: string | null }
  | { name: "daily"; date: string | null }
  | { name: "shared" }
  | { name: "templates" }
  | { name: "starred" }
  | { name: "archive" }
  | { name: "trash" }
  | { name: "unsorted" }
  | { name: "folder"; id: string }
  | { name: "tag"; id: string }
  | { name: "settings"; section: "account" | "security" | "appearance" | "notifications" | "workspace" | "members" | "sync" | "data" }
  | { name: "help" }
  | { name: "onboarding" }
  | { name: "invite"; token: string }
  | { name: "not_found" };

const TASK_VIEWS = ["inbox", "today", "upcoming", "all", "completed", "mine"] as const;
const SETTINGS = ["account", "security", "appearance", "notifications", "workspace", "members", "sync", "data"] as const;

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a] = parts;
  switch (head) {
    case "documents":
      return { name: "documents" };
    case "d":
      return a ? { name: "doc", id: a } : { name: "not_found" };
    case "tasks":
      return { name: "tasks", view: (TASK_VIEWS as readonly string[]).includes(a ?? "") ? (a as (typeof TASK_VIEWS)[number]) : "today" };
    case "calendar":
      return { name: "calendar", month: a && /^\d{4}-\d{2}$/.test(a) ? a : null };
    case "daily":
      return { name: "daily", date: a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : null };
    case "shared":
    case "templates":
    case "starred":
    case "archive":
    case "trash":
    case "unsorted":
    case "help":
    case "onboarding":
      return { name: head };
    case "folders":
      return a ? { name: "folder", id: a } : { name: "documents" };
    case "tags":
      return a ? { name: "tag", id: a } : { name: "documents" };
    case "settings":
      return { name: "settings", section: (SETTINGS as readonly string[]).includes(a ?? "") ? (a as (typeof SETTINGS)[number]) : "account" };
    case "invite":
      return a ? { name: "invite", token: a } : { name: "not_found" };
    default:
      return { name: "not_found" };
  }
}

export { APP_ROUTE_HEADS } from "./routes";

interface RouterValue {
  route: Route;
  pathname: string;
  search: URLSearchParams;
  navigate: (href: string, opts?: { replace?: boolean }) => void;
  back: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function AppRouterProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/documents";
  // When the offline shell is served for a different URL, re-sync the router with the address bar.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname !== pathname) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${window.location.hash}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const searchParams = useSearchParams();
  const route = useMemo(() => parseRoute(pathname), [pathname]);
  const navigate = useCallback((href: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    // Move focus to the main region for screen-reader users after navigation.
    // Only when focus was lost (e.g. the focused element was removed) — never steal it from the new view.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) document.getElementById("main")?.focus({ preventScroll: true });
    });
  }, []);
  const back = useCallback(() => window.history.back(), []);
  const search = useMemo(() => new URLSearchParams(searchParams?.toString() ?? ""), [searchParams]);
  const value = useMemo(() => ({ route, pathname, search, navigate, back }), [route, pathname, search, navigate, back]);
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
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
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
    navigate(href);
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
