// Several places in the Mac app (docs/MULTI_ACCOUNT_PLAN.md §2.2): the library on this Mac and any number of
// Folevi accounts, each with its own session (secrets.ts, `auth.session.<user id>`), encryption keys
// (userData/e2ee/accounts/<user id>) and data. This file keeps the list in userData/places.json: which place the
// windows show, the accounts (what each account's own page last said of itself, for the switcher) and Quick Add's
// last place. Nothing here is secret. Plain Node, so the unit tests load it without Electron.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const LIBRARY = "library";
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface PlaceWorkspace {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface AccountPlace {
  kind: "account";
  /** `acct:<user id>`. */
  id: string;
  userId: string;
  profileId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
  workspaces: PlaceWorkspace[];
  unread: number;
  reminders: number;
  waiting: number;
}

export interface PlacesState {
  v: 1;
  /** What the windows show: "library", "acct:<id>", or null (nothing chosen yet; or signing in to a first account). */
  current: string | null;
  /** The library is one of the places (set up here, and not forgotten). */
  library: boolean;
  libraryCounts: { unread: number; reminders: number; waiting: number };
  accounts: AccountPlace[];
  /** Quick Add's last place. */
  quickAdd: string | null;
}

export const accountId = (userId: string) => `acct:${userId}`;

export function userIdOf(place: string | null | undefined): string | null {
  if (!place?.startsWith("acct:")) return null;
  const id = place.slice(5);
  return USER_ID.test(id) ? id : null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(1_000_000, Math.floor(v)) : 0);
const url = (v: unknown) => (typeof v === "string" && /^(https:\/\/|app:\/\/folevi\/)/.test(v) && v.length <= 2000 ? v : null);

function cleanWorkspaces(v: unknown): PlaceWorkspace[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 50)
    .map((w) => (w && typeof w === "object" ? (w as Record<string, unknown>) : {}))
    .filter((w) => typeof w.id === "string" && USER_ID.test(w.id) && typeof w.name === "string")
    .map((w) => ({ id: w.id as string, name: str(w.name, 120), logoUrl: url(w.logoUrl) }));
}

function cleanAccount(raw: unknown): AccountPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const userId = typeof r.userId === "string" && USER_ID.test(r.userId) ? r.userId : null;
  if (!userId) return null;
  return {
    kind: "account",
    id: accountId(userId),
    userId,
    profileId: typeof r.profileId === "string" && USER_ID.test(r.profileId) ? r.profileId : null,
    name: str(r.name, 120),
    email: str(r.email, 254),
    avatarUrl: url(r.avatarUrl),
    workspaces: cleanWorkspaces(r.workspaces),
    unread: count(r.unread),
    reminders: count(r.reminders),
    waiting: count(r.waiting),
  };
}

export function emptyPlaces(): PlacesState {
  return { v: 1, current: null, library: false, libraryCounts: { unread: 0, reminders: 0, waiting: 0 }, accounts: [], quickAdd: null };
}

/** Keeps only what's valid: the file may hold anything. */
export function cleanPlaces(input: unknown): PlacesState {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const accounts: AccountPlace[] = [];
  for (const a of Array.isArray(raw.accounts) ? raw.accounts : []) {
    const c = cleanAccount(a);
    if (c && !accounts.some((x) => x.userId === c.userId)) accounts.push(c);
  }
  const library = raw.library === true;
  const valid = (p: unknown) => typeof p === "string" && ((p === LIBRARY && library) || accounts.some((a) => a.id === p));
  const counts = raw.libraryCounts && typeof raw.libraryCounts === "object" ? (raw.libraryCounts as Record<string, unknown>) : {};
  return {
    v: 1,
    current: valid(raw.current) ? (raw.current as string) : null,
    library,
    libraryCounts: { unread: 0, reminders: count(counts.reminders), waiting: count(counts.waiting) },
    accounts,
    quickAdd: valid(raw.quickAdd) ? (raw.quickAdd as string) : null,
  };
}

export class PlacesStore {
  state: PlacesState;
  private listeners = new Set<(s: PlacesState) => void>();

  constructor(
    private readonly file: string,
    initial?: PlacesState,
  ) {
    this.state = initial ?? PlacesStore.read(file);
  }

