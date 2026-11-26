"use client";
// The open account tells the rest of the device who it is (docs/MULTI_ACCOUNT_PLAN.md §2.1): its name, email,
// picture and workspaces for the switcher, its unread count and what's waiting to sync for the dots. On the
// website that's the registry in localStorage; in the apps the host keeps it (shell().places.describe). It also
// holds the Web Lock that tells another tab's background runner this account is open here (§5.1).
import { useQuery } from "@/lib/convex/queries";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/convex/api";
import { authClient } from "@/lib/auth/client";
import { useAppState } from "@/lib/app/state";
import { isShell, shell } from "@/lib/shell";
import { adoptSession, isPlaceRunner, pinnedUserId } from "@/lib/places/pin";
import { rememberAccount } from "@/lib/places/registry";
import { holdPlaceOpen } from "@/lib/places/locks";

/** How long the count of waiting edits must hold before the app hears of it. */
const WAITING_SETTLE_MS = 2000;

export function PlacesReporter() {
  const { profile, workspaces, engine } = useAppState();
  const { data: session } = authClient.useSession();
  const userId = isShell() ? null : (session?.user?.id ?? pinnedUserId());
  const unread = useQuery(api.notifications.unreadCount, {});
  const [waiting, setWaiting] = useState(0);
  const opened = useRef(false);

  // How many edits wait to sync, once the number has held for a moment. Every save takes it from 0 to 1 and back
  // within a second; reported as it happened, each of those made the app write its places file, mirror it to the
  // Keychain and tell every window, on its main thread, twice per save while typing (docs/perf/feel-results.md).
  // Edits that really are waiting (offline, a refused change) still show after two seconds.
  useEffect(() => {
    if (!engine) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setWaiting(engine.pendingCount()), WAITING_SETTLE_MS);
    };
    setWaiting(engine.pendingCount());
    const off = engine.subscribe(read);
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [engine]);

  useEffect(() => {
    if (userId) adoptSession(userId);
  }, [userId]);

  // Web: the registry. The runner of a background account (/place-sync) updates its entry without opening it.
  useEffect(() => {
    if (isShell() || !userId) return;
    const open = !opened.current && !isPlaceRunner();
    opened.current = true;
    rememberAccount(
      {
        userId,
        profileId: profile.id,
        name: profile.displayName,
        email: profile.email ?? "",
        avatarUrl: profile.avatarUrl ?? null,
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, logoUrl: w.logoUrl ?? null })),
        ...(unread !== undefined ? { unread } : {}),
        waiting,
      },
      { open },
    );
  }, [userId, profile.id, profile.displayName, profile.email, profile.avatarUrl, workspaces, unread, waiting]);

  // The apps: the host keeps the places (older hosts have no `places`).
  useEffect(() => {
    const places = shell()?.places;
    if (!isShell() || !places) return;
    void places
      .describe({
        profileId: profile.id,
        name: profile.displayName,
        email: profile.email ?? "",
        avatarUrl: profile.avatarUrl ?? null,
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, logoUrl: w.logoUrl ?? null })),
        ...(unread !== undefined ? { unread } : {}),
        waiting,
      })
      .catch(() => undefined);
  }, [profile.id, profile.displayName, profile.email, profile.avatarUrl, workspaces, unread, waiting]);

  // While this tab shows the account, no other tab runs it in the background.
  useEffect(() => {
    if (isShell() || !userId || isPlaceRunner()) return;
    return holdPlaceOpen(userId);
  }, [userId]);
  return null;
}
