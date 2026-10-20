// The one-time IndexedDB handoff (handoff.ts, handoffKit.ts) against a fixture of the website's storage on the
// old origin: two separate fake-indexeddb factories stand in for https://app.folevi.com and app://folevi, and
// the kit runs from its source text, as main injects it into the hidden pages.
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { handOver, handoffDue, indexedDbFolder, journalAccount, kitScript, MAX_ATTEMPTS, newerDatabases, parseHandoffState, pendingAccounts, type KitCall } from "./handoff";
import { handoffKit } from "./handoffKit";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

interface Origin {
  indexedDB: IDBFactory;
  localStorage: MemoryStorage;
  call: KitCall;
}

function origin(): Origin {
  const o = { indexedDB: new IDBFactory(), localStorage: new MemoryStorage() } as Origin;
  // As main does: the kit's source text, evaluated in the page with the page's storage in scope.
  o.call = (fn, ...args) => new Function("indexedDB", "IDBKeyRange", "localStorage", `return ${kitScript(fn, args)}`)(o.indexedDB, IDBKeyRange, o.localStorage);
  return o;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

/** The website's per-account database as apps/web/src/lib/sync/db.ts makes it (DB_VERSION 3). */
async function websiteDb(f: IDBFactory, name: string, fill: (tx: IDBTransaction) => void): Promise<void> {
  const open = f.open(name, 3);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore("meta");
    db.createObjectStore("syncState");
    db.createObjectStore("blocks", { keyPath: "documentId" });
    db.createObjectStore("uploads", { keyPath: "uploadId" });
    db.createObjectStore("documents", { keyPath: "id" }).createIndex("by_scope", "scopeKey");
  };
  const db = await req(open);
  const tx = db.transaction(["meta", "syncState", "blocks", "uploads", "documents"], "readwrite");
  fill(tx);
  await new Promise<void>((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error))));
  db.close();
}

const OP = { kind: "block.update", opId: "op-1", block: { id: "b1", type: "paragraph", text: "written offline" }, sent: false };
const PROFILE = { id: "acct1", name: "Desk Person", avatarUrl: null };

/** The fixture: one account with work waiting (every kind), one with none, and the localStorage around them. */
async function seedOldOrigin(o: Origin) {
  await websiteDb(o.indexedDB, "folevi-acct1", (tx) => {
    const meta = tx.objectStore("meta");
    meta.put({ profile: PROFILE, workspaces: [], savedAt: 1 }, "accountSnapshot");
    meta.put("web-01DEVICE", "deviceId");
    meta.put({ id: "01OUTBOX", name: "organization.createFolder", args: { name: "Trips" }, keys: ["folder:f1"], label: "New folder “Trips”", createdAt: 5, attempts: 0 }, "outbox:01OUTBOX");
    meta.put({ id: "b1", version: 3, at: new Date(1_700_000_000_000) }, "syncBlock:b1");
    meta.put({ rows: [1, 2, 3], when: new Map([["a", 1]]) }, "query:documents.list:{}");
    tx.objectStore("syncState").put({ blocks: {}, pending: [OP], inflight: [], conflicts: [], errors: [], uploads: [] }, "account");
    tx.objectStore("uploads").put({
      uploadId: "u1",
      documentId: "d1",
      blockId: "b2",
      kind: "image",
      filename: "photo.png",
      mimeType: "image/png",
      size: 4,
      blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      attempts: 0,
      nextAttemptAt: 0,
    });
    tx.objectStore("documents").put({ id: "d1", scopeKey: "personal", title: "Trip", icon: null, kind: "page", updatedAt: 2, excerpt: "", parentDocumentId: null, cachedAt: 3, summary: null });
    tx.objectStore("blocks").put({ documentId: "d1", blocks: [{ id: "b1", text: "x".repeat(5000) }], cachedAt: 3 });
    // An object that happens to have a "$t" key, and a typed array: they survive the trip as they were.
    meta.put({ $t: "not a tag", bytes: new Uint8Array([1, 2, 3]), nested: [undefined, null, NaN] }, "odd");
  });
  await websiteDb(o.indexedDB, "folevi-idle", (tx) => tx.objectStore("meta").put("web-02", "deviceId"));
  o.localStorage.setItem("folevi:last-account", "acct1");
  o.localStorage.setItem("folevi:sync-journal:acct1:tab9", JSON.stringify({ ops: [OP], uploads: [], closed: true, at: 9 }));
  o.localStorage.setItem("folevi:sync-journal:idle:tab1", JSON.stringify({ ops: [], uploads: [], closed: true, at: 9 }));
  o.localStorage.setItem("folevi:theme", "dark");
  o.localStorage.setItem("someone-else", "x");
}

async function readAll(f: IDBFactory, name: string, store: string) {
  const db = await req(f.open(name));
  const tx = db.transaction(store);
  const keys = await req(tx.objectStore(store).getAllKeys());
  const values = await req(tx.objectStore(store).getAll());
  db.close();
  return { keys, values, db };
}

