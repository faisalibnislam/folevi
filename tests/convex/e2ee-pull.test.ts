// e2ee.pull (docs/E2EE_DESIGN.md §5.3, §6.5, §11.2 e2ee-pull): paging by seq with ties kept whole,
// filtering by what the caller may read (restricted pages), and sealed rows only in a Standard space with locks.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { e2eePerson, e2eeRecoveryMethods, e2eeSpace, inWorkspace, join, para, PERSONAL, setup, teamWorkspace, ulid, type T } from "./helpers";
import { push } from "./e2ee-fixtures";
import { sealerFor } from "./e2ee-device";

const SWITCHES = { foliAi: "off", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false } as const;

type Page = Awaited<ReturnType<typeof pullAll>>;

async function pullAll(p: Awaited<ReturnType<typeof e2eePerson>>, scope: typeof PERSONAL | ReturnType<typeof inWorkspace>, limit: number) {
  const pages = [];
  let cursor = 0;
  for (let i = 0; i < 100; i++) {
    const page = await p.as.query(api.e2ee.pull.pull, { scope, cursor, limit });
    pages.push(page);
    expect(page.nextCursor).toBeGreaterThanOrEqual(cursor);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  return pages;
}

const ids = (pages: Page, key: "documents" | "blocks") => pages.flatMap((p) => (key === "documents" ? p.documents.map((d) => d.id) : p.blocks.map((b) => b.block.id)));

async function fullPersonal(t: T, email: string) {
  const p = await e2eePerson(t, email);
  await e2eeRecoveryMethods(p);
  const space = await e2eeSpace(p, PERSONAL);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", `p:${p.profileId}`)).unique();
    await ctx.db.patch(row!._id, { level: "full", state: "on" });
  });
  return { p, sealer: await sealerFor(space.sk, space.scopeId) };
}

