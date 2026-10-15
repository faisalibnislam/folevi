// Importing a folder keeps its tree (lib/import/folders.ts): each file goes in the folder its path names,
// at most five levels deep, and folders already there with the same name under the same parent are reused.
import { describe, expect, test, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { entriesFromFiles, entryMap } from "@/components/doc/importBundle";
import { folderPathOf, planFolders } from "@/lib/import/folders";
import { isNotionExport, loadMarkdown, markdownDocs } from "@/lib/import/sources";

// The app gets mammoth's browser build, which reads an ArrayBuffer; under Node it wants a buffer.
vi.mock("mammoth", async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import("mammoth") }>()).default;
  const convertToHtml: typeof real.convertToHtml = (input, options) => real.convertToHtml("arrayBuffer" in input ? { buffer: Buffer.from(input.arrayBuffer) } : input, options);
  const mammoth = { ...real, convertToHtml };
  return { ...mammoth, default: mammoth };
});

// A PNG's first bytes are enough for an image the importer passes along as it is.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** A tiny Word document: a bold line, a paragraph and a PNG (as Word writes them, cut down). */
function tinyDocx(): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const image = '<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="The site"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const body = `<w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Site plan</w:t></w:r></w:p><w:p><w:r><w:t>Pour the slab on Monday.</w:t></w:r></w:p><w:p>${image}</w:p></w:body>`;
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}>${body}</w:document>`),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>'),
    "word/media/image1.png": PNG,
  });
}

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

  test("a ZIP's Word and HTML files come along like its Markdown, each in the folder its path names", async () => {
    const html = '<html><head><title>Trip</title></head><body><p>Ferry on <b>Friday</b>.</p><img src="../img/photo.png" alt="Pier"><img src="missing.png"></body></html>';
    const zip = zipSync({ "Notes/readme.md": strToU8("# Readme"), "Notes/Work/plan.docx": tinyDocx(), "Notes/Web/Pages/trip.html": strToU8(html), "Notes/Web/img/photo.png": PNG });
    const { entries, errors } = await entriesFromFiles([new File([zip], "Export.zip", { type: "application/zip" })]);
    expect(errors).toEqual([]);
    expect(isNotionExport(entries)).toBe(false);
    const docs = markdownDocs(entries, entryMap(entries));
    expect(docs.map((d) => [d.path, d.folderPath ?? null, d.filename])).toEqual([
      ["Export/Notes/readme.md", ["Export", "Notes"], "readme.md"],
      ["Export/Notes/Work/plan.docx", ["Export", "Notes", "Work"], "plan.md"],
      ["Export/Notes/Web/Pages/trip.html", ["Export", "Notes", "Web", "Pages"], "trip.md"],
    ]);
    // Their folders, made once each, parents first.
    expect(planFolders(docs.map((d) => d.folderPath!), []).steps.map((s) => s.name)).toEqual(["Export", "Notes", "Work", "Web", "Pages"]);

    // Word: its text and its image, as when a .docx is picked by itself.
    const word = docs[1]!;
    await loadMarkdown(word);
    expect(word.content).toBe("**Site plan**\n\nPour the slab on Monday.\n\n![The site](docx-image-1)");
    expect([...word.images.entries()].map(([src, img]) => [src, img.filename, img.mime, img.blob.size])).toEqual([["docx-image-1", "image-1.png", "image/png", PNG.length]]);
    expect(word.warnings).toEqual([]);

    // HTML: titled by its <title>; an image elsewhere in the ZIP comes along, one that isn't there stays a link.
    const page = docs[2]!;
    await loadMarkdown(page);
    expect(page.filename).toBe("Trip.md");
    expect(page.content).toBe("# Trip\n\nFerry on **Friday**.\n\n![Pier](../img/photo.png)\n\n![](missing.png)");
    expect([...page.images.keys()]).toEqual(["../img/photo.png"]);
    expect(page.images.get("../img/photo.png")).toMatchObject({ filename: "photo.png", mime: "image/png" });
    expect(page.warnings).toEqual([{ message: "Image “missing.png” isn’t in the file and was kept as a link" }]);
  });
});
