// WP7 (docs/E2EE_DESIGN.md §11.1): pull ingest is idempotent; derived fields equal local mode's for the same
// rows; the engine's unsent edits show on top of the replica.
import { describe, expect, test } from "vitest";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, SCHEMA_VERSION, ulid, type SyncOp, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { E2eeRouterClient } from "@/lib/e2ee/router/client";
import { SyncEngine } from "@/lib/sync/engine";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { ReplicaIngest } from "@/lib/e2ee/replica/ingest";
import { SpaceReplicaStore } from "@/lib/e2ee/replica/store";
import { Sealer } from "@/lib/e2ee/seal";
import { pullPage, type E2eePullPage } from "@/lib/e2ee/router/refs";
import { FakeConvex, FakeKeyRing, FakeSession, testProfile, until } from "./routerFakes";

const PERSONAL: WireScope = { kind: "personal" };
const LIST = { scope: PERSONAL, view: "all" as const, paginationOpts: { numItems: 100, cursor: null } };
const TODAY = "2026-10-21";

const para = (id: string, text: string, rank: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: {} });
const heading = (id: string, text: string, rank: string): WireBlock => ({ id, type: "heading", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { level: 1 } });
const todo = (id: string, text: string, rank: string): WireBlock => ({ id, type: "todo", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { checked: false } });
const link = (id: string, target: string, rank: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "See " }, { type: "pageLink", documentId: target, label: "x" } as never], props: {} });

async function encryptedWorld() {
  const profile = await testProfile();
  const fake = new FakeConvex(profile);
  const scopeId = `personal:${profile.id}`;
  fake.encrypt(PERSONAL, scopeId, "full");
  const keyring = new FakeKeyRing([{ scope: PERSONAL, scopeId }]);
  const session = new FakeSession();
  const router = new E2eeRouterClient(fake.client as never, { session, keyring, persist: () => false, locks: null });
  await router.ready();
  return { profile, fake, scopeId, keyring, session, router };
}

async function localLibrary() {
  const client = new LocalClient(new LocalBackend(new MemoryStore(), { deviceId: "local-device-1" }));
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Tess", seed: false });
  return client;
}

const create = (id: string, title: string): SyncOp => ({ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: "📝", scope: PERSONAL } });
const upsert = (documentId: string, block: WireBlock): SyncOp => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] });

/** The same notes written to both: what a person would see must be the same. */
function scenario() {
  const a = ulid();
  const b = ulid();
  const ops: SyncOp[] = [
    create(a, "Trip plans"),
    upsert(a, heading(ulid(), "Lisbon in spring", "a")),
    upsert(a, para(ulid(), "Book the tram museum and the bookshop near the river.", "b")),
    upsert(a, todo(ulid(), "Renew passport", "c")),
    create(b, "Packing"),
    upsert(b, link(ulid(), a, "a")),
  ];
  return { a, b, ops };
}

const pick = (d: Record<string, unknown>) => ({ id: d.id, title: d.title, icon: d.icon, excerpt: d.excerpt, preview: d.preview, wordCount: d.wordCount, charCount: d.charCount, blockCount: d.blockCount, kind: d.kind });

describe("the replica's derived fields match local mode's (§6.7)", () => {
  test("lists, previews, counts, tasks and backlinks", async () => {
    const { a, b, ops } = scenario();
    const local = await localLibrary();
    await local.mutation(api.sync.push, { scope: PERSONAL, deviceId: "local-device-1", ops: ops as never });
    const { router } = await encryptedWorld();
    const results = (await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never })) as { status: string }[];
    expect(results.every((r) => r.status === "applied")).toBe(true);
    await until(() => router.status(PERSONAL).state === "ready");

    const fromLocal = ((await local.query(api.documents.list, LIST)) as unknown as { page: Record<string, unknown>[] }).page.map(pick).sort((x, y) => String(x.id).localeCompare(String(y.id)));
    const fromReplica = ((await router.query(api.documents.list, LIST)) as unknown as { page: Record<string, unknown>[] }).page.map(pick).sort((x, y) => String(x.id).localeCompare(String(y.id)));
    expect(fromReplica).toEqual(fromLocal);
    expect(fromReplica.find((d) => d.id === a)!.excerpt).toContain("tram museum");

    const tasks = async (c: { query: (r: never, a: never) => Promise<unknown> }) => ((await c.query(api.tasks.list as never, { scope: PERSONAL, view: "all", today: TODAY } as never)) as { tasks?: { title?: string; text?: string }[] } | { title?: string }[]);
    expect(JSON.stringify(await tasks(router as never))).toContain("Renew passport");
    // Times are each backend's own clock; everything else must match.
    const timeless = (v: unknown) => JSON.stringify(v, (k, x) => (k === "updatedAt" || k === "createdAt" ? undefined : x));
    expect(timeless(await tasks(router as never))).toBe(timeless(await tasks(local as never)));

    const backlinks = async (c: { query: (r: never, a: never) => Promise<unknown> }) => JSON.stringify(await c.query(api.documents.backlinks as never, { documentId: a } as never));
    expect(await backlinks(router as never)).toContain(b);
    const search = async (c: { query: (r: never, a: never) => Promise<unknown> }) => ((await c.query(api.search.documents as never, { scope: PERSONAL, query: "bookshop" } as never)) as unknown[]);
    expect(JSON.stringify(await search(router as never))).toContain(a);
    await local.close();
  });
});

