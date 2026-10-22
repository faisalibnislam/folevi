// The places this device knows (docs/MULTI_ACCOUNT_PLAN.md §2.1, Words): on the website, the accounts this
// browser is signed in to, as each account's own page last described itself (name, email, picture, its
// workspaces, unread count). Kept in localStorage under `folevi:places`: nothing secret (no tokens; the
// sessions are HTTP-only cookies), and signing out of an account removes its entry. The apps keep theirs in
// the host (lib/shell/types.ts ShellPlaces) and this file only describes the shapes.

/** `library`, or `acct:<Better Auth user id>`. */
export type PlaceId = string;

export const LIBRARY_PLACE: PlaceId = "library";

export function accountPlaceId(userId: string): PlaceId {
  return `acct:${userId}`;
}

/** The user id in an account's place id, or null (the library, or not a place id). */
export function userIdOf(place: PlaceId | null | undefined): string | null {
  if (!place?.startsWith("acct:")) return null;
  const id = place.slice(5);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export interface PlaceWorkspace {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface AccountPlace {
  kind: "account";
  id: PlaceId;
  userId: string;
  /** Folevi's profile id (names the account's data on this device); null until its page has opened here. */
  profileId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
  workspaces: PlaceWorkspace[];
  /** Unread notifications, as last seen. */
  unread: number;
  /** Reminders due and not yet seen. */
  reminders: number;
  /** Changes on this device still waiting to reach Folevi. */
  waiting: number;
  lastOpenedAt: number;
}

export interface LibraryPlace {
  kind: "library";
  id: PlaceId;
  /** Where it syncs, for people to read: "iCloud Drive", "Dropbox", "Google Drive", a folder, "This Mac only". */
  syncs: string;
  unread: number;
  reminders: number;
  waiting: number;
  lastOpenedAt: number;
}

export type Place = AccountPlace | LibraryPlace;

const KEY = "folevi:places";

interface Stored {
  v: 1;
  accounts: AccountPlace[];
  /** The place this browser opened last (a new tab opens it). */
  last: PlaceId | null;
}

const empty = (): Stored => ({ v: 1, accounts: [], last: null });
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: Stored } | null = null;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function cleanAccount(raw: unknown): AccountPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const userId = typeof r.userId === "string" ? r.userId : userIdOf(str(r.id, 80));
  if (!userId || !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  const workspaces = Array.isArray(r.workspaces)
    ? (r.workspaces as unknown[])
        .map((w) => (w && typeof w === "object" ? (w as Record<string, unknown>) : null))
        .filter((w): w is Record<string, unknown> => Boolean(w && typeof w.id === "string" && typeof w.name === "string"))
        .slice(0, 50)
        .map((w) => ({ id: str(w.id, 64), name: str(w.name, 120), logoUrl: typeof w.logoUrl === "string" ? w.logoUrl.slice(0, 2000) : null }))
    : [];
  return {
    kind: "account",
    id: accountPlaceId(userId),
    userId,
    profileId: typeof r.profileId === "string" && r.profileId ? r.profileId.slice(0, 64) : null,
    name: str(r.name, 120),
    email: str(r.email, 254),
    avatarUrl: typeof r.avatarUrl === "string" && r.avatarUrl ? r.avatarUrl.slice(0, 2000) : null,
    workspaces,
    unread: num(r.unread),
    reminders: num(r.reminders),
    waiting: num(r.waiting),
    lastOpenedAt: num(r.lastOpenedAt),
  };
}

export function parseStored(raw: string | null): Stored {
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as { accounts?: unknown; last?: unknown };
    const accounts: AccountPlace[] = [];
    for (const a of Array.isArray(parsed.accounts) ? parsed.accounts : []) {
      const clean = cleanAccount(a);
      if (clean && !accounts.some((x) => x.userId === clean.userId)) accounts.push(clean);
    }
    const last = typeof parsed.last === "string" && (parsed.last === LIBRARY_PLACE || userIdOf(parsed.last)) ? parsed.last : null;
    return { v: 1, accounts, last };
  } catch {
    return empty();
  }
}

function read(): Stored {
  let raw: string | null;
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (cached && cached.raw === raw) return cached.value;
  const value = parseStored(raw);
  cached = { raw, value };
  return value;
}

function write(next: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Without storage the switcher only knows the open account; nothing else breaks.
  }
  cached = null;
  for (const l of [...listeners]) l();
}

/** The accounts this browser knows, most recently opened first. */
export function knownAccounts(): AccountPlace[] {
  return [...read().accounts].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function knownAccount(userId: string): AccountPlace | null {
  return read().accounts.find((a) => a.userId === userId) ?? null;
}

export function lastPlace(): PlaceId | null {
  return read().last;
}

/** Updates (or adds) an account's entry with what its own page knows; `open` also makes it the last place. */
export function rememberAccount(patch: Partial<Omit<AccountPlace, "kind" | "id">> & { userId: string }, opts: { open?: boolean } = {}): void {
  const s = read();
  const now = Date.now();
  const existing = s.accounts.find((a) => a.userId === patch.userId);
  const merged = cleanAccount({ ...(existing ?? { unread: 0, reminders: 0, waiting: 0, workspaces: [], lastOpenedAt: 0, profileId: null, name: "", email: "", avatarUrl: null }), ...patch, ...(opts.open ? { lastOpenedAt: now } : {}) });
  if (!merged) return;
  const accounts = existing ? s.accounts.map((a) => (a.userId === patch.userId ? merged : a)) : [...s.accounts, merged];
  const next: Stored = { v: 1, accounts, last: opts.open ? merged.id : s.last };
  if (JSON.stringify(next) === JSON.stringify(s)) return;
  write(next);
}

/** Forgets an account (signed out of it here). */
export function forgetAccount(userId: string): void {
  const s = read();
  const accounts = s.accounts.filter((a) => a.userId !== userId);
  const last = s.last === accountPlaceId(userId) ? (accounts.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.id ?? null) : s.last;
  write({ v: 1, accounts, last });
}

/**
 * Keeps only the accounts the server says this browser is still signed in to (signed out in another browser
 * tab, ended in Settings > Devices elsewhere), adding any it didn't know with what the server says of them.
 */
export function reconcileAccounts(live: { userId: string; name: string; email: string; image: string | null }[]): void {
  const s = read();
  const ids = new Set(live.map((a) => a.userId));
  const accounts = s.accounts.filter((a) => ids.has(a.userId));
  for (const l of live) {
    const known = accounts.find((a) => a.userId === l.userId);
    const patch = { name: l.name || known?.name || "", email: l.email || known?.email || "", avatarUrl: known?.avatarUrl ?? l.image };
    if (known) Object.assign(known, patch);
    else {
      const fresh = cleanAccount({ userId: l.userId, ...patch, workspaces: [], unread: 0, reminders: 0, waiting: 0, lastOpenedAt: 0, profileId: null });
      if (fresh) accounts.push(fresh);
    }
  }
  const last = s.last && (s.last === LIBRARY_PLACE || ids.has(userIdOf(s.last) ?? "")) ? s.last : null;
  const next: Stored = { v: 1, accounts, last };
  if (JSON.stringify(next) !== JSON.stringify(s)) write(next);
}

export function subscribePlaces(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = null;
      cb();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** A stable snapshot for useSyncExternalStore. */
export function placesSnapshot(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
