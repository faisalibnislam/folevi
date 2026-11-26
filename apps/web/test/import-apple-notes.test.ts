// Apple Notes import (lib/import/appleNotes.ts): the HTML Notes hands over through its scripting interface, as
// pages. The fixtures in fixtures/apple-notes are written in the shape Notes' `body` property has (a div per
// line, the title as the first line, images as data: URIs, tables in a div); no real Notes library is read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appleNoteDoc, appleNotesSummary, importAppleNotes, withoutTitleLine, type AppleNotesBridge } from "@/lib/import/appleNotes";

vi.mock("@/lib/sync/uploads", () => ({ uploadFileNow: vi.fn(async () => "file-1") }));

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/apple-notes", name), "utf8");

describe("Apple Notes notes as pages", () => {
  it("keeps the text, lists, links and monospaced text, with the title once as the heading", () => {
    const doc = appleNoteDoc({ id: "x-coredata://A/ICNote/p1", title: "Groceries", html: fixture("groceries.html"), folder: ["Home"], attachments: [] });
    expect(doc.content).toBe(
      ["# Groceries", "For the **weekend**, see [recipes](https://example.com/recipes).", "- Milk\n- Bread\n  - Sourdough", "1. Shop\n2. Cook", "`2 * 3`"].join("\n\n"),
    );
    expect(doc.folderPath).toEqual(["Home"]);
    expect(doc.name).toBe("Home / Groceries");
    expect(doc.filename).toBe("Groceries.md");
    expect(doc.warnings).toEqual([]);
  });

  it("brings PNG, JPEG, GIF and WebP images along, leaves others out and counts other attachments", () => {
    const doc = appleNoteDoc({ id: "p2", title: "Trip photos", html: fixture("photo.html"), folder: [], attachments: ["IMG_1.png", "IMG_2.heic", "Ticket.pdf"] });
    expect(doc.content).toBe("# Trip photos\n\nDay one\n\n![](apple-notes-image-1)\n\nThe end");
    expect([...doc.images.keys()]).toEqual(["apple-notes-image-1"]);
    expect(doc.images.get("apple-notes-image-1")!.mime).toBe("image/png");
    expect(doc.folderPath).toBeUndefined();
    expect(doc.warnings.map((w) => w.message)).toEqual([
      "1 image in a format other than PNG, JPEG, GIF or WebP was left out",
      "1 attachment (files, scans, drawings, audio or links) isn’t imported: Notes doesn’t hand it over. Its attachments: IMG_1.png, IMG_2.heic, Ticket.pdf",
    ]);
  });

  it("keeps a Notes table as a table", () => {
    const doc = appleNoteDoc({ id: "p3", title: "Budget", html: fixture("table.html"), folder: ["iCloud", "Money"] });
    expect(doc.content).toBe("# Budget\n\n| Item | Cost |\n| --- | --- |\n| Rent | 1,200 |");
    expect(doc.folderPath).toEqual(["iCloud", "Money"]);
  });

  it("drops the first line only when it is the title", () => {
    expect(withoutTitleLine("<div><br></div><div>Plan</div><div>Plan</div>", "Plan")).toBe("<div><br></div><div>Plan</div>");
    expect(withoutTitleLine("<div>Other</div><div>Plan</div>", "Plan")).toBe("<div>Other</div><div>Plan</div>");
  });

  it("titles an untitled note and cleans folder names", () => {
    const doc = appleNoteDoc({ id: "p4", title: "  ", html: "<div>Just text</div>", folder: ["Work\u0007", ""] });
    expect(doc.content).toBe("# Untitled\n\nJust text");
    expect(doc.folderPath).toEqual(["Work"]);
  });
});

describe("Apple Notes import in batches", () => {
  const refs = Array.from({ length: 45 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, folder: i % 2 ? ["Notes"] : ["Notes", "Sub"] }));
  const bridge = (onRead?: (ids: string[]) => void): AppleNotesBridge => ({
    access: async () => "granted",
    scan: async () => ({ notes: refs, locked: 3 }),
    read: async (ids) => {
      onRead?.(ids);
      return ids.filter((id) => id !== "n7").map((id) => ({ id, html: `<div>${id}</div><div>Body of ${id}</div>`, attachments: [] }));
    },
  });
  const sidebar = () => {
    const folders: { id: string; name: string; parentFolderId: string | null }[] = [{ id: "F1", name: "Notes", parentFolderId: null }];
    return { client: { query: vi.fn(async () => ({ folders: [...folders] })) }, made: (x: { id: string; name: string; parentFolderId?: string }) => void folders.push({ ...x, parentFolderId: x.parentFolderId ?? null }) };
  };

  it("reads 20 at a time, imports every note it gets, reuses folders and reports the rest", async () => {
    const reads: number[] = [];
    const created: { name: string }[] = [];
    const { client, made } = sidebar();
    let n = 0;
    const importText = vi.fn(async () => ({ document: { id: `D${++n}` }, warnings: [] }));
    const r = await importAppleNotes(client as never, { kind: "personal" }, bridge((ids) => reads.push(ids.length)), {
      importText,
      createFolder: async (x: { id: string; name: string; parentFolderId?: string }) => {
        created.push(x);
        made(x);
      },
    });
    expect(reads).toEqual([20, 20, 5]);
    expect(importText).toHaveBeenCalledTimes(44);
    expect(r.results.filter((x) => x.id)).toHaveLength(44);
    expect(r.results.find((x) => !x.id)?.name).toBe("Notes / Note 7");
    // "Notes" is there already; "Sub" is made once, in the first batch, and found in the sidebar after that.
    expect(created.map((c) => c.name)).toEqual(["Sub"]);
    expect(appleNotesSummary(r)).toBe("Imported 44 of 45 notes from Apple Notes; 3 locked notes skipped (unlock them in Notes to import)");
  });

  it("stops between notes when cancelled", async () => {
    const abort = new AbortController();
    const { client } = sidebar();
    let n = 0;
    const importText = vi.fn(async () => {
      if (++n === 5) abort.abort();
      return { document: { id: `D${n}` }, warnings: [] };
    });
    const r = await importAppleNotes(client as never, { kind: "personal" }, bridge(), { importText, createFolder: async () => undefined, signal: abort.signal });
    expect(importText).toHaveBeenCalledTimes(5);
    expect(r.cancelled).toBe(true);
    expect(appleNotesSummary(r)).toMatch(/^Stopped: imported 5 of 45 notes/);
  });
});
