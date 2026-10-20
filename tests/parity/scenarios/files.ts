// Files and search in files (convex/files.ts, fileText.ts; local: lib/local/functions/files.ts, fileText.ts):
// an upload is checked and typed from its bytes, a note's files open (files.urls), a note theme's colours are
// kept, pasted files get rows of the note they're pasted into, and the words a device found in a PDF, an image
// or handwriting are kept with the note and found by search with where they were.
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { para } from "../kit";
import { scenario, type ParityBackend } from "../types";

/** A 1×1 PNG. */
export const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
/** Enough of a PDF for its type to be read from the bytes. */
export const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

export const fileBlock = (id: string, fileId: string, name: string, rank = "X"): WireBlock => ({
  id,
  type: "file",
  parentId: null,
  rank,
  schemaVersion: SCHEMA_VERSION,
  text: [],
  props: { fileId, name, size: PDF.length, mimeType: "application/pdf" },
});
export const imageBlock = (id: string, fileId: string, rank = "Y"): WireBlock => ({ id, type: "image", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props: { fileId, alt: "", caption: "" } });
const whiteboard = (id: string, rank = "Z"): WireBlock => ({
  id,
  type: "whiteboard",
  parentId: null,
  rank,
  schemaVersion: SCHEMA_VERSION,
  text: [],
  props: { data: JSON.stringify({ v: 1, strokes: [{ points: [[1, 1], [20, 20]], color: "ink", width: 3 }] }), height: 420 },
});

/** What a call refused with ({ code, message }), or what it returned. */
async function attempt<T>(p: Promise<T>): Promise<{ ok: T } | { error: unknown }> {
  try {
    return { ok: await p };
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    return { error: typeof data === "string" ? JSON.parse(data) : (data ?? String(e)) };
  }
}

/** files.urls without the link itself (each backend has its own kind of address). */
async function fileInfo(b: ParityBackend, fileIds: string[]) {
  const urls = await b.query(api.files.urls, { fileIds, now: Math.floor(Date.now() / 3_600_000) * 3_600_000 });
  return Object.fromEntries(Object.entries(urls).map(([id, { url, ...rest }]) => [id, { ...rest, hasUrl: url.length > 0 }]));
}

