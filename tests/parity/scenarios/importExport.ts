// Import and export (convex/imports.ts, exports.ts; local: lib/local/functions/imports.ts, exports.ts): a
// Markdown or text file becomes a note (front matter, warnings, images, a batch of pages that link to and
// nest in each other), and the export ZIP holds the same files with the same contents: each note's Markdown
// in its folder, its attachments, manifest.json, blocks.json, found-text.json and the README.
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import { strFromU8, unzipSync } from "fflate";
import { api } from "../../../convex/_generated/api";
import { heading, para, todo } from "../kit";
import { scenario, type ParityBackend } from "../types";
import { fileBlock, imageBlock, PDF, PNG } from "./files";

/** What a call refused with ({ code, message }), or what it returned. */
async function attempt<T>(p: Promise<T>): Promise<{ ok: T } | { error: unknown }> {
  try {
    return { ok: await p };
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    return { error: typeof data === "string" ? JSON.parse(data) : (data ?? String(e)) };
  }
}

const ULIDS = /[0-9A-HJKMNP-TV-Z]{26}/g;
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;

/** Ids and times inside text (file paths, Markdown, front matter, synced blocks' `<block>_<block>` ids) as names. */
function scrub(b: ParityBackend, value: unknown): unknown {
  const text = (s: string) =>
    s
      .replace(ULIDS, (id) => b.known.get(id) ?? "<ulid>")
      .replace(ISO, "<iso>")
      .replace(/\d{4}-\d\d-\d\d\.zip$/, "<date>.zip");
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map((v) => scrub(b, v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [text(k), scrub(b, v)]));
  return value;
}

const syncedBlock = (id: string, sourceId: string, rank: string): WireBlock => ({ id, type: "synced", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props: { sourceId } });

const MARKDOWN = `---
title: Imported trip notes
tags: travel
---

# Day one

Walked to the **old harbour** and read about it on [the museum site](https://example.com/harbour).

- Pack light
- Bring a map
  - The paper one

- [ ] Book the ferry
- [x] Pick a hostel

\`\`\`js
const bags = 1;
\`\`\`

| Day | Place |
| --- | ----- |
| 1   | Harbour |

![The harbour](harbour.png)

<div class="callout">Raw HTML here</div>
`;

