"use client";

import { localDb } from "@/lib/sync/db";
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

export async function saveAccountSnapshot(profile: Profile, workspaces: Workspace[]): Promise<void> {
  try {
    const db = await localDb(profile.id);
    await db.put("meta", { profile, workspaces, savedAt: Date.now() } satisfies AccountSnapshot, SNAPSHOT_KEY);
    localStorage.setItem(LAST_ACCOUNT_KEY, profile.id);
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

export function forgetLastAccount(): void {
  try {
    localStorage.removeItem(LAST_ACCOUNT_KEY);
  } catch {
    /* storage unavailable */
  }
}
