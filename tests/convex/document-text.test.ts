// A note's search text row (documentText, lib/documentText.ts) stays equal to the note through creates, edits,
// renames, moves, Trash, restore and deletes; the backfill builds rows for notes from before; and its search
// is what search reads; the backfill and narrow migrations move older notes' text (docs/perf/backend-results.md).
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { para, person, PERSONAL, setup, textOf, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function push(p: Person, ops: unknown[]) {
  const results = await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-text", ops: ops as never });
  for (const r of results) expect(r.status).toBe("applied");
}

async function newNote(p: Person, title: string, folderId: string | null = null) {
  const id = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId, kind: "document", title, icon: null } }]);
  return id;
}

const write = (documentId: string, text: string) => ({ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), text), baseRevision: null, fields: ["content", "position"] });

/** Every note of the person's Personal has exactly one documentText row, with the note's search fields. */
async function expectTextMatchesNotes(t: T, profileId: string) {
  await t.run(async (ctx) => {
    const owner = profileId as Id<"profiles">;
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_owner_created", (q) => q.eq("ownerProfileId", owner))
      .collect();
    const rows = await ctx.db
      .query("documentText")
      .withIndex("by_owner", (q) => q.eq("ownerProfileId", owner))
      .collect();
    expect(rows.length).toBe(docs.length);
    const byDoc = new Map(rows.map((r) => [r.documentId as string, r]));
    for (const d of docs) {
      const r = byDoc.get(d._id);
      expect(r, d.title).toBeDefined();
      expect({ inTrash: r!.inTrash, folderId: r!.folderId, createdBy: r!.createdBy, kind: r!.kind }).toEqual({ inTrash: d.inTrash, folderId: d.folderId, createdBy: d.createdBy, kind: d.kind });
      // The text starts with the title; the note row keeps no copy.
      expect(r!.searchText.startsWith(d.title)).toBe(true);
      expect(d.searchText).toBeUndefined();
    }
  });
}

describe("documentText", () => {
  test("stays equal to the note through edits, renames, moves, Trash and deletes", async () => {
    const t = setup();
    const a = await person(t, "text-a@example.com");
    await expectTextMatchesNotes(t, a.profileId);
    const folder = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "F" })).id;
    const one = await newNote(a, "Zebra crossing");
    const two = await newNote(a, "Other", folder);
    await push(a, [write(one, "A line about giraffes"), write(two, "Nothing much")]);
    await expectTextMatchesNotes(t, a.profileId);

    await push(a, [{ opId: ulid(), kind: "document.update", documentId: one, patch: { title: "Zebra stripes" }, baseRevision: null }]);
    await a.as.mutation(api.documents.move, { documentId: one, folderId: folder });
    await expectTextMatchesNotes(t, a.profileId);

    await a.as.mutation(api.documents.moveToTrash, { documentId: two });
    await expectTextMatchesNotes(t, a.profileId);
    await a.as.mutation(api.documents.restoreFromTrash, { documentId: two });
    await a.as.mutation(api.documents.moveToTrash, { documentId: two });
    await a.as.mutation(api.documents.deletePermanently, { documentId: two, confirmTitle: "Other" });
    await expectTextMatchesNotes(t, a.profileId);

    // Search finds notes by their text through it.
    expect((await a.as.query(api.search.documents, { scope: PERSONAL, query: "giraffes" })).map((r) => r.id)).toEqual([one]);
    expect(await textOf(t, one)).toContain("A line about giraffes");
  });

  test("the backfill copies text kept on note rows from before; the narrow step empties those copies", async () => {
    const t = setup();
    const a = await person(t, "text-backfill@example.com");
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await newNote(a, `Old ${i}`));
    // As notes were before: text on the row, no documentText row.
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("documentText").collect()) await ctx.db.delete(r._id);
      for (const d of await ctx.db.query("documents").collect()) await ctx.db.patch(d._id, { searchText: `${d.title}\nlegacy body` });
    });
    const first = await t.action(internal.migrations.backfillDocumentText, {});
    expect(first.failed).toBe(0);
    expect(first.copied).toBeGreaterThanOrEqual(30);
    expect(await textOf(t, ids[3]!)).toBe("Old 3\nlegacy body");
    expect((await t.action(internal.migrations.backfillDocumentText, {})).copied).toBe(0);
    // Found by search through the copied rows.
    expect((await a.as.query(api.search.documents, { scope: PERSONAL, query: "legacy" })).length).toBeGreaterThanOrEqual(30);

    await t.mutation(internal.migrations.narrowDocumentText, {});
    await t.finishAllScheduledFunctions(() => {});
    await expectTextMatchesNotes(t, a.profileId);
    expect(await textOf(t, ids[3]!)).toBe("Old 3\nlegacy body");
  });
});
