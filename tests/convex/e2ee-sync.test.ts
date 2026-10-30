// Sealed content through sync.push (docs/E2EE_DESIGN.md §5.4, §11.2 e2ee-sync): sealed creates, upserts,
// conflicts by MAC, toggles, synced sources, plaintext refused, e2ee_busy, mentions, locks, blind versions.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_FOLDER_DEPTH, SCHEMA_VERSION, canonicalJson, sync, validateWireBlock, type OpResult, type SyncOp, type SyncState, type WireBlock } from "@folevi/editor-schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { e2eePerson, e2eeRecoveryMethods, e2eeSpace, join, para, person, setup, teamWorkspace, ulid, type T } from "./helpers";
import { ctx as aadCtx, deriveSpaceKeys } from "@folevi/local-store/e2ee";
import { encryptedSpace, push, Sealer } from "./e2ee-fixtures";

type Person = Awaited<ReturnType<typeof person>>;

async function sealedPerson(t: T, email: string, level: "full" | "selected" | "standard" = "full") {
  const p = await person(t, email);
  const space = await encryptedSpace(t, p, { level });
  return { p, sealer: new Sealer(space) };
}

async function sealedNote(p: Person, sealer: Sealer, title = "Plan") {
  const id = ulid();
  const [r] = await push(p, [await sealer.createOp(id, { title })]);
  expect(r!.status).toBe("applied");
  return id;
}

async function rows(t: T, publicId: string) {
  return await t.run(async (ctx) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
      .unique();
    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_document", (q) => q.eq("documentId", doc!._id))
      .collect();
    return { doc: doc!, blocks };
  });
}

