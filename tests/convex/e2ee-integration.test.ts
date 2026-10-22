// Cross-package follow-ups of the server-side E2EE integration (docs/E2EE_DESIGN.md §5, "Settled during
// server integration"): pull paging folders and tags by seq, account deletion of a guest's keys and records
// in other people's spaces, notification previews for sealed mentions and comments, published copies served
// through e2ee.links, purgeDocument with WP5's helpers, the sealed Inbox, and Foli AI reading a sealed image
// from bytes the device sends.
import { afterEach, describe, expect, test } from "vitest";
import { inboxDocumentId, scopeIdKey, SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { ctx as aad } from "@folevi/local-store/e2ee";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { e2eePerson, e2eeRecoveryMethods, e2eeSpace, para, person, PERSONAL, setup, ulid, type T } from "./helpers";
import { encryptedSpace, push, Sealer } from "./e2ee-fixtures";
import { docId, encryptScope, gemini, mirror, note, sealDoc, setSwitches, stopGemini } from "./e2ee-ai-helpers";

afterEach(() => stopGemini());

const dataOf = (e: unknown) => (e as { data?: Record<string, unknown> }).data;

async function sharedWith(t: T, documentPublicId: string, profileId: string) {
  await t.run(async (ctx) => {
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentPublicId)).unique())!;
    await ctx.db.insert("documentPermissions", { documentId: doc._id, ownerProfileId: doc.ownerProfileId, profileId: profileId as Id<"profiles">, role: "editor", grantedBy: doc.createdBy, createdAt: Date.now() });
  });
}

async function notificationsOf(t: T, profileId: string): Promise<Doc<"notifications">[]> {
  return await t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", profileId as Id<"profiles">)).collect());
}

