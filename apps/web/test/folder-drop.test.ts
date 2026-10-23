import { describe, expect, test } from "vitest";
import { MAX_FOLDER_DEPTH, compareRank, flattenFolders, rankBetween } from "@folevi/editor-schema";
import { folderPlace, placeFolder, resolveFolderDrop, siblingsIn, zoneAt } from "@/lib/app/folderDrop";
import { overlaySidebar, type SidebarData } from "@/lib/sync/overlays";
import type { OutboxEntry } from "@/lib/sync/outbox";

type F = { id: string; parentFolderId: string | null; rank: string };

/** Folders in sidebar order (by rank), each with a real rank. */
function list(spec: [id: string, parent: string | null][]): F[] {
  let last: string | null = null;
  return spec.map(([id, parentFolderId]) => {
    last = rankBetween(last, null);
    return { id, parentFolderId, rank: last };
  });
}

// Work > (Clients > Acme), Home, Ideas
const folders = list([
  ["work", null],
  ["clients", "work"],
  ["acme", "clients"],
  ["home", null],
  ["ideas", null],
]);

const order = (fs: readonly F[]) => flattenFolders(fs).map((e) => `${"  ".repeat(e.depth)}${e.folder.id}`);

describe("zoneAt", () => {
  test("top quarter is before, bottom quarter after, the middle inside", () => {
    expect(zoneAt(100, 100, 32)).toBe("before");
    expect(zoneAt(107, 100, 32)).toBe("before");
    expect(zoneAt(109, 100, 32)).toBe("inside");
    expect(zoneAt(116, 100, 32)).toBe("inside");
    expect(zoneAt(124, 100, 32)).toBe("inside");
    expect(zoneAt(125, 100, 32)).toBe("after");
    expect(zoneAt(131, 100, 32)).toBe("after");
    expect(zoneAt(0, 0, 0)).toBe("inside");
  });
});

describe("folderPlace and siblingsIn", () => {
  test("a folder's parent and the sibling before it", () => {
    expect(folderPlace(folders, "work")).toEqual({ parentFolderId: null, afterFolderId: null });
    expect(folderPlace(folders, "home")).toEqual({ parentFolderId: null, afterFolderId: "work" });
    expect(folderPlace(folders, "acme")).toEqual({ parentFolderId: "clients", afterFolderId: null });
    expect(folderPlace(folders, "nope")).toBeNull();
    expect(siblingsIn(folders, null, "home").map((f) => f.id)).toEqual(["work", "ideas"]);
  });
  test("a folder whose parent isn't listed counts as top level", () => {
    const orphan = [...folders, { id: "lost", parentFolderId: "gone", rank: "z" }];
    expect(folderPlace(orphan, "lost")).toEqual({ parentFolderId: null, afterFolderId: "ideas" });
  });
});

describe("resolveFolderDrop", () => {
  test("inside a folder: it goes last in it", () => {
    expect(resolveFolderDrop(folders, "ideas", "work", "inside")).toEqual({ ok: true, changed: true, parentFolderId: "work", afterFolderId: "clients" });
    expect(resolveFolderDrop(folders, "ideas", "home", "inside")).toEqual({ ok: true, changed: true, parentFolderId: "home", afterFolderId: null });
  });

  test("a line before or after a row reorders among its siblings", () => {
    expect(resolveFolderDrop(folders, "ideas", "work", "before")).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: null });
    expect(resolveFolderDrop(folders, "ideas", "home", "before")).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: "work" });
    expect(resolveFolderDrop(folders, "work", "ideas", "after")).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: "ideas" });
    expect(resolveFolderDrop(folders, "work", "home", "after")).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: "home" });
  });

  test("a line where it already is changes nothing", () => {
    expect(resolveFolderDrop(folders, "home", "work", "after")).toMatchObject({ ok: true, changed: false });
    expect(resolveFolderDrop(folders, "home", "ideas", "before")).toMatchObject({ ok: true, changed: false });
    expect(resolveFolderDrop(folders, "home", "home", "before")).toMatchObject({ ok: true, changed: false });
    expect(resolveFolderDrop(folders, "home", "home", "after")).toMatchObject({ ok: true, changed: false });
    // Inside the folder it's already last in.
    expect(resolveFolderDrop(folders, "clients", "work", "inside")).toMatchObject({ ok: true, changed: false });
  });

  test("a subfolder dragged to a line at the top level leaves its parent (un-nesting)", () => {
    expect(resolveFolderDrop(folders, "clients", "home", "after")).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: "home" });
    expect(resolveFolderDrop(folders, "acme", "work", "before")).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: null });
    // The space for the top level: last there.
    expect(resolveFolderDrop(folders, "acme", null, "inside")).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: "ideas" });
    // A line beside a subfolder: into that subfolder's parent.
    expect(resolveFolderDrop(folders, "home", "clients", "after")).toEqual({ ok: true, changed: true, parentFolderId: "work", afterFolderId: "clients" });
  });

  test("below an open folder with subfolders: first inside it", () => {
    expect(resolveFolderDrop(folders, "ideas", "work", "after", true)).toEqual({ ok: true, changed: true, parentFolderId: "work", afterFolderId: null });
    // Closed (or nothing inside): after it, as its sibling.
    expect(resolveFolderDrop(folders, "ideas", "work", "after", false)).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: "work" });
    expect(resolveFolderDrop(folders, "work", "home", "after", true)).toEqual({ ok: true, changed: true, parentFolderId: null, afterFolderId: "home" });
  });

  test("never into itself or one of its own subfolders", () => {
    expect(resolveFolderDrop(folders, "work", "work", "inside")).toEqual({ ok: false, problem: "self" });
    expect(resolveFolderDrop(folders, "work", "clients", "inside")).toEqual({ ok: false, problem: "descendant" });
    expect(resolveFolderDrop(folders, "work", "acme", "inside")).toEqual({ ok: false, problem: "descendant" });
    // A line beside its own subfolder puts it inside its own subtree too.
    expect(resolveFolderDrop(folders, "work", "acme", "after")).toEqual({ ok: false, problem: "descendant" });
    expect(resolveFolderDrop(folders, "work", "clients", "before")).toEqual({ ok: false, problem: "self" });
  });

  test(`never deeper than ${MAX_FOLDER_DEPTH} levels`, () => {
    const deep = list([
      ["l1", null],
      ["l2", "l1"],
      ["l3", "l2"],
      ["l4", "l3"],
      ["l5", "l4"],
      ["a", null],
      ["b", "a"],
    ]);
    expect(resolveFolderDrop(deep, "a", "l5", "inside")).toEqual({ ok: false, problem: "depth" });
    // "a" carries "b" a level below it: inside l4 would put b at level 6.
    expect(resolveFolderDrop(deep, "a", "l4", "inside")).toEqual({ ok: false, problem: "depth" });
    expect(resolveFolderDrop(deep, "b", "l4", "inside")).toMatchObject({ ok: true, parentFolderId: "l4" });
    // Beside l5 is inside l4: a (with b) is too tall for that, b alone fits.
    expect(resolveFolderDrop(deep, "a", "l5", "after")).toEqual({ ok: false, problem: "depth" });
    expect(resolveFolderDrop(deep, "b", "l5", "after")).toMatchObject({ ok: true, parentFolderId: "l4", afterFolderId: "l5" });
  });

  test("unknown folders are refused", () => {
    expect(resolveFolderDrop(folders, "nope", "work", "inside")).toEqual({ ok: false, problem: "self" });
    expect(resolveFolderDrop(folders, "work", "nope", "inside")).toEqual({ ok: false, problem: "self" });
  });
});