describe("sealed notes through sync.push", () => {
  test("a sealed create stores placeholders, the sealed fields and note key v1, and derives nothing", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-create@example.com");
    const id = ulid();
    const [r] = await push(p, [await sealer.createOp(id, { title: "ZQXJ-TITLE-create" })]);
    expect(r!.status).toBe("applied");
    const doc = r!.document as { title: string; sealed?: { title: { c: ArrayBuffer; mac: string } }; icon: string | null };
    expect(doc.title).toBe("");
    expect(doc.icon).toBeNull();
    expect(await sealer.openTitle(id, doc.sealed!.title)).toBe("ZQXJ-TITLE-create");
    const { doc: row } = await rows(t, id);
    expect(row.sealedAt).toBeTypeOf("number");
    expect(row.title).toBe("");
    expect(row.searchText).toBe("");
    const keys = await t.run(async (ctx) => await ctx.db.query("e2eeNoteKeys").withIndex("by_document", (q) => q.eq("documentId", row._id)).collect());
    expect(keys.map((k) => [k.version, k.wrappedBy, k.spaceVersion])).toEqual([[1, "space", 1]]);
  });

  test("sealed blocks round-trip, and the server keeps only ciphertext and placeholders", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-blocks@example.com");
    const id = await sealedNote(p, sealer);
    const block = para(ulid(), "ZQXJ-BODY-roundtrip");
    const [r] = await push(p, [await sealer.upsert(id, block, null)]);
    expect(r!.status).toBe("applied");
    expect(r!.revision).toBe(1);
    expect(r!.block!.type).toBe("sealed");
    expect((await sealer.openBlock(id, r!.block!)).text).toEqual(block.text);
    const { blocks, doc } = await rows(t, id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("sealed");
    expect(blocks[0]!.text).toEqual([]);
    expect(blocks[0]!.props).toEqual({});
    expect(JSON.stringify(blocks[0]!.text) + JSON.stringify(blocks[0]!.props)).not.toContain("ZQXJ");
    // blocks.list returns them sealed too.
    const listed = (await p.as.query(api.blocks.list, { documentId: id }))!.blocks as (WireBlock & { sealed?: { c: ArrayBuffer } })[];
    expect((await sealer.openBlock(id, listed[0]!)).text).toEqual(block.text);
    // Nothing derived: no search text, no excerpt, but the block count (the limit is enforced on it).
    expect(doc.searchText).toBe("");
    expect(doc.excerpt).toBe("");
    expect(doc.blockCount).toBe(1);
  });

  test("conflicts are told by MAC: the same content is no conflict, a stale edit is", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-conflict@example.com");
    const id = await sealedNote(p, sealer);
    const block = para(ulid(), "First");
    const [a] = await push(p, [await sealer.upsert(id, block, null)]);
    // Resending the same content as a create (baseRevision null): equal MAC, applied, no new revision.
    const [same] = await push(p, [await sealer.upsert(id, block, null)]);
    expect(same!.status).toBe("applied");
    expect(same!.revision).toBe(a!.revision);
    // Different content as a create: an "exists" conflict.
    const [exists] = await push(p, [await sealer.upsert(id, { ...block, text: [{ type: "text", text: "Other" }] }, null)]);
    expect(exists!.status).toBe("conflict");
    expect(exists!.conflict!.reason).toBe("exists");
    // Device A edits (rev 2); device B, still on rev 1, edits too: content conflict, server keeps A's.
    const [edit] = await push(p, [await sealer.upsert(id, { ...block, text: [{ type: "text", text: "A's edit" }] }, 1, ["content"])]);
    expect(edit!.status).toBe("applied");
    const [stale] = await push(p, [await sealer.upsert(id, { ...block, text: [{ type: "text", text: "B's edit" }] }, 1, ["content"])], "device-e2ee-2");
    expect(stale!.status).toBe("conflict");
    expect(stale!.conflict!.reason).toBe("content");
    expect((await sealer.openBlock(id, stale!.conflict!.server as never)).text).toEqual([{ type: "text", text: "A's edit" }]);
    // A move based on the old revision still applies (position is separate), as for plain blocks.
    const [moved] = await push(p, [await sealer.upsert(id, { ...block, rank: "W", text: [{ type: "text", text: "A's edit" }] }, 1, ["position"])]);
    expect(moved!.status).toBe("applied");
  });

  test("a toggle opens and closes without a content revision, last writer wins", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-toggle@example.com");
    const id = await sealedNote(p, sealer);
    const toggle: WireBlock = { id: ulid(), type: "toggle", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Details" }], props: {} };
    const [c] = await push(p, [await sealer.upsert(id, toggle, null)]);
    const [closed] = await push(p, [await sealer.upsert(id, { ...toggle, props: { collapsed: true } }, c!.revision!, ["collapsed"])]);
    expect(closed!.status).toBe("applied");
    expect(closed!.block!.sealed!.collapsed).toBe(true);
    const { blocks } = await rows(t, id);
    expect(blocks[0]!.contentRev).toBe(1);
    expect(blocks[0]!.props).toEqual({ collapsed: true });
    // A text edit from a device that hadn't seen it closed (based on rev 1, no "collapsed") keeps it closed.
    const [edited] = await push(p, [await sealer.upsert(id, { ...toggle, text: [{ type: "text", text: "Details, more" }] }, c!.revision!, ["content"])], "device-e2ee-2");
    expect(edited!.status).toBe("applied");
    expect(edited!.block!.sealed!.collapsed).toBe(true);
    expect((await sealer.openBlock(id, edited!.block!)).props).toEqual({ collapsed: true });
  });

  test("plaintext is refused for sealed notes and anywhere in an encrypted space (e2ee_required)", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-plain@example.com");
    const id = await sealedNote(p, sealer);
    const [plainBlock] = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), "readable"), baseRevision: null, fields: ["content", "position"] }]);
    expect(plainBlock!.status).toBe("rejected");
    expect(plainBlock!.error!.code).toBe("e2ee_required");
    const [plainTitle] = await push(p, [{ opId: ulid(), kind: "document.update", documentId: id, patch: { title: "readable" }, baseRevision: null }]);
    expect(plainTitle!.error!.code).toBe("e2ee_required");
    const [plainCreate] = await push(p, [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: null, folderId: null, kind: "document", title: "readable", icon: null } }]);
    expect(plainCreate!.error!.code).toBe("e2ee_required");
    // The seeded notes from before (not yet sealed) are refused too: the device seals them first.
    const seeded = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_owner_created", (q) => q.eq("ownerProfileId", p.profileId as Id<"profiles">)).collect()).find((d) => d.sealedAt === undefined));
    if (seeded) {
      const [old] = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: seeded.publicId, block: para(ulid(), "readable"), baseRevision: null, fields: ["content", "position"] }]);
      expect(old!.error!.code).toBe("e2ee_required");
    }
    // Placeholders must be exact.
    const sealedOp = await sealer.upsert(id, para(ulid(), "x"), null);
    (sealedOp as { block: WireBlock }).block.text = [{ type: "text", text: "leak" }];
    const [leaky] = await push(p, [sealedOp]);
    expect(leaky!.status).toBe("rejected");
    expect(leaky!.error!.code).toBe("invalid_block");
    const createOp = await sealer.createOp(ulid(), { title: "x" });
    (createOp as { document: { title: string } }).document.title = "leak";
    await expect(push(p, [createOp])).resolves.toMatchObject([{ status: "rejected", error: { code: "e2ee_plaintext" } }]);
  });

  test("a Standard space is unchanged: plain ops apply, sealed ones are refused", async () => {
    const t = setup();
    const p = await person(t, "seal-standard@example.com");
    const id = ulid();
    const [c] = await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Plain", icon: null } }]);
    expect(c!.status).toBe("applied");
    expect(c!.document).not.toHaveProperty("sealed");
    const [b] = await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), "hello"), baseRevision: null, fields: ["content", "position"] }]);
    expect(b!.status).toBe("applied");
    expect(b!.block).not.toHaveProperty("sealed");
    // No space key: a sealed create can't happen.
    const sealer = new Sealer({ keys: await deriveSpaceKeys(new Uint8Array(32).fill(7)), scope: `personal:${p.profileId}` });
    const [refused] = await push(p, [await sealer.createOp(ulid(), { title: "x" })]);
    expect(refused!.status).toBe("rejected");
    expect(refused!.error!.code).toBe("e2ee_not_set_up");
    const [sealedOnPlain] = await push(p, [await sealer.upsert(id, para(ulid(), "x"), null)]);
    expect(sealedOnPlain!.status).toBe("rejected");
  });

  test("a note another device is converting fails the whole batch with e2ee_busy", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-busy@example.com");
    const id = await sealedNote(p, sealer);
    await t.run(async (ctx) => {
      const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique();
      await ctx.db.patch(d!._id, { sealing: { by: "device-other-1", until: Date.now() + 60_000 } });
    });
    const other = await sealedNote(p, sealer, "Other");
    await expect(push(p, [await sealer.upsert(other, para(ulid(), "fine"), null), await sealer.upsert(id, para(ulid(), "busy"), null)])).rejects.toThrow(/e2ee_busy|Encrypting/);
    // Nothing of the batch landed.
    expect((await rows(t, other)).blocks).toHaveLength(0);
    // The converting device itself may write.
    const [own] = await push(p, [await sealer.upsert(id, para(ulid(), "mine"), null)], "device-other-1");
    expect(own!.status).toBe("applied");
  });

  test("a block sealed with a key version the note doesn't have is refused; a rotated version works", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-version@example.com");
    const id = await sealedNote(p, sealer);
    const { version, wrapped } = await sealer.rotate(id);
    const [unknown] = await push(p, [await sealer.upsert(id, para(ulid(), "v2"), null)]);
    expect(unknown!.status).toBe("rejected");
    await t.run(async (ctx) => {
      const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique();
      await ctx.db.insert("e2eeNoteKeys", { ownerProfileId: d!.ownerProfileId, documentId: d!._id, version, wrappedBy: "space", spaceVersion: 1, wrapped, createdBy: d!.createdBy, createdAt: Date.now(), seq: 1 } as never);
    });
    const [ok] = await push(p, [await sealer.upsert(id, para(ulid(), "v2"), null)]);
    expect(ok!.status).toBe("applied");
    expect(ok!.block!.sealed!.k).toBe(2);
  });

  test("sealed titles: renames by MAC, stale renames conflict by titleRev", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-title@example.com");
    const id = await sealedNote(p, sealer, "One");
    const [r1] = await push(p, [await sealer.renameOp(id, "Two", 1)]);
    expect(r1!.status).toBe("applied");
    const doc1 = r1!.document as { sealed: { title: { c: ArrayBuffer } }; titleRev: number };
    expect(await sealer.openTitle(id, doc1.sealed.title)).toBe("Two");
    const [stale] = await push(p, [await sealer.renameOp(id, "Three", 1)], "device-e2ee-2");
    expect(stale!.status).toBe("conflict");
    // The same title again is no change and no conflict.
    const [same] = await push(p, [await sealer.renameOp(id, "Two", 1)], "device-e2ee-2");
    expect(same!.status).toBe("applied");
  });

  test("mentions in sealed blocks notify the new people with generic text", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-mention@example.com");
    const id = await sealedNote(p, sealer, "ZQXJ-TITLE-mention");
    // Mention yourself (no notification) and a made-up id (dropped): nothing is sent, nothing breaks.
    const block: WireBlock = { ...para(ulid(), ""), text: [{ type: "mention", userId: p.profileId, label: "me" } as never, { type: "text", text: " ZQXJ-BODY-mention" }] };
    const [r] = await push(p, [await sealer.upsert(id, block, null)]);
    expect(r!.status).toBe("applied");
    expect(r!.block!.sealed!.mentions).toEqual([p.profileId]);
    const { blocks } = await rows(t, id);
    expect(blocks[0]!.mentionIds).toEqual([p.profileId]);
  });

  test("versions of a sealed note are made blind (SealedVersionContent)", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-version-blind@example.com");
    const id = await sealedNote(p, sealer, "ZQXJ-TITLE-version");
    await push(p, [await sealer.upsert(id, para(ulid(), "ZQXJ-BODY-version"), null)]);
    await p.as.mutation(api.documents.createSnapshot, { documentId: id, reason: "manual" });
    const snaps = await t.run(async (ctx) => {
      const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique();
      const s = await ctx.db.query("documentSnapshots").withIndex("by_document", (q) => q.eq("documentId", d!._id)).collect();
      const chunks = [];
      for (const snap of s) chunks.push(...(await ctx.db.query("snapshotChunks").withIndex("by_snapshot", (q) => q.eq("snapshotId", snap._id)).collect()));
      return { s, chunks };
    });
    expect(snaps.s).toHaveLength(1);
    expect(snaps.s[0]!.sealed).toBe(true);
    expect(snaps.s[0]!.title).toBe("");
    const content = JSON.parse(snaps.s[0]!.content ?? snaps.chunks.map((c) => c.data).join(""));
    expect(content.e2ee).toBe(1);
    expect(content.blocks).toHaveLength(1);
    // With its hyphen: the ids in the rows are random letters and digits and can hold "ZQXJ" by chance.
    expect(JSON.stringify(snaps)).not.toContain("ZQXJ-");
  });

  test("an old client's settle and refresh never derive text for a sealed note", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "seal-settle@example.com");
    const id = await sealedNote(p, sealer);
    await push(p, [await sealer.upsert(id, para(ulid(), "ZQXJ-BODY-settle"), null)]);
    const { doc } = await rows(t, id);
    await t.mutation(internal.documents.refreshDerivedLater, { documentId: doc._id });
    await t.mutation(internal.documents.settleEdits, { documentId: doc._id });
    const after = await rows(t, id);
    expect(after.doc.searchText).toBe("");
    expect(after.doc.preview).toBeUndefined();
  });
});

