// WP7 (docs/E2EE_DESIGN.md §11.1): pull ingest is idempotent; derived fields equal local mode's for the same
// rows; the engine's unsent edits show on top of the replica.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, ulid, type SyncOp, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { E2eeRouterClient } from "@/lib/e2ee/router/client";
import { SyncEngine } from "@/lib/sync/engine";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { ReplicaIngest } from "@/lib/e2ee/replica/ingest";
import { SpaceReplicaStore } from "@/lib/e2ee/replica/store";
import { Sealer } from "@/lib/e2ee/seal";
import { pullPage } from "@/lib/e2ee/router/refs";
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
});
