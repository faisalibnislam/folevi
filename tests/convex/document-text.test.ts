// A note's search text row (documentText, lib/documentText.ts) stays equal to the note through creates, edits,
// renames, moves, Trash, restore and deletes; the backfill builds rows for notes from before; and its search
// index finds what the note's own index finds (the rollout's widen step, docs/perf/backend-results.md).
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { para, person, PERSONAL, setup, ulid, type T } from "./helpers";

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

/** Every note of the person's Personal has exactly one documentText row, equal to the note. */
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
      expect({ searchText: r!.searchText, inTrash: r!.inTrash, folderId: r!.folderId, createdBy: r!.createdBy, kind: r!.kind }).toEqual({
        searchText: d.searchText,
        inTrash: d.inTrash,
        folderId: d.folderId,
        createdBy: d.createdBy,
        kind: d.kind,
      });
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

    // Its search index finds what the note's own index finds.
    const hits = await t.run(async (ctx) => {
      const owner = a.profileId as Id<"profiles">;
      const viaNote = await ctx.db
        .query("documents")
        .withSearchIndex("search_text", (s) => s.search("searchText", "giraffes").eq("ownerProfileId", owner).eq("inTrash", false))
        .collect();
      const viaText = await ctx.db
        .query("documentText")
        .withSearchIndex("search_text", (s) => s.search("searchText", "giraffes").eq("ownerProfileId", owner).eq("inTrash", false))
        .collect();
      return { viaNote: viaNote.map((d) => d._id as string), viaText: viaText.map((r) => r.documentId as string) };
    });
    expect(hits.viaText).toEqual(hits.viaNote);
    expect(hits.viaText).toHaveLength(1);
  });

  test("the backfill builds rows for notes from before, once", async () => {
    const t = setup();
    const a = await person(t, "text-backfill@example.com");
    for (let i = 0; i < 30; i++) await newNote(a, `Old ${i}`);
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("documentText").collect()) await ctx.db.delete(r._id);
    });
    const first = await t.action(internal.migrations.backfillDocumentText, {});
    expect(first.failed).toBe(0);
    expect(first.copied).toBeGreaterThanOrEqual(30);
    await expectTextMatchesNotes(t, a.profileId);
    expect((await t.action(internal.migrations.backfillDocumentText, {})).copied).toBe(0);
  });
});
