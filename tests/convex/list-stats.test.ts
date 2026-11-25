// Folder and Drafts stats (lib/listStats.ts) stay equal to counting the pages, through creates, edits, moves,
// Archive, Trash, deletes and folder deletes, and organization.index / recentFolders / draftCount read them
// instead of the pages. Permission cases are in privacy-gaps.test.ts (they run on the stats too).
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { inDrafts, inFolderList, PREVIEWS } from "../../convex/lib/listStats";
import { para, person, PERSONAL, setup, ulid, type T } from "./helpers";
import { measure } from "./perf/measure";

type Person = Awaited<ReturnType<typeof person>>;

async function newNote(p: Person, title: string, folderId: string | null = null) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-stats",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function edit(p: Person, documentId: string, text: string) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-stats",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), text), baseRevision: null, fields: ["content", "position"] }],
  });
  expect(r!.status).toBe("applied");
}

/** Every stats row of the person's Personal equals counting its pages. */
async function expectStatsMatchPages(t: T, profileId: string) {
  await t.run(async (ctx) => {
    const owner = profileId as Id<"profiles">;
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_owner_created", (q) => q.eq("ownerProfileId", owner))
      .collect();
    const rows = await ctx.db
      .query("listStats")
      .withIndex("by_owner_folder", (q) => q.eq("ownerProfileId", owner))
      .collect();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const listed: Doc<"documents">[] = row.folderId ? docs.filter((d) => inFolderList(d) && d.folderId === row.folderId) : docs.filter(inDrafts);
      expect({ folder: row.folderId ?? "drafts", count: row.count }).toEqual({ folder: row.folderId ?? "drafts", count: listed.length });
      if (!row.folderId) continue;
      const newest = [...listed].sort((a, b) => b.updatedAt - a.updatedAt || a._creationTime - b._creationTime).slice(0, PREVIEWS);
      expect(row.previews.map((e) => e.title)).toEqual(newest.map((d) => d.title));
      if (listed.length) expect(row.lastEditedAt).toBeGreaterThanOrEqual(Math.max(...listed.map((d) => d.updatedAt)));
    }
  });
}

const folderCard = async (p: Person, folderId: string) => (await p.as.query(api.organization.index, { scope: PERSONAL, only: "folders" })).folders.find((f) => f.id === folderId)!;

