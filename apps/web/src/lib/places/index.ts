"use client";
// Several places at once (docs/MULTI_ACCOUNT_PLAN.md): the library on this device and any number of Folevi
// accounts, for the switcher and everything that names a place. One shape over two sources: on the website the
// accounts this browser is signed in to (registry.ts, web.ts); in the apps the host's list (shell().places).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isShell, shell } from "@/lib/shell";
import type { LibraryKind, ShellPlace } from "@/lib/shell/types";
import type { SyncEngine } from "@/lib/sync/engine";
import type { Outbox } from "@/lib/sync/outbox";
import { pinnedUserId } from "./pin";
import { currentBackendMode } from "@/lib/backendMode";
import { accountPlaceId, knownAccounts, LIBRARY_PLACE, placesSnapshot, subscribePlaces, type AccountPlace, type LibraryPlace, type Place, type PlaceId } from "./registry";
import { addAccount, openPlaceInTab, signedInAccounts } from "./web";

export * from "./registry";

/** Where a library syncs, for people to read. */
export function syncsWords(kind: LibraryKind | null): string {
  switch (kind) {
    case "icloud":
      return "Syncs with iCloud Drive";
    case "dropbox":
      return "Syncs with Dropbox";
    case "gdrive":
      return "Syncs with Google Drive";
    case "folder":
      return "Syncs through a folder";
    case "device":
      return "Kept on this device only";
    default:
      return "Not set up yet";
  }
}

function fromShell(p: ShellPlace): Place {
  if (p.kind === "library") return { kind: "library", id: LIBRARY_PLACE, syncs: syncsWords(p.syncs), unread: p.unread, reminders: p.reminders, waiting: p.waiting, lastOpenedAt: 0 };
  return {
    kind: "account",
    id: p.id,
    userId: p.userId,
    profileId: p.profileId,
    name: p.name,
    email: p.email,
    avatarUrl: p.avatarUrl,
    workspaces: p.workspaces,
    unread: p.unread,
    reminders: p.reminders,
    waiting: p.waiting,
    lastOpenedAt: 0,
  };
}

/** The place this page shows: its account (website), or what the host says (apps). */
export function currentPlaceId(): PlaceId | null {
  if (isShell()) return shell()?.places?.current ?? null;
  const user = pinnedUserId();
  return user ? accountPlaceId(user) : null;
}

/** Whether this page can show more than one place (the website, or an app whose host keeps several). */
export function placesAvailable(): boolean {
  if (shell()?.places) return true;
  // A library page with no host to keep places (and local mode never reaches Folevi): just the one.
  return !isShell() && currentBackendMode() !== "local";
}

let refreshed = false;

/** Every place this device knows, the open one included, and which is open. */
export function usePlaces(): { places: Place[]; current: PlaceId | null } {
  const host = isShell() ? (shell()?.places ?? null) : null;
  // Website: the registry, refreshed from the server once per page (signed out elsewhere, a new sign-in).
  const raw = useSyncExternalStore(subscribePlaces, placesSnapshot, () => null);
  useEffect(() => {
    if (!placesAvailable() || isShell() || refreshed) return;
    refreshed = true;
    void signedInAccounts();
  }, []);
  const [hosted, setHosted] = useState<Place[] | null>(null);
  useEffect(() => {
    if (!host) return;
    let live = true;
    void host.list().then(
      (list) => live && setHosted(list.map(fromShell)),
      () => undefined,
    );
    const off = host.onChange((list) => live && setHosted(list.map(fromShell)));
    return () => {
      live = false;
      off();
    };
  }, [host]);
  const places = useMemo<Place[]>(() => {
    if (host) return hosted ?? [];
    void raw;
    return knownAccounts();
  }, [host, hosted, raw]);
  return { places, current: currentPlaceId() };
}

/**
 * Before leaving a place: what's queued is written to this device and given a moment to reach Folevi (it's never
 * lost either way: it goes the next time the place opens, or from its background runner).
 */
export async function flushBeforeSwitch(o: { engine?: SyncEngine | null; outbox?: Outbox | null; library?: { flush(): Promise<void> } | null }, ms = 2000): Promise<void> {
  const work = Promise.all([
    o.engine ? o.engine.persisted().then(() => o.engine!.flush()) : null,
    o.outbox ? o.outbox.persisted().then(() => o.outbox!.flush()) : null,
    o.library ? o.library.flush() : null,
  ]).catch(() => undefined);
  await Promise.race([work, new Promise((r) => setTimeout(r, ms))]);
}

/** Opens another place: an account (Personal, or one of its workspaces), or the library. */
export async function switchToPlace(place: Place, o: { workspaceId?: string | null; flush?: () => Promise<void> } = {}): Promise<void> {
  await o.flush?.();
  const host = isShell() ? shell()?.places : null;
  if (host) {
    if (place.kind === "account" && place.profileId && o.workspaceId !== undefined) {
      try {
        localStorage.setItem(`folevi:context:${place.profileId}`, o.workspaceId ? `workspace:${o.workspaceId}` : "personal");
      } catch {
        /* storage unavailable */
      }
    }
    await host.switchTo(place.id, { path: "/documents" });
    return;
  }
  openPlaceInTab(place.id, { workspaceId: o.workspaceId });
}

/** "Sign in to another account". */
export async function signInToAnotherAccount(): Promise<void> {
  const host = isShell() ? shell()?.places : null;
  if (host) {
    const id = await host.signIn();
    if (id) await host.switchTo(id, { path: "/documents" });
    return;
  }
  await addAccount();
}

export type { AccountPlace, LibraryPlace, Place, PlaceId };
