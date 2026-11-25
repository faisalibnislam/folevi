// What the hot backend functions read for a large library (5,000 notes, 200 folders, 2,000 tasks, long notes
// with images; convex/lib/fakeLibrary.ts), with Convex's per-function limits on. Slow (it seeds the whole
// library), so it runs only when asked:
//
//   FOLEVI_PERF=1 pnpm vitest run --project convex tests/convex/perf/library.test.ts
//
// The table it prints is what docs/perf/backend-results.md records.
import { describe, expect, test } from "vitest";
import { api } from "../../../convex/_generated/api";
import { person, PERSONAL } from "../helpers";
import { limitedSetup, measure, seedLibrary, table, type Cost } from "./measure";

describe.skipIf(!process.env.FOLEVI_PERF)("large library read costs", () => {
  test(
    "hot functions at 5,000 notes",
    async () => {
      const t = limitedSetup();
      const email = "perf@example.com";
      const a = await person(t as never, email);
      const started = performance.now();
      await seedLibrary(t, email, Number(process.env.FOLEVI_PERF_NOTES) || undefined);
      const seededMs = Math.round(performance.now() - started);

      // The biggest folder, a tag, a long note and a short note to open.
      const fixtures = await t.run(async (ctx) => {
        const docs = await ctx.db.query("documents").collect();
        const byFolder = new Map<string, number>();
        for (const d of docs) if (d.folderId) byFolder.set(d.folderId, (byFolder.get(d.folderId) ?? 0) + 1);
        const [bigFolderId, bigCount] = [...byFolder.entries()].sort((x, y) => y[1] - x[1])[0]!;
        const bigFolder = (await ctx.db.get(bigFolderId as never)) as { publicId: string };
        const tag = (await ctx.db.query("tags").collect()).find((tg) => tg.name === "tag-1")!;
        // Note text is in documentText once it moved there (convex/lib/documentText.ts), on the row before.
        const texts = new Map((await ctx.db.query("documentText").collect()).map((r) => [r.documentId as string, r.searchText.length]));
        const len = (d: (typeof docs)[number]) => texts.get(d._id) ?? (d as { searchText?: string }).searchText?.length ?? 0;
        const long = docs.find((d) => len(d) > 20_000)!;
        const short = docs.find((d) => d.folderId && len(d) < 2_000)!;
        const bigNote = docs.find((d) => d.folderId === bigFolderId && !d.parentDocumentId)!;
        const other = (await ctx.db.query("folders").collect()).find((f) => f._id !== bigFolderId)!;
        return { bigFolder: bigFolder.publicId, bigCount, tag: tag.publicId, long: long.publicId, short: short.publicId, bigNote: bigNote.publicId, otherFolder: other.publicId, total: docs.length };
      });

      const page = { numItems: 50, cursor: null };
      const today = "2026-11-25";
      const costs: Cost[] = [];
      const run = async (name: string, fn: () => Promise<unknown>) => costs.push(await measure(name, fn));
      await run("organization.sidebar", () => a.as.query(api.organization.sidebar, { scope: PERSONAL }));
      await run("organization.index (folders)", () => a.as.query(api.organization.index, { scope: PERSONAL, only: "folders" }));
      await run("organization.index (tags)", () => a.as.query(api.organization.index, { scope: PERSONAL, only: "tags" }));
      await run("organization.recentFolders (6)", () => a.as.query(api.organization.recentFolders, { scope: PERSONAL, limit: 6 }));
      await run("organization.draftCount", () => a.as.query(api.organization.draftCount, { scope: PERSONAL }));
      for (const view of ["all", "unsorted", "starred"] as const) await run(`documents.list ${view} (50)`, () => a.as.query(api.documents.list, { scope: PERSONAL, view, paginationOpts: page }));
      await run(`documents.list folder (${fixtures.bigCount} notes, 50)`, () => a.as.query(api.documents.list, { scope: PERSONAL, view: "folder", folderId: fixtures.bigFolder, paginationOpts: page }));
      await run("documents.list tag (50)", () => a.as.query(api.documents.list, { scope: PERSONAL, view: "tag", tagId: fixtures.tag, paginationOpts: page }));
      for (const view of ["inbox", "today", "upcoming", "all", "completed"] as const) await run(`tasks.list ${view}`, () => a.as.query(api.tasks.list, { scope: PERSONAL, view, today }));
      await run("tasks.range (a month)", () => a.as.query(api.tasks.range, { scope: PERSONAL, from: "2026-03-01", to: "2026-03-31" }));
      await run("changes.list", () => a.as.query(api.changes.list, {}));
      await run("search.documents 'project'", () => a.as.query(api.search.documents, { scope: PERSONAL, query: "project" }));
      await run("sync.manifest (first page)", () => a.as.query(api.sync.manifest, { scope: PERSONAL, after: 0 }));
      await run("documents.get (long note)", () => a.as.query(api.documents.get, { documentId: fixtures.long }));
      await run("blocks.list (long note)", () => a.as.query(api.blocks.list, { documentId: fixtures.long }));
      await run("documents.get (short note)", () => a.as.query(api.documents.get, { documentId: fixtures.short }));
      await run("blocks.list (short note)", () => a.as.query(api.blocks.list, { documentId: fixtures.short }));

      // Writes: one edit (a block typed into a note in the biggest folder), and a note moved between folders.
      const { pushEdit, pushMove } = await import("./writes");
      await run("sync.push (edit a block)", () => pushEdit(a, fixtures.bigNote));
      await run("documents.move (to another folder)", () => pushMove(a, fixtures.bigNote, fixtures.otherFolder));

      console.log(`\nLibrary: ${fixtures.total} notes (biggest folder ${fixtures.bigCount}); seeded in ${seededMs} ms\n\n${table(costs)}\n`);
      expect(costs.length).toBeGreaterThan(0);
    },
    30 * 60_000,
  );
});