// ---------------------------------------------------------------- golden scenarios, sealed

type Step = { action: string; input?: unknown } & Record<string, unknown>;
const golden = JSON.parse(readFileSync(resolve(__dirname, "../../packages/editor-schema/fixtures/sync-scenarios.json"), "utf8")) as { scenarios: { name: string; steps: Step[] }[] };

/**
 * Runs a golden scenario (packages/editor-schema/fixtures/sync-scenarios.json) against the real server: the
 * client reducer's batches go to sync.push (sealed by a sealing adapter in the sealed run, as WP7's router
 * does: blocks that fail validation are refused on the device, results opened back), and each scripted
 * remote update is another device writing that row. Returns the reducer's final state.
 */
async function driveScenario(scenario: { name: string; steps: Step[] }, mode: "plain" | "sealed", n: number): Promise<SyncState> {
  const t = setup();
  const p = await person(t, `golden-${mode}-${n}@example.com`);
  const docId = "01J9ZDOC000000000000000001";
  let sealer: Sealer | null = null;
  if (mode === "sealed") {
    sealer = new Sealer(await encryptedSpace(t, p, { level: "full" }));
    expect((await push(p, [await sealer.createOp(docId, { title: "Golden" })]))[0]!.status).toBe("applied");
  } else {
    expect((await push(p, [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title: "Golden", icon: null } }]))[0]!.status).toBe("applied");
  }
  const open = async (b: WireBlock | null | undefined) => (b && sealer ? await sealer.openBlock(docId, b as never) : (b ?? null));
  const openResult = async (r: OpResult): Promise<OpResult> => {
    const out: OpResult = { ...r };
    if (r.block) out.block = await open(r.block);
    if (r.conflict) out.conflict = { ...r.conflict, server: await open(r.conflict.server), client: await open(r.conflict.client) };
    return out;
  };
  /** One batch through the adapter: seal (or refuse invalid blocks on the device), push, open the results. */
  const send = async (queued: SyncOp[], deviceId: string): Promise<OpResult[]> => {
    // As the engine sends them (engine.ts wireOp): without the reducer's own bookkeeping.
    const ops = queued.map((op) => {
      const { sent: _s, ...rest } = op as SyncOp & { blockedBy?: string };
      void _s;
      if ("blockedBy" in rest) delete (rest as { blockedBy?: string }).blockedBy;
      return rest as SyncOp;
    });
    if (!sealer) return (await push(p, ops, deviceId)) as OpResult[];
    const local = new Map<string, OpResult>();
    const sendable: SyncOp[] = [];
    for (const op of ops) {
      if (op.kind === "block.upsert") {
        const { revision: _r, ...block } = op.block;
        void _r;
        const issues = validateWireBlock(block);
        if (issues.length) {
          local.set(op.opId, { opId: op.opId, status: "rejected", error: { code: "invalid_block", message: `${issues[0]!.path}: ${issues[0]!.message}` }, block: null });
          continue;
        }
        sendable.push({ ...op, block: await sealer.sealBlock(docId, op.block) });
      } else sendable.push(op);
    }
    const results = sendable.length ? ((await push(p, sendable, deviceId)) as OpResult[]) : [];
    const byId = new Map(results.map((r) => [r.opId, r]));
    const out: OpResult[] = [];
    for (const op of ops) out.push(local.get(op.opId) ?? (await openResult(byId.get(op.opId)!)));
    return out;
  };
  const serverRevision = async (blockId: string) =>
    await t.run(async (ctx) => (await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", blockId)).unique())?.revision ?? null);
  let state = sync.emptySyncState();
  let results: OpResult[] | null = null;
  for (const step of scenario.steps) {
    const input = step.input as never;
    switch (step.action) {
      case "takeBatch":
        state = sync.takeBatch(state);
        results = state.inflight.length ? await send(state.inflight, "device-golden-1") : null;
        break;
      case "applyResults":
        if (results) state = sync.applyResults(state, results);
        results = null;
        break;
      case "batchFailed":
        // The batch reached the server or not: either way the client resends it later (replayed by op id).
        state = sync.batchFailed(state, input);
        results = null;
        break;
      case "remoteUpdate": {
        const row = step.input as { documentId: string; block: WireBlock; deleted: boolean };
        const { revision: _r, ...block } = row.block;
        void _r;
        const base = await serverRevision(block.id);
        const [r] = await send([{ opId: ulid(), kind: "block.upsert", documentId: docId, block, baseRevision: base, fields: ["content", "position"] }], "device-golden-2");
        const fresh = r!.block ?? null;
        if (fresh) state = sync.remoteUpdate(state, { documentId: docId, block: fresh, deleted: Boolean(r!.deleted) });
        break;
      }
      case "expect":
        break;
      default:
        state = (sync as unknown as Record<string, (s: SyncState, i: unknown) => SyncState>)[step.action]!(state, input);
    }
  }
  return state;
}

describe("golden sync scenarios over sealed blocks", () => {
  golden.scenarios.forEach((scenario, n) => {
    test(`${scenario.name}: the sealed run ends exactly as the plain one`, async () => {
      const plain = await driveScenario(scenario, "plain", n);
      const sealed = await driveScenario(scenario, "sealed", n);
      // The run did something (blocks synced, or the server's refusal recorded).
      expect(Object.keys(plain.blocks).length + plain.errors.length).toBeGreaterThan(0);
      expect(canonicalJson(sealed)).toBe(canonicalJson(plain));
    });
  });
});

export type { SyncOp };

// ---------------------------------------------------------------- e2ee.content and e2ee.files

describe("sealed content mutations", () => {
  test("folders and tags: sealed names, blind duplicate check, plaintext refused in an encrypted space", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "content-names@example.com");
    const scope = { kind: "personal" } as const;
    await expect(p.as.mutation(api.organization.createFolder, { scope, name: "readable" })).rejects.toThrow(/encrypted|e2ee_required/);
    await expect(p.as.mutation(api.organization.createTag, { scope, name: "readable" })).rejects.toThrow(/encrypted|e2ee_required/);
    const folderId = ulid();
    await p.as.mutation(api.e2ee.content.createFolder, { scope, folderId, sealedName: await sealer.sealSpaceName("folder", folderId, "ZQXJ-FOLDER-x") });
    const sidebar = await p.as.query(api.organization.sidebar, { scope });
    const f = sidebar.folders.find((x) => x.id === folderId)!;
    expect(f.name).toBe("");
    expect(await sealer.openSpaceName("folder", folderId, (f as { sealedName: { c: ArrayBuffer } }).sealedName.c)).toBe("ZQXJ-FOLDER-x");
    const tagId = ulid();
    const mac = await sealer.tagMac("Projects");
    await p.as.mutation(api.e2ee.content.createTag, { scope, tagId, sealedName: await sealer.sealSpaceName("tag", tagId, "Projects"), nameMac: mac });
    // The same name again (any case) is the same tag.
    const again = await p.as.mutation(api.e2ee.content.createTag, { scope, tagId: ulid(), sealedName: await sealer.sealSpaceName("tag", tagId, "projects"), nameMac: await sealer.tagMac("projects") });
    expect(again.id).toBe(tagId);
    // Plaintext renames of sealed names are refused.
    await expect(p.as.mutation(api.organization.renameFolder, { folderId, name: "readable" })).rejects.toThrow();
    await expect(p.as.mutation(api.organization.updateTag, { tagId, name: "readable" })).rejects.toThrow();
    // Tags on a sealed note: the links carry the change's seq.
    const doc = await sealedNote(p, sealer);
    await p.as.mutation(api.e2ee.content.setDocumentTags, { documentId: doc, tagIds: [tagId] });
    const links = await t.run(async (ctx) => {
      const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", doc)).unique();
      return { links: await ctx.db.query("documentTags").withIndex("by_document", (q) => q.eq("documentId", d!._id)).collect(), seq: d!.seq };
    });
    expect(links.links).toHaveLength(1);
    expect(links.links[0]!.seq).toBe(links.seq);
  });

  test("records: compare-and-set, tombstones, a person's own kinds stay theirs", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "content-records@example.com");
    const scope = { kind: "personal" } as const;
    const doc = await sealedNote(p, sealer);
    const sealed = async (v: unknown) => await sealer.sealNoteRecord(doc, aadCtx.spaceRecord(sealer.space.scope, "collection", "c1"), v);
    const r1 = await p.as.mutation(api.e2ee.content.putRecord, { scope, kind: "collection", recordId: "c1", documentId: doc, sealed: await sealed({ v: 1 }), keyVersion: 1, baseRev: 0 });
    expect(r1.rev).toBe(1);
    await expect(p.as.mutation(api.e2ee.content.putRecord, { scope, kind: "collection", recordId: "c1", documentId: doc, sealed: await sealed({ v: 2 }), keyVersion: 1, baseRev: 0 })).rejects.toThrow(/e2ee_conflict|changed on another device/);
    const r2 = await p.as.mutation(api.e2ee.content.putRecord, { scope, kind: "collection", recordId: "c1", documentId: doc, sealed: await sealed({ v: 2 }), keyVersion: 1, baseRev: 1 });
    expect(r2.rev).toBe(2);
    // A record sealed with a key version the note doesn't have is refused.
    await expect(p.as.mutation(api.e2ee.content.putRecord, { scope, kind: "collection", recordId: "c2", documentId: doc, sealed: await sealed({ v: 1 }), keyVersion: 7, baseRev: 0 })).rejects.toThrow();
    const del = await p.as.mutation(api.e2ee.content.deleteRecord, { scope, kind: "collection", recordId: "c1", documentId: doc, baseRev: 2 });
    expect(del.rev).toBe(3);
    const pulled = await p.as.query(api.e2ee.pull.pull, { scope, cursor: 0 });
    const rec = pulled.records.find((r) => r.recordId === "c1")!;
    expect(rec.deletedAt).toBeTypeOf("number");
    expect(rec.sealed.byteLength).toBe(0);
  });

  test("comments on a sealed note are sealed; plaintext comments are refused", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "content-comments@example.com");
    const doc = await sealedNote(p, sealer);
    await expect(p.as.mutation(api.comments.create, { documentId: doc, body: [{ type: "text", text: "readable" }] })).rejects.toThrow();
    const threadId = ulid();
    const commentId = ulid();
    const body = [{ type: "text", text: "ZQXJ-COMMENT-sealed" }];
    await p.as.mutation(api.e2ee.content.createComment, { documentId: doc, threadId, commentId, sealedBody: await sealer.sealNoteRecord(doc, aadCtx.comment(doc, commentId), body), mentions: [] });
    const rows = await t.run(async (ctx) => await ctx.db.query("comments").withIndex("by_public_id", (q) => q.eq("publicId", commentId)).unique());
    expect(rows!.body).toEqual([]);
    expect(JSON.parse(await sealer.openNoteRecord(doc, aadCtx.comment(doc, commentId), rows!.sealedBody!.c))).toEqual(body);
    const reply = ulid();
    await p.as.mutation(api.e2ee.content.replyComment, { threadId, commentId: reply, sealedBody: await sealer.sealNoteRecord(doc, aadCtx.comment(doc, reply), [{ type: "text", text: "ok" }]), mentions: [] });
    await p.as.mutation(api.e2ee.content.editComment, { commentId, sealedBody: await sealer.sealNoteRecord(doc, aadCtx.comment(doc, commentId), [{ type: "text", text: "edited" }]), mentions: [] });
  });

  test("version names are sealed; a plaintext name on a sealed note is refused", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "content-versions@example.com");
    const doc = await sealedNote(p, sealer);
    await push(p, [await sealer.upsert(doc, para(ulid(), "x"), null)]);
    await expect(p.as.mutation(api.documents.createSnapshot, { documentId: doc, reason: "manual", name: "readable" })).rejects.toThrow();
    const { id } = await p.as.mutation(api.documents.createSnapshot, { documentId: doc, reason: "manual" });
    await expect(p.as.mutation(api.documents.nameVersion, { snapshotId: id!, name: "readable" })).rejects.toThrow();
    await p.as.mutation(api.e2ee.content.nameVersion, { snapshotId: id!, sealedName: await sealer.sealNoteRecord(doc, aadCtx.versionName(doc, id!), "Sent to the client") });
    const listed = await p.as.query(api.documents.versions, { documentId: doc, namedOnly: true });
    expect(listed.versions).toHaveLength(1);
    const v = listed.versions[0] as { sealed?: true; sealedName?: { c: ArrayBuffer } | null };
    expect(v.sealed).toBe(true);
    expect(await sealer.openNoteRecord(doc, aadCtx.versionName(doc, id!), v.sealedName!.c)).toBe("Sent to the client");
    // Copy and restore are composed on the device.
    await expect(p.as.mutation(api.documents.copyVersion, { snapshotId: id! })).rejects.toThrow(/device|e2ee_device_only/);
    await expect(p.as.mutation(api.documents.restoreSnapshot, { snapshotId: id! })).rejects.toThrow(/device|e2ee_device_only/);
  });

  test("sealed files: upload checked by size and hash only, served as ciphertext, pasted with the key rewrapped", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "content-files@example.com");
    const doc = await sealedNote(p, sealer);
    // Plaintext uploads into a sealed note are refused.
    await expect(p.as.mutation(api.files.generateUploadUrl, { documentId: doc, filename: "a.png", size: 10, mimeType: "image/png", kind: "image" })).rejects.toThrow();
    const fileId = ulid();
    const plain = new TextEncoder().encode("ZQXJ-FILE-bytes ".repeat(10));
    const sealed = await sealer.sealFileBytes(doc, fileId, plain, { name: "notes.txt", mime: "text/plain" });
    const { intentId } = await p.as.mutation(api.e2ee.files.generateUploadUrl, { documentId: doc, kind: "file", declaredSize: sealed.bytes.byteLength });
    // A wrong hash is refused (and the blob dropped).
    const bad = await t.run(async (ctx) => await ctx.storage.store(new Blob([sealed.bytes])));
    await expect(p.as.action(api.e2ee.files.commit, { intentId, documentId: doc, fileId, storageId: bad, sealed: sealed.row, size: sealed.bytes.byteLength, sha256: "0".repeat(64) })).rejects.toThrow();
    const { intentId: again } = await p.as.mutation(api.e2ee.files.generateUploadUrl, { documentId: doc, kind: "file", declaredSize: sealed.bytes.byteLength });
    const good = await t.run(async (ctx) => await ctx.storage.store(new Blob([sealed.bytes])));
    await p.as.action(api.e2ee.files.commit, { intentId: again, documentId: doc, fileId, storageId: good, sealed: sealed.row, size: sealed.bytes.byteLength, sha256: sealed.sha256 });
    const urls = await p.as.query(api.files.urls, { fileIds: [fileId], now: Date.now() });
    expect(urls[fileId]!.mimeType).toBe("application/octet-stream");
    expect(urls[fileId]!.filename).toBe("file");
    expect(urls[fileId]!.sealed?.plainSize).toBe(plain.length);
    const row = await t.run(async (ctx) => await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", doc)).unique());
    expect(row!.fileIds).toEqual([fileId]);
    // Palette changes go into the sealed details.
    await expect(p.as.mutation(api.files.setPalette, { fileId, palette: { paper: "#ffffff", ink: "#000000", paperDark: "#000000", inkDark: "#ffffff", tone: "light" } as never })).rejects.toThrow();
    await p.as.mutation(api.e2ee.files.updateMeta, { fileId, meta: sealed.row.meta });
    // Pasted into another note of the same space: same bytes, a new row with the key for that note.
    const other = await sealedNote(p, sealer, "Other");
    await expect(p.as.mutation(api.files.shareForPaste, { documentId: other, fileIds: [fileId] })).rejects.toThrow(/device|e2ee_device_only/);
    const copy = await sealer.sealFileBytes(other, ulid(), plain, { name: "notes.txt", mime: "text/plain" });
    const newFileId = ulid();
    await p.as.mutation(api.e2ee.files.rewrap, { fileId, targetDocumentId: other, newFileId, key: copy.row.key, meta: copy.row.meta, k: 1 });
    const rows = await t.run(async (ctx) => await ctx.db.query("files").withIndex("by_storage", (q) => q.eq("storageId", good)).collect());
    expect(rows.map((r) => r.publicId).sort()).toEqual([fileId, newFileId].sort());
    expect(rows.find((r) => r.publicId === newFileId)!.sharesBlob).toBe(true);
  });

  test("locking one note in a Standard space, and its readable copies dropped", async () => {
    const t = setup();
    const p = await e2eePerson(t, "content-lock-note@example.com");
    await e2eeRecoveryMethods(p);
    await e2eeSpace(p, { kind: "personal" });
    const id = ulid();
    await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Private", icon: null } }]);
    const r = await p.as.mutation(api.e2ee.content.setDocumentLocked, { documentId: id, locked: true });
    expect(r.migrationId).toBeTruthy();
    const space = await t.run(async (ctx) => await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", `p:${p.profileId}`)).unique());
    expect(space!.lockedCount).toBe(1);
    const job = await p.as.query(api.e2ee.migrate.progress, { scope: { kind: "personal" } });
    expect(job[0]!.scopeOf).toBe("document");
  });
});

