// Security audit 2026-11-26, the smaller holes: uploads can't claim or delete stored bytes that are a file's,
// deleted text stays with the people who can edit, Trash never reaches or opens up restricted pages, a
// collection is copied only with its page, copies of restricted pages stay restricted, and presence and
// imports are bounded.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function newPage(p: Person, scope: ScopeArg, title = "Page", parentDocumentId?: string) {
  const { id } = await p.as.mutation(api.documents.create, { scope, title, ...(parentDocumentId ? { parentDocumentId } : {}) });
  return id;
}

async function write(p: Person, documentId: string, blocks: WireBlock[]) {
  const results = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-audit",
    ops: blocks.map((block) => ({ opId: ulid(), kind: "block.upsert" as const, documentId, block, baseRevision: null, fields: ["content" as const, "position" as const] })),
  });
  for (const r of results) expect(r.status).toBe("applied");
}

async function world(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const member = await person(t, `${prefix}-member@example.com`);
  const ally = await person(t, `${prefix}-ally@example.com`);
  const viewer = await person(t, `${prefix}-viewer@example.com`);
  const { workspaceId, scope } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, member, `${prefix}-member@example.com`, workspaceId, "editor");
  await join(t, owner, ally, `${prefix}-ally@example.com`, workspaceId, "editor");
  await join(t, owner, viewer, `${prefix}-viewer@example.com`, workspaceId, "viewer");
  return { owner, member, ally, viewer, workspaceId, scope, memberEmail: `${prefix}-member@example.com` };
}

const accessOf = async (p: Person, documentId: string) => (await p.as.query(api.documents.get, { documentId }))?.access ?? "none";
const docRow = async (t: T, publicId: string) => await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const store = async (t: T, bytes: Uint8Array) => await t.run(async (ctx) => await ctx.storage.store(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "text/plain" })));
const stored = async (t: T, storageId: Id<"_storage">) => await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null);

describe("files.finalize and stored bytes that are already a file's", () => {
  test("it neither deletes them nor takes them as a new upload", async () => {
    const t = setup();
    const victim = await person(t, "bytes-victim@example.com");
    const attacker = await person(t, "bytes-attacker@example.com");
    const content = bytesOf("The victim's contract, in full.");
    const note = await newPage(victim, PERSONAL, "Contract");
    const first = await victim.as.mutation(api.files.generateUploadUrl, { documentId: note, filename: "contract.txt", size: content.length, mimeType: "text/plain", kind: "file" });
    const storageId = await store(t, content);
    const { fileId } = await victim.as.action(api.files.finalize, { intentId: first.intentId, storageId, sha256: await sha256(content) });
    // Someone names the same stored bytes with an upload of their own that can't pass: they used to be deleted.
    const bad = await attacker.as.mutation(api.files.generateUploadUrl, { scope: PERSONAL, filename: "x.txt", size: 3, mimeType: "text/plain", kind: "file" });
    await expect(attacker.as.action(api.files.finalize, { intentId: bad.intentId, storageId, sha256: "0".repeat(64) })).rejects.toThrow();
    expect(await stored(t, storageId)).toBe(true);
    // Nor with an intent that's used up or was never theirs.
    await expect(attacker.as.action(api.files.finalize, { intentId: first.intentId, storageId, sha256: await sha256(content) })).rejects.toThrow();
    expect(await stored(t, storageId)).toBe(true);
    // Knowing what the bytes are doesn't make them a second file either.
    const claim = await attacker.as.mutation(api.files.generateUploadUrl, { scope: PERSONAL, filename: "mine.txt", size: content.length, mimeType: "text/plain", kind: "file" });
    await expect(attacker.as.action(api.files.finalize, { intentId: claim.intentId, storageId, sha256: await sha256(content) })).rejects.toThrow(/expired/i);
    expect(await t.run(async (ctx) => (await ctx.db.query("files").withIndex("by_storage", (q) => q.eq("storageId", storageId)).collect()).map((f) => f.publicId))).toEqual([fileId]);
    expect(await stored(t, storageId)).toBe(true);
  });

  test("an upload of one's own that fails is still cleaned up, and a good one goes through", async () => {
    const t = setup();
    const p = await person(t, "bytes-own@example.com");
    const content = bytesOf("Fresh bytes");
    const bad = await p.as.mutation(api.files.generateUploadUrl, { scope: PERSONAL, filename: "a.txt", size: content.length, mimeType: "text/plain", kind: "file" });
    const badBytes = await store(t, content);
    await expect(p.as.action(api.files.finalize, { intentId: bad.intentId, storageId: badBytes, sha256: "0".repeat(64) })).rejects.toThrow(/damaged/);
    expect(await stored(t, badBytes)).toBe(false);
    const good = await p.as.mutation(api.files.generateUploadUrl, { scope: PERSONAL, filename: "a.txt", size: content.length, mimeType: "text/plain", kind: "file" });
    const goodBytes = await store(t, content);
    expect((await p.as.action(api.files.finalize, { intentId: good.intentId, storageId: goodBytes, sha256: await sha256(content) })).size).toBe(content.length);
  });
});

