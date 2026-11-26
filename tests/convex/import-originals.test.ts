// An imported note keeps what it had in the app it came from (Apple Notes): its original dates, its tags and its
// attachments as file blocks where the note showed them.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, PERSONAL, setup } from "./helpers";

describe("import keeps the original", () => {
  test("dates, tags and attachments", async () => {
    const t = setup();
    const a = await person(t, "originals@example.com");
    const created = Date.UTC(2020, 0, 2);
    const updated = Date.UTC(2023, 5, 7);
    const r = await a.as.mutation(api.imports.importText, {
      scope: PERSONAL,
      filename: "Trip.md",
      content: "# Trip\n\nBefore\n\n[Tickets.pdf](apple-notes-file-1)\n\n[Elsewhere](https://example.com)",
      format: "markdown",
      createdAt: created,
      updatedAt: updated,
      fileMap: { "apple-notes-file-1": { fileId: "FILE1", name: "Tickets.pdf", size: 1234, mimeType: "application/pdf" } },
      tags: ["#travel", "Travel", "japan", " "],
    });
    // A tag already there is reused.
    await a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "Two.md", content: "x", format: "markdown", tags: ["japan"] });
    const got = await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", r.document.id)).unique())!;
      const blocks = await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect();
      const links = await ctx.db.query("documentTags").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect();
      const tags = await Promise.all(links.map(async (l) => (await ctx.db.get(l.tagId))!.name));
      const allTags = (await ctx.db.query("tags").collect()).map((x) => x.name);
      return { doc, blocks: blocks.sort((x, y) => (x.rank < y.rank ? -1 : 1)).map((b) => ({ type: b.type, props: b.props })), tags, allTags };
    });
    expect(got.doc.createdAt).toBe(created);
    expect(got.doc.updatedAt).toBe(updated);
    expect(got.blocks.map((b) => b.type)).toEqual(["paragraph", "file", "paragraph"]);
    expect(got.blocks[1]!.props).toEqual({ fileId: "FILE1", name: "Tickets.pdf", size: 1234, mimeType: "application/pdf" });
    expect(got.tags.sort()).toEqual(["japan", "travel"]);
    // Each made once, whatever case or "#" it came with.
    expect(got.allTags.filter((n) => ["japan", "travel"].includes(n.toLowerCase())).sort()).toEqual(["japan", "travel"]);
  });

  test("dates are made safe: never in the future, changed no earlier than made", async () => {
    const t = setup();
    const a = await person(t, "dates@example.com");
    const before = Date.now();
    const future = await a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "F.md", content: "x", format: "markdown", createdAt: before + 10 ** 12, updatedAt: Date.UTC(2019, 0, 1) });
    const plain = await a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "P.md", content: "x", format: "markdown" });
    const docs = await t.run(async (ctx) => Promise.all([future, plain].map(async (r) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", r.document.id)).unique())!)));
    expect(docs[0]!.createdAt).toBeGreaterThanOrEqual(before);
    expect(docs[0]!.updatedAt).toBe(docs[0]!.createdAt);
    expect(docs[1]!.createdAt).toBeGreaterThanOrEqual(before);
  });
});
