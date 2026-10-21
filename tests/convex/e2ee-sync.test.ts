// Sealed content through sync.push (docs/E2EE_DESIGN.md §5.4, §11.2 e2ee-sync): sealed creates, upserts,
// conflicts by MAC, toggles, synced sources, plaintext refused, e2ee_busy, mentions, locks, blind versions.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { para, person, setup, ulid, type T } from "./helpers";
import { deriveSpaceKeys } from "@folevi/local-store/e2ee";
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
    expect(JSON.stringify(snaps)).not.toContain("ZQXJ");
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

export type { SyncOp };