describe("e2ee.pull", () => {
  test("pages by seq without splitting a change, and returns every row once", async () => {
    const t = setup();
    const { p, sealer } = await fullPersonal(t, "pull-paging@example.com");
    const docs = [ulid(), ulid(), ulid()];
    await push(p, await Promise.all(docs.map((id, i) => sealer.createOp(id, { title: `Note ${i}` }))));
    // One push of five blocks: one change, one seq.
    const batch = Array.from({ length: 5 }, (_, i) => para(ulid(), `line ${i}`, `V${i}`));
    await push(p, await Promise.all(batch.map((b) => sealer.upsert(docs[0]!, b, null))));
    for (const id of docs.slice(1)) await push(p, [await sealer.upsert(id, para(ulid(), "a"), null)]);
    const pages = await pullAll(p, PERSONAL, 2);
    expect(pages.length).toBeGreaterThan(1);
    const pulledDocs = ids(pages, "documents");
    for (const id of docs) expect(pulledDocs).toContain(id);
    // The five blocks written in one change come in the same page, though the limit is 2.
    const pageOf = (id: string) => pages.findIndex((pg) => pg.blocks.some((b) => b.block.id === id));
    expect(new Set(batch.map((b) => pageOf(b.id))).size).toBe(1);
    // Every row exactly once (the seeded notes from before encryption come too, as plain rows).
    const pulledBlocks = ids(pages, "blocks");
    expect(new Set(pulledBlocks).size).toBe(pulledBlocks.length);
    const ours = pages.flatMap((pg) => pg.blocks).filter((b) => docs.includes(b.documentId));
    expect(ours).toHaveLength(7);
    expect(ours.every((b) => (b.block as { sealed?: unknown }).sealed !== undefined)).toBe(true);
    const doc = pages.flatMap((pg) => pg.documents).find((d) => d.id === docs[0])!;
    expect(doc.sealed).toBeDefined();
    expect(await sealer.openTitle(docs[0]!, doc.sealed!.title)).toBe("Note 0");
    const keys = pages.flatMap((pg) => pg.noteKeys).filter((k) => k.documentId === docs[0]);
    expect(keys).toHaveLength(1);
    // The space row comes once, in the page its seq falls in.
    expect(pages.filter((pg) => pg.space).map((pg) => pg.space!.level)).toEqual(["full"]);
    // From the last cursor nothing new.
    const again = await p.as.query(api.e2ee.pull.pull, { scope: PERSONAL, cursor: pages.at(-1)!.nextCursor });
    expect(again.documents).toHaveLength(0);
    expect(again.blocks).toHaveLength(0);
  });

  test("a restricted page and its rows never reach a member who can't open it", async () => {
    const t = setup();
    const owner = await e2eePerson(t, "pull-owner@example.com");
    await e2eeRecoveryMethods(owner);
    const member = await e2eePerson(t, "pull-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "pull-member@example.com", workspaceId, "editor");
    const space = await e2eeSpace(owner, scope, [member]);
    await t.run(async (ctx) => {
      const ws = await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique();
      const row = await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", `w:${ws!._id}`)).unique();
      await ctx.db.patch(row!._id, { level: "full", state: "on" });
    });
    const sealer = await sealerFor(space.sk, space.scopeId);
    const open = ulid();
    const secret = ulid();
    await push(owner, [await sealer.createOp(open, { title: "Open" }), await sealer.createOp(secret, { title: "ZQXJ-TITLE-secret" })], "device-owner-001", scope);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    await push(owner, [await sealer.upsert(open, para(ulid(), "hello"), null), await sealer.upsert(secret, para(ulid(), "ZQXJ-BODY-secret"), null)], "device-owner-001", scope);
    const memberPages = await pullAll(member, scope, 500);
    expect(ids(memberPages, "documents")).toContain(open);
    expect(ids(memberPages, "documents")).not.toContain(secret);
    expect(memberPages.flatMap((pg) => pg.blocks).every((b) => b.documentId !== secret)).toBe(true);
    expect(memberPages.flatMap((pg) => pg.noteKeys).every((k) => k.documentId !== secret)).toBe(true);
    // The owner gets both.
    const ownerPages = await pullAll(owner, scope, 500);
    expect(ids(ownerPages, "documents")).toEqual(expect.arrayContaining([open, secret]));
    // pull.document for one note: the caller's wraps and the note.
    const one = await owner.as.query(api.e2ee.pull.document, { documentId: secret });
    expect(one!.noteKeys).toHaveLength(1);
    await expect(member.as.query(api.e2ee.pull.document, { documentId: secret })).rejects.toThrow();
  });

  test("a Standard space with a locked folder pulls only the sealed notes and the locked folder", async () => {
    const t = setup();
    const p = await e2eePerson(t, "pull-locks@example.com");
    await e2eeRecoveryMethods(p);
    const space = await e2eeSpace(p, PERSONAL);
    const sealer = await sealerFor(space.sk, space.scopeId);
    const { id: folderId } = await p.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Locked" });
    const { id: plainFolder } = await p.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Plain folder" });
    await p.as.mutation(api.e2ee.content.setFolderLocked, { folderId, locked: true });
    const sealed = ulid();
    await push(p, [await sealer.createOp(sealed, { title: "Sealed", folderId })]);
    await push(p, [await sealer.upsert(sealed, para(ulid(), "sealed body"), null)]);
    const plain = ulid();
    await push(p, [{ opId: ulid(), kind: "document.create", document: { id: plain, parentDocumentId: null, folderId: plainFolder, kind: "document", title: "Plain", icon: null } }]);
    await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: plain, block: para(ulid(), "plain body"), baseRevision: null, fields: ["content", "position"] }]);
    const pages = await pullAll(p, PERSONAL, 500);
    expect(ids(pages, "documents")).toEqual([sealed]);
    expect(pages.flatMap((pg) => pg.blocks).every((b) => b.documentId === sealed)).toBe(true);
    const folders = pages.flatMap((pg) => pg.folders).map((f) => f.id);
    expect(folders).toContain(folderId);
    expect(folders).not.toContain(plainFolder);
    void SWITCHES;
  });

  test("mine lists the caller's stars and recents in the scope", async () => {
    const t = setup();
    const { p, sealer } = await fullPersonal(t, "pull-mine@example.com");
    const id = ulid();
    await push(p, [await sealer.createOp(id, { title: "Starred" })]);
    await p.as.mutation(api.documents.setStarred, { documentId: id, starred: true });
    const mine = await p.as.query(api.e2ee.pull.mine, { scope: PERSONAL });
    expect(mine.stars.map((s) => s.documentId)).toContain(id);
  });
});

