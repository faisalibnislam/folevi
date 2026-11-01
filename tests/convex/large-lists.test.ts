// Lists past a view's read cap: a folder with more pages than the cap (1,000) pages through its index
// instead of stopping at the cap, so every page is listed once.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, PERSONAL, setup, ulid } from "./helpers";

describe("large lists", () => {
  test("a folder past the read cap lists every page once", async () => {
    const t = setup();
    const a = await person(t, "large-folder@example.com");
    const folderId = (await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Big" })).id;
    const first = ulid();
    const [r] = await a.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-large-lists",
      ops: [{ opId: ulid(), kind: "document.create", document: { id: first, parentDocumentId: null, folderId, kind: "document", title: "Page 0", icon: null } }],
    });
    expect(r!.status).toBe("applied");

    // Copies of the first page's row, straight into the table (1,000 pushes would be slow).
    const total = 1005;
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("documents")
        .withIndex("by_public_id", (q) => q.eq("publicId", first))
        .unique())!;
      const { _id, _creationTime, ...rest } = row;
      void _id;
      void _creationTime;
      for (let i = 1; i < total; i++) await ctx.db.insert("documents", { ...rest, publicId: ulid(), title: `Page ${i}`, updatedAt: rest.updatedAt + i });
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const res: { page: { title: string }[]; isDone: boolean; continueCursor: string } = await a.as.query(api.documents.list, {
        scope: PERSONAL,
        view: "folder",
        folderId,
        paginationOpts: { numItems: 200, cursor },
      });
      seen.push(...res.page.map((d) => d.title));
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
    // Past the cap the folder keeps its index's order: last edited first.
    expect(seen[0]).toBe(`Page ${total - 1}`);
  });
});