describe("deleted text is for people who can edit the page", () => {
  test("someone who can only read gets no deleted block's content, from the list or from a pull", async () => {
    const t = setup();
    const w = await world(t, "gone");
    const page = await newPage(w.owner, w.scope, "Minutes");
    const kept = ulid();
    const removed = ulid();
    await write(w.owner, page, [para(kept, "Still here"), para(removed, "Said in confidence", "W")]);
    await w.owner.as.mutation(api.sync.push, { scope: w.scope, deviceId: "device-audit", ops: [{ opId: ulid(), kind: "block.delete", documentId: page, blockId: removed, baseRevision: null }] });

    expect(await w.viewer.as.query(api.blocks.deleted, { documentId: page })).toEqual([]);
    expect((await w.member.as.query(api.blocks.deleted, { documentId: page })).map((b) => b.id)).toEqual([removed]);

    for (const pull of [api.sync.pull, api.sync.pullAll] as const) {
      const seen = (await w.viewer.as.query(pull, { scope: w.scope, cursor: 0 })).blocks.filter((b) => b.documentId === page);
      expect(JSON.stringify(seen)).not.toContain("Said in confidence");
      const gone = seen.find((b) => b.block.id === removed)!;
      // The same shape as ever (devices parse it), with nothing in it.
      expect(gone.deleted).toBe(true);
      expect(gone.block).toMatchObject({ id: removed, type: "paragraph", parentId: null, rank: "W", text: [], props: {} });
      expect(Object.keys(gone.block).sort()).toEqual(["id", "parentId", "props", "rank", "revision", "schemaVersion", "text", "type"]);
      expect(seen.find((b) => b.block.id === kept)!.block.text).toEqual([{ type: "text", text: "Still here" }]);
      // An editor's device still gets what the line said (it can offer to bring it back).
      const full = (await w.member.as.query(pull, { scope: w.scope, cursor: 0 })).blocks.find((b) => b.block.id === removed)!;
      expect(full.block.text).toEqual([{ type: "text", text: "Said in confidence" }]);
    }
    const json = JSON.parse(await w.viewer.as.query(api.sync.pullJson, { scope: w.scope, cursor: 0 })) as { blocks: unknown[] };
    expect(JSON.stringify(json.blocks)).not.toContain("Said in confidence");
  });
});