describe("placeFolder (reorder ranks)", () => {
  const ranked = (fs: F[]) => [...fs].sort((a, b) => compareRank(a.rank, b.rank));

  test("first among siblings: a rank before the first, shown first", () => {
    const next = placeFolder(folders, "ideas", null, null)!;
    expect(order(next)).toEqual(["ideas", "work", "  clients", "    acme", "home"]);
    expect(order(ranked(next))).toEqual(order(next));
    const ideas = next.find((f) => f.id === "ideas")!;
    expect(compareRank(ideas.rank, folders.find((f) => f.id === "work")!.rank)).toBeLessThan(0);
  });

  test("between two siblings: a rank strictly between theirs", () => {
    const next = placeFolder(folders, "ideas", null, "work")!;
    expect(order(next)).toEqual(["work", "  clients", "    acme", "ideas", "home"]);
    const r = (id: string) => next.find((f) => f.id === id)!.rank;
    expect(compareRank(r("work"), r("ideas"))).toBeLessThan(0);
    expect(compareRank(r("ideas"), r("home"))).toBeLessThan(0);
    expect(order(ranked(next))).toEqual(order(next));
  });

  test("last, and into another folder (with what's inside it)", () => {
    expect(order(placeFolder(folders, "work", null, "ideas")!)).toEqual(["home", "ideas", "work", "  clients", "    acme"]);
    const nested = placeFolder(folders, "clients", "home", null)!;
    expect(order(nested)).toEqual(["work", "home", "  clients", "    acme", "ideas"]);
    expect(order(ranked(nested))).toEqual(order(nested));
  });

  test("refuses what the server refuses", () => {
    expect(placeFolder(folders, "work", "acme", null)).toBeNull();
    expect(placeFolder(folders, "work", "nope", null)).toBeNull();
    expect(placeFolder(folders, "nope", null, null)).toBeNull();
  });

  test("a folder made offline (a stand-in rank) still takes its place in the list", () => {
    const offline = [...folders, { id: "new", parentFolderId: null, rank: "~e0001" }];
    expect(order(placeFolder(offline, "new", null, null)!)).toEqual(["new", "work", "  clients", "    acme", "home", "ideas"]);
  });

  test("the outbox overlay shows a waiting reorder at once", () => {
    const data: SidebarData = { folders: folders.map((f) => ({ ...f, name: f.id, color: null })), tags: [] };
    const entries = [
      { id: "e1", name: "organization.moveFolder", args: { folderId: "ideas", parentFolderId: null, afterFolderId: null }, keys: [], label: "Move folder", createdAt: 1, attempts: 0 },
      { id: "e2", name: "organization.moveFolder", args: { folderId: "home", parentFolderId: "work", afterFolderId: null }, keys: [], label: "Move folder", createdAt: 2, attempts: 0 },
    ] as unknown as OutboxEntry[];
    expect(order(overlaySidebar(data, entries, { kind: "personal" }).folders as F[])).toEqual(["ideas", "work", "  home", "  clients", "    acme"]);
  });
});
