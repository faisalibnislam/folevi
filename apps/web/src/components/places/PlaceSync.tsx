"use client";
// The background runner of a place no window shows (docs/MULTI_ACCOUNT_PLAN.md §5): /place-sync?place=acct:<id>,
// in a hidden iframe on the website (PlaceRunners.tsx) or a hidden window in the Mac app. It's the account's own
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
  const since = useRef(Date.now());
  const told = useRef(new Set<string>());
  const userId = pinnedUserId();

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
