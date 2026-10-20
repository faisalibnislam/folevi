// The one-time IndexedDB handoff (docs/LOCAL_MODE_PLAN.md §7, risk R2). Folevi for Mac showed the website, so
// edits made offline wait in the https://app.folevi.com origin's IndexedDB (and localStorage journals) in the
// persist:folevi session. The bundled interface lives on app://folevi, a different origin with storage of its
// own: without a handoff, those edits would never be sent.
//
// On the bundled interface's first launch, main opens a hidden window on each origin (the old one served
// locally for that one page, see main.ts) and this module copies, through them, every account database that
// holds work not yet sent: the whole database (schema, sync state, outbox, waiting uploads, and the cached
// notes and account snapshot that let it open offline), plus that account's journals and the other
// "folevi…" localStorage entries the new origin doesn't have. The web app then finds them where it always
// looks (apps/web/src/lib/sync/db.ts `folevi-<account>`), and its sync engine and outbox send them through
// the normal path once the person is signed in to that account. Nothing on the old origin is changed or
// deleted, and nothing already on the new origin is overwritten.
//
// A website database newer than the bundled interface (the website shipped a schema change this app build
// doesn't have yet) can't be opened by it, so it isn't copied either: the handoff stops, records "update", and
// the app asks for an update instead of opening (risk R1, docs/LOCAL_MODE.md). The next launch tries again.
import { handoffKit, type Chunk, type DatabaseInventory, type Inventory, type PrepareResult } from "./handoffKit";

/** Runs one of the kit's functions on a page and answers its result (JSON text for most). */
export type KitCall = (fn: "inventory" | "readChunk" | "prepare" | "writeChunk" | "counts" | "writeStorage", ...args: unknown[]) => Promise<unknown>;

/**
 * The script that calls kit function `fn` with `args` on a page: the kit's own source, so it needs nothing
 * from the page (the handoff pages are blank).
 */
export function kitScript(fn: string, args: unknown[]): string {
  return `(${handoffKit.toString()})()[${JSON.stringify(fn)}]({ indexedDB, IDBKeyRange, localStorage }, ...${JSON.stringify(args)})`;
}

export interface HandoffReport {
  /** Databases copied, with their record counts. */
  copied: { name: string; records: number; pending: DatabaseInventory["pending"] }[];
  /** Databases with waiting work that the new origin already had (left alone on both sides). */
  skipped: string[];
  /** localStorage entries set on the new origin. */
  storage: number;
  /** Databases the old origin had with nothing waiting (not copied). */
  idle: string[];
  /**
   * Databases with waiting work at a schema version newer than the bundled interface opens: when there are
   * any, nothing is copied and the app asks for an update.
   */
  newer?: { name: string; version: number }[];
}

const ACCOUNT_DB = "folevi-";
const JOURNAL = "folevi:sync-journal:";

/** The account a journal key belongs to ("folevi:sync-journal:<account>[:<tab>]"), or null. */
export function journalAccount(key: string): string | null {
  if (!key.startsWith(JOURNAL)) return null;
  return key.slice(JOURNAL.length).split(":")[0] || null;
}

/** How many ops a journal entry holds (apps/web/src/lib/sync/engine.ts writeJournal). */
function journalOps(value: string): number {
  try {
    const parsed = JSON.parse(value) as { ops?: unknown[] };
    return Array.isArray(parsed.ops) ? parsed.ops.length : 0;
  } catch {
    return 0;
  }
}

const waiting = (d: DatabaseInventory) => d.pending.sync + d.pending.outbox + d.pending.uploads;

/** The accounts with work not yet sent: in their database, or in a journal written as a tab closed. */
export function pendingAccounts(inv: Inventory): Set<string> {
  const out = new Set<string>();
  for (const d of inv.databases) if (d.name.startsWith(ACCOUNT_DB) && waiting(d) > 0) out.add(d.name.slice(ACCOUNT_DB.length));
  for (const [k, v] of inv.storage) {
    const account = journalAccount(k);
    if (account && journalOps(v) > 0) out.add(account);
  }
  return out;
}

/**
 * The account databases the handoff would copy whose schema is newer than `dbVersion` (the bundled
 * interface's apps/web/src/lib/sync/db.ts DB_VERSION): the bundled app can't open those.
 */