export const scenarios = [
  scenario({
    name: "files: uploads typed from their bytes, opened, coloured and refused",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Attachments" });
      const pdf = k.name(await b.upload({ bytes: PDF, filename: "manual.pdf", mimeType: "application/pdf", kind: "file", documentId: note }), "pdf");
      // Filed as a file, read as an image: it's an image.
      const png = k.name(await b.upload({ bytes: PNG, filename: "photo.png", mimeType: "application/octet-stream", kind: "file", documentId: note }), "png");
      const text = k.name(await b.upload({ bytes: new TextEncoder().encode("plain words\n"), filename: "notes.txt", mimeType: "text/plain", kind: "file", documentId: note }), "text");
      const notImage = await attempt(b.upload({ bytes: PDF, filename: "fake.png", mimeType: "image/png", kind: "image", documentId: note }));
      const noNote = await attempt(b.upload({ bytes: PNG, filename: "a.png", mimeType: "image/png", kind: "image", documentId: ulid() }));
      const empty = await attempt(b.upload({ bytes: new Uint8Array(0), filename: "empty.pdf", mimeType: "application/pdf", kind: "file", documentId: note }));
      const before = await fileInfo(b, [pdf, png, text, ulid()]);
      await b.mutation(api.files.setPalette, { fileId: png, palette: { paper: "#FAF7F2", ink: "#222222", paperDark: "#111111", inkDark: "#EEEEEE", tone: "light" } });
      const badColour = await attempt(b.mutation(api.files.setPalette, { fileId: png, palette: { paper: "red", ink: "#222222", paperDark: "#111111", inkDark: "#eeeeee", tone: "light" } }));
      const notThemeImage = await attempt(b.mutation(api.files.setPalette, { fileId: pdf, palette: { paper: "#ffffff", ink: "#222222", paperDark: "#111111", inkDark: "#eeeeee", tone: "light" } }));
      const after = await fileInfo(b, [png]);
      return { before, after, notImage, noNote, empty, badColour, notThemeImage };
    },
  }),
  scenario({
    name: "files: pasted into another note, a file gets a row of that note",
    async run(b, k) {
      const from = await k.newNote("from", { title: "Original" });
      const to = await k.newNote("to", { title: "Pasted into" });
      const png = k.name(await b.upload({ bytes: PNG, filename: "photo.png", mimeType: "image/png", kind: "image", documentId: from }), "png");
      await k.upsert(from, [imageBlock(ulid(), png)]);
      const first = await b.mutation(api.files.shareForPaste, { documentId: to, fileIds: [png, ulid()] });
      const copy = first[png];
      if (copy) k.name(copy, "copy");
      const again = await b.mutation(api.files.shareForPaste, { documentId: to, fileIds: [png] });
      const sameNote = await b.mutation(api.files.shareForPaste, { documentId: from, fileIds: [png] });
      return { first, again, sameNote, copyIsNew: copy !== png, info: await fileInfo(b, copy ? [copy] : []) };
    },
  }),
  scenario({
    name: "search in files: PDF pages, images and handwriting, found with where they were",
    async run(b, k) {
      const manual = await k.newNote("manual", { title: "Boiler manual" });
      const pdf = k.name(await b.upload({ bytes: PDF, filename: "boiler.pdf", mimeType: "application/pdf", kind: "file", documentId: manual }), "pdf");
      const pdfBlock = k.id("pdfBlock");
      await k.upsert(manual, [para(ulid(), "Kept for the yearly service.", "V"), fileBlock(pdfBlock, pdf, "boiler.pdf")]);
      const pages = ["Contents and safety notes.", "Chapter two.\nThe zephyrine valve sits under the front panel. Check the zephyrine seal every year."];
      const text = `${pages[0]}\n\n${pages[1]}`;
      await b.mutation(api.fileText.save, { documentId: manual, blockId: pdfBlock, fileId: pdf, source: "pdf", text, pageStarts: [0, pages[0]!.length + 2] });

      const receipt = await k.newNote("receipt", { title: "Receipts" });
      const png = k.name(await b.upload({ bytes: PNG, filename: "receipt.png", mimeType: "image/png", kind: "image", documentId: receipt }), "png");
      const imgBlock = k.id("imgBlock");
      await k.upsert(receipt, [imageBlock(imgBlock, png)]);
      await b.mutation(api.fileText.save, { documentId: receipt, blockId: imgBlock, fileId: png, source: "image", text: "Marmot Cafe\n2 flat whites   7.50" });

      const board = await k.newNote("board", { title: "Planning board" });
      const wb = k.id("wb");
      await k.upsert(board, [whiteboard(wb)]);
      await b.mutation(api.fileText.save, { documentId: board, blockId: wb, source: "handwriting", text: "Order the zephyrine parts\ncall the plumber about the boiler\nbook the electrician\nbuy paint for the hall", hash: "fp0001" });

      // (Found in two notes: the one made first is also the better match, see search.ts.)
      // The note's own text says it too: no `match`, the snippet is from the note.
      const both = await k.newNote("both", { title: "Parts list" });
      const bothPdf = k.name(await b.upload({ bytes: PDF, filename: "parts.pdf", mimeType: "application/pdf", kind: "file", documentId: both }), "bothPdf");
      const bothBlock = k.id("bothBlock");
      await k.upsert(both, [para(ulid(), "Order a marmot gasket.", "V"), fileBlock(bothBlock, bothPdf, "parts.pdf")]);
      await b.mutation(api.fileText.save, { documentId: both, blockId: bothBlock, fileId: bothPdf, source: "pdf", text: "Marmot gasket, part 7" });

      const search = async (query: string) => (await b.query(api.search.documents, { scope: b.scope, query })).map((r) => ({ id: r.id, snippet: r.snippet, match: r.match }));
      const zephyrine = await search("zephyrine");
      const marmot = await search("marmot");
      const known = { manual: await b.query(api.fileText.forDocument, { documentId: manual }), board: await b.query(api.fileText.forDocument, { documentId: board }) };

      // Saved again (read once more), the text is replaced; the image taken out of the note, its words aren't found.
      await b.mutation(api.fileText.save, { documentId: receipt, blockId: imgBlock, fileId: png, source: "image", text: "Wombat Bakery" });
      const replaced = { old: await search("cafe"), now: await search("wombat") };
      await k.deleteBlock(receipt, imgBlock);
      const removed = await search("wombat");

      const refused = {
        notPdf: await attempt(b.mutation(api.fileText.save, { documentId: receipt, blockId: imgBlock, fileId: png, source: "pdf", text: "x" })),
        notImage: await attempt(b.mutation(api.fileText.save, { documentId: manual, blockId: pdfBlock, fileId: pdf, source: "image", text: "x" })),
        otherNote: await attempt(b.mutation(api.fileText.save, { documentId: board, blockId: pdfBlock, fileId: pdf, source: "pdf", text: "x" })),
        pagesOnImage: await attempt(b.mutation(api.fileText.save, { documentId: receipt, blockId: imgBlock, fileId: png, source: "image", text: "x", pageStarts: [0] })),
        handwritingWithFile: await attempt(b.mutation(api.fileText.save, { documentId: board, blockId: wb, fileId: png, source: "handwriting", text: "x", hash: "fp" })),
        handwritingNoHash: await attempt(b.mutation(api.fileText.save, { documentId: board, blockId: wb, source: "handwriting", text: "x" })),
        badBlock: await attempt(b.mutation(api.fileText.save, { documentId: board, blockId: "no spaces", source: "handwriting", text: "x", hash: "fp" })),
      };
      return { zephyrine, marmot, known, replaced, removed, refused };
    },
  }),
];
