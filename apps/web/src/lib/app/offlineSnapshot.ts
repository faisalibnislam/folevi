"use client";

import { localDb } from "@/lib/sync/db";
import { isShell, shell } from "@/lib/shell";
import type { Profile, Workspace } from "./state";

/**
 * Last-known account snapshot for opening Folevi with no connection (an offline cold start). The profile
 * and workspace list live in that account's own IndexedDB database, which sign-out deletes; localStorage
 * only remembers which account database to open (an opaque id, no personal data).
 */
export interface AccountSnapshot {
  profile: Profile;
  workspaces: Workspace[];
  savedAt: number;
}

const LAST_ACCOUNT_KEY = "folevi:last-account";
const SNAPSHOT_KEY = "accountSnapshot";
/** Which of the app's places (the host's "acct:<id>") the last account snapshot is for. */
const LAST_PLACE_KEY = "folevi:last-account-place";

export async function saveAccountSnapshot(profile: Profile, workspaces: Workspace[]): Promise<void> {
  try {
    const db = await localDb(profile.id);
    await db.put("meta", { profile, workspaces, savedAt: Date.now() } satisfies AccountSnapshot, SNAPSHOT_KEY);
    localStorage.setItem(LAST_ACCOUNT_KEY, profile.id);
    const place = shell()?.places?.current;
    if (place) localStorage.setItem(LAST_PLACE_KEY, place);
    else localStorage.removeItem(LAST_PLACE_KEY);
  } catch {
    // Private browsing or storage full: offline cold start just isn't available.
  }
}

export async function loadAccountSnapshot(): Promise<AccountSnapshot | null> {
  try {
    const accountKey = localStorage.getItem(LAST_ACCOUNT_KEY);
    if (!accountKey) return null;
    const snapshot = (await (await localDb(accountKey)).get("meta", SNAPSHOT_KEY)) as AccountSnapshot | undefined;
    if (snapshot?.profile?.id !== accountKey || !Array.isArray(snapshot.workspaces)) return null;
    // Snapshots saved before pictures existed lack logoUrl; the UI expects null, not undefined. Snapshots
    // saved before Personal stopped being a workspace list it as one (kind "personal"). It's left out:
    // Personal is always there, and the list holds team workspaces only.
    const workspaces = (snapshot.workspaces as (Workspace & { kind?: string })[]).filter((w) => w.kind !== "personal");
    return {
      ...snapshot,
      profile: { ...snapshot.profile, avatarUrl: snapshot.profile.avatarUrl ?? null },
      workspaces: workspaces.map(({ kind: _kind, ...w }) => ({ ...w, logoUrl: w.logoUrl ?? null })),
    };
  } catch {
    return null;
  }
}

/**
 * The snapshot to open the apps with straight away while the server is asked (a warm start: docs/IOS_PERFORMANCE.md):
 * only in the Mac and iPhone/iPad apps' built-in interface, and only when it's the account the host opened this
 * page for (several accounts: another place's folio must never show, even for a moment). Null otherwise.
 */
export async function loadStartSnapshot(): Promise<AccountSnapshot | null> {
  if (!isShell()) return null;
  try {
    const current = shell()?.places?.current ?? null;
    if (current && localStorage.getItem(LAST_PLACE_KEY) !== current) return null;
  } catch {
    return null;
  }
  return loadAccountSnapshot();
}
