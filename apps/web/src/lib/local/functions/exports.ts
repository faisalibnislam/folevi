// exports.exportScope in local mode (convex/exports.ts): the whole library as a ZIP, built on this device with
// fflate, in the server's layout: one Markdown file per note in folders that mirror the sidebar, assets/,
// manifest.json, blocks.json, found-text.json and a README. Synced content is written into each note showing
// it; links read with the current titles.
//
// The ZIP is saved through the app (`shell().files.save`, a save dialog on the Mac); the answer's `url` is
// then empty, since there's nothing left to download. Without a shell (a development browser, tests) the url
// is an object URL of the ZIP, which Settings downloads as on the website. Cancelling the dialog is an error
// with code "cancelled", which Settings treats as nothing happening.
import { blocksToMarkdown, type WireBlock } from "@folevi/editor-schema";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { ConvexError } from "convex/values";
import { safeFilename } from "@folevi/editor-schema/fileBytes";
import { api } from "@/lib/convex/api";
import { shell } from "@/lib/shell";
import { defineLocal, type LocalReader } from "../registry";
import type { LocalFile, LocalFileText } from "../store";
import { checkScope, liveBlocks, ReaderLabels, requireProfile, toWireBlock, withSyncedContent } from "./shared";

/** What an export of Personal is called. */
const PERSONAL_EXPORT_NAME = "Personal";
const MAX_EXPORT_ASSET_BYTES = 400 * 1024 * 1024;