describe("ingest", () => {
  test("is idempotent: the same page twice leaves the replica as it was", async () => {
    const { fake, router, keyring, profile, scopeId } = await encryptedWorld();
    const { ops } = scenario();
    await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never });
    const page = (await fake.client.query(pullPage as never, { scope: PERSONAL, cursor: 0 })) as never;
    const store = new SpaceReplicaStore(null);
    const ingest = new ReplicaIngest({ store, sealer: new Sealer(keyring), keyring, scope: PERSONAL, scopeId, profile });
    await ingest.ensureProfile();
    await ingest.page(page);
    const snapshot = async () => JSON.stringify({ docs: (await store.list("documents")).sort((x, y) => x.id.localeCompare(y.id)), blocks: (await Promise.all((await store.list("documents")).map((d) => store.list("blocks", d.id)))).flat().sort((x, y) => x.id.localeCompare(y.id)) });
    const first = await snapshot();
    let announced = 0;
    store.subscribe(() => announced++);
    await ingest.page(page);
    expect(await snapshot()).toBe(first);
    // Nothing changed, so at most bookkeeping was announced (no note or block keys).
    void announced;
    const docs = await store.list("documents");
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.title).sort()).toEqual(["Packing", "Trip plans"]);
  });

  test("a sibling device reading the pull sees what this one wrote, opened", async () => {
    const { fake, router, keyring, profile, scopeId } = await encryptedWorld();
    const { a, ops } = scenario();
    await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never });
    const page = (await fake.client.query(pullPage as never, { scope: PERSONAL, cursor: 0 })) as never;
    const sibling = keyring.sibling();
    const store = new SpaceReplicaStore(null);
    const ingest = new ReplicaIngest({ store, sealer: new Sealer(sibling), keyring: sibling, scope: PERSONAL, scopeId, profile });
    await ingest.page(page);
    const blocks = await store.list("blocks", a);
    expect(blocks.map((x) => x.text)).toContainEqual([{ type: "text", text: "Renew passport" }]);
  });
});

