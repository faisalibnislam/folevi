"use client";
// Several accounts on the website (docs/MULTI_ACCOUNT_PLAN.md §2.1, §3, §9): what this browser is signed in to
// (/api/places, never a token), switching this tab to another account, signing in to one more, and signing
// out of one while the others stay. The sessions themselves are HTTP-only cookies the server keeps.
import { accountPlaceId, forgetAccount, knownAccount, knownAccounts, reconcileAccounts, rememberAccount, type PlaceId } from "./registry";
import { adoptNextSignIn, setTabPlace } from "./pin";

export interface JarEntry {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  active: boolean;
}

/** How many accounts one browser can keep signed in (convex/auth.ts MAX_BROWSER_ACCOUNTS). */
export const MAX_BROWSER_ACCOUNTS = 10;

/** The accounts this browser holds a live session for (the registry follows), or null when it can't tell (offline). */
export async function signedInAccounts(): Promise<JarEntry[] | null> {
  try {
    const res = await fetch("/api/places", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { accounts?: JarEntry[] };
    const accounts = Array.isArray(body.accounts) ? body.accounts : [];
    reconcileAccounts(accounts);
    return accounts;
  } catch {
    return null;
  }
}

/** Ends this browser's session for one account; the others stay. Returns the user ids still signed in (null: unknown). */
export async function signOutOfAccount(userId: string): Promise<string[] | null> {
  try {
    const res = await fetch("/api/places/sign-out", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { left?: unknown };
    return Array.isArray(body.left) ? body.left.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

const CONTEXT_PREFIX = "folevi:context:";

/** Where an account opens next (its Personal or one of its workspaces), for a switch that names one. */
export function setAccountContext(profileId: string, workspaceId: string | null): void {
  try {
    localStorage.setItem(`${CONTEXT_PREFIX}${profileId}`, workspaceId ? `workspace:${workspaceId}` : "personal");
  } catch {
    /* storage unavailable: it opens where it was */
  }
}

/** This tab opens `place` (reloading into it): the next load pins it, and it's the place a new tab opens. */
export function openPlaceInTab(place: PlaceId, o: { workspaceId?: string | null; path?: string } = {}): void {
  const account = place.startsWith("acct:") ? knownAccount(place.slice(5)) : null;
  if (account?.profileId && o.workspaceId !== undefined) setAccountContext(account.profileId, o.workspaceId);
  setTabPlace(place);
  if (account) rememberAccount({ userId: account.userId }, { open: true });
  window.location.assign(o.path ?? "/documents");
}

/**
 * "Sign in to another account": makes sure the session open now is kept in the jar (a session from before the
 * jar existed isn't), then opens the sign-in page; this tab opens whoever signs in.
 */
export async function addAccount(returnTo = "/documents"): Promise<void> {
  await signedInAccounts();
  adoptNextSignIn();
  window.location.assign(`/signin?add=1&returnTo=${encodeURIComponent(returnTo)}`);
}

/** After signing out of an account here: the registry keeps only what's left, and the tab opens the next one (or none). */
export function afterAccountSignedOut(userId: string, left: string[] | null): PlaceId | null {
  forgetAccount(userId);
  const next = knownAccounts().filter((a) => a.userId !== userId && (left === null || left.includes(a.userId)));
  if (left) for (const a of knownAccounts()) if (!left.includes(a.userId)) forgetAccount(a.userId);
  const first = next[0]?.userId ?? left?.find((id) => id !== userId) ?? null;
  const place = first ? accountPlaceId(first) : null;
  setTabPlace(place);
  return place;
}
