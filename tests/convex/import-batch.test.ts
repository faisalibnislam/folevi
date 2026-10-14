// Importing pages that nest in and link to each other (a Notion export): ids chosen up front, parents
// first, links between them turned into page links.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, PERSONAL, setup, ulid } from "./helpers";

describe("batch import", () => {
  test("nested, linked pages", async () => {
    const t = setup();
    const a = await person(t, "importer@example.com");
    const home = ulid();
    const child = ulid();
    await a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "Home.md", content: "# Home\n\nSee [Projects](Home/Projects.md).", format: "markdown", publicId: home, links: { "Home/Projects.md": child } });
    const r = await a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "Projects.md", content: "# Projects\n\nBack [home](../Home.md).", format: "markdown", publicId: child, parentId: home, links: { "../Home.md": home } });
    expect(r.document.id).toBe(child);
    const docs = await t.run(async (ctx) => {
      const byId = async (id: string) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!;
      const h = await byId(home);
      const c = await byId(child);
      const blocks = await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", h._id)).collect();
      return { parent: c.parentDocumentId === h._id, text: blocks.map((b) => b.text).flat() };
    });
    expect(docs.parent).toBe(true);
    expect(docs.text).toContainEqual({ type: "pageLink", documentId: child, label: "Projects" });
    // Ids must be well formed, and only once.
    await expect(a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "x.md", content: "x", format: "markdown", publicId: "nope" })).rejects.toThrow();
    await expect(a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "x.md", content: "x", format: "markdown", publicId: home })).rejects.toThrow();
  });

  test("a parent in someone else's notes can't be used", async () => {
    const t = setup();
    const a = await person(t, "importer-a@example.com");
    const b = await person(t, "importer-b@example.com");
    const theirs = ulid();
    await b.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "Private.md", content: "secret", format: "markdown", publicId: theirs });
    await expect(a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "Mine.md", content: "x", format: "markdown", parentId: theirs })).rejects.toThrow();
  });
});
