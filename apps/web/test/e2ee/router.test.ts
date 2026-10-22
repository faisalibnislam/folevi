// WP7 (docs/E2EE_DESIGN.md §11.1): resolveSpace rules; pass for Standard (byte-identical args); the sealed
// push round trip; decoders refuse a ciphertext moved to another block; locked sessions; sealed variants;
// device routes answered by the replica; Standard spaces with locks merged.
import { describe, expect, test } from "vitest";
import { canonicalJson, SCHEMA_VERSION, ulid, type SyncOp, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { E2eeRouterClient } from "@/lib/e2ee/router/client";
import { SpaceIndex } from "@/lib/e2ee/router/spaces";
import { routeOf } from "@/lib/e2ee/router/routes";
import { UNREADABLE_TEXT } from "@/lib/e2ee/seal";
import { FakeConvex, FakeKeyRing, FakeSession, testProfile, until } from "./routerFakes";

const PERSONAL: WireScope = { kind: "personal" };
const LIST = { scope: PERSONAL, view: "all" as const, paginationOpts: { numItems: 50, cursor: null } };
const para = (id: string, text: string, rank = "a"): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: {} });

async function world(opts: { level?: "standard" | "selected" | "full"; lockedCount?: number; encrypted?: boolean; locked?: boolean; fetch?: typeof fetch } = {}) {
  const profile = await testProfile();
  const fake = new FakeConvex(profile);
  const scopeId = `personal:${profile.id}`;
  if (opts.encrypted !== false) fake.encrypt(PERSONAL, scopeId, opts.level ?? "full", opts.lockedCount ?? 0);
  const keyring = new FakeKeyRing([{ scope: PERSONAL, scopeId }]);
  const session = new FakeSession(opts.locked ? "locked" : "unlocked");
  const router = new E2eeRouterClient(fake.client as never, { session, keyring, persist: () => false, locks: null, fetch: opts.fetch });
  await router.ready();
  return { profile, fake, scopeId, keyring, session, router };
}

const create = (id: string, title: string, extra: Record<string, unknown> = {}): SyncOp => ({ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: "📝", scope: PERSONAL, ...extra } });
const upsert = (documentId: string, block: WireBlock): SyncOp => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] });
const push = (router: E2eeRouterClient, ops: SyncOp[]) => router.mutation(api.sync.push, { scope: PERSONAL, deviceId: "web-test-device-01", ops: ops as never }) as Promise<{ opId: string; status: string; block?: WireBlock | null; error?: { code: string } }[]>;

describe("resolveSpace (§6.4)", () => {
  const space = (scope: WireScope, level: "standard" | "full", lockedCount = 0) => ({ scope, scopeId: scope.kind === "personal" ? "personal:p1" : `workspace:${scope.workspaceId}`, level, state: level === "full" ? ("on" as const) : ("off" as const), switches: {} as never, currentKeyVersion: 1, lockedCount });

  test("args.scope wins; an id the index knows names its space; an unknown id is a Standard note's", () => {
    const idx = new SpaceIndex();
    const W: WireScope = { kind: "workspace", workspaceId: "W1" };
    idx.setSpaces([space(PERSONAL, "full")]);
    expect(idx.resolve({ scope: PERSONAL }).active).toBe(true);
    expect(idx.resolve({ scope: W }).active).toBe(false);
    idx.noteDocument("D1", PERSONAL, true);
    expect(idx.resolve({ documentId: "D1" })).toMatchObject({ active: true, sealed: true, documentId: "D1", via: "documentId" });
    // In an encrypted space every note is in its replica: an id it doesn't know is answered there (not found).
    expect(idx.resolve({ documentId: "UNKNOWN", scope: PERSONAL })).toMatchObject({ active: true, via: "scope" });
    // In a space that isn't e2ee-active it's a plain note's.
    expect(idx.resolve({ documentId: "UNKNOWN", scope: W })).toMatchObject({ active: false, via: "documentId" });
    expect(idx.resolve({ documentId: "UNKNOWN" })).toMatchObject({ active: false, via: "documentId" });
    idx.noteRef("folder", "F1", PERSONAL);
    expect(idx.resolve({ folderId: "F1" })).toMatchObject({ active: true, via: "folderId" });
    idx.noteRef("comment", "C1", PERSONAL, "D1");
    expect(idx.resolve({ commentId: "C1" })).toMatchObject({ active: true, sealed: true, documentId: "D1" });
  });

  test("the first id argument the index knows decides, in §6.4's order; no id falls back to the context scope", () => {
    const idx = new SpaceIndex();
    idx.setSpaces([space(PERSONAL, "full")]);
    idx.noteDocument("D1", PERSONAL, true);
    idx.noteRef("folder", "F1", PERSONAL);
    expect(idx.resolve({ documentId: "D1", folderId: "OTHER" })).toMatchObject({ via: "documentId", documentId: "D1" });
    // A task moved to a note nobody has: its block still says where it is.
    idx.noteRef("block", "B1", PERSONAL, "D1");
    expect(idx.resolve({ documentId: "NOWHERE", blockId: "B1" })).toMatchObject({ active: true, via: "blockId", documentId: "D1" });
    expect(idx.resolve({ documentId: "STD" }).active).toBe(false);
    expect(idx.resolve({}).active).toBe(false);
    idx.setContextScope(PERSONAL);
    expect(idx.resolve({}).active).toBe(true);
    expect(idx.resolve({}).via).toBe("context");
  });

  test("a Standard space with locks is active; one without is not", () => {
    const idx = new SpaceIndex();
    idx.setSpaces([space(PERSONAL, "standard", 1)]);
    expect(idx.resolve({ scope: PERSONAL }).active).toBe(true);
    idx.setSpaces([space(PERSONAL, "standard", 0)]);
    expect(idx.resolve({ scope: PERSONAL }).active).toBe(false);
  });
});