interface ExportDoc {
  id: string;
  title: string;
  kind: string;
  icon: string | null;
  parentId: string | null;
  folder: string | null;
  folderPath: string[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  dailyDate: string | null;
  blocks: WireBlock[];
  files: LocalFile[];
  foundText: { blockId: string; fileId: string | null; source: string; by: string; pageStarts: number[] | null; text: string }[];
}

/** Every note as the export writes it, in the order they were made (convex/exports.ts documentPage). */
async function collect(db: LocalReader): Promise<ExportDoc[]> {
  const docs = (await db.list("documents")).sort((a, b) => a.createdAt - b.createdAt || a.ordinal - b.ordinal);
  const folders = new Map((await db.list("folders")).map((f) => [f.id, f]));
  const filesByDoc = new Map<string, LocalFile[]>();
  for (const f of (await db.list("files")).sort((a, b) => a.createdAt - b.createdAt)) {
    if (!f.documentId) continue;
    const list = filesByDoc.get(f.documentId) ?? [];
    list.push(f);
    filesByDoc.set(f.documentId, list);
  }
  const labels = new ReaderLabels(db);
  const out: ExportDoc[] = [];
  for (const d of docs) {
    // Synced content is written into each note that shows it, not as a page of its own.
    if (d.inTrash || d.kind === "synced") continue;
    const own = (await liveBlocks(db, d.id)).map(toWireBlock);
    const blocks = await labels.blocks(await withSyncedContent(db, d, own));
    const folder = d.folderId ? folders.get(d.folderId) : undefined;
    const folderPath: string[] = [];
    for (let f = folder, i = 0; f && f.deletedAt === null && i < 8; i++) {
      folderPath.unshift(f.name);
      f = f.parentFolderId ? folders.get(f.parentFolderId) : undefined;
    }
    const files = (filesByDoc.get(d.id) ?? []).slice(0, 200);
    const fileIds = new Set(files.map((f) => f.id));
    const found: LocalFileText[] = (await db.list("fileTexts", d.id)).sort((a, b) => (a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : a.createdAt - b.createdAt)).slice(0, 200);
    out.push({
      id: d.id,
      title: d.title,
      kind: d.kind,
      icon: d.icon ?? null,
      parentId: d.parentDocumentId,
      folder: folder && folder.deletedAt === null ? folder.name : null,
      folderPath,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      archived: Boolean(d.archivedAt),
      dailyDate: d.dailyDate ?? null,
      blocks,
      files,
      foundText: found
        .filter((r) => r.text && (!r.fileId || fileIds.has(r.fileId)))
        .map((r) => ({ blockId: r.blockId, fileId: r.fileId, source: r.source, by: r.by, pageStarts: r.pageStarts ?? null, text: r.text })),
    });
  }
  return out;
}

/** The ZIP of the library, laid out exactly as the server's (convex/exports.ts buildExport). */
async function buildZip(collected: ExportDoc[], now: number): Promise<{ bytes: Uint8Array; filename: string; documents: number; assets: number; skippedAssets: string[]; skippedReason: "size" | "missing" | null }> {
  const exportedAt = new Date(now).toISOString();
  const manifest: { format: string; version: number; exportedAt: string; scope: "personal"; workspace: string; documents: unknown[]; assets: unknown[]; skippedAssets: unknown[] } = {
    format: "folevi-export",
    version: 1,
    exportedAt,
    scope: "personal",
    workspace: PERSONAL_EXPORT_NAME,
    documents: [],
    assets: [],
    skippedAssets: [],
  };
  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else if (chunk) chunks.push(chunk);
  });
  const addFile = (path: string, bytes: Uint8Array, compress: boolean) => {
    const entry = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
    zip.add(entry);
    entry.push(bytes, true);
  };
  const usedNames = new Set<string>();
  const nameFor = (dir: string, base: string) => {
    const clean = safeFilename(base || "Untitled").slice(0, 100);
    let name = clean;
    let n = 1;
    while (usedNames.has(`${dir}/${name}`.toLowerCase())) name = `${clean.slice(0, 96)} (${++n})`;
    usedNames.add(`${dir}/${name}`.toLowerCase());
    return name;
  };
  let assetCount = 0;
  let totalBytes = 0;
  const skipped: string[] = [];
  let skippedReason: "size" | "missing" | null = null;
  const pathById = new Map<string, string>();
  for (const d of collected) {
    const dir = d.kind === "daily" ? "Daily Notes" : d.kind === "template" ? "Templates" : d.archived ? "Archive" : d.folderPath.length ? d.folderPath.map((f) => safeFilename(f)).join("/") : "Documents";
    pathById.set(d.id, `${dir}/${nameFor(dir, d.title || (d.dailyDate ?? "Untitled"))}`);
  }
  for (const d of collected) {
    const path = pathById.get(d.id)!;
    const assetPaths = new Map<string, string>();
    for (const f of d.files) {
      if (totalBytes + f.size > MAX_EXPORT_ASSET_BYTES) {
        skipped.push(f.name);
        skippedReason = "size";
        manifest.skippedAssets.push({ id: f.id, filename: f.name, size: f.size, documentId: d.id, reason: "export_size_limit" });
        continue;
      }
      // A file whose bytes can't be read (not on this device yet) is listed as left out.
      const bytes = await f.blob.arrayBuffer().then(
        (b) => new Uint8Array(b),
        () => null,
      );
      if (!bytes) {
        skipped.push(f.name);
        skippedReason ??= "missing";
        manifest.skippedAssets.push({ id: f.id, filename: f.name, size: f.size, documentId: d.id, reason: "unavailable" });
        continue;
      }
      const assetPath = `assets/${f.id}-${safeFilename(f.name)}`;
      addFile(assetPath, bytes, false);
      totalBytes += f.size;
      assetPaths.set(f.id, assetPath);
      manifest.assets.push({ id: f.id, path: assetPath, filename: f.name, mimeType: f.mimeType, size: f.size, documentId: d.id });
      assetCount++;
    }
    const up = "../".repeat(path.split("/").length - 1);
    const opts = {
      resolveFile: (id: string) => (assetPaths.has(id) ? `${up}${assetPaths.get(id)}` : null),
      resolveDocument: (id: string) => {
        const p = pathById.get(id);
        return p ? `${up}${p}.md` : null;
      },
      resolveDocumentTitle: (id: string) => collected.find((x) => x.id === id)?.title || null,
    };
    const frontMatter = { folevi_id: d.id, created: new Date(d.createdAt).toISOString(), updated: new Date(d.updatedAt).toISOString() };
    addFile(`${path}.md`, strToU8(blocksToMarkdown(d.blocks, { ...opts, title: d.title || "Untitled", frontMatter })), true);
    manifest.documents.push({
      id: d.id,
      title: d.title,
      kind: d.kind,
      icon: d.icon,
      parentId: d.parentId,
      folder: d.folder,
      folderPath: d.folderPath,
      archived: d.archived,
      dailyDate: d.dailyDate,
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
      markdown: `${path}.md`,
      blocks: d.blocks.length,
    });
  }
  addFile("manifest.json", strToU8(JSON.stringify(manifest, null, 2)), true);
  addFile("blocks.json", strToU8(JSON.stringify(Object.fromEntries(collected.map((d) => [d.id, d.blocks])))), true);
  const foundText = collected.filter((d) => d.foundText.length).map((d) => [d.id, d.foundText] as const);
  if (foundText.length) addFile("found-text.json", strToU8(JSON.stringify(Object.fromEntries(foundText), null, 2)), true);
  addFile(
    "README.txt",
    strToU8(
      `Folevi export of "${PERSONAL_EXPORT_NAME}" (${exportedAt}).\n\nEach document is a Markdown file in a folder matching your sidebar; attachments are in assets/. manifest.json lists documents, folders and assets (and any attachments left out); blocks.json holds the canonical Folevi block data; found-text.json (when there is any) holds the text found in PDFs, images and handwriting, which search uses.\n`,
    ),
    true,
  );
  zip.end();
  if (zipError) throw zipError;
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const filename = `${safeFilename(PERSONAL_EXPORT_NAME)}-folevi-export-${exportedAt.slice(0, 10)}.zip`;
  return { bytes, filename, documents: collected.length, assets: assetCount, skippedAssets: skipped, skippedReason: skipped.length ? skippedReason : null };
}

/** An address the page can download the ZIP from, when no app is there to save it. */
function downloadUrl(bytes: Uint8Array): string {
  if (typeof URL.createObjectURL === "function") return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:application/zip;base64,${btoa(binary)}`;
}

defineLocal(api.exports.exportScope, "action", async (ctx, args) => {
  checkScope(args.scope);
  const collected = await ctx.mutate(async (m) => {
    await requireProfile(m);
    return await collect(m.db);
  });
  const { bytes, ...built } = await buildZip(collected, ctx.now());
  const files = shell()?.files;
  if (files) {
    if (!(await files.save(built.filename, bytes))) throw new ConvexError({ code: "cancelled", message: "Export cancelled." });
    return { url: "", ...built };
  }
  return { url: downloadUrl(bytes), ...built };
});