async function markAllRead(t: T, profileId: string) {
  await t.run(async (ctx) => {
    for (const n of await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", profileId as Id<"profiles">)).collect()) await ctx.db.patch(n._id, { readAt: Date.now() });
  });
}

describe("e2ee.pull pages folders and tags by seq", () => {
  test("a small limit pages folders and tags like the other tables, and nothing is read twice", async () => {
    const t = setup();
    const a = await person(t, "pull-folders@example.com");
    const space = await encryptedSpace(t, a, { level: "full" });
    const sealer = new Sealer(space);
    const folderIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const folderId = ulid();
      folderIds.push(folderId);
      await a.as.mutation(api.e2ee.content.createFolder, { scope: PERSONAL, folderId, sealedName: await sealer.sealSpaceName("folder", folderId, `F${i}`) });
    }
    const tagId = ulid();
    await a.as.mutation(api.e2ee.content.createTag, { scope: PERSONAL, tagId, sealedName: await sealer.sealSpaceName("tag", tagId, "T"), nameMac: await sealer.tagMac("T"), color: "moss" });
    const seen: string[] = [];
    const tags: string[] = [];
    let cursor = 0;
    for (let i = 0; i < 20; i++) {
      const page = await a.as.query(api.e2ee.pull.pull, { scope: PERSONAL, cursor, limit: 2 });
      seen.push(...page.folders.map((f) => f.id));
      tags.push(...page.tags.map((x) => x.id));
      expect(page.folders.length).toBeLessThanOrEqual(2);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    // Every new folder once (the Personal's starter folders come too), nothing twice.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((f) => folderIds.includes(f)).sort()).toEqual([...folderIds].sort());
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain(tagId);
    // A later pull from the end sees nothing new.
    const after = await a.as.query(api.e2ee.pull.pull, { scope: PERSONAL, cursor, limit: 2 });
    expect(after.folders).toEqual([]);
    expect(after.tags).toEqual([]);
  });
});

describe("account deletion reaches other people's spaces", () => {
  test("a deleted person's note keys as a guest and their own records in someone else's space go; the space's own rows stay", async () => {
    const t = setup();
    const a = await person(t, "owner-space@example.com");
    const b = await person(t, "guest-leaving@example.com");
    const id = await note(a, "Shared", ["Hello"]);
    await sealDoc(t, id);
    await encryptScope(t, a);
    const row = await docId(t, id);
    await t.run(async (ctx) => {
      const owner = a.profileId as Id<"profiles">;
      const base = { ownerProfileId: owner, documentId: row, version: 1, wrapped: new ArrayBuffer(97), createdBy: owner, createdAt: Date.now(), seq: 1 };
      await ctx.db.insert("e2eeNoteKeys", { ...base, wrappedBy: "space", spaceVersion: 1 });
      await ctx.db.insert("e2eeNoteKeys", { ...base, wrappedBy: "grant", profileId: b.profileId as Id<"profiles"> });
      const rec = { ownerProfileId: owner, keyVersion: 1, sealed: new ArrayBuffer(40), size: 40, rev: 1, updatedAt: Date.now(), seq: 1 };
      await ctx.db.insert("e2eeRecords", { ...rec, kind: "aiChat", recordId: "chat-b", profileId: b.profileId as Id<"profiles">, updatedBy: b.profileId as Id<"profiles"> });
      await ctx.db.insert("e2eeRecords", { ...rec, kind: "collection", recordId: "col-a", documentId: row, updatedBy: owner });
      await ctx.db.patch(b.profileId as Id<"profiles">, { status: "pending_deletion" });
      await ctx.db.insert("deletionJobs", { kind: "account", targetId: b.profileId, requestedBy: b.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: Date.now() - 1, status: "scheduled", progress: 0, createdAt: Date.now() });
    });
    for (let i = 0; i < 20; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const left = await t.run(async (ctx) => ({
      keys: (await ctx.db.query("e2eeNoteKeys").collect()).map((k) => k.wrappedBy),
      records: (await ctx.db.query("e2eeRecords").collect()).map((r) => r.recordId),
    }));
    expect(left).toEqual({ keys: ["space"], records: ["col-a"] });
  });

  test("an E2EE identity goes with the account: keys, wraps, devices and approvals", async () => {
    const t = setup();
    const p = await e2eePerson(t, "leaving-keys@example.com");
    await e2eeRecoveryMethods(p);
    await p.as.mutation(api.e2ee.devices.requestApproval, { deviceId: ulid(), kind: "browser", label: "New", x25519Pub: new ArrayBuffer(32), ed25519Pub: new ArrayBuffer(32), commit: new ArrayBuffer(32) });
    await t.run(async (ctx) => {
      await ctx.db.patch(p.profileId as Id<"profiles">, { status: "pending_deletion" });
      await ctx.db.insert("deletionJobs", { kind: "account", targetId: p.profileId, requestedBy: p.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: Date.now() - 1, status: "scheduled", progress: 0, createdAt: Date.now() });
    });
    for (let i = 0; i < 20; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const counts = await t.run(async (ctx) => ({
      accounts: (await ctx.db.query("e2eeAccounts").collect()).length,
      wraps: (await ctx.db.query("e2eeAccountWraps").collect()).length,
      devices: (await ctx.db.query("e2eeDevices").collect()).length,
      approvals: (await ctx.db.query("e2eeApprovals").collect()).length,
    }));
    expect(counts).toEqual({ accounts: 0, wraps: 0, devices: 0, approvals: 0 });
  });
});

describe("notification previews for sealed mentions and comments (§7.7)", () => {
  async function sealedShared(t: T) {
    const a = await person(t, "preview-a@example.com");
    const b = await person(t, "preview-b@example.com");
    const space = await encryptedSpace(t, a, { level: "selected" });
    const sealer = new Sealer(space);
    const id = ulid();
    await push(a, [await sealer.createOp(id, { title: "Plan" })]);
    await sharedWith(t, id, b.profileId);
    return { a, b, sealer, id };
  }

  async function mention(a: { as: unknown; profileId: string }, sealer: Sealer, id: string, who: string) {
    const block: WireBlock = { id: ulid(), type: "paragraph", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [{ type: "mention", userId: who, label: "B" } as never, { type: "text", text: " ask Sam" }], props: {} };
    const op = (await sealer.upsert(id, block, null)) as { block: { sealed: Record<string, unknown> } };
    op.block.sealed.mentionPreview = { title: "Plan", line: "Ask Sam about the ferry" };
    await push(a as never, [op as never]);
  }

  test("a mention in a sealed block: generic text with previews off, the device's preview with them on", async () => {
    const t = setup();
    const { a, b, sealer, id } = await sealedShared(t);
    await mention(a, sealer, id, b.profileId);
    let [n] = await notificationsOf(t, b.profileId);
    expect(n).toMatchObject({ kind: "mention", sealedDocument: true });
    expect(n!.title).toMatch(/mentioned you in a note$/);
    expect(n!.body).toBeUndefined();
    await markAllRead(t, b.profileId);
    await setSwitches(t, `p:${a.profileId}`, { notificationPreviews: true });
    await mention(a, sealer, id, b.profileId);
    n = (await notificationsOf(t, b.profileId)).find((x) => !x.readAt);
    expect(n!.title).toMatch(/mentioned you in Plan$/);
    expect(n!.body).toBe("Ask Sam about the ferry");
    // A locked note never shows a preview.
    await markAllRead(t, b.profileId);
    const rowId = await docId(t, id);
    await t.run(async (ctx) => ctx.db.patch(rowId, { locked: true }));
    await mention(a, sealer, id, b.profileId);
    n = (await notificationsOf(t, b.profileId)).find((x) => !x.readAt);
    expect(n!.title).toMatch(/mentioned you in a note$/);
  });

  test("a sealed comment's mention: the preview only with previews on", async () => {
    const t = setup();
    const { a, b, sealer, id } = await sealedShared(t);
    const comment = async () => {
      const threadId = ulid();
      const commentId = ulid();
      await a.as.mutation(api.e2ee.content.createComment, {
        documentId: id,
        threadId,
        commentId,
        sealedBody: await sealer.sealNoteRecord(id, aad.comment(id, commentId), [{ type: "text", text: "Looks good" }]),
        mentions: [b.profileId],
        preview: { title: "Plan", excerpt: "Looks good" },
      });
    };
    await comment();
    let n = (await notificationsOf(t, b.profileId)).find((x) => x.kind === "mention")!;
    expect(n.title).toMatch(/mentioned you in a note$/);
    expect(n.body).toBeUndefined();
    await markAllRead(t, b.profileId);
    await setSwitches(t, `p:${a.profileId}`, { notificationPreviews: true });
    await comment();
    n = (await notificationsOf(t, b.profileId)).find((x) => x.kind === "mention" && !x.readAt)!;
    expect(n.title).toMatch(/mentioned you in Plan$/);
    expect(n.body).toBe("Looks good");
  });
});

describe("published copies (§9.3) through e2ee.links", () => {
  const collection = {
    name: "Trips",
    viewType: "table" as const,
    config: {},
    properties: [{ id: "p1", name: "Name", type: "text", options: null }],
    rows: [{ id: "r1", title: "Lisbon", icon: null, values: { p1: "Lisbon" } }],
  };

  async function publishedNote(t: T) {
    const a = await person(t, "publish-copy@example.com");
    const id = await note(a, "Private", ["Secret"]);
    await sealDoc(t, id);
    await encryptScope(t, a);
    const block = { ...para(ulid(), "Published words"), type: "collection", props: { collectionId: "col-1" }, text: [] };
    const published = await a.as.mutation(api.e2ee.links.publishCopy, { documentId: id, copy: { title: "Public", blocks: [para(ulid(), "Published words"), block as WireBlock], collections: { "col-1": collection } } });
    return { a, id, published };
  }

  test("sharing.openPublicLink serves what publishCopy stored: { blocks, collections }", async () => {
    const t = setup();
    const { published } = await publishedNote(t);
    const res = await t.mutation(api.sharing.openPublicLink, { token: published.token!, serverSecret: "a".repeat(64), clientKey: "test" });
    expect(res.status).toBe("ok");
    const ok = res as { document: { title: string }; blocks: WireBlock[]; collections: Record<string, { name: string; rows: unknown[] }> };
    expect(ok.document.title).toBe("Public");
    expect(ok.blocks.map((b) => b.type)).toEqual(["paragraph", "collection"]);
    expect(ok.collections["col-1"]).toMatchObject({ name: "Trips", rows: [{ title: "Lisbon" }] });
    const stored = await t.run(async (ctx) => JSON.parse((await ctx.db.query("e2eePublishedChunks").collect()).map((c) => c.data).join("")) as Record<string, unknown>);
    expect(Object.keys(stored).sort()).toEqual(["blocks", "collections", "fileIds"]);
  });

  test("deleting the note for good removes its readable copies and its published copies with their chunks", async () => {
    const t = setup();
    const { a, id } = await publishedNote(t);
    await setSwitches(t, `p:${a.profileId}`, { searchEverywhere: true });
    await mirror(t, id, "search", { title: "Private", text: "Secret" });
    const rowId = await docId(t, id);
    await t.run(async (ctx) => ctx.db.patch(rowId, { inTrash: true, deletedAt: Date.now() }));
    await a.as.mutation(api.documents.deletePermanently, { documentId: id, confirmTitle: "sealed" });
    for (let i = 0; i < 10; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const left = await t.run(async (ctx) => ({
      mirrors: (await ctx.db.query("e2eeMirrors").collect()).length,
      copies: (await ctx.db.query("e2eePublishedCopies").collect()).length,
      chunks: (await ctx.db.query("e2eePublishedChunks").collect()).length,
      doc: await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique(),
    }));
    expect(left).toEqual({ mirrors: 0, copies: 0, chunks: 0, doc: null });
  });
});

describe("the sealed Inbox", () => {
  test("encrypting a Personal names its existing Inbox; Quick Add then finds it without a title", async () => {
    const t = setup();
    const a = await e2eePerson(t, "inbox-enable@example.com");
    const { documentId } = await a.as.mutation(api.tasks.inbox, { scope: PERSONAL });
    await e2eeRecoveryMethods(a);
    await e2eeSpace(a, PERSONAL);
    await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "full", switches: { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false } });
    const named = await t.run(async (ctx) => {
      const space = (await ctx.db.query("e2eeSpaces").collect())[0]!;
      return space.inboxDocumentId ? (await ctx.db.get(space.inboxDocumentId))!.publicId : null;
    });
    expect(named).toBe(documentId);
    expect((await a.as.mutation(api.tasks.inbox, { scope: PERSONAL })).documentId).toBe(documentId);
  });

  test("with no Inbox yet, the server answers e2ee_device_only; the device makes a sealed one and registers it (first one wins)", async () => {
    const t = setup();
    const a = await person(t, "inbox-device@example.com");
    const space = await encryptedSpace(t, a, { level: "full" });
    const sealer = new Sealer(space);
    expect(await a.as.mutation(api.tasks.inbox, { scope: PERSONAL }).catch(dataOf)).toMatchObject({ code: "e2ee_device_only" });
    const mine = ulid();
    await push(a, [await sealer.createOp(mine, { title: "Inbox" })]);
    expect(await a.as.mutation(api.e2ee.content.setInbox, { scope: PERSONAL, documentId: mine })).toEqual({ documentId: mine });
    expect((await a.as.mutation(api.tasks.inbox, { scope: PERSONAL })).documentId).toBe(mine);
    // A second device's Inbox loses: it is told the first one's id.
    const other = ulid();
    await push(a, [await sealer.createOp(other, { title: "Inbox" })]);
    expect(await a.as.mutation(api.e2ee.content.setInbox, { scope: PERSONAL, documentId: other })).toEqual({ documentId: mine });
    // Plain notes, sub-pages and workspaces are refused.
    const plain = await t.run(async (ctx) => (await ctx.db.query("documents").collect()).find((d) => d.sealedAt === undefined)?.publicId ?? null);
    if (plain) await expect(a.as.mutation(api.e2ee.content.setInbox, { scope: PERSONAL, documentId: plain })).rejects.toThrow();
  });

  test("in an encrypted workspace each person's Inbox is at their deterministic id", async () => {
    const { teamWorkspace } = await import("./helpers");
    const t = setup();
    const a = await person(t, "inbox-ws@example.com");
    const { workspaceId, scope } = await teamWorkspace(a, "Team");
    const space = await encryptedSpace(t, a, { workspaceId, level: "full" });
    const sealer = new Sealer(space);
    const id = inboxDocumentId(a.profileId, scopeIdKey(scope));
    await push(a, [await sealer.createOp(id, { title: "Inbox" })], "device-e2ee-1", scope);
    expect((await a.as.mutation(api.tasks.inbox, { scope })).documentId).toBe(id);
    await expect(a.as.mutation(api.e2ee.content.setInbox, { scope, documentId: id })).rejects.toThrow(/fixed id/);
  });
});

describe("Foli AI reads a sealed note's image from the device's bytes (§7.2)", () => {
  async function sealedImage(t: T, foliAi: "off" | "ask" | "auto") {
    const a = await person(t, `read-image-${foliAi}@example.com`);
    const id = await note(a, "Receipts", ["A photo"]);
    await sealDoc(t, id);
    await encryptScope(t, a, { switches: { foliAi } });
    const fileId = ulid();
    const rowId = await docId(t, id);
    await t.run(async (ctx) => {
      const doc = (await ctx.db.get(rowId))!;
      const storageId = await ctx.storage.store(new Blob([new Uint8Array(64)]));
      await ctx.db.insert("files", {
        publicId: fileId,
        storageId,
        ownerProfileId: doc.ownerProfileId,
        documentId: doc._id,
        uploadedBy: doc.createdBy,
        filename: "file",
        mimeType: "application/octet-stream",
        size: 64,
        sha256: "0".repeat(64),
        kind: "image",
        status: "ready",
        sealed: { key: new ArrayBuffer(70), meta: new ArrayBuffer(70), k: 1, plainSize: 30 },
        createdAt: Date.now(),
      });
    });
    const provided = { scope: PERSONAL, notes: [], files: [{ name: "photo.png", mime: "image/png", bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer as ArrayBuffer }], consent: "asked" as const, ephemeral: true as const };
    return { a, id, fileId, provided };
  }

  test("with Foli AI allowed, the text is returned to the device and nothing is stored", async () => {
    const t = setup();
    const { a, id, fileId, provided } = await sealedImage(t, "ask");
    gemini("TOTAL 12.50");
    const out = await a.as.action(api.fileText.readImage, { documentId: id, fileId, blockId: ulid(), provided });
    expect(out).toMatchObject({ status: "read", text: "TOTAL 12.50" });
    expect(await t.run(async (ctx) => (await ctx.db.query("fileTexts").collect()).length)).toBe(0);
    // Without bytes it stays unavailable (the server can't read the sealed file).
    expect(await a.as.action(api.fileText.readImage, { documentId: id, fileId, blockId: ulid() }).catch(dataOf)).toMatchObject({ code: "e2ee_unavailable", feature: "readImage" });
  });

  test("Foli AI off in the space or a locked note: refused before anything is sent", async () => {
    const t = setup();
    const { a, id, fileId, provided } = await sealedImage(t, "off");
    const { fetchMock } = gemini("never");
    expect(await a.as.action(api.fileText.readImage, { documentId: id, fileId, blockId: ulid(), provided }).catch(dataOf)).toMatchObject({ code: "e2ee_switch_off" });
    await setSwitches(t, `p:${a.profileId}`, { foliAi: "ask" });
    const rowId = await docId(t, id);
    await t.run(async (ctx) => ctx.db.patch(rowId, { locked: true }));
    expect(await a.as.action(api.fileText.readImage, { documentId: id, fileId, blockId: ulid(), provided }).catch(dataOf)).toMatchObject({ code: "e2ee_locked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the file must be a sealed image of that note, and exactly one supported image travels", async () => {
    const t = setup();
    const { a, id, provided } = await sealedImage(t, "ask");
    gemini("x");
    await expect(a.as.action(api.fileText.readImage, { documentId: id, fileId: ulid(), blockId: ulid(), provided })).rejects.toThrow(/File not found/);
    const [file] = await t.run(async (ctx) => await ctx.db.query("files").collect());
    await expect(a.as.action(api.fileText.readImage, { documentId: id, fileId: file!.publicId, blockId: ulid(), provided: { ...provided, files: [] } })).rejects.toThrow(/one image/);
    await expect(a.as.action(api.fileText.readImage, { documentId: id, fileId: file!.publicId, blockId: ulid(), provided: { ...provided, files: [{ ...provided.files[0]!, mime: "image/gif" }] } })).rejects.toThrow(/PNG, JPEG and WebP/);
  });
});

describe("turning the e2ee flag on for a development deployment", () => {
  test("testSupport.setFeatureFlag sets a known flag (and refuses unknown ones)", async () => {
    const { isFeatureEnabled } = await import("../../convex/lib/flags");
    const t = setup();
    expect(await t.run(async (ctx) => await isFeatureEnabled(ctx, "e2ee"))).toBe(false);
    expect(await t.mutation(internal.testSupport.setFeatureFlag, { key: "e2ee", enabled: true })).toEqual({ key: "e2ee", enabled: true });
    expect(await t.run(async (ctx) => await isFeatureEnabled(ctx, "e2ee"))).toBe(true);
    await expect(t.mutation(internal.testSupport.setFeatureFlag, { key: "nope", enabled: true })).rejects.toThrow(/Unknown flag/);
  });
});
