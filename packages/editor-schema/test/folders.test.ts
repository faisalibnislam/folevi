import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_FOLDER_DEPTH,
  canNestFolderIn,
  flattenFolders,
  folderAncestors,
  folderDepth,
  folderDescendants,
  folderHeight,
  folderMoveProblem,
  folderPath,
} from "../src";

const f = (id: string, parentFolderId: string | null = null) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), parentFolderId });

// work > clients > acme, work > admin, home
const tree = [f("work"), f("clients", "work"), f("acme", "clients"), f("admin", "work"), f("home")];

describe("folder trees", () => {
  it("knows each folder's level, ancestors, descendants and height", () => {
    expect(folderDepth(tree, "work")).toBe(1);
    expect(folderDepth(tree, "acme")).toBe(3);
    expect(folderAncestors(tree, "acme").map((x) => x.id)).toEqual(["work", "clients"]);
    expect([...folderDescendants(tree, "work")].sort()).toEqual(["acme", "admin", "clients"]);
    expect(folderHeight(tree, "work")).toBe(3);
    expect(folderHeight(tree, "home")).toBe(1);
    expect(folderPath(tree, "acme")).toBe("Work / Clients / Acme");
  });

  it("lists folders in tree order with their level", () => {
    expect(flattenFolders(tree).map((e) => `${e.folder.id}:${e.depth}`)).toEqual(["work:0", "clients:1", "acme:2", "admin:1", "home:0"]);
  });

  it("refuses moves into the folder itself, its subfolders, or past the deepest level", () => {
    expect(folderMoveProblem(tree, "work", "work")).toBe("self");
    expect(folderMoveProblem(tree, "work", "acme")).toBe("descendant");
    expect(folderMoveProblem(tree, "home", "acme")).toBeNull();
    expect(folderMoveProblem(tree, "acme", null)).toBeNull();
    // A chain as deep as allowed: nothing more fits at the bottom, and a two-level folder doesn't fit one up.
    const chain = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => f(`l${i + 1}`, i ? `l${i}` : null));
    const deep = [...chain, f("solo"), f("pair"), f("pairchild", "pair")];
    expect(canNestFolderIn(deep, `l${MAX_FOLDER_DEPTH}`)).toBe(false);
    expect(canNestFolderIn(deep, `l${MAX_FOLDER_DEPTH - 1}`)).toBe(true);
    expect(folderMoveProblem(deep, "solo", `l${MAX_FOLDER_DEPTH}`)).toBe("depth");
    expect(folderMoveProblem(deep, "solo", `l${MAX_FOLDER_DEPTH - 1}`)).toBeNull();
    expect(folderMoveProblem(deep, "pair", `l${MAX_FOLDER_DEPTH - 1}`)).toBe("depth");
    expect(folderMoveProblem(deep, "pair", `l${MAX_FOLDER_DEPTH - 2}`)).toBeNull();
  });

  it("treats a folder whose parent is gone as top level, and survives cycles", () => {
    const damaged = [f("orphan", "missing"), f("x", "y"), f("y", "x")];
    expect(folderDepth(damaged, "orphan")).toBe(1);
    expect(flattenFolders(damaged).map((e) => e.folder.id).sort()).toEqual(["orphan", "x", "y"]);
    expect(folderAncestors(damaged, "x").map((e) => e.id)).toEqual(["y"]);
    expect([...folderDescendants(damaged, "x")]).toEqual(["y"]);
  });

  it("every folder appears exactly once in tree order, whatever the shape", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1, max: 19 }), { minLength: 1, maxLength: 20 }), (parents) => {
        const folders = parents.map((p, i) => f(`n${i}`, p < 0 || p === i ? null : `n${p}`));
        const flat = flattenFolders(folders);
        expect(flat.map((e) => e.folder.id).sort()).toEqual(folders.map((x) => x.id).sort());
        for (const x of folders) expect(folderDescendants(folders, x.id).has(x.id)).toBe(false);
      }),
    );
  });
});