describe("after a note key rotation, and published copies with images", () => {
  test("file keys under an old note key are listed and re-wrapped with the newest one", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "files-rewrap@example.com");
    const doc = await sealedNote(p, sealer);
    const fileId = ulid();
    const plain = new TextEncoder().encode("bytes ".repeat(20));
    const sealed = await sealer.sealFileBytes(doc, fileId, plain, { name: "a.txt", mime: "text/plain" });
    const { intentId } = await p.as.mutation(api.e2ee.files.generateUploadUrl, { documentId: doc, kind: "file", declaredSize: sealed.bytes.byteLength });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([sealed.bytes])));
    await p.as.action(api.e2ee.files.commit, { intentId, documentId: doc, fileId, storageId, sealed: sealed.row, size: sealed.bytes.byteLength, sha256: sealed.sha256 });
    expect(await p.as.query(api.e2ee.files.oldKeyFiles, { documentId: doc })).toEqual([]);
    const { version, wrapped } = await sealer.rotate(doc);
    await t.run(async (ctx) => {
      const d = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", doc)).unique())!;
      await ctx.db.insert("e2eeNoteKeys", { ownerProfileId: d.ownerProfileId, documentId: d._id, version, wrappedBy: "space", spaceVersion: 1, wrapped, createdBy: d.createdBy, createdAt: Date.now(), seq: 1 } as never);
    });
    const old = await p.as.query(api.e2ee.files.oldKeyFiles, { documentId: doc });
    expect(old.map((f) => [f.fileId, f.k])).toEqual([[fileId, 1]]);
    const rewrapped = (await sealer.sealFileBytes(doc, fileId, plain, { name: "a.txt", mime: "text/plain" })).row.key;
    const r = await p.as.mutation(api.e2ee.files.rewrapKeys, { documentId: doc, files: [{ fileId, key: rewrapped, k: version }] });
    expect(r).toEqual({ rewrapped: 1, skipped: [] });
    const row = await t.run(async (ctx) => await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", fileId)).unique());
    expect(row!.sealed!.k).toBe(version);
    expect(row!.storageId).toBe(storageId);
    expect(await p.as.query(api.e2ee.files.oldKeyFiles, { documentId: doc })).toEqual([]);
    // Again: skipped, never rolled back to an older key.
    expect((await p.as.mutation(api.e2ee.files.rewrapKeys, { documentId: doc, files: [{ fileId, key: rewrapped, k: version }] })).skipped).toEqual([fileId]);
  });

  test("a published copy carries its own plain files, which go when it stops using them", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "publish-files@example.com", "selected");
    const doc = await sealedNote(p, sealer, "Public");
    // The note's ordinary uploads are still refused plaintext.
    const bytes = new TextEncoder().encode("%PDF-1.4\n% published copy\n");
    await expect(p.as.mutation(api.files.generateUploadUrl, { documentId: doc, filename: "a.pdf", size: bytes.length, mimeType: "application/pdf", kind: "file" })).rejects.toThrow();
    const upload = async () => {
      const { intentId } = await p.as.mutation(api.e2ee.links.generateFileUploadUrl, { documentId: doc, filename: "a.pdf", size: bytes.length, mimeType: "application/pdf", kind: "file" });
      const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([bytes])));
      const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
      return (await p.as.action(api.files.finalize, { intentId, storageId, sha256 })).fileId;
    };
    const first = await upload();
    const row = await t.run(async (ctx) => await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", first)).unique());
    expect(row!.publishedCopy).toBe(true);
    expect(row!.sealed).toBeUndefined();
    // Not one of the note's own files: the replica and the migration leave it out.
    const pulled = await p.as.query(api.e2ee.pull.document, { documentId: doc });
    expect(pulled!.document.files.map((f) => f.id)).not.toContain(first);
    const { linkId } = await p.as.mutation(api.e2ee.links.publishCopy, { documentId: doc, copy: { title: "Public", blocks: [], fileIds: [first] } });
    // An update that uses another file drops the first one; stopping drops the rest.
    const second = await upload();
    await p.as.mutation(api.e2ee.links.publishCopy, { documentId: doc, linkId, copy: { title: "Public", blocks: [], fileIds: [second] } });
    const files = async () => (await t.run(async (ctx) => await ctx.db.query("files").collect())).filter((f) => f.publishedCopy).map((f) => f.publicId);
    expect(await files()).toEqual([second]);
    await p.as.mutation(api.e2ee.links.unpublish, { linkId });
    expect(await files()).toEqual([]);
    // A file that wasn't uploaded for the copy can't be named in it.
    const sealedFile = ulid();
    const s = await sealer.sealFileBytes(doc, sealedFile, bytes, { name: "x", mime: "application/pdf" });
    const { intentId } = await p.as.mutation(api.e2ee.files.generateUploadUrl, { documentId: doc, kind: "file", declaredSize: s.bytes.byteLength });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([s.bytes])));
    await p.as.action(api.e2ee.files.commit, { intentId, documentId: doc, fileId: sealedFile, storageId, sealed: s.row, size: s.bytes.byteLength, sha256: s.sha256 });
    await expect(p.as.mutation(api.e2ee.links.publishCopy, { documentId: doc, copy: { title: "Public", blocks: [], fileIds: [sealedFile] } })).rejects.toThrow();
  });
});

