// The 1.22 handover to the native Folevi for Mac (handover.ts): what this app's origin holds unsent goes into
// userData/handover as files, and the native app's copy of the kit (apps/mac/Folevi/Migration/handover-kit.js, what
// HandoverImport.swift runs in WebKit) puts it back into an empty origin exactly as it was. Two fake-indexeddb
// factories stand in for Electron's app://folevi and the native app's.
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { kitScript, type KitCall } from "./handoff";
import { pendingWork, removeStaleHandover, waitForSync, writeHandover, type HandoverIndex } from "./handover";
import type { Inventory } from "./handoffKit";

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

/** Electron's side: the kit from its TypeScript source, as main.ts injects it. */
function electronOrigin(): Origin {
  const o = { indexedDB: new IDBFactory(), localStorage: new MemoryStorage() } as Origin;
  o.call = (fn, ...args) => new Function("indexedDB", "IDBKeyRange", "localStorage", `return ${kitScript(fn, args)}`)(o.indexedDB, IDBKeyRange, o.localStorage);
  return o;
}

/** The native app's side: the committed handover-kit.js, called as HandoverImport.swift does. */
const nativeKit = readFileSync(resolve(__dirname, "../../mac/Folevi/Migration/handover-kit.js"), "utf8");
function nativeOrigin(): Origin {
  const o = { indexedDB: new IDBFactory(), localStorage: new MemoryStorage() } as Origin;
  o.call = (fn, ...args) =>
    new Function("indexedDB", "IDBKeyRange", "localStorage", "fn", "args", `const kit = (${nativeKit})(); return kit[fn]({ indexedDB, IDBKeyRange, localStorage }, ...args);`)(o.indexedDB, IDBKeyRange, o.localStorage, fn, args);
  return o;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

async function accountDb(f: IDBFactory, name: string, fill: (tx: IDBTransaction) => void): Promise<void> {
  const open = f.open(name, 3);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore("meta");
    db.createObjectStore("syncState");
    db.createObjectStore("uploads", { keyPath: "uploadId" });
    db.createObjectStore("documents", { keyPath: "id" }).createIndex("by_scope", "scopeKey");
  };
  const db = await req(open);
  const tx = db.transaction(["meta", "syncState", "uploads", "documents"], "readwrite");
  fill(tx);
  await new Promise<void>((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error))));
  db.close();
}

const OP = { kind: "block.update", opId: "op-1", block: { id: "b1", type: "paragraph", text: "written offline" }, sent: false };

async function seed(o: Origin) {
  await accountDb(o.indexedDB, "folevi-acct1", (tx) => {
    const meta = tx.objectStore("meta");
    meta.put("mac-01DEVICE", "deviceId");
    meta.put({ id: "01OUTBOX", name: "organization.createFolder", args: { name: "Trips" }, createdAt: 5, attempts: 0 }, "outbox:01OUTBOX");
    meta.put({ at: new Date(1_700_000_000_000), bytes: new Uint8Array([1, 2, 3]) }, "odd");
    tx.objectStore("syncState").put({ blocks: {}, pending: [OP], inflight: [], conflicts: [], errors: [], uploads: [] }, "account");
    tx.objectStore("uploads").put({ uploadId: "u1", documentId: "d1", blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), attempts: 0 });
    for (let i = 0; i < 30; i++) tx.objectStore("documents").put({ id: `d${i}`, scopeKey: "personal", title: `Note ${i}`, body: "x".repeat(300) });
  });
  await accountDb(o.indexedDB, "folevi-idle", (tx) => tx.objectStore("meta").put("mac-02", "deviceId"));
  o.localStorage.setItem("folevi:last-account", "acct1");
  o.localStorage.setItem("folevi:sync-journal:acct1:tab9", JSON.stringify({ ops: [OP], uploads: [], closed: true, at: 9 }));
  o.localStorage.setItem("folevi:sync-journal:idle:tab1", JSON.stringify({ ops: [], uploads: [], closed: true, at: 9 }));
}

/** What HandoverImport.swift does with the folder, in TypeScript. */
async function importHandover(dir: string, to: Origin): Promise<{ imported: string[]; skipped: string[]; storage: number }> {
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as HandoverIndex;
  const out = { imported: [] as string[], skipped: [] as string[], storage: 0 };
  for (const db of index.databases) {
    if ((await to.call("prepare", JSON.stringify(db.schema))) === "exists") {
      out.skipped.push(db.name);
      continue;
    }
    for (const c of db.chunks) {
      const text = readFileSync(join(dir, c.file), "utf8");
      expect(createHash("sha256").update(text).digest("hex")).toBe(c.sha256);
      await to.call("writeChunk", db.name, c.store, text);
    }
    expect(JSON.parse((await to.call("counts", db.name)) as string)).toEqual(db.counts);
    out.imported.push(db.name);
  }
  if (index.storage) out.storage = (await to.call("writeStorage", readFileSync(join(dir, index.storage.file), "utf8"))) as number;
  return out;
}

const scratch = () => mkdtempSync(join(tmpdir(), "folevi-handover-"));

