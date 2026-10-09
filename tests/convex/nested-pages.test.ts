// Nested pages: they live where their top-level note does, and a note's sidebar lists its whole page tree.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { inWorkspace, person, setup, teamWorkspace, ulid } from "./helpers";

describe("nested pages", () => {
  test("a nested page is in its top-level note's folder; the page tree lists the note and every page under it", async () => {
    const t = setup();
    const owner = await person(t, "nest-owner@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Nest team");
    const scope = inWorkspace(workspaceId);
    const { id: folderId } = await owner.as.mutation(api.organization.createFolder, { scope, name: "Brainstorming" });
    const create = (id: string, title: string, parent: string | null, folder: string | null = null) => ({
      opId: ulid(),
      kind: "document.create",
      document: { id, parentDocumentId: parent, folderId: folder, kind: "document", title, icon: null },
    });
    const top = ulid();
    const first = ulid();
    const second = ulid();
    const deep = ulid();
    for (const op of [create(top, "Website idea", null, folderId), create(first, "Hero titles #1", top), create(second, "Hero titles #2", top), create(deep, "Shortlist", second)]) {
      const [r] = await owner.as.mutation(api.sync.push, { scope, deviceId: `device-${ulid()}`, ops: [op as never] });
      expect(r!.status).toBe("applied");
    }

    // Not "Drafts": the folder of the note it's in.
    const meta = await owner.as.query(api.documents.get, { documentId: deep });
    expect(meta!.folder).toEqual({ id: folderId, name: "Brainstorming" });
    expect(meta!.breadcrumbs.map((b) => b.title)).toEqual(["Website idea", "Hero titles #2"]);

    // From any page in it, the same tree: the top-level note first, parents before children, oldest first.
    for (const from of [top, second, deep]) {
      const tree = await owner.as.query(api.documents.pageTree, { documentId: from });
      expect(tree!.rootId).toBe(top);
      expect(tree!.pages.map((p) => [p.title, p.depth])).toEqual([
        ["Website idea", 0],
        ["Hero titles #1", 1],
        ["Hero titles #2", 1],
        ["Shortlist", 2],
      ]);
      expect(tree!.pages.find((p) => p.id === deep)!.parentId).toBe(second);
    }
    // A page that hasn't reached the server yet has no tree (rather than an error).
    expect(await owner.as.query(api.documents.pageTree, { documentId: ulid() })).toBeNull();
  });
});
