// The views' pure selectors produce the contract fixtures from data shaped as the data layer answers it
// (docs/NATIVE_APP_PLAN.md section 3.8): a fixture is what the engine really sends, not a hand-written guess.
import { describe, expect, it } from "vitest";
import { FIXTURES, seedRow, type ViewFixture } from "@/lib/engine/fixtures/source";
import { folderTree, noteRowOf, syncMarksOf, type SummaryLike } from "@/lib/engine/rows";
import { homeValue } from "@/lib/engine/views";
import type { FoldersTreeValue, HomeValue, NoteRow } from "@/lib/engine/protocol";
import { PERSONAL } from "./fakes";

/** A row back into the summary shape documents.list answers with. */
function summaryOf(row: NoteRow): SummaryLike {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    excerpt: row.excerpt,
    preview: row.preview,
    cover: row.cover,
    style: row.style,
    starred: row.starred,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    folderId: row.folder?.id ?? null,
    homeFolder: row.folder,
    tags: row.tags,
    archivedAt: null,
    deletedAt: null,
  };
}

describe("selectors reproduce the fixtures", () => {
  it("noteRowOf: a summary becomes exactly the fixture's row, hash included", () => {
    for (const i of [0, 1, 3, 5, 7, 12]) {
      const row = seedRow(i);
      expect(noteRowOf(summaryOf(row))).toEqual(row);
    }
  });

  it("noteRowOf: waiting changes mark the row", () => {
    const row = seedRow(2);
    const marks = syncMarksOf(null, [{ id: "e1", name: "documents.bulkUpdate", args: {} as never, keys: [`note:${row.id}`], label: "Move a note", createdAt: 0, attempts: 0 }]);
    expect(noteRowOf(summaryOf(row), marks).sync).toBe("waiting");
  });

  it("folderTree: organization.sidebar's flat list becomes the fixture's depth-first tree", () => {
    const fixture = (FIXTURES["view.folders.tree"] as ViewFixture<"folders.tree">).value as FoldersTreeValue;
    // The server's order is by rank only; children come in any order.
    const sidebar = [...fixture.folders].reverse().map((f) => ({ id: f.id, name: f.name, color: f.color, parentFolderId: f.parentId, rank: f.rank, ...(f.locked ? { locked: true } : {}) }));
    const counts = new Map(fixture.folders.filter((f) => f.noteCount !== null).map((f) => [f.id, f.noteCount!]));
    const marks = syncMarksOf(null, [{ id: "e1", name: "organization.createFolder", args: {} as never, keys: ["folder:fld_iceland"], label: "New folder", createdAt: 0, attempts: 0 }]);
    const tree = folderTree(sidebar, counts, marks).map((f) => (f.id === "fld_iceland" ? { ...f, noteCount: null } : f));
    expect(tree).toEqual(fixture.folders);
  });

  it("homeValue: a new account's Home is the empty fixture", () => {
    const fixture = (FIXTURES["view.home.empty"] as ViewFixture<"home">).value as HomeValue;
    const value = homeValue({
      space: PERSONAL,
      locked: false,
      recent: [],
      starred: { page: [], isDone: true, continueCursor: "0" },
      drafts: 0,
      changes: 0,
      proposed: 0,
      reviews: { due: 0, new: 0, hasCards: false },
      sidebar: { folders: [], tags: [] },
      index: { folders: [], tags: [] } as never,
      entries: [],
      marks: syncMarksOf(null, []),
      pending: [],
      capabilities: { sharing: true, changes: true },
      catchUp: { available: false, state: "idle", brief: null, error: null },
    });
    expect(value).toEqual(fixture);
  });
});