describe("Standard calls pass through untouched", () => {
  test("no e2ee-active space: the inner client gets the very same args and its own watch", async () => {
    const { fake, router } = await world({ encrypted: false });
    const args = { scope: PERSONAL, name: "Trips" };
    await router.mutation(api.organization.createFolder, args);
    const sent = fake.log.find((l) => l.name === "organization:createFolder")!;
    expect(sent.args).toBe(args);
    // A route that never concerns content hands back the inner client's own watch object.
    const w = router.watchQuery(api.users.me, {});
    expect(Object.keys(w).sort()).toEqual(["journal", "localQueryLogs", "localQueryResult", "onUpdate"]);
    expect(routeOf("users:me").kind).toBe("pass");
  });

  test("a Standard note in an encrypted account's other space: its ops go out as they are", async () => {
    const { fake, router } = await world({ encrypted: false });
    const ops = [create(ulid(), "Plain"), upsert(ulid(), para(ulid(), "plain words"))];
    await push(router, ops);
    const sent = fake.log.find((l) => l.name === "sync:push")!.args as { ops: SyncOp[] };
    expect(canonicalJson(sent.ops)).toBe(canonicalJson(ops));
  });
});

describe("sync.push sealed (§6.6)", () => {
  test("creates and edits in an encrypted space reach the server as ciphertext, and come back as plaintext", async () => {
    const { fake, router } = await world();
    const doc = ulid();
    const b = ulid();
    const results = await push(router, [create(doc, "ZQXJ-TITLE-7f3a"), upsert(doc, para(b, "ZQXJ-BODY-1 secret words"))]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    // What the engine gets back is the plaintext block it sent.
    expect(results[1]!.block?.text).toEqual([{ type: "text", text: "ZQXJ-BODY-1 secret words" }]);
    // Nothing readable reached the server.
    expect(fake.stored()).not.toContain("ZQXJ");
    const sent = fake.log.find((l) => l.name === "sync:push")!.args as { ops: SyncOp[] };
    expect(JSON.stringify(sent.ops)).not.toContain("ZQXJ");
    const sealedCreate = sent.ops[0] as SyncOp & { kind: "document.create" };
    expect(sealedCreate.document.title).toBe("");
    expect(sealedCreate.document.icon).toBeNull();
    // Read back through the router: opened.
    const listed = (await router.query(api.blocks.list, { documentId: doc })) as { blocks: WireBlock[] };
    expect(listed.blocks.map((x) => x.text)).toEqual([[{ type: "text", text: "ZQXJ-BODY-1 secret words" }]]);
    const got = (await router.query(api.documents.get, { documentId: doc })) as { document: { title: string; icon: string | null } };
    expect(got.document.title).toBe("ZQXJ-TITLE-7f3a");
    expect(got.document.icon).toBe("📝");
  });

  test("a title patch is sealed with its MAC; folder moves stay plaintext", async () => {
    const { fake, router } = await world();
    const doc = ulid();
    await push(router, [create(doc, "First")]);
    await push(router, [{ opId: ulid(), kind: "document.update", documentId: doc, patch: { title: "ZQXJ-RENAMED", folderId: null }, baseRevision: 1 }]);
    const last = fake.log.filter((l) => l.name === "sync:push").at(-1)!.args as { ops: { patch: Record<string, unknown> }[] };
    expect(Object.keys(last.ops[0]!.patch).sort()).toEqual(["folderId", "sealedTitle"]);
    expect(fake.stored()).not.toContain("ZQXJ");
    const got = (await router.query(api.documents.get, { documentId: doc })) as { document: { title: string } };
    expect(got.document.title).toBe("ZQXJ-RENAMED");
  });

  test("a resend of the same op is sealed the same way (the server answers it as a replay)", async () => {
    const { fake, router } = await world();
    const doc = ulid();
    const op = create(doc, "Once");
    await push(router, [op]);
    await push(router, [op]);
    const [a, b] = fake.log.filter((l) => l.name === "sync:push").map((l) => (l.args as { ops: unknown[] }).ops[0]);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test("a mention is visible to the server (it notifies), the rest of the block isn't", async () => {
    const { fake, router } = await world();
    const doc = ulid();
    await push(router, [create(doc, "Meeting")]);
    const block: WireBlock = { ...para(ulid(), "ZQXJ-hi "), text: [{ type: "text", text: "ZQXJ-hi " }, { type: "mention", userId: "P2", label: "Pat" } as never] };
    await push(router, [upsert(doc, block)]);
    const row = [...fake.blocks.values()].find((r) => r.documentId === doc)!;
    expect((row.block as { sealed: { mentions?: string[] } }).sealed.mentions).toEqual(["P2"]);
    expect(fake.stored()).not.toContain("ZQXJ");
  });
});

describe("decoders", () => {
  test("a ciphertext moved to another block (or note) doesn't open: that block reads as unreadable", async () => {
    const { fake, router } = await world();
    const doc = ulid();
    const a = ulid();
    const b = ulid();
    await push(router, [create(doc, "Note"), upsert(doc, para(a, "alpha", "a")), upsert(doc, para(b, "beta", "b"))]);
    const rowA = fake.blocks.get(`${doc}/${a}`)!;
    const rowB = fake.blocks.get(`${doc}/${b}`)!;
    // A server that swaps ciphertexts between blocks.
    rowB.block = { ...rowB.block, sealed: (rowA.block as { sealed: unknown }).sealed };
    const listed = (await router.query(api.blocks.list, { documentId: doc })) as { blocks: WireBlock[] };
    const byId = new Map(listed.blocks.map((x) => [x.id, x]));
    expect(byId.get(a)!.text).toEqual([{ type: "text", text: "alpha" }]);
    expect(byId.get(b)!.text).toEqual([{ type: "text", text: UNREADABLE_TEXT }]);
  });

  test("watchQuery: a sealed note's blocks arrive opened, and update after an edit", async () => {
    const { router } = await world();
    const doc = ulid();
    const b = ulid();
    await push(router, [create(doc, "Live"), upsert(doc, para(b, "one"))]);
    const watch = router.watchQuery(api.blocks.list, { documentId: doc });
    let updates = 0;
    const off = watch.onUpdate(() => updates++);
    await until(() => (watch.localQueryResult() as { blocks?: WireBlock[] } | undefined)?.blocks?.length === 1);
    expect((watch.localQueryResult() as { blocks: WireBlock[] }).blocks[0]!.text).toEqual([{ type: "text", text: "one" }]);
    await push(router, [upsert(doc, { ...para(b, "two"), revision: 1 })]);
    await until(() => JSON.stringify((watch.localQueryResult() as { blocks: WireBlock[] }).blocks[0]!.text).includes("two"));
    expect(updates).toBeGreaterThan(0);
    off();
  });
});

describe("locked sessions (§6.3)", () => {
  test("an encrypted space's calls answer e2ee_locked_session; Standard calls still work", async () => {
    const { router, fake } = await world({ locked: true });
    await expect(router.query(api.documents.list, LIST)).rejects.toMatchObject({ data: { code: "e2ee_locked_session" } });
    const w = router.watchQuery(api.documents.list, LIST);
    expect(() => w.localQueryResult()).toThrow();
    const other: WireScope = { kind: "workspace", workspaceId: "W-STD" };
    fake.extra.set("documents:list", () => [{ id: "x", title: "Standard" }]);
    await expect(router.query(api.documents.list, { ...LIST, scope: other })).resolves.toEqual([{ id: "x", title: "Standard" }]);
  });
});

describe("sealed variants (§6.4 sealed)", () => {
  test("a folder made in an encrypted space has a sealed name", async () => {
    const { router, fake } = await world();
    const r = (await router.mutation(api.organization.createFolder, { scope: PERSONAL, name: "ZQXJ-FOLDER-1" })) as { id: string };
    expect(typeof r.id).toBe("string");
    const sent = fake.log.find((l) => l.name === "e2ee/content:createFolder");
    expect(sent).toBeTruthy();
    expect(fake.log.some((l) => l.name === "organization:createFolder")).toBe(false);
    expect(fake.stored()).not.toContain("ZQXJ");
  });

  test("in a Standard space with locks a plain folder stays plain", async () => {
    const { router, fake } = await world({ level: "standard", lockedCount: 1 });
    await router.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Plain folder" });
    expect(fake.log.some((l) => l.name === "organization:createFolder")).toBe(true);
    expect(fake.log.some((l) => l.name === "e2ee/content:createFolder")).toBe(false);
  });

  test("the agent is off in an encrypted space", async () => {
    const { router } = await world();
    expect(routeOf("aiAgent:send").kind).toBe("off");
    await expect(router.action(api.aiAgent.send as never, { scope: PERSONAL } as never)).rejects.toMatchObject({ data: { code: "e2ee_unavailable", feature: "agent" } });
  });
});

describe("device routes (§6.5)", () => {
  test("documents.list in an encrypted space is answered by the replica, with opened titles", async () => {
    const { router, fake } = await world();
    const doc = ulid();
    await push(router, [create(doc, "ZQXJ-LISTED"), upsert(doc, para(ulid(), "body text here"))]);
    await until(() => router.status(PERSONAL).state === "ready");
    const before = fake.log.filter((l) => l.name === "documents:list").length;
    const list = ((await router.query(api.documents.list, LIST)) as { page: { id: string; title: string; excerpt: string }[] }).page;
    expect(fake.log.filter((l) => l.name === "documents:list").length).toBe(before);
    const mine = list.find((d) => d.id === doc)!;
    expect(mine.title).toBe("ZQXJ-LISTED");
    expect(mine.excerpt).toContain("body text here");
  });

  test("a second device ingests the space from the pull and answers the same", async () => {
    const { router, fake, keyring, profile } = await world();
    const doc = ulid();
    await push(router, [create(doc, "Shared title"), upsert(doc, para(ulid(), "pulled words"))]);
    const other = new E2eeRouterClient(fake.client as never, { session: new FakeSession("unlocked", "web-test-device-02"), keyring: keyring.sibling(), persist: () => false, locks: null });
    await other.ready();
    await until(async () => ((await other.query(api.documents.list, LIST)) as { page: { id: string }[] }).page.some((d) => d.id === doc));
    const list = ((await other.query(api.documents.list, LIST)) as { page: { id: string; title: string; excerpt: string }[] }).page;
    expect(list.find((d) => d.id === doc)).toMatchObject({ title: "Shared title" });
    expect(list.find((d) => d.id === doc)!.excerpt).toContain("pulled words");
    void profile;
  });
});

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("composers added after the first cut", () => {
  test("changes.undo puts the lines others changed back, sealed, and keeps a version first", async () => {
    const { router, fake } = await world();
    const doc = ulid();
    const b = ulid();
    await push(router, [create(doc, "Shared"), upsert(doc, para(b, "ZQXJ-theirs"))]);
    await until(() => router.status(PERSONAL).state === "ready");
    fake.extra.set("changes:note", () => ({ kinds: [[b, "edited"]], previous: [para(b, "ZQXJ-mine")], more: false, authors: [], removed: [], blocks: [], canUndo: true, people: {} }));
    fake.extra.set("documents:createSnapshot", () => ({ created: true, id: "SNAP1" }));
    fake.extra.set("changes:markSeen", () => null);
    const r = (await router.mutation(api.changes.undo, { documentId: doc })) as { undoVersionId: string | null; reverted: number };
    expect(r).toEqual({ undoVersionId: "SNAP1", reverted: 1 });
    const listed = (await router.query(api.blocks.list, { documentId: doc })) as { blocks: WireBlock[] };
    expect(listed.blocks[0]!.text).toEqual([{ type: "text", text: "ZQXJ-mine" }]);
    expect(fake.stored()).not.toContain("ZQXJ");
    expect(fake.log.map((l) => l.name)).toContain("changes:markSeen");
  });

  test("changes.undo without the version from when they last looked says so", async () => {
    const { router, fake } = await world();
    const doc = ulid();
    await push(router, [create(doc, "Shared")]);
    fake.extra.set("changes:note", () => ({ kinds: [["X", "edited"]], previous: null, more: false }));
    await expect(router.mutation(api.changes.undo, { documentId: doc })).rejects.toMatchObject({ data: { code: "not_found" } });
  });

  test("aiResearch.saveAsNote into an encrypted place makes the report a sealed note", async () => {
    const { router, fake } = await world();
    router.setScope(PERSONAL);
    fake.extra.set("aiResearch:list", () => [{ id: "R1", status: "done", question: "ZQXJ which tea?", sources: [{ n: 1, kind: "web", url: "https://tea.example", title: "Tea", domain: "tea.example" }], messageId: "M1", conversationId: "C1", noteId: null }]);
    fake.extra.set("aiChat:get", () => ({ messages: [{ id: "M1", text: "ZQXJ-REPORT Green tea [1]." }] }));
    const r = (await router.mutation(api.aiResearch.saveAsNote, { researchId: "R1" })) as { id: string };
    const listed = (await router.query(api.blocks.list, { documentId: r.id })) as { blocks: WireBlock[] };
    expect(JSON.stringify(listed.blocks)).toContain("ZQXJ-REPORT Green tea");
    const got = (await router.query(api.documents.get, { documentId: r.id })) as { document: { title: string } };
    expect(got.document.title).toBe("ZQXJ which tea?");
    expect(fake.stored()).not.toContain("ZQXJ");
  });

  test("a Standard note's file pasted into a sealed note is encrypted and uploaded as that note's", async () => {
    const stored: Uint8Array[] = [];
    const fetchStub = (async (url: string, init?: { body?: Uint8Array }) => {
      if (String(url).includes("plain-file")) return new Response(PNG as Uint8Array<ArrayBuffer>, { status: 200 });
      stored.push(init!.body!);
      return new Response(JSON.stringify({ storageId: "S1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const { router, fake } = await world({ fetch: fetchStub });
    const doc = ulid();
    await push(router, [create(doc, "Sealed")]);
    fake.extra.set("files:urls", () => ({ PLAIN: { url: "https://site/files/plain-file", mimeType: "image/png", filename: "photo.png", size: PNG.length } }));
    fake.extra.set("e2ee/files:generateUploadUrl", () => ({ uploadUrl: "https://upload", intentId: "I1" }));
    fake.extra.set("e2ee/files:commit", (a) => ({ fileId: a.fileId, size: a.size }));
    const map = (await router.mutation(api.files.shareForPaste, { documentId: doc, fileIds: ["PLAIN"] })) as Record<string, string>;
    expect(map.PLAIN).toBeTruthy();
    expect(map.PLAIN).not.toBe("PLAIN");
    // What went up is a keyed stream (FLV1 0x04), not the PNG.
    expect([...stored[0]!.slice(0, 5)]).toEqual([0x46, 0x4c, 0x56, 0x31, 0x04]);
    const commit = fake.log.find((l) => l.name === "e2ee/files:commit")!.args as { documentId: string; sealed: { plainSize: number } };
    expect(commit.documentId).toBe(doc);
    expect(commit.sealed.plainSize).toBe(PNG.length);
    // Pasting the same file again reuses the copy.
    const again = (await router.mutation(api.files.shareForPaste, { documentId: doc, fileIds: ["PLAIN"] })) as Record<string, string>;
    expect(again.PLAIN).toBe(map.PLAIN);
  });

  test("an opened toggle keeps collapsed: false, as it was sealed", async () => {
    const { router } = await world();
    const doc = ulid();
    const t = ulid();
    await push(router, [create(doc, "Toggles")]);
    const toggle: WireBlock = { id: t, type: "toggle", parentId: null, rank: "a", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Open" }], props: { collapsed: false } };
    await push(router, [upsert(doc, toggle)]);
    const listed = (await router.query(api.blocks.list, { documentId: doc })) as { blocks: WireBlock[] };
    expect(listed.blocks[0]!.props).toEqual({ collapsed: false });
  });
});