describe("the one-time handoff", () => {
  test("copies the account with unsent work, whole, and leaves idle accounts and the old origin as they were", async () => {
    const from = origin();
    const to = origin();
    await seedOldOrigin(from);

    // Small chunks, so a store takes several round trips.
    const report = await handOver(from.call, to.call, { budget: 200 });
    expect(report.copied).toEqual([{ name: "folevi-acct1", records: 10, pending: { sync: 1, outbox: 1, uploads: 1 } }]);
    expect(report.idle).toEqual(["folevi-idle"]);
    expect(report.skipped).toEqual([]);

    // Same name, version, stores and index: the web app's localDb() opens it without an upgrade.
    const names = (await to.indexedDB.databases()).map((d) => [d.name, d.version]);
    expect(names).toEqual([["folevi-acct1", 3]]);
    const sync = await readAll(to.indexedDB, "folevi-acct1", "syncState");
    expect(sync.keys).toEqual(["account"]);
    expect((sync.values[0] as { pending: unknown[] }).pending).toEqual([OP]);
    const db = await req(to.indexedDB.open("folevi-acct1"));
    expect([...db.objectStoreNames].sort()).toEqual(["blocks", "documents", "meta", "syncState", "uploads"]);
    const docs = db.transaction("documents").objectStore("documents");
    expect(docs.keyPath).toBe("id");
    expect(docs.index("by_scope").keyPath).toBe("scopeKey");
    expect(await req(docs.index("by_scope").getAll("personal"))).toHaveLength(1);
    db.close();

    const meta = await readAll(to.indexedDB, "folevi-acct1", "meta");
    const byKey = Object.fromEntries(meta.keys.map((k, i) => [String(k), meta.values[i]]));
    expect(Object.keys(byKey).sort()).toEqual(["accountSnapshot", "deviceId", "odd", "outbox:01OUTBOX", "query:documents.list:{}", "syncBlock:b1"]);
    expect(byKey.deviceId).toBe("web-01DEVICE");
    expect((byKey["syncBlock:b1"] as { at: Date }).at).toEqual(new Date(1_700_000_000_000));
    expect((byKey["query:documents.list:{}"] as { when: Map<string, number> }).when).toEqual(new Map([["a", 1]]));
    const odd = byKey.odd as { $t: string; bytes: Uint8Array; nested: unknown[] };
    expect(odd.$t).toBe("not a tag");
    expect(odd.bytes).toBeInstanceOf(Uint8Array);
    expect([...odd.bytes]).toEqual([1, 2, 3]);
    expect(odd.nested).toEqual([undefined, null, NaN]);

    // The waiting upload keeps its bytes, as a Blob of the same type.
    const uploads = await readAll(to.indexedDB, "folevi-acct1", "uploads");
    const blob = (uploads.values[0] as { blob: Blob }).blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71]);

    // localStorage: the account to open offline, its journal and the app's preferences; not the idle
    // account's journal, nor anything that isn't Folevi's.
    expect(report.storage).toBe(3);
    expect(to.localStorage.getItem("folevi:last-account")).toBe("acct1");
    expect(JSON.parse(to.localStorage.getItem("folevi:sync-journal:acct1:tab9")!).ops).toEqual([OP]);
    expect(to.localStorage.getItem("folevi:theme")).toBe("dark");
    expect(to.localStorage.getItem("folevi:sync-journal:idle:tab1")).toBeNull();
    expect(to.localStorage.getItem("someone-else")).toBeNull();

    // The old origin is untouched (the website's own build still has everything, should it come back).
    expect((await from.indexedDB.databases()).map((d) => d.name).sort()).toEqual(["folevi-acct1", "folevi-idle"]);
    expect((await readAll(from.indexedDB, "folevi-acct1", "syncState")).values).toHaveLength(1);
    expect(from.localStorage.length).toBe(5);
  });

  test("never overwrites what the new origin already holds", async () => {
    const from = origin();
    const to = origin();
    await seedOldOrigin(from);
    await websiteDb(to.indexedDB, "folevi-acct1", (tx) => tx.objectStore("meta").put("web-NEW", "deviceId"));
    to.localStorage.setItem("folevi:theme", "light");
    const report = await handOver(from.call, to.call);
    expect(report.copied).toEqual([]);
    expect(report.skipped).toEqual(["folevi-acct1"]);
    expect((await readAll(to.indexedDB, "folevi-acct1", "meta")).values).toEqual(["web-NEW"]);
    expect(to.localStorage.getItem("folevi:theme")).toBe("light");
    expect(to.localStorage.getItem("folevi:sync-journal:acct1:tab9")).toBeNull();
  });

  test("an empty database of the same shape on the new origin is filled", async () => {
    const from = origin();
    const to = origin();
    await seedOldOrigin(from);
    await websiteDb(to.indexedDB, "folevi-acct1", () => undefined);
    expect((await handOver(from.call, to.call)).copied.map((c) => c.name)).toEqual(["folevi-acct1"]);
  });

  test("nothing waiting: nothing is copied", async () => {
    const from = origin();
    const to = origin();
    await websiteDb(from.indexedDB, "folevi-acct1", (tx) => tx.objectStore("meta").put({ profile: PROFILE, workspaces: [], savedAt: 1 }, "accountSnapshot"));
    from.localStorage.setItem("folevi:last-account", "acct1");
    const report = await handOver(from.call, to.call);
    expect(report).toEqual({ copied: [], skipped: [], storage: 0, idle: ["folevi-acct1"] });
    expect(await to.indexedDB.databases()).toEqual([]);
    expect(to.localStorage.length).toBe(0);
  });

  test("a journal alone (a tab closed before its save finished) is work waiting", async () => {
    const from = origin();
    const to = origin();
    await websiteDb(from.indexedDB, "folevi-acct1", () => undefined);
    from.localStorage.setItem("folevi:sync-journal:acct1:tab1", JSON.stringify({ ops: [OP], closed: true }));
    const report = await handOver(from.call, to.call);
    expect(report.copied.map((c) => c.name)).toEqual(["folevi-acct1"]);
    expect(to.localStorage.getItem("folevi:sync-journal:acct1:tab1")).not.toBeNull();
  });

  test("a website database newer than the bundled interface opens: nothing is copied, and it's tried again", async () => {
    const from = origin();
    const to = origin();
    await seedOldOrigin(from);
    // The bundled interface opens version 2 (an app built before the website's v3 change).
    const report = await handOver(from.call, to.call, { dbVersion: 2 });
    expect(report.newer).toEqual([{ name: "folevi-acct1", version: 3 }]);
    expect(report.copied).toEqual([]);
    expect(await to.indexedDB.databases()).toEqual([]);
    expect(to.localStorage.length).toBe(0);
    // The same or a newer interface goes ahead; an idle newer database doesn't matter (it isn't copied).
    expect((await handOver(from.call, origin().call, { dbVersion: 3 })).copied.map((c) => c.name)).toEqual(["folevi-acct1"]);
    const inv = { databases: [{ name: "folevi-idle", version: 9, stores: [], pending: { sync: 0, outbox: 0, uploads: 0 } }], storage: [] as [string, string][] };
    expect(newerDatabases(inv, 3)).toEqual([]);
    expect(newerDatabases({ ...inv, databases: [{ ...inv.databases[0]!, pending: { sync: 1, outbox: 0, uploads: 0 } }] }, 3)).toEqual([{ name: "folevi-idle", version: 9 }]);
    expect(newerDatabases(inv, null)).toEqual([]);
    // Waiting for an update: every launch tries again, however many there were.
    expect(handoffDue({ state: "update", attempts: 0, at: 0 })).toBe(true);
    expect(handoffDue({ state: "update", attempts: MAX_ATTEMPTS + 5, at: 0 })).toBe(true);
    expect(parseHandoffState(JSON.stringify({ state: "update", attempts: 0, at: 2, appVersion: "1.16.0", dbVersion: 2 }))).toMatchObject({ state: "update", appVersion: "1.16.0", dbVersion: 2 });
  });

  test("the bookkeeping: journal owners, when to try, Chromium's folder name", () => {
    expect(journalAccount("folevi:sync-journal:acct1:tab")).toBe("acct1");
    expect(journalAccount("folevi:sync-journal:acct1")).toBe("acct1");
    expect(journalAccount("folevi:last-account")).toBeNull();
    expect(pendingAccounts({ databases: [], storage: [["folevi:sync-journal:a:t", "{bad"]] }).size).toBe(0);
    expect(handoffDue(null)).toBe(true);
    expect(handoffDue({ state: "retry", attempts: MAX_ATTEMPTS - 1, at: 0 })).toBe(true);
    expect(handoffDue({ state: "retry", attempts: MAX_ATTEMPTS, at: 0 })).toBe(false);
    expect(handoffDue({ state: "done", attempts: 1, at: 0 })).toBe(false);
    expect(parseHandoffState("{nope")).toBeNull();
    expect(parseHandoffState(JSON.stringify({ state: "done", attempts: 1, at: 2 }))?.state).toBe("done");
    expect(indexedDbFolder(new URL("https://app.folevi.com"))).toBe("https_app.folevi.com_0.indexeddb.leveldb");
    expect(indexedDbFolder(new URL("http://app.localhost:3002"))).toBe("http_app.localhost_3002.indexeddb.leveldb");
  });

  test("the kit's source runs on its own (nothing from outside its body)", () => {
    const source = handoffKit.toString();
    expect(source).not.toMatch(/require\(|import\(|__vite|exports\./);
    expect(kitScript("counts", ["x"])).toContain('["counts"]');
  });
});
