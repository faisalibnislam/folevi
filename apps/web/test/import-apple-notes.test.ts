// Apple Notes import (lib/import/appleNotes.ts): the HTML Notes hands over through its scripting interface, as
// pages. The fixtures in fixtures/apple-notes are written in the shape Notes' `body` property has (a div per
// line, the title as the first line, images as data: URIs, tables in a div); no real Notes library is read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { importDocs } from "@/lib/import/run";
import { appleNoteDoc, appleNotesSummary, hashtags, importAppleNotes, withoutTitleLine, type AppleNotesBridge } from "@/lib/import/appleNotes";

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

  it("brings web images along as pictures and keeps any other image as its file", () => {
    const doc = appleNoteDoc({ id: "p2", title: "Trip photos", html: fixture("photo.html"), folder: [], attachments: [{ name: "IMG_1.png", mime: "image/png", data: "AAAA" }, { name: "IMG_2.heic", mime: "image/heic", data: "AAAA" }] });
    expect(doc.content).toBe("# Trip photos\n\nDay one\n\n![](apple-notes-image-1)\n\n[Image](apple-notes-file-1)\n\nThe end");
    expect([...doc.images.keys()]).toEqual(["apple-notes-image-1"]);
    expect(doc.images.get("apple-notes-image-1")!.mime).toBe("image/png");
    expect(doc.files!.get("apple-notes-file-1")).toMatchObject({ filename: "Image.heic", mime: "image/heic" });
    // Both listed attachments are the body's pictures: nothing is added twice.
    expect(doc.warnings).toEqual([]);
    expect(doc.folderPath).toBeUndefined();
  });

  it("puts every attachment where the note shows it, the rest at the end, and keeps tags and dates", () => {
    const pdf = btoa("%PDF-1.4 test");
    const doc = appleNoteDoc({
      id: "p5",
      title: "Trip",
      html: fixture("attachments.html"),
      folder: ["Travel"],
      created: 1_600_000_000_000,
      modified: 1_700_000_000_000,
      attachments: [
        { name: "photo.png", mime: "image/png", data: "AAAA" },
        { name: "Tickets.pdf", cid: "cid:TICKET-1@notes", mime: "application/pdf", data: pdf },
        { name: "Voice memo.m4a", mime: "audio/mp4", data: "AAAA" },
        { name: "Hotel", url: "https://example.com/hotel" },
        { name: "Scan.pdf", error: "it’s over 512 MB" },
      ],
    });
    expect(doc.content).toBe(
      [
        "# Trip",
        "Plans for #travel and #Japan-2027, not #42 or example.com/#anchor.",
        "![](apple-notes-image-1)",
        "The tickets:",
        "[Tickets.pdf](apple-notes-file-1)",
        "See you there #travel",
        "[Voice memo.m4a](apple-notes-file-2)",
        "[Hotel](https://example.com/hotel)",
      ].join("\n\n"),
    );
    expect([...doc.files!.entries()].map(([k, f]) => [k, f.filename, f.mime])).toEqual([
      ["apple-notes-file-1", "Tickets.pdf", "application/pdf"],
      ["apple-notes-file-2", "Voice memo.m4a", "audio/mp4"],
    ]);
    expect(doc.tags).toEqual(["travel", "Japan-2027"]);
    expect(doc.createdAt).toBe(1_600_000_000_000);
    expect(doc.updatedAt).toBe(1_700_000_000_000);
    expect(doc.warnings.map((w) => w.message)).toEqual(["Attachment “Scan.pdf” couldn’t be taken out of Notes: it’s over 512 MB"]);
  });

  it("sends the attachments, tags and dates to importText", async () => {
    const doc = appleNoteDoc({
      id: "p6",
      title: "Trip",
      html: "<div>Trip</div><div>#travel</div>",
      folder: [],
      created: 1_600_000_000_000,
      modified: 1_700_000_000_000,
      attachments: [{ name: "Tickets.pdf", mime: "application/pdf", data: btoa("%PDF") }],
    });
    const importText = vi.fn(async () => ({ document: { id: "D1" }, warnings: [] }));
    const [r] = await importDocs({ query: vi.fn() } as never, { kind: "personal" }, [doc], { importText, createFolder: async () => undefined });
    expect(importText).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "# Trip\n\n#travel\n\n[Tickets.pdf](apple-notes-file-1)",
        fileMap: { "apple-notes-file-1": { fileId: "file-1", name: "Tickets.pdf", size: 4, mimeType: "application/pdf" } },
        tags: ["travel"],
        createdAt: 1_600_000_000_000,
        updatedAt: 1_700_000_000_000,
      }),
    );
    expect(r).toMatchObject({ id: "D1", files: 1 });
  });

  it("finds Notes' tags but not numbers, anchors or repeats", () => {
    expect(hashtags("#Work notes #work, (#ideas) #1 a#b x/#y #to_do- #日本")).toEqual(["Work", "ideas", "to_do", "日本"]);
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
  /** Hands over at most `budget` notes a read (as a size budget would), and never n7 (deleted meanwhile). */
  const bridge = (onRead?: (ids: string[]) => void, budget = 20): AppleNotesBridge => ({
    access: async () => "granted",
    scan: async () => ({ notes: refs, locked: 3, folders: [["Notes"], ["Notes", "Sub"], ["Empty"], ["Notes", "Sub", "Deep"]] }),
    read: async (ids) => {
      onRead?.(ids);
      const asked = ids.slice(0, budget);
      return { notes: asked.filter((id) => id !== "n7").map((id) => ({ id, html: `<div>${id}</div><div>Body of ${id}</div>`, attachments: [] })), missing: asked.includes("n7") ? ["n7"] : [] };
    },
  });
  const sidebar = () => {
    const folders: { id: string; name: string; parentFolderId: string | null }[] = [{ id: "F1", name: "Notes", parentFolderId: null }];
    return { client: { query: vi.fn(async () => ({ folders: [...folders] })) }, made: (x: { id: string; name: string; parentFolderId?: string }) => void folders.push({ ...x, parentFolderId: x.parentFolderId ?? null }) };
  };

  it("reads in batches, imports every note it gets, makes every folder once (empty ones too) and reports the rest", async () => {
    const reads: number[] = [];
    const created: { name: string }[] = [];
    const { client, made } = sidebar();
    let n = 0;
    const importText = vi.fn(async (_: { createdAt?: number }) => ({ document: { id: `D${++n}` }, warnings: [] }));
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
    // "Notes" is there already; the rest are made once, with the first batch.
    expect(created.map((c) => c.name)).toEqual(["Sub", "Empty", "Deep"]);
    expect(appleNotesSummary(r)).toBe("Imported 44 of 45 notes from Apple Notes; 3 locked notes skipped (remove their locks in Notes to import them)");
  });

  it("asks again for notes a read had no room for", async () => {
    const reads: string[] = [];
    const { client } = sidebar();
    const importText = vi.fn(async () => ({ document: { id: "D" }, warnings: [] }));
    const r = await importAppleNotes(client as never, { kind: "personal" }, bridge((ids) => reads.push(ids[0]!), 7), { importText, createFolder: async () => undefined });
    expect(reads.slice(0, 3)).toEqual(["n0", "n7", "n14"]);
    expect(importText).toHaveBeenCalledTimes(44);
    expect(r.total).toBe(45);
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