describe("the handover to the native app", () => {
  test("writes what isn't sent, and the native kit puts it back exactly", async () => {
    const from = electronOrigin();
    await seed(from);
    const userData = scratch();
    const index = await writeHandover(from.call, userData, { appVersion: "1.22.0", dbVersion: 3, origin: "app://folevi", budget: 2000, now: () => 42 });
    expect(index).toMatchObject({ v: 1, createdAt: 42, appVersion: "1.22.0", dbVersion: 3, origin: "app://folevi" });
    // Only the account with unsent work; its documents in several chunks.
    expect(index.databases.map((d) => d.name)).toEqual(["folevi-acct1"]);
    const acct = index.databases[0]!;
    expect(acct.pending).toEqual({ sync: 1, outbox: 1, uploads: 1 });
    expect(acct.counts).toEqual({ documents: 30, meta: 3, syncState: 1, uploads: 1 });
    expect(acct.chunks.filter((c) => c.store === "documents").length).toBeGreaterThan(1);
    expect(index.storage?.entries).toBe(2);
    // Written whole, no temporary folder left.
    expect(readdirSync(userData)).toEqual(["handover"]);

    const to = nativeOrigin();
    const result = await importHandover(join(userData, "handover"), to);
    expect(result).toEqual({ imported: ["folevi-acct1"], skipped: [], storage: 2 });
    const inv = JSON.parse((await to.call("inventory", "folevi-")) as string) as Inventory;
    expect(inv.databases.map((d) => [d.name, d.version, d.pending])).toEqual([["folevi-acct1", 3, { sync: 1, outbox: 1, uploads: 1 }]]);
    const db = await req(to.indexedDB.open("folevi-acct1"));
    const tx = db.transaction(["meta", "uploads", "documents"]);
    const odd = (await req(tx.objectStore("meta").get("odd"))) as { at: Date; bytes: Uint8Array };
    expect(odd.at.getTime()).toBe(1_700_000_000_000);
    expect([...odd.bytes]).toEqual([1, 2, 3]);
    const upload = (await req(tx.objectStore("uploads").get("u1"))) as { blob: Blob };
    expect([...new Uint8Array(await upload.blob.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    expect(await req(tx.objectStore("documents").index("by_scope").count("personal"))).toBe(30);
    db.close();
    expect(to.localStorage.getItem("folevi:sync-journal:acct1:tab9")).toContain("written offline");
    expect(to.localStorage.getItem("folevi:sync-journal:idle:tab1")).toBeNull();

    // Again over what's there: nothing is overwritten.
    expect((await importHandover(join(userData, "handover"), to)).skipped).toEqual(["folevi-acct1"]);
  });

  test("with nothing waiting it says so, and replaces an older handover", async () => {
    const from = electronOrigin();
    await seed(from);
    const userData = scratch();
    await writeHandover(from.call, userData, { appVersion: "1.22.0", origin: "app://folevi" });
    // The outbox and journal are sent: the next quit's handover holds nothing.
    const db = await req(from.indexedDB.open("folevi-acct1"));
    const tx = db.transaction(["meta", "syncState", "uploads"], "readwrite");
    tx.objectStore("meta").delete("outbox:01OUTBOX");
    tx.objectStore("syncState").put({ blocks: {}, pending: [], inflight: [], conflicts: [], errors: [], uploads: [] }, "account");
    tx.objectStore("uploads").clear();
    await new Promise<void>((r) => (tx.oncomplete = () => r()));
    db.close();
    from.localStorage.removeItem("folevi:sync-journal:acct1:tab9");
    const index = await writeHandover(from.call, userData, { appVersion: "1.22.0", origin: "app://folevi" });
    expect(index.databases).toEqual([]);
    expect(index.storage).toBeNull();
    expect(readdirSync(join(userData, "handover"))).toEqual(["index.json"]);
    expect(removeStaleHandover(userData)).toBe(true);
    expect(existsSync(join(userData, "handover"))).toBe(false);
  });

  test("a failed write leaves no handover behind", async () => {
    const from = electronOrigin();
    await seed(from);
    const userData = scratch();
    const broken: KitCall = (fn, ...args) => (fn === "readChunk" ? Promise.reject(new Error("tab crashed")) : from.call(fn, ...args));
    await expect(writeHandover(broken, userData, { appVersion: "1.22.0", origin: "app://folevi" })).rejects.toThrow("tab crashed");
    expect(readdirSync(userData)).toEqual([]);
  });

  test("waits for the sync to send what's waiting, up to its limit", async () => {
    const from = electronOrigin();
    await seed(from);
    expect(pendingWork(JSON.parse((await from.call("inventory", "folevi-")) as string))).toBe(1);
    let t = 0;
    const waited: number[] = [];
    // Never sent: gives up at the limit.
    expect(await waitForSync(from.call, { timeoutMs: 45_000, intervalMs: 15_000, now: () => t, sleep: async (ms) => void (t += ms), onWaiting: (n) => waited.push(n) })).toBe(false);
    expect(waited).toEqual([1, 1, 1, 1]);
    // Sent after the first look.
    const sent: KitCall = async (fn, ...args) => {
      const answer = await from.call(fn, ...args);
      await from.indexedDB.deleteDatabase("folevi-acct1");
      from.localStorage.removeItem("folevi:sync-journal:acct1:tab9");
      return answer;
    };
    t = 0;
    expect(await waitForSync(sent, { intervalMs: 15_000, now: () => t, sleep: async (ms) => void (t += ms) })).toBe(true);
  });
});