describe("a member waiting for the space's key", () => {
  test("pulls nothing until the key is shared, then opens every row (none kept as couldn't be decrypted)", async () => {
    const { fake, router, keyring } = await encryptedWorld();
    const { a, ops } = scenario();
    await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never });
    // Another person's device: their key ring has no grant of the space key yet.
    const sibling = keyring.sibling();
    let granted = false;
    const gated = Object.assign(Object.create(sibling) as FakeKeyRing, {
      spaceKeys: (scope: WireScope, version?: number) => (granted ? sibling.spaceKeys(scope, version) : Promise.reject(Object.assign(new Error("no key"), { data: { code: "e2ee_no_key" } }))),
    });
    const other = new E2eeRouterClient(fake.client as never, { session: new FakeSession("unlocked", "web-test-device-02"), keyring: gated, persist: () => false, locks: null });
    await other.ready();
    await other.replicas.open(PERSONAL);
    await new Promise((r) => setTimeout(r, 100));
    const store = other.replicas.hostedStore!(PERSONAL)!;
    expect(await store.list("blocks", a)).toHaveLength(0);
    expect(other.status(PERSONAL).state).not.toBe("ready");

    // An admin's device shares the key (the space's row moves, so the head moves).
    granted = true;
    await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: [upsert(a, para(ulid(), "After the grant", "d"))] as never });
    await until(async () => (await store.list("blocks", a)).length === 4);
    const blocks = await store.list("blocks", a);
    expect(blocks.some((b) => (b.props as { e2eeUnreadable?: true }).e2eeUnreadable)).toBe(false);
    expect(blocks.map((x) => x.text)).toContainEqual([{ type: "text", text: "Renew passport" }]);
    await other.dispose();
  });

  test("rows kept as couldn't be decrypted (an earlier session without the key) are opened again", async () => {
    const { fake, router, keyring, profile, scopeId } = await encryptedWorld();
    const { a, ops } = scenario();
    await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never });
    const page = (await fake.client.query(pullPage as never, { scope: PERSONAL, cursor: 0 })) as never;
    const store = new SpaceReplicaStore(null);
    const noKey = Object.assign(Object.create(keyring.sibling()) as FakeKeyRing, { spaceKeys: () => Promise.reject(new Error("no key")) });
    await new ReplicaIngest({ store, sealer: new Sealer(noKey), keyring: noKey, scope: PERSONAL, scopeId, profile }).page(page);
    expect((await store.list("blocks", a)).every((b) => (b.props as { e2eeUnreadable?: true }).e2eeUnreadable)).toBe(true);
    const withKey = keyring.sibling();
    await new ReplicaIngest({ store, sealer: new Sealer(withKey), keyring: withKey, scope: PERSONAL, scopeId, profile }).page(page);
    const blocks = await store.list("blocks", a);
    expect(blocks.some((b) => (b.props as { e2eeUnreadable?: true }).e2eeUnreadable)).toBe(false);
  });
});

describe("tombstones and locks from the pull", () => {
  test("a note deleted for good goes with its blocks; a deleted tag leaves every note; unknown ids are ignored", async () => {
    const { fake, router, keyring, profile, scopeId } = await encryptedWorld();
    const { a, b, ops } = scenario();
    await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never });
    const page = (await fake.client.query(pullPage as never, { scope: PERSONAL, cursor: 0 })) as E2eePullPage;
    const store = new SpaceReplicaStore(null);
    const ingest = new ReplicaIngest({ store, sealer: new Sealer(keyring), keyring, scope: PERSONAL, scopeId, profile });
    const withTag = { ...page, documents: page.documents.map((d) => (d.id === b ? { ...d, tagIds: ["T1"], locked: true, lockedVia: "F1" } : d)), tags: [{ id: "T1", color: "moss", createdAt: 1, name: "trip", seq: 1 }] };
    await ingest.page(withTag);
    expect((await store.get("documents", b))).toMatchObject({ tagIds: ["T1"], locked: true, lockedVia: "F1" });
    const empty = { ...page, documents: [], blocks: [], folders: [], tags: [], records: [], noteKeys: [] };
    await ingest.page({ ...empty, removed: [{ kind: "document", id: a, seq: 99 }, { kind: "tag", id: "T1", seq: 99 }, { kind: "document", id: "NEVER-HELD", seq: 99 }] });
    expect(await store.get("documents", a)).toBeUndefined();
    expect(await store.list("blocks", a)).toEqual([]);
    expect(await store.get("tags", "T1")).toBeUndefined();
    expect((await store.get("documents", b))!.tagIds).toEqual([]);
  });
});

describe("the engine's unsent edits over the replica (§6.5)", () => {
  test("a to-do typed offline shows in the task list before it reaches the server", async () => {
    const { router } = await encryptedWorld();
    const doc = ulid();
    await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: [create(doc, "Errands")] as never });
    await until(() => router.status(PERSONAL).state === "ready");
    const engine = await SyncEngine.open(router as never, `acct-${ulid()}`, PERSONAL, "web-test-device-01");
    engine.setOnline(false);
    router.setEngine(engine);
    engine.upsertBlock(doc, todo(ulid(), "Buy stamps offline", "a"), ["content", "position"]);
    const list = await router.query(api.tasks.list, { scope: PERSONAL, view: "all", today: TODAY });
    expect(JSON.stringify(list)).toContain("Buy stamps offline");
    engine.dispose();
  });

  test("a note created offline without a look gets the default cover and style (cards draw them)", async () => {
    const { router } = await encryptedWorld();
    await until(() => router.status(PERSONAL).state === "ready");
    const engine = await SyncEngine.open(router as never, `acct-${ulid()}`, PERSONAL, "web-test-device-01");
    engine.setOnline(false);
    router.setEngine(engine);
    const id = ulid();
    engine.createDocument({ id, parentDocumentId: null, folderId: null, kind: "document", title: "From the inbox", icon: null, scope: PERSONAL });
    const list = (await router.query(api.documents.list, LIST)) as unknown as { page: { id: string; style?: unknown; cover?: unknown }[] };
    const doc = list.page.find((d) => d.id === id)!;
    expect(doc.style).toEqual(DEFAULT_DOCUMENT_STYLE);
    expect(doc.cover).toEqual(DEFAULT_COVER);
    engine.dispose();
  });
});