describe("e2ee.pull after WP7's integration", () => {
  test("notes deleted for good and deleted tags come as `removed`; a restricted page's only to who opens everything", async () => {
    const t = setup();
    const owner = await e2eePerson(t, "pull-removed-owner@example.com");
    await e2eeRecoveryMethods(owner);
    const member = await e2eePerson(t, "pull-removed-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "pull-removed-member@example.com", workspaceId, "editor");
    const space = await e2eeSpace(owner, scope, [member]);
    await t.run(async (ctx) => {
      const ws = await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique();
      const row = await ctx.db.query("e2eeSpaces").withIndex("by_scope_key", (q) => q.eq("scopeKey", `w:${ws!._id}`)).unique();
      await ctx.db.patch(row!._id, { level: "full", state: "on" });
    });
    const sealer = await sealerFor(space.sk, space.scopeId);
    const open = ulid();
    const secret = ulid();
    await push(owner, [await sealer.createOp(open, { title: "Open" }), await sealer.createOp(secret, { title: "Secret" })], "device-owner-002", scope);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    const tagId = ulid();
    await owner.as.mutation(api.e2ee.content.createTag, { scope, tagId, sealedName: await sealer.sealSpaceName("tag", tagId, "Gone"), nameMac: await sealer.tagMac("Gone") });
    const ownerCursor = (await pullAll(owner, scope, 500)).at(-1)!.nextCursor;
    const memberCursor = (await pullAll(member, scope, 500)).at(-1)!.nextCursor;

    for (const id of [open, secret]) {
      await owner.as.mutation(api.documents.moveToTrash, { documentId: id });
      await owner.as.mutation(api.documents.deletePermanently, { documentId: id, confirmTitle: "sealed" });
    }
    for (let i = 0; i < 5; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    await owner.as.mutation(api.organization.deleteTag, { tagId });

    const ownerRemoved = (await owner.as.query(api.e2ee.pull.pull, { scope, cursor: ownerCursor })).removed;
    expect(ownerRemoved.map((r) => [r.kind, r.id]).sort()).toEqual([["document", open], ["document", secret], ["tag", tagId]].sort());
    const memberRemoved = (await member.as.query(api.e2ee.pull.pull, { scope, cursor: memberCursor })).removed;
    expect(memberRemoved.map((r) => r.id).sort()).toEqual([open, tagId].sort());
  });

  test("a Standard space without encryption writes no tombstones", async () => {
    const t = setup();
    const p = await e2eePerson(t, "pull-removed-standard@example.com");
    const { id: tagId } = await p.as.mutation(api.organization.createTag, { scope: PERSONAL, name: "plain" });
    await p.as.mutation(api.organization.deleteTag, { tagId });
    expect(await t.run(async (ctx) => await ctx.db.query("e2eeTombstones").collect())).toEqual([]);
  });

  test("a file committed or re-wrapped moves its note's seq, so the note comes again with the file", async () => {
    const t = setup();
    const { p, sealer } = await fullPersonal(t, "pull-files-seq@example.com");
    const doc = ulid();
    await push(p, [await sealer.createOp(doc, { title: "With a file" })]);
    const cursor = (await pullAll(p, PERSONAL, 500)).at(-1)!.nextCursor;
    const fileId = ulid();
    const plain = new TextEncoder().encode("file bytes ".repeat(10));
    const sealed = await sealer.sealFileBytes(doc, fileId, plain, { name: "a.txt", mime: "text/plain" });
    const { intentId } = await p.as.mutation(api.e2ee.files.generateUploadUrl, { documentId: doc, kind: "file", declaredSize: sealed.bytes.byteLength });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([sealed.bytes])));
    await p.as.action(api.e2ee.files.commit, { intentId, documentId: doc, fileId, storageId, sealed: sealed.row, size: sealed.bytes.byteLength, sha256: sealed.sha256 });
    const after = await p.as.query(api.e2ee.pull.pull, { scope: PERSONAL, cursor });
    const pulled = after.documents.find((d) => d.id === doc)!;
    expect(pulled.files.map((f) => f.id)).toEqual([fileId]);
    expect(pulled.fileIds).toEqual([fileId]);
    // The details sealed again: the note comes once more.
    await p.as.mutation(api.e2ee.files.updateMeta, { fileId, meta: sealed.row.meta });
    expect((await p.as.query(api.e2ee.pull.pull, { scope: PERSONAL, cursor: after.nextCursor })).documents.map((d) => d.id)).toContain(doc);
  });
});