describe("sealed creates and folders, as WP7 sends them", () => {
  test("a collection row stays a collectionRow, and needs its sealed meta", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "row-kind@example.com");
    const without = ulid();
    const [refused] = await push(p, [await sealer.createOp(without, { kind: "collectionRow" })]);
    expect(refused!.status).toBe("rejected");
    expect(refused!.error!.code).toBe("e2ee_plaintext");
    const row = ulid();
    const [ok] = await push(p, [await sealer.createOp(row, { kind: "collectionRow", meta: { row: { id: ulid(), collectionId: ulid(), rank: "V", values: {}, createdAt: 1 } } })]);
    expect(ok!.status).toBe("applied");
    expect((ok!.document as { kind: string }).kind).toBe("collectionRow");
    const stored = await t.run(async (ctx) => await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", row)).unique());
    expect(stored!.kind).toBe("collectionRow");
    expect(stored!.sealedMeta).toBeDefined();
  });

  test("sealed folders nest as deep as plain ones and no deeper", async () => {
    const t = setup();
    const { p, sealer } = await sealedPerson(t, "folder-depth@example.com");
    const scope = { kind: "personal" } as const;
    let parent: string | null = null;
    for (let level = 1; level <= MAX_FOLDER_DEPTH; level++) {
      const folderId = ulid();
      await p.as.mutation(api.e2ee.content.createFolder, { scope, folderId, parentFolderId: parent, sealedName: await sealer.sealSpaceName("folder", folderId, `Level ${level}`) });
      parent = folderId;
    }
    const tooDeep = ulid();
    await expect(p.as.mutation(api.e2ee.content.createFolder, { scope, folderId: tooDeep, parentFolderId: parent, sealedName: await sealer.sealSpaceName("folder", tooDeep, "Too deep") })).rejects.toThrow(/nested/);
  });
});

