import { v } from "convex/values";
import { action, internalAction, internalQuery, internalMutation, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { blocksToMarkdown, ulid, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, requireProfile, requireWorkspace } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { safeFilename } from "./lib/images";
import { signFileUrl } from "./lib/fileUrls";

export const prepare = internalMutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", "workspace_export"))
      .unique();
    if (flag && !flag.enabled) fail("forbidden", "Workspace export is temporarily unavailable.");
    await consume(ctx, "export", profile._id);
    return { profileId: profile._id, workspaceId: workspace._id, workspaceName: workspace.name };
  },
});

export const documentPage = internalQuery({
  args: { profileId: v.id("profiles"), workspaceId: v.id("workspaces"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const profile = (await ctx.db.get(args.profileId))!;
    const page = await ctx.db
      .query("documents")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", args.workspaceId))
      .paginate({ cursor: args.cursor, numItems: 25 });
    const docs = [];
    for (const d of page.page) {
      if (d.inTrash) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
      const blocks = (await liveBlocks(ctx, d._id)).map(toWireBlock);
      const parent = d.parentDocumentId ? await ctx.db.get(d.parentDocumentId) : null;
      const folder = d.folderId ? await ctx.db.get(d.folderId) : null;
      // Folders nest (one level today); keep the whole path so the export mirrors the sidebar.
      const folderPath: string[] = [];
      for (let f = folder, i = 0; f && !f.deletedAt && i < 8; i++) {
        folderPath.unshift(f.name);
        f = f.parentFolderId ? await ctx.db.get(f.parentFolderId) : null;
      }
      const files = await ctx.db
        .query("files")
        .withIndex("by_document", (q) => q.eq("documentId", d._id))
        .take(200);
      docs.push({
        id: d.publicId,
        title: d.title,
        kind: d.kind,
        icon: d.icon ?? null,
        parentId: parent?.publicId ?? null,
        folder: folder && !folder.deletedAt ? folder.name : null,
        folderPath,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        archived: Boolean(d.archivedAt),
        dailyDate: d.dailyDate ?? null,
        blocks,
        files: files.filter((f) => f.status === "ready").map((f) => ({ id: f.publicId, storageId: f.storageId, filename: f.filename, mimeType: f.mimeType, size: f.size })),
      });
    }
    return { docs, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const storeExport = internalMutation({
  args: { profileId: v.id("profiles"), workspaceId: v.id("workspaces"), storageId: v.id("_storage"), size: v.number(), filename: v.string() },
  handler: async (ctx, args) => {
    const publicId = ulid();
    await ctx.db.insert("files", {
      publicId,
      storageId: args.storageId,
      workspaceId: args.workspaceId,
      uploadedBy: args.profileId,
      filename: args.filename,
      mimeType: "application/zip",
      size: args.size,
      sha256: "",
      kind: "export",
      status: "ready",
      createdAt: Date.now(),
    });
    return publicId;
  },
});

const MAX_EXPORT_ASSET_BYTES = 400 * 1024 * 1024;

type ExportDoc = {
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
  files: { id: string; storageId: Id<"_storage">; filename: string; mimeType: string; size: number }[];
};

/**
 * Workspace export: a ZIP with one Markdown file per document (in folders mirroring the sidebar, nested
 * folders included), an assets folder and a machine-readable manifest.json. The ZIP is streamed: each
 * attachment is added (uncompressed — images and PDFs are compressed already) and released before the
 * next is read, so memory holds the archive plus one file, not every input twice. Attachments that are
 * left out (over the 400 MB budget, or unreadable) are listed in the manifest and returned.
 */
type Prep = { profileId: Id<"profiles">; workspaceId: Id<"workspaces">; workspaceName: string };
type Built = { fileId: string; filename: string; documents: number; assets: number; skippedAssets: string[]; skippedReason: "size" | "missing" | null };

export const exportWorkspace = action({
  args: { workspaceId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; filename: string; documents: number; assets: number; skippedAssets: string[]; skippedReason: "size" | "missing" | null }> => {
    const prep: Prep = await ctx.runMutation(internal.exports.prepare, { workspaceId: args.workspaceId });
    const built = await buildExport(ctx, prep);
    const exp = Date.now() + 60 * 60_000;
    const sig = await signFileUrl(`${built.fileId}:${exp}`);
    const { fileId: _f, ...rest } = built;
    void _f;
    return { url: `${process.env.CONVEX_SITE_URL ?? ""}/files/${built.fileId}?exp=${exp}&sig=${sig}`, ...rest };
  },
});

/** Builds the export ZIP of one workspace as `prep.profileId` sees it, stores it, and returns its file id. */
async function buildExport(ctx: ActionCtx, prep: Prep): Promise<Built> {
  {
    const manifest: { format: string; version: number; exportedAt: string; workspace: string; documents: unknown[]; assets: unknown[]; skippedAssets: unknown[] } = {
      format: "folevi-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: prep.workspaceName,
      documents: [],
      assets: [],
      skippedAssets: [],
    };

    // Streaming ZIP writer.
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
    let cursor: string | null = null;
    let assetCount = 0;
    let totalBytes = 0;
    const skipped: string[] = [];
    let skippedReason: "size" | "missing" | null = null;
    type Page = { docs: ExportDoc[]; isDone: boolean; continueCursor: string };
    const collected: ExportDoc[] = [];
    for (let i = 0; i < 400; i++) {
      const page: Page = await ctx.runQuery(internal.exports.documentPage, { profileId: prep.profileId, workspaceId: prep.workspaceId, cursor });
      collected.push(...page.docs);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    const pathById = new Map<string, string>();
    for (const d of collected) {
      const dir =
        d.kind === "daily" ? "Daily Notes" : d.kind === "template" ? "Templates" : d.archived ? "Archive" : d.folderPath.length ? d.folderPath.map((f) => safeFilename(f)).join("/") : "Documents";
      pathById.set(d.id, `${dir}/${nameFor(dir, d.title || (d.dailyDate ?? "Untitled"))}`);
    }
    for (const d of collected) {
      const path = pathById.get(d.id)!;
      const assetPaths = new Map<string, string>();
      for (const f of d.files) {
        if (totalBytes + f.size > MAX_EXPORT_ASSET_BYTES) {
          skipped.push(f.filename);
          skippedReason = "size";
          manifest.skippedAssets.push({ id: f.id, filename: f.filename, size: f.size, documentId: d.id, reason: "export_size_limit" });
          continue;
        }
        const blob = await ctx.storage.get(f.storageId);
        if (!blob) {
          skipped.push(f.filename);
          skippedReason ??= "missing";
          manifest.skippedAssets.push({ id: f.id, filename: f.filename, size: f.size, documentId: d.id, reason: "unavailable" });
          continue;
        }
        const assetPath = `assets/${f.id}-${safeFilename(f.filename)}`;
        addFile(assetPath, new Uint8Array(await blob.arrayBuffer()), false);
        totalBytes += f.size;
        assetPaths.set(f.id, assetPath);
        manifest.assets.push({ id: f.id, path: assetPath, filename: f.filename, mimeType: f.mimeType, size: f.size, documentId: d.id });
        assetCount++;
      }
      const depth = path.split("/").length - 1;
      const up = "../".repeat(depth);
      const opts = {
        resolveFile: (id: string) => (assetPaths.has(id) ? `${up}${assetPaths.get(id)}` : null),
        resolveDocument: (id: string) => {
          const p = pathById.get(id);
          return p ? `${up}${p}.md` : null;
        },
        resolveDocumentTitle: (id: string) => collected.find((x) => x.id === id)?.title || null,
      };
      addFile(
        `${path}.md`,
        strToU8(
          blocksToMarkdown(d.blocks, { ...opts, title: d.title || "Untitled", frontMatter: { folevi_id: d.id, created: new Date(d.createdAt).toISOString(), updated: new Date(d.updatedAt).toISOString() } }),
        ),
        true,
      );
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
    // Canonical block data for lossless re-import by future versions.
    addFile("manifest.json", strToU8(JSON.stringify(manifest, null, 2)), true);
    addFile("blocks.json", strToU8(JSON.stringify(Object.fromEntries(collected.map((d) => [d.id, d.blocks])))), true);
    addFile(
      "README.txt",
      strToU8(
        `Folevi export of "${prep.workspaceName}" (${manifest.exportedAt}).\n\nEach document is a Markdown file in a folder matching your sidebar; attachments are in assets/. manifest.json lists documents, folders and assets (and any attachments left out); blocks.json holds the canonical Folevi block data.\n`,
      ),
      true,
    );
    zip.end();
    if (zipError) throw zipError;
    const size = chunks.reduce((n, c) => n + c.length, 0);
    const storageId = await ctx.storage.store(new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: "application/zip" }));
    chunks.length = 0;
    const filename = `${safeFilename(prep.workspaceName)}-folevi-export-${new Date().toISOString().slice(0, 10)}.zip`;
    const fileId: string = await ctx.runMutation(internal.exports.storeExport, { profileId: prep.profileId, workspaceId: prep.workspaceId, storageId, size, filename });
    return { fileId, filename, documents: collected.length, assets: assetCount, skippedAssets: skipped, skippedReason: skipped.length ? skippedReason : null };
  }
}

/**
 * An export prepared for someone at their request through support (admin → user → "Prepare export"). It's
 * built exactly as they'd see it and delivered only to them — a notification with a download — so staff
 * never receive note content.
 */
export const exportForUser = internalAction({
  args: { profileId: v.id("profiles"), workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspaceName: string = await ctx.runQuery(internal.exports.workspaceName, { workspaceId: args.workspaceId });
    const built = await buildExport(ctx, { profileId: args.profileId, workspaceId: args.workspaceId, workspaceName });
    await ctx.runMutation(internal.exports.notifyExportReady, { profileId: args.profileId, workspaceId: args.workspaceId, fileId: built.fileId, documents: built.documents, workspaceName });
    return null;
  },
});

export const workspaceName = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => (await ctx.db.get(args.workspaceId))?.name ?? "Workspace",
});

export const notifyExportReady = internalMutation({
  args: { profileId: v.id("profiles"), workspaceId: v.id("workspaces"), fileId: v.string(), documents: v.number(), workspaceName: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("notifications", {
      profileId: args.profileId,
      workspaceId: args.workspaceId,
      kind: "system",
      fileId: args.fileId,
      title: `Your export of ${args.workspaceName} is ready`,
      body: `${args.documents} ${args.documents === 1 ? "document" : "documents"}, as Markdown with attachments. Prepared at your request by Folevi support.`,
      createdAt: Date.now(),
    });
    return null;
  },
});