export function newerDatabases(inv: Inventory, dbVersion: number | null | undefined): { name: string; version: number }[] {
  if (typeof dbVersion !== "number" || !Number.isFinite(dbVersion)) return [];
  const accounts = pendingAccounts(inv);
  return inv.databases.filter((d) => d.name.startsWith(ACCOUNT_DB) && accounts.has(d.name.slice(ACCOUNT_DB.length)) && d.version > dbVersion).map((d) => ({ name: d.name, version: d.version }));
}

/**
 * Copies what the old origin (`from`) holds that hasn't been sent to the new one (`to`). `dbVersion` is the
 * schema version the bundled interface opens: a newer database stops the handoff before anything is written.
 */
export async function handOver(from: KitCall, to: KitCall, o: { budget?: number; dbVersion?: number | null } = {}): Promise<HandoffReport> {
  const inv = JSON.parse((await from("inventory", ACCOUNT_DB)) as string) as Inventory;
  const accounts = pendingAccounts(inv);
  const report: HandoffReport = { copied: [], skipped: [], storage: 0, idle: [] };
  if (!accounts.size) {
    report.idle = inv.databases.map((d) => d.name);
    return report;
  }
  const newer = newerDatabases(inv, o.dbVersion);
  if (newer.length) return { ...report, newer };
  for (const db of inv.databases) {
    if (!accounts.has(db.name.slice(ACCOUNT_DB.length))) {
      report.idle.push(db.name);
      continue;
    }
    const prepared = (await to("prepare", JSON.stringify(db))) as PrepareResult;
    if (prepared === "exists") {
      report.skipped.push(db.name);
      continue;
    }
    let records = 0;
    for (const store of db.stores) {
      let after: unknown = null;
      do {
        const text = (await from("readChunk", db.name, store.name, after, o.budget ?? 4_000_000)) as string;
        const chunk = JSON.parse(text) as Chunk;
        if (chunk.records.length) records += (await to("writeChunk", db.name, store.name, text)) as number;
        after = chunk.next;
      } while (after !== null);
    }
    // Every record arrived, or the handoff isn't done (and runs again next launch).
    const counts = JSON.parse((await to("counts", db.name)) as string) as Record<string, number> | null;
    for (const store of db.stores) {
      if ((counts?.[store.name] ?? -1) !== store.count) throw new Error(`${db.name}/${store.name}: copied ${counts?.[store.name] ?? 0} of ${store.count}`);
    }
    report.copied.push({ name: db.name, records, pending: db.pending });
  }
  // Journals of the accounts handed over (their ops are merged when the engine opens), and the rest of the
  // app's own entries (which account opens offline, preferences). Other accounts' journals stay behind.
  const skipped = new Set(report.skipped.map((n) => n.slice(ACCOUNT_DB.length)));
  const entries = inv.storage.filter(([k]) => {
    const account = journalAccount(k);
    return account === null || (accounts.has(account) && !skipped.has(account));
  });
  if (report.copied.length || entries.some(([k]) => journalAccount(k) !== null)) report.storage = (await to("writeStorage", JSON.stringify(entries))) as number;
  return report;
}

// ---------------------------------------------------------------- the record of it (userData/handoff.json)

export interface HandoffState {
  /** "update": the website's database is newer than this app's interface; tried again every launch. */
  state: "done" | "retry" | "update";
  attempts: number;
  at: number;
  /** The app version that ran it, and the IndexedDB schema version its interface opens (shell/build.json). */
  appVersion?: string;
  dbVersion?: number | null;
  /** The origin the edits were taken from. */
  from?: string;
  report?: HandoffReport;
  error?: string;
}

/** After this many failed launches it stops trying (the old origin keeps everything, untouched). */
export const MAX_ATTEMPTS = 3;

export function parseHandoffState(raw: string | null): HandoffState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as HandoffState;
    return s && (s.state === "done" || s.state === "retry" || s.state === "update") && typeof s.attempts === "number" ? s : null;
  } catch {
    return null;
  }
}

/**
 * Whether this launch should try the handoff. One that waited for an update runs again every launch (nothing
 * was copied, so there's nothing to repeat): an updated app goes ahead.
 */
export function handoffDue(state: HandoffState | null): boolean {
  return !state || state.state === "update" || (state.state === "retry" && state.attempts < MAX_ATTEMPTS);
}

/**
 * Chromium's folder name for an origin's IndexedDB inside a session ("https_app.folevi.com_0"): when it's
 * missing, the old origin never stored anything and there's nothing to hand over.
 */
export function indexedDbFolder(origin: URL): string {
  const port = origin.port || "0";
  return `${origin.protocol.replace(/:$/, "")}_${origin.hostname}_${port}.indexeddb.leveldb`;
}