describe("Trash and restricted pages", () => {
  test("restoring a page on its own doesn't take it out of a restricted page for someone who doesn't manage it", async () => {
    const t = setup();
    const w = await world(t, "lift");
    const figures = await newPage(w.owner, w.scope, "Figures");
    const board = await newPage(w.owner, w.scope, "Board");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: board, mode: "restricted" });
    await w.owner.as.mutation(api.documents.move, { documentId: figures, parentDocumentId: board });
    await w.owner.as.mutation(api.sharing.grant, { documentId: board, email: w.memberEmail, role: "editor" });
    expect(await accessOf(w.ally, figures)).toBe("none");
    // An invited editor (not a manager) trashes the restricted page, then restores the sub-page alone.
    await w.member.as.mutation(api.documents.moveToTrash, { documentId: board });
    await expect(w.member.as.mutation(api.documents.restoreFromTrash, { documentId: figures })).rejects.toThrow(/restricted page that's in Trash/);
    expect(await w.member.as.mutation(api.documents.bulkUpdate, { documentIds: [figures], action: { kind: "restore" } })).toMatchObject({ done: [], skipped: 1 });
    expect((await docRow(t, figures)).inTrash).toBe(true);
    expect(await accessOf(w.ally, figures)).toBe("none");
    // Restoring the restricted page brings both back as they were; a manager may restore the sub-page alone.
    await w.member.as.mutation(api.documents.restoreFromTrash, { documentId: board });
    expect((await docRow(t, figures)).inTrash).toBe(false);
    expect(await accessOf(w.ally, figures)).toBe("none");
    await w.owner.as.mutation(api.documents.moveToTrash, { documentId: board });
    await w.owner.as.mutation(api.documents.restoreFromTrash, { documentId: figures });
    expect((await docRow(t, figures)).parentDocumentId).toBeUndefined();
  });

  test("trashing a page leaves a restricted sub-page its trasher can't edit, and deleting never takes one", async () => {
    const t = setup();
    const w = await world(t, "reach");
    const wiki = await newPage(w.member, w.scope, "Wiki");
    const open = await newPage(w.member, w.scope, "Open sub-page", wiki);
    const pay = await newPage(w.owner, w.scope, "Pay", wiki);
    const payDetail = await newPage(w.owner, w.scope, "Pay detail", pay);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: pay, mode: "restricted" });
    expect(await accessOf(w.member, pay)).toBe("none");
    await w.member.as.mutation(api.documents.moveToTrash, { documentId: wiki });
    expect((await docRow(t, wiki)).inTrash).toBe(true);
    expect((await docRow(t, open)).inTrash).toBe(true);
    // The restricted page stays, out from under the trashed page, still closed; its own sub-page with it.
    const kept = await docRow(t, pay);
    expect(kept).toMatchObject({ inTrash: false, accessMode: "restricted" });
    expect(kept.parentDocumentId).toBeUndefined();
    expect((await docRow(t, payDetail)).inTrash).toBe(false);
    expect(await accessOf(w.owner, payDetail)).toBe("manage");
    expect(await accessOf(w.member, pay)).toBe("none");
    expect(await accessOf(w.ally, payDetail)).toBe("none");

    // A trashed tree that still holds such a page (older data): its creator can't delete it for good.
    const old = await newPage(w.member, w.scope, "Old wiki");
    const hidden = await newPage(w.owner, w.scope, "Hidden", old);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: hidden, mode: "restricted" });
    await t.run(async (ctx) => {
      const stamp = Date.now();
      for (const id of [old, hidden]) {
        const d = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!;
        await ctx.db.patch(d._id, { inTrash: true, deletedAt: stamp });
      }
    });
    await expect(w.member.as.mutation(api.documents.deletePermanently, { documentId: old, confirmTitle: "Old wiki" })).rejects.toThrow(/delete permanently/);
    expect(await w.member.as.mutation(api.documents.bulkUpdate, { documentIds: [old], action: { kind: "delete" } })).toMatchObject({ done: [], skipped: 1 });
    expect((await w.member.as.query(api.documents.trashSummary, { scope: w.scope })).deletable).toBe(2);
    // The page they trashed themselves, with only pages they can edit under it, they can delete.
    await w.member.as.mutation(api.documents.deletePermanently, { documentId: wiki, confirmTitle: "Wiki" });
  });
});

describe("a collection is copied only with a page the person can open", () => {
  const collectionBlock = (collectionId: string): WireBlock => ({ id: ulid(), type: "collection", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [], props: { collectionId } });

  test("naming someone else's collection in a block copies nothing of it", async () => {
    const t = setup();
    const victim = await person(t, "coll-victim@example.com");
    const attacker = await person(t, "coll-attacker@example.com");
    const { scope } = await teamWorkspace(attacker, "Attacker team");
    const hr = await newPage(victim, PERSONAL, "HR");
    const { collectionId } = await victim.as.mutation(api.collections.create, { documentId: hr, name: "Dismissals" });
    await victim.as.mutation(api.collections.addProperty, { collectionId, name: "Severance amount", type: "number" });
    const mine = await newPage(attacker, PERSONAL, "Mine");
    await write(attacker, mine, [collectionBlock(collectionId)]);

    const dup = await attacker.as.mutation(api.documents.duplicate, { documentId: mine });
    const made = await t.run(async (ctx) => (await ctx.db.query("collections").collect()).filter((c) => c.name === "Dismissals"));
    expect(made).toHaveLength(1);
    const block = (await attacker.as.query(api.blocks.list, { documentId: dup.id }))!.blocks.find((b) => b.type === "collection")!;
    await expect(attacker.as.query(api.collections.get, { collectionId: (block.props as { collectionId: string }).collectionId })).rejects.toThrow(/not found/i);

    const copy = await attacker.as.mutation(api.copies.copyTo, { documentId: mine, destination: scope });
    const blocks = (await attacker.as.query(api.blocks.list, { documentId: copy.id }))!.blocks;
    expect(JSON.stringify(blocks)).not.toContain("Severance amount");

    // One's own collection is still copied with the page.
    const { collectionId: own } = await attacker.as.mutation(api.collections.create, { documentId: mine, name: "Audit shelf" });
    await write(attacker, mine, [{ ...collectionBlock(own), rank: "W" }]);
    await attacker.as.mutation(api.documents.duplicate, { documentId: mine });
    expect(await t.run(async (ctx) => (await ctx.db.query("collections").collect()).filter((c) => c.name === "Audit shelf").length)).toBe(2);
  });
});