export const scenarios = [
  scenario({
    name: "import: a Markdown file becomes a note, with its warnings and images",
    ignore: ["icon"],
    async run(b, k) {
      // The importer puts images in first (no note yet), then names them in imageMap.
      const image = k.name(await b.upload({ bytes: PNG, filename: "harbour.png", mimeType: "image/png", kind: "image" }), "image");
      const result = await b.mutation(api.imports.importText, { scope: b.scope, filename: "trip.md", content: MARKDOWN, format: "markdown", imageMap: { "harbour.png": image } });
      const note = k.name(result.document.id, "note");
      const blocks = await b.query(api.blocks.list, { documentId: note });
      const text = await b.mutation(api.imports.importText, { scope: b.scope, filename: "Plain words.txt", content: "First line\nsecond line\n\nA new paragraph.", format: "text" });
      k.name(text.document.id, "text");
      const textBlocks = await b.query(api.blocks.list, { documentId: text.document.id });
      const found = (await b.query(api.search.documents, { scope: b.scope, query: "harbour" })).map((r) => ({ id: r.id, snippet: r.snippet }));
      const images = await b.query(api.files.urls, { fileIds: [image], now: Math.floor(Date.now() / 3_600_000) * 3_600_000 });
      return { result, blocks: blocks?.blocks, text, textBlocks: textBlocks?.blocks, found, imageFound: Object.keys(images) };
    },
  }),
  scenario({
    name: "import: a batch of pages that nest and link to each other, into a folder, and what it refuses",
    ignore: ["icon"],
    async run(b, k) {
      const folder = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Imported" })).id, "folder");
      await b.mutation(api.organization.setFolderColor, { folderId: folder, color: "olive" });
      const home = k.id("home");
      const projects = k.id("projects");
      const links = { "Home.md": home, "Home/Projects.md": projects };
      const first = await b.mutation(api.imports.importText, { scope: b.scope, filename: "Home.md", content: "# Home\n\nSee [Projects](Home/Projects.md).", format: "markdown", folderId: folder, publicId: home, links });
      const second = await b.mutation(api.imports.importText, { scope: b.scope, filename: "Projects.md", content: "Back to [Home](../Home.md) or [Home](Home.md).", format: "markdown", publicId: projects, parentId: home, links });
      const homeBlocks = await b.query(api.blocks.list, { documentId: home });
      const projectBlocks = await b.query(api.blocks.list, { documentId: projects });
      const tree = await b.query(api.documents.pageTree, { documentId: projects });
      const refused = {
        folder: await attempt(b.mutation(api.imports.importText, { scope: b.scope, filename: "a.md", content: "x", format: "markdown", folderId: ulid() })),
        id: await attempt(b.mutation(api.imports.importText, { scope: b.scope, filename: "a.md", content: "x", format: "markdown", publicId: "not-an-id" })),
        parent: await attempt(b.mutation(api.imports.importText, { scope: b.scope, filename: "a.md", content: "x", format: "markdown", parentId: ulid() })),
        taken: await attempt(b.mutation(api.imports.importText, { scope: b.scope, filename: "a.md", content: "x", format: "markdown", publicId: home })),
      };
      return { first, second, homeBlocks: homeBlocks?.blocks, projectBlocks: projectBlocks?.blocks, tree, refused };
    },
  }),
  scenario({
    name: "export: the ZIP's files and what they say",
    async run(b, k) {
      const folder = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Trips" })).id, "folder");
      await b.mutation(api.organization.setFolderColor, { folderId: folder, color: "olive" });
      const other = await k.newNote("other", { title: "Packing" });
      await k.upsert(other, [para(ulid(), "Socks.", "V")]);
      const source = k.id("source");
      await k.apply([{ opId: ulid(), kind: "document.create", document: { id: source, parentDocumentId: null, folderId: null, kind: "synced", title: "", icon: null } }]);
      await k.upsert(source, [para(k.id("sourceLine"), "Shared: passports and tickets.", "V")]);
      const trip = await k.newNote("trip", { title: "Field trip", folder });
      const png = k.name(await b.upload({ bytes: PNG, filename: "map.png", mimeType: "image/png", kind: "image", documentId: trip }), "png");
      const pdf = k.name(await b.upload({ bytes: PDF, filename: "tickets.pdf", mimeType: "application/pdf", kind: "file", documentId: trip }), "pdf");
      const pdfBlock = k.id("pdfBlock");
      await k.upsert(trip, [
        heading(k.id("h"), "Plan", "M"),
        { ...para(k.id("p"), "", "N"), text: [{ type: "text", text: "Read " }, { type: "pageLink", documentId: other, label: "old title" }, { type: "text", text: " first." }] } as WireBlock,
        todo(k.id("t"), "Print the tickets", "O"),
        imageBlock(k.id("img"), png, "P"),
        fileBlock(pdfBlock, pdf, "tickets.pdf", "Q"),
        syncedBlock(k.id("synced"), source, "R"),
      ]);
      await b.mutation(api.fileText.save, { documentId: trip, blockId: pdfBlock, fileId: pdf, source: "pdf", text: "Ferry ticket, seat 12A", pageStarts: [0] });
      const archived = await k.newNote("archived", { title: "Old trip" });
      await b.mutation(api.documents.setArchived, { documentId: archived, archived: true });

      const result = await b.action(api.exports.exportScope, { scope: b.scope });
      const zip = unzipSync(await b.download(result.url));
      const mine = new Set([trip, other, archived]);
      const names = Object.keys(zip);
      const manifest = JSON.parse(strFromU8(zip["manifest.json"]!)) as { documents: { id: string }[]; assets: { documentId: string }[]; skippedAssets: unknown[] } & Record<string, unknown>;
      const blocksJson = JSON.parse(strFromU8(zip["blocks.json"]!)) as Record<string, unknown>;
      const foundText = zip["found-text.json"] ? (JSON.parse(strFromU8(zip["found-text.json"])) as Record<string, unknown>) : {};
      const markdown = (id: string) => {
        const doc = manifest.documents.find((d) => d.id === id) as { markdown: string } | undefined;
        return doc ? strFromU8(zip[doc.markdown]!) : null;
      };
      const assetNames = names.filter((n) => n.startsWith("assets/") && manifest.assets.some((a) => mine.has(a.documentId) && n === (a as unknown as { path: string }).path));
      return scrub(b, {
        result: { ...result, url: result.url.length > 0 },
        files: { readme: strFromU8(zip["README.txt"]!), hasManifest: "manifest.json" in zip, mine: names.filter((n) => /^(Trips|Documents|Archive)\//.test(n) && /Field trip|Packing|Old trip/.test(n)), assets: assetNames },
        manifest: { ...manifest, documents: manifest.documents.filter((d) => mine.has(d.id)), assets: manifest.assets.filter((a) => mine.has(a.documentId)), skippedAssets: manifest.skippedAssets },
        blocks: Object.fromEntries([...mine].map((id) => [id, blocksJson[id]])),
        foundText: Object.fromEntries([...mine].filter((id) => foundText[id]).map((id) => [id, foundText[id]])),
        markdown: { trip: markdown(trip), other: markdown(other), archived: markdown(archived), source: markdown(source) },
        assetBytes: assetNames.map((n) => zip[n]!.length),
      });
    },
  }),
];