  static read(file: string): PlacesState {
    try {
      return cleanPlaces(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return emptyPlaces();
    }
  }

  /** Whether the file exists (a Mac that ran an older Folevi has none: its mode says where it was). */
  static exists(file: string): boolean {
    try {
      readFileSync(file);
      return true;
    } catch {
      return false;
    }
  }

  subscribe(cb: (s: PlacesState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private commit(next: PlacesState) {
    this.state = cleanPlaces(next);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      renameSync(tmp, this.file);
    } catch {
      /* Not saved: it still holds until Folevi quits. */
    }
    for (const l of [...this.listeners]) l(this.state);
  }

  account(id: string): AccountPlace | null {
    return this.state.accounts.find((a) => a.id === id) ?? null;
  }

  /** Whether `id` names a place here. */
  has(id: string | null | undefined): boolean {
    return !!id && ((id === LIBRARY && this.state.library) || this.state.accounts.some((a) => a.id === id));
  }

  /** "local" for the library, "account" for an account (or a first sign-in), "unset" before anything was chosen. */
  modeOf(place: string | null): "local" | "account" | "unset" {
    if (place === LIBRARY) return "local";
    if (userIdOf(place)) return "account";
    return this.pendingAccount ? "account" : "unset";
  }

  /** The windows are in account mode with no account yet (the sign-in screen). Not kept on disk. */
  pendingAccount = false;

  setCurrent(place: string | null) {
    if (place !== null && !this.has(place)) return;
    this.pendingAccount = false;
    this.commit({ ...this.state, current: place });
  }

  /** Adds (or updates) an account from what the server said of it after signing in. */
  addAccount(a: { userId: string; name: string; email: string; avatarUrl: string | null }): AccountPlace | null {
    const existing = this.state.accounts.find((x) => x.userId === a.userId);
    const next = cleanAccount({ ...(existing ?? {}), ...a });
    if (!next) return null;
    const accounts = existing ? this.state.accounts.map((x) => (x.userId === a.userId ? { ...x, ...next, workspaces: x.workspaces } : x)) : [...this.state.accounts, next];
    this.commit({ ...this.state, accounts });
    return this.account(next.id);
  }

  /** What an account's own page says of itself (the page is bound to that account by main). */
  describe(id: string, d: unknown) {
    const a = this.account(id);
    if (!a || !d || typeof d !== "object") return;
    const r = d as Record<string, unknown>;
    const merged = cleanAccount({
      ...a,
      ...(typeof r.profileId === "string" ? { profileId: r.profileId } : {}),
      ...(typeof r.name === "string" && r.name ? { name: r.name } : {}),
      ...(typeof r.email === "string" && r.email ? { email: r.email } : {}),
      ...("avatarUrl" in r ? { avatarUrl: r.avatarUrl } : {}),
      ...(Array.isArray(r.workspaces) ? { workspaces: r.workspaces } : {}),
      ...(r.unread !== undefined ? { unread: r.unread } : {}),
      ...(r.reminders !== undefined ? { reminders: r.reminders } : {}),
      ...(r.waiting !== undefined ? { waiting: r.waiting } : {}),
    });
    if (!merged || JSON.stringify(merged) === JSON.stringify(a)) return;
    this.commit({ ...this.state, accounts: this.state.accounts.map((x) => (x.id === id ? merged : x)) });
  }

  describeLibrary(d: unknown) {
    if (!d || typeof d !== "object") return;
    const r = d as Record<string, unknown>;
    const next = { unread: 0, reminders: r.reminders !== undefined ? count(r.reminders) : this.state.libraryCounts.reminders, waiting: r.waiting !== undefined ? count(r.waiting) : this.state.libraryCounts.waiting };
    if (JSON.stringify(next) === JSON.stringify(this.state.libraryCounts)) return;
    this.commit({ ...this.state, libraryCounts: next });
  }

  /** The library is a place (set up, or the windows chose it). */
  setLibrary(on: boolean) {
    if (this.state.library === on) return;
    const current = !on && this.state.current === LIBRARY ? null : this.state.current;
    const quickAdd = !on && this.state.quickAdd === LIBRARY ? null : this.state.quickAdd;
    this.commit({ ...this.state, library: on, current, quickAdd });
  }

  /** Removes an account; when it was open, the windows go to the next place (or none). Returns that place. */
  removeAccount(id: string): string | null {
    const accounts = this.state.accounts.filter((a) => a.id !== id);
    const next = this.state.current === id ? (accounts[0]?.id ?? (this.state.library ? LIBRARY : null)) : this.state.current;
    const quickAdd = this.state.quickAdd === id ? null : this.state.quickAdd;
    this.commit({ ...this.state, accounts, current: next, quickAdd });
    return next;
  }

  setQuickAdd(id: string) {
    if (!this.has(id)) return;
    this.commit({ ...this.state, quickAdd: id });
  }

  /** Every place, for the page: the library (when it's one) and each account. */
  list(o: { libraryKind: string | null; displayPath: string; configured: boolean }) {
    return [
      ...(this.state.library ? [{ kind: "library" as const, id: LIBRARY, configured: o.configured, syncs: o.libraryKind, displayPath: o.displayPath, ...this.state.libraryCounts }] : []),
      ...this.state.accounts,
    ];
  }

  /** The Dock badge: every place's unread count. */
  unreadTotal(): number {
    return this.state.accounts.reduce((n, a) => n + a.unread, 0);
  }
}