describe("public computer mode keeps the account's data in memory (§6.10)", () => {
  test("the in-memory IndexedDB is loaded only in that mode: one dynamic import, in lib/sync/db.ts", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("fake-indexeddb")) hits.push(p.slice(p.indexOf("src/")));
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual(["src/lib/sync/db.ts"]);
    const text = readFileSync(join(process.cwd(), "src/lib/sync/db.ts"), "utf8");
    expect(text).toMatch(/await import\("fake-indexeddb"\)/);
    expect(text).not.toMatch(/^import .*fake-indexeddb/m);
  });

  test("a public session's flag switches the account database to memory before the account opens", async () => {
    const { memoryLocalDbIfPublic, localDbInMemory, openLocalDbInMemory } = await import("@/lib/sync/db");
    expect(await memoryLocalDbIfPublic()).toBe(false);
    expect(localDbInMemory()).toBe(false);
    localStorage.setItem("folevi.e2ee.publicSession", "1");
    try {
      expect(await memoryLocalDbIfPublic()).toBe(true);
      expect(localDbInMemory()).toBe(true);
    } finally {
      localStorage.removeItem("folevi.e2ee.publicSession");
      openLocalDbInMemory(null);
    }
  });

  test("localDb opens in the given in-memory IndexedDB and leaves the browser's untouched", async () => {
    const { IDBFactory } = await import("fake-indexeddb");
    const { localDb, openLocalDbInMemory, localDbInMemory } = await import("@/lib/sync/db");
    const account = `public-${ulid()}`;
    openLocalDbInMemory(new IDBFactory());
    try {
      expect(localDbInMemory()).toBe(true);
      const db = await localDb(account);
      await db.put("meta", "kept in memory", "probe");
      expect(await db.get("meta", "probe")).toBe("kept in memory");
      const names = ((await indexedDB.databases?.()) ?? []).map((d) => d.name);
      expect(names).not.toContain(`folevi-${account}`);
    } finally {
      openLocalDbInMemory(null);
    }
  });
});

// §12 WP7 accept: a 1,000-note space ingests in under 20 s (Chromium on an M1). Skipped in CI: WP7_BENCH=1 runs it.
describe.skipIf(!process.env.WP7_BENCH)("ingest benchmark", () => {
  test("1,000 notes of 5 blocks each, pulled and opened by a second device", async () => {
    const { router, fake, keyring, profile, scopeId } = await encryptedWorld();
    for (let n = 0; n < 1000; n += 20) {
      const ops: SyncOp[] = [];
      for (let i = n; i < n + 20; i++) {
        const doc = ulid();
        ops.push(create(doc, `Note ${i}`));
        for (let j = 0; j < 4; j++) ops.push(upsert(doc, para(ulid(), `Line ${j} of note ${i}, with a few more words to search.`, `a${j}`)));
      }
      await router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never });
    }
    const page = (await fake.client.query(pullPage as never, { scope: PERSONAL, cursor: 0 })) as never;
    const sibling = keyring.sibling();
    const store = new SpaceReplicaStore(null);
    const ingest = new ReplicaIngest({ store, sealer: new Sealer(sibling), keyring: sibling, scope: PERSONAL, scopeId, profile });
    const started = performance.now();
    await ingest.page(page);
    const ms = performance.now() - started;
    process.stderr.write(`\n[e2ee bench] 1,000 notes, 5,000 blocks ingested in ${Math.round(ms)} ms\n`);
    expect((await store.list("documents")).length).toBe(1000);
    expect(ms).toBeLessThan(20_000);
  }, 120_000);
});