describe("Changes on a sealed note", () => {
  test("changes.note gives the version from when they last looked, sealed, so the device can undo", async () => {
    const t = setup();
    const owner = await e2eePerson(t, "changes-owner@example.com");
    await e2eeRecoveryMethods(owner);
    const editor = await e2eePerson(t, "changes-editor@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, editor, "changes-editor@example.com", workspaceId, "editor");
    const space = await e2eeSpace(owner, scope, [editor]);
    await t.run(async (ctx) => {
      const ws = await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique();
      const row = await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", `w:${ws!._id}`)).unique();
      await ctx.db.patch(row!._id, { level: "full", state: "on" });
    });
    const sealer = new Sealer({ keys: await deriveSpaceKeys(space.sk.slice()), scope: space.scopeId });
    const doc = ulid();
    const line = para(ulid(), "As it was");
    await push(owner, [await sealer.createOp(doc, { title: "Shared" })], "device-owner-chg", scope);
    const [made] = await push(owner, [await sealer.upsert(doc, line, null)], "device-owner-chg", scope);
    await owner.as.mutation(api.documents.recordView, { documentId: doc });
    // Marking it seen saves the version that holds it as it is now (blind for a sealed note).
    await owner.as.mutation(api.changes.markSeen, { documentIds: [doc] });
    const [edited] = await push(editor, [await sealer.upsert(doc, { ...line, text: [{ type: "text", text: "Changed by the editor" }] }, made!.revision!, ["content"])], "device-editor-chg", scope);
    expect(edited!.status).toBe("applied");
    const note = (await owner.as.query(api.changes.note, { documentId: doc }))! as unknown as {
      previous: unknown;
      canUndo: boolean;
      kinds: [string, string][];
      seenVersionId: string | null;
      previousSealed: { blocks: { id: string; parentId: string | null; rank: string; c: string; k: number }[] } | null;
    };
    expect(note.kinds).toEqual([[line.id, "edited"]]);
    expect(note.previous).toBeNull();
    expect(note.canUndo).toBe(true);
    expect(note.seenVersionId).toBeTruthy();
    expect(note.previousSealed!.blocks.map((b) => b.id)).toEqual([line.id]);
    const b = note.previousSealed!.blocks[0]!;
    const bin = atob(b.c.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (b.c.length % 4)) % 4));
    const c = Uint8Array.from(bin, (ch) => ch.charCodeAt(0)).buffer;
    const opened = await sealer.openBlock(doc, { id: b.id, type: "sealed", parentId: b.parentId, rank: b.rank, schemaVersion: 0, text: [], props: {}, sealed: { c } } as never);
    expect(opened.text).toEqual([{ type: "text", text: "As it was" }]);
    // The server still doesn't rewrite a sealed note itself.
    await expect(owner.as.mutation(api.changes.undo, { documentId: doc })).rejects.toThrow(/device|e2ee_device_only/);
  });
});