describe("folder and Drafts stats", () => {
  test("stay equal to the pages through creates, edits, moves, Archive, Trash and deletes", async () => {
    const t = setup();
    const a = await person(t, "stats-a@example.com");
    // A new person's Drafts start with stats.
    await expectStatsMatchPages(t, a.profileId);
    const x = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "X" })).id;
    const y = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Y" })).id;
    const drafts0 = await a.as.query(api.organization.draftCount, { scope: PERSONAL });

    const notes: string[] = [];
    for (let i = 0; i < 7; i++) notes.push(await newNote(a, `Note ${i}`, x));
    const draft = await newNote(a, "Loose");
    await expectStatsMatchPages(t, a.profileId);
    expect((await folderCard(a, x)).documentCount).toBe(7);
    expect((await folderCard(a, x)).previews.map((p) => p.title)).toEqual(["Note 6", "Note 5", "Note 4", "Note 3", "Note 2"]);
    expect(await a.as.query(api.organization.draftCount, { scope: PERSONAL })).toBe(drafts0 + 1);

    // An edit brings an older note to the front.
    await edit(a, notes[0]!, "changed");
    await expectStatsMatchPages(t, a.profileId);
    expect((await folderCard(a, x)).previews[0]!.title).toBe("Note 0");

    // Moves: between folders, and out of Drafts.
    await a.as.mutation(api.documents.move, { documentId: notes[0]!, folderId: y });
    await a.as.mutation(api.documents.move, { documentId: draft, folderId: y });
    await expectStatsMatchPages(t, a.profileId);
    expect((await folderCard(a, x)).documentCount).toBe(6);
    expect((await folderCard(a, y)).documentCount).toBe(2);
    expect(await a.as.query(api.organization.draftCount, { scope: PERSONAL })).toBe(drafts0);

    // Archive, Trash and back.
    await a.as.mutation(api.documents.setArchived, { documentId: notes[6]!, archived: true });
    await a.as.mutation(api.documents.moveToTrash, { documentId: notes[5]! });
    await expectStatsMatchPages(t, a.profileId);
    expect((await folderCard(a, x)).documentCount).toBe(4);
    await a.as.mutation(api.documents.setArchived, { documentId: notes[6]!, archived: false });
    await a.as.mutation(api.documents.restoreFromTrash, { documentId: notes[5]! });
    await expectStatsMatchPages(t, a.profileId);
    expect((await folderCard(a, x)).documentCount).toBe(6);

    // Deleted for good.
    await a.as.mutation(api.documents.moveToTrash, { documentId: notes[1]! });
    await a.as.mutation(api.documents.deletePermanently, { documentId: notes[1]!, confirmTitle: "Note 1" });
    await expectStatsMatchPages(t, a.profileId);
    expect((await folderCard(a, x)).documentCount).toBe(5);

    // A deleted folder's notes go to Drafts.
    await a.as.mutation(api.organization.deleteFolder, { folderId: x });
    await expectStatsMatchPages(t, a.profileId);
    expect(await a.as.query(api.organization.draftCount, { scope: PERSONAL })).toBe(drafts0 + 5);
  });

  test("folder views read one stats row per folder, not its pages", async () => {
    const t = setup();
    const a = await person(t, "stats-reads@example.com");
    const x = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Big" })).id;
    for (let i = 0; i < 30; i++) await newNote(a, `Page ${i}`, x);
    const rows = await t.run(async (ctx) => (await ctx.db.query("folders").collect()).length + (await ctx.db.query("listStats").collect()).length);
    const index = await measure("index", () => a.as.query(api.organization.index, { scope: PERSONAL, only: "folders" }));
    const recent = await measure("recent", () => a.as.query(api.organization.recentFolders, { scope: PERSONAL, limit: 6 }));
    const drafts = await measure("drafts", () => a.as.query(api.organization.draftCount, { scope: PERSONAL }));
    // Folders, their stats and the person's own rows (profile, session): no pages.
    for (const c of [index, recent]) {
      expect(c.error).toBeUndefined();
      expect(c.documentsRead).toBeLessThanOrEqual(rows + 10);
    }
    expect(drafts.documentsRead).toBeLessThanOrEqual(10);
  });

  test("a folder without stats is counted from its pages, and the backfill builds them", async () => {
    const t = setup();
    const a = await person(t, "stats-backfill@example.com");
    const x = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Old" })).id;
    for (let i = 0; i < 3; i++) await newNote(a, `Old ${i}`, x);
    const before = await folderCard(a, x);
    const draftsBefore = await a.as.query(api.organization.draftCount, { scope: PERSONAL });
    // As it was before stats existed.
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("listStats").collect()) await ctx.db.delete(r._id);
    });
    expect(await folderCard(a, x)).toEqual(before);
    expect(await a.as.query(api.organization.draftCount, { scope: PERSONAL })).toBe(draftsBefore);
    // Writes to a folder without stats leave it without (counted from its pages until the backfill).
    await newNote(a, "Old 3", x);
    expect((await folderCard(a, x)).documentCount).toBe(4);

    const result = await t.action(internal.migrations.backfillListStats, {});
    expect(result.skipped).toBe(0);
    expect(result.folders).toBeGreaterThan(0);
    await expectStatsMatchPages(t, a.profileId);
    const after = await folderCard(a, x);
    expect(after.documentCount).toBe(4);
    expect(after.previews.map((p) => p.title)).toEqual(["Old 3", "Old 2", "Old 1", "Old 0"]);
    expect(await a.as.query(api.organization.draftCount, { scope: PERSONAL })).toBe(draftsBefore);
    // Running it again changes nothing.
    expect((await t.action(internal.migrations.backfillListStats, {})).folders).toBe(0);
  });
});
