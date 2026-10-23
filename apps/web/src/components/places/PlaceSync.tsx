"use client";
// The background runner of a place no window shows (docs/MULTI_ACCOUNT_PLAN.md §5): /place-sync?place=acct:<id>,
// in a hidden iframe on the website (PlaceRunners.tsx), or in the Mac app a page in no window while there's work
// (apps/mac BackgroundSync.swift: it comes and goes). It's the account's own
// app state (AppStateProvider opens its engine, outbox and uploader, so whatever was queued when the person
// switched away still goes up), plus a watch on its notifications. It renders nothing and reports to whoever
// runs it: the page that made the iframe (postMessage), or the Mac app (its notifications, the place's counts).
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { desktop } from "@/lib/desktop";
import { isShell, shell } from "@/lib/shell";
import { pinnedUserId } from "@/lib/places/pin";

/** What a runner tells the page that runs it. */
export interface PlaceSyncReport {
  source: "folevi-place-sync";
  userId: string;
  unread: number;
  waiting: number;
  /** Notifications that arrived while it ran (never what was already there). */
  fresh: { id: string; title: string; body: string | null; path: string }[];
  signedOut?: boolean;
}

export const PLACE_SYNC_SOURCE = "folevi-place-sync";

/**
 * What this account's runners have shown already, kept on this device (the Mac app only): there a runner runs while
 * there's work, then goes, and the next one shows what came in meanwhile, never anything twice. On the website the
 * runner runs while the tab is open and shows only what arrives meanwhile.
 */
export interface PlaceSyncSeen {
  since: number;
  told: string[];
}

const SEEN_KEY = (userId: string) => `folevi:place-sync:seen:${userId}`;
/** What's older than this when a runner starts was there before: the bell has it, no banner. */
const SEEN_MAX_AGE = 24 * 60 * 60 * 1000;

export function readSeen(userId: string | null, now = Date.now()): PlaceSyncSeen {
  if (!userId) return { since: now, told: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY(userId)) ?? "null") as Partial<PlaceSyncSeen> | null;
    const since = typeof raw?.since === "number" && Number.isFinite(raw.since) ? Math.min(now, Math.max(raw.since, now - SEEN_MAX_AGE)) : now;
    const told = Array.isArray(raw?.told) ? raw.told.filter((t): t is string => typeof t === "string").slice(-100) : [];
    return { since, told };
  } catch {
    return { since: now, told: [] };
  }
}

export function writeSeen(userId: string | null, seen: PlaceSyncSeen): void {
  if (!userId) return;
  try {
    localStorage.setItem(SEEN_KEY(userId), JSON.stringify({ since: seen.since, told: seen.told.slice(-100) }));
  } catch {
    // Storage full or off: the next runner starts from its own start.
  }
}

/** Reports to the page that runs this one (a hidden iframe on the website). */
export function reportToParent(report: Omit<PlaceSyncReport, "source">): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ source: PLACE_SYNC_SOURCE, ...report } satisfies PlaceSyncReport, location.origin);
}

export function PlaceSync() {
  const { engine, profile, workspaces } = useAppState();
  const unread = useQuery(api.notifications.unreadCount, {});
  const latest = useQuery(api.notifications.list, { limit: 10 });
  const [waiting, setWaiting] = useState(0);
  const userId = pinnedUserId();
  // The Mac app's runners come and go: each starts where the last one left off.
  const seen = useRef<PlaceSyncSeen | null>(null);
  seen.current ??= isShell() ? readSeen(userId) : { since: Date.now(), told: [] };
  const since = useRef(seen.current.since);
  const told = useRef(new Set<string>(seen.current.told));

  useEffect(() => {
    if (!engine) return;
    const read = () => setWaiting(engine.pendingCount());
    read();
    return engine.subscribe(read);
  }, [engine]);

  useEffect(() => {
    if (unread === undefined) return;
    const fresh: PlaceSyncReport["fresh"] = [];
    for (const n of [...(latest ?? [])].reverse()) {
      if (n.read || n.createdAt < since.current || told.current.has(n.id)) continue;
      told.current.add(n.id);
      fresh.push({ id: n.id, title: n.title, body: n.body ?? null, path: n.documentId ? `/d/${n.documentId}` : "/documents" });
    }
    if (isShell()) {
      writeSeen(userId, { since: Math.max(since.current, ...(latest ?? []).map((n) => n.createdAt)), told: [...told.current] });
      // The Mac app: the place's dot and the Dock badge, and Mac notifications that name the place.
      void shell()
        ?.places?.describe({ profileId: profile.id, name: profile.displayName, email: profile.email ?? "", avatarUrl: profile.avatarUrl ?? null, workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, logoUrl: w.logoUrl ?? null })), unread, waiting })
        .catch(() => undefined);
      const bridge = desktop();
      for (const n of fresh) bridge?.notify({ id: n.id, title: `${profile.displayName || profile.email} · ${n.title}`, body: n.body, path: n.path });
      return;
    }
    if (userId) reportToParent({ userId, unread, waiting, fresh });
  }, [unread, latest, waiting, userId, profile.id, profile.displayName, profile.email, profile.avatarUrl, workspaces]);

  return (
    <main aria-hidden className="sr-only">
      Keeping {profile.displayName || "this account"} in sync
    </main>
  );
}