describe("a copy of a restricted page stays restricted", () => {
  test("Duplicate and a copy of a version are never more open than the page", async () => {
    const t = setup();
    const w = await world(t, "dup");
    const secret = await newPage(w.owner, w.scope, "Secret");
    await write(w.owner, secret, [para(ulid(), "Numbers")]);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    const inner = await newPage(w.owner, w.scope, "Inner", secret);
    await w.owner.as.mutation(api.sharing.grant, { documentId: secret, email: w.memberEmail, role: "viewer" });
    // A viewer of the restricted page duplicates it: the copy is theirs, and closed to everyone else.
    const dup = await w.member.as.mutation(api.documents.duplicate, { documentId: secret });
    expect((await docRow(t, dup.id)).accessMode).toBe("restricted");
    expect(await accessOf(w.member, dup.id)).toBe("manage");
    expect(await accessOf(w.ally, dup.id)).toBe("none");
    const template = await w.member.as.mutation(api.documents.duplicate, { documentId: inner, asTemplate: true });
    expect(await accessOf(w.ally, template.id)).toBe("none");
    expect(await accessOf(w.member, template.id)).toBe("manage");
    // A copy next to a page inside the restriction stays inside it; with a grant on that page alone, the
    // person keeps on the copy the access they had on the original.
    const w2 = await world(t, "dup2");
    const board = await newPage(w2.owner, w2.scope, "Board");
    await w2.owner.as.mutation(api.sharing.setAccessMode, { documentId: board, mode: "restricted" });
    const minutes = await newPage(w2.owner, w2.scope, "Minutes", board);
    await write(w2.owner, minutes, [para(ulid(), "Agreed")]);
    await w2.owner.as.mutation(api.sharing.grant, { documentId: minutes, email: w2.memberEmail, role: "editor" });
    const copy = await w2.member.as.mutation(api.documents.duplicate, { documentId: minutes });
    expect(await accessOf(w2.member, copy.id)).toBe("write");
    expect(await accessOf(w2.ally, copy.id)).toBe("none");
    expect(await accessOf(w2.member, board)).toBe("none");
    const { id: versionId } = await w2.member.as.mutation(api.documents.createSnapshot, { documentId: minutes, reason: "manual" });
    const fromVersion = await w2.member.as.mutation(api.documents.copyVersion, { snapshotId: versionId! });
    expect(await accessOf(w2.member, fromVersion.id)).toBe("write");
    expect(await accessOf(w2.ally, fromVersion.id)).toBe("none");
  });
});

describe("presence and imports are bounded", () => {
  test("one person holds a few presence rows in a note, and session and block ids are short", async () => {
    const t = setup();
    const w = await world(t, "here");
    const page = await newPage(w.owner, w.scope, "Busy page");
    for (let i = 0; i < 20; i++) {
      await w.viewer.as.mutation(api.presence.heartbeat, { documentId: page, sessionId: `session-${i}`, focusedBlockId: "x".repeat(500) });
      await w.viewer.as.mutation(api.presence.setCursor, { documentId: page, sessionId: `session-${i}`, cursor: { anchor: { blockId: "b1", offset: 0 }, head: { blockId: "b1", offset: 0 } } });
    }
    const rows = await t.run(async (ctx) => ({ presence: await ctx.db.query("presence").collect(), cursors: await ctx.db.query("presenceCursors").collect() }));
    expect(rows.presence).toHaveLength(5);
    expect(rows.cursors).toHaveLength(5);
    expect(rows.presence.every((r) => r.focusedBlockId === undefined)).toBe(true);
    await expect(w.viewer.as.mutation(api.presence.heartbeat, { documentId: page, sessionId: "s".repeat(65) })).rejects.toThrow(/Not a session/);
    // Others are still seen.
    await w.member.as.mutation(api.presence.heartbeat, { documentId: page, sessionId: "member-session", focusedBlockId: "b1" });
    expect((await w.owner.as.query(api.presence.list, { documentId: page, now: Date.now() })).map((p) => p.profileId).sort()).toEqual([w.member.profileId, w.viewer.profileId].sort());
  });

  test("importing notes has a budget of its own (a whole library, not without end)", async () => {
    const t = setup();
    const p = await person(t, "import-limit@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("systemSettings", { key: "rate_limits", value: { importNote: { limit: 3, windowMs: 60 * 60_000 } }, updatedAt: Date.now() });
    });
    const importOne = (i: number) => p.as.mutation(api.imports.importText, { scope: PERSONAL, filename: `n${i}.md`, content: "# Note\n\nText", format: "markdown" });
    for (let i = 0; i < 3; i++) await importOne(i);
    await expect(importOne(3)).rejects.toThrow(/rate_limited|Too many/);
  });
});
