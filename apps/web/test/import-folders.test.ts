// Importing a folder keeps its tree (lib/import/folders.ts): each file goes in the folder its path names,
// at most five levels deep, and folders already there with the same name under the same parent are reused.
import { describe, expect, test } from "vitest";
import { folderPathOf, planFolders } from "@/lib/import/folders";
import { loadMarkdown, markdownDocs } from "@/lib/import/sources";

describe("the folder a file goes in", () => {
  test("its directories, outermost first; loose files go in none", () => {
    expect(folderPathOf("Vault/Projects/2026/plan.md")).toEqual(["Vault", "Projects", "2026"]);
    expect(folderPathOf("Vault/readme.md")).toEqual(["Vault"]);
    expect(folderPathOf("readme.md")).toEqual([]);
  });

  test("deeper than five levels folds into the fifth", () => {
    expect(folderPathOf("a/b/c/d/e/f/g/deep.md")).toEqual(["a", "b", "c", "d", "e"]);
    expect(folderPathOf("a/b/c/d/e/at-five.md")).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("planning the folders", () => {
  test("a three-level tree: each folder made once, parents first, and every file finds its folder", () => {
    const paths = [["Vault"], ["Vault", "Projects"], ["Vault", "Projects", "2026"], ["Vault", "Projects", "2026"], ["Vault", "Archive"]];
    const { steps, folderId } = planFolders(paths, []);
    expect(steps.map((s) => s.name)).toEqual(["Vault", "Projects", "2026", "Archive"]);
    const [vault, projects, year, archive] = steps;
    expect(vault!.parentFolderId).toBeNull();
    expect(projects!.parentFolderId).toBe(vault!.id);
    expect(year!.parentFolderId).toBe(projects!.id);
    expect(archive!.parentFolderId).toBe(vault!.id);
    expect(folderId(["Vault", "Projects", "2026"])).toBe(year!.id);
    expect(folderId(["Vault"])).toBe(vault!.id);
    expect(folderId([])).toBeNull();
  });

  test("folders already there are reused by name under the same parent (not elsewhere)", () => {
    const existing = [
      { id: "F-vault", name: "Vault", parentFolderId: null },
      { id: "F-projects", name: "projects", parentFolderId: "F-vault" },
      { id: "F-other-2026", name: "2026", parentFolderId: null },
    ];
    const { steps, folderId } = planFolders([["Vault", "Projects", "2026"], ["Vault", "Notes"]], existing);
    // Vault and Projects are reused (names match whatever their case); 2026 at the top level isn't the one inside Projects.
    expect(steps.map((s) => [s.name, s.parentFolderId])).toEqual([
      ["2026", "F-projects"],
      ["Notes", "F-vault"],
    ]);
    expect(folderId(["Vault", "Projects"])).toBe("F-projects");
    expect(folderId(["Vault", "Projects", "2026"])).toBe(steps[0]!.id);
  });

  test("a picked folder's Markdown, text and CSV files carry their folder; a CSV becomes a table", async () => {
    const entry = (path: string) => ({ path, blob: new Blob([path.endsWith(".csv") ? "Item,Cost\nTent,120" : "x"]) });
    const entries = [entry("Vault/readme.md"), entry("Vault/Projects/2026/plan.md"), entry("Vault/Projects/budget.csv"), entry("loose.txt"), entry("Vault/Projects/photo.png")];
    const docs = markdownDocs(entries, new Map(entries.map((e) => [e.path, e])));
    expect(docs.map((d) => [d.path, d.folderPath ?? null, d.filename])).toEqual([
      ["Vault/readme.md", ["Vault"], "readme.md"],
      ["Vault/Projects/2026/plan.md", ["Vault", "Projects", "2026"], "plan.md"],
      ["Vault/Projects/budget.csv", ["Vault", "Projects"], "budget.md"],
      ["loose.txt", null, "loose.txt"],
    ]);
    await loadMarkdown(docs[2]!);
    expect(docs[2]!.content).toBe("# budget\n\n| Item | Cost |\n| --- | --- |\n| Tent | 120 |");
  });
});
