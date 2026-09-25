import { v } from "convex/values";
import { action, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { strToU8, zipSync, type Zippable } from "fflate";
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

/**
 * Workspace export: a ZIP with one Markdown file per document (plus HTML), an assets folder and a
 * machine-readable manifest.json. Returns a short-lived signed download URL.
 */
export const exportWorkspace = action({
  args: { workspaceId: v.string() },
  handler: async (ctx, args): Promise<{ url: string; filename: string; documents: number; assets: number }> => {
    const prep: { profileId: Id<"profiles">; workspaceId: Id<"workspaces">; workspaceName: string } = await ctx.runMutation(internal.exports.prepare, { workspaceId: args.workspaceId });
    const zip: Zippable = {};
    const manifest: { format: string; version: number; exportedAt: string; workspace: string; documents: unknown[]; assets: unknown[] } = {
      format: "folevi-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: prep.workspaceName,
      documents: [],
      assets: [],
    };
    const usedNames = new Set<string>();
    const nameFor = (base: string) => {
      let name = safeFilename(base || "Untitled").slice(0, 100);
      let n = 1;
      while (usedNames.has(name.toLowerCase())) name = `${safeFilename(base || "Untitled").slice(0, 96)} (${++n})`;
      usedNames.add(name.toLowerCase());
      return name;
    };
    let cursor: string | null = null;
    let assetCount = 0;
    let totalBytes = 0;
    const docs: { id: string; path: string }[] = [];
    type Page = { docs: { id: string; title: string; kind: string; icon: string | null; parentId: string | null; folder: string | null; createdAt: number; updatedAt: number; archived: boolean; dailyDate: string | null; blocks: WireBlock[]; files: { id: string; storageId: Id<"_storage">; filename: string; mimeType: string; size: number }[] }[]; isDone: boolean; continueCursor: string };
    const collected: Page["docs"] = [];
    for (let i = 0; i < 400; i++) {
      const page: Page = await ctx.runQuery(internal.exports.documentPage, { profileId: prep.profileId, workspaceId: prep.workspaceId, cursor });
      collected.push(...page.docs);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    const pathById = new Map<string, string>();
    for (const d of collected) {
      const dir = d.kind === "daily" ? "Daily Notes" : d.kind === "template" ? "Templates" : d.archived ? "Archive" : d.folder ? safeFilename(d.folder) : "Documents";
      const path = `${dir}/${nameFor(d.title || (d.dailyDate ?? "Untitled"))}`;
      pathById.set(d.id, path);
      docs.push({ id: d.id, path });
    }
    for (const d of collected) {
      const path = pathById.get(d.id)!;
      const assetPaths = new Map<string, string>();
      for (const f of d.files) {
        if (totalBytes + f.size > 400 * 1024 * 1024) break;
        const blob = await ctx.storage.get(f.storageId);
        if (!blob) continue;
        const assetPath = `assets/${f.id}-${safeFilename(f.filename)}`;
        zip[assetPath] = new Uint8Array(await blob.arrayBuffer());
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
      };
      zip[`${path}.md`] = strToU8(
        blocksToMarkdown(d.blocks, { ...opts, title: d.title || "Untitled", frontMatter: { folevi_id: d.id, created: new Date(d.createdAt).toISOString(), updated: new Date(d.updatedAt).toISOString() } }),
      );
      manifest.documents.push({
        id: d.id,
        title: d.title,
        kind: d.kind,
        icon: d.icon,
        parentId: d.parentId,
        folder: d.folder,
        archived: d.archived,
        dailyDate: d.dailyDate,
        createdAt: new Date(d.createdAt).toISOString(),
        updatedAt: new Date(d.updatedAt).toISOString(),
        markdown: `${path}.md`,
        blocks: d.blocks.length,
      });
    }
    // Canonical block data for lossless re-import by future versions.
    zip["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    zip["blocks.json"] = strToU8(JSON.stringify(Object.fromEntries(collected.map((d) => [d.id, d.blocks]))));
    zip["README.txt"] = strToU8(
      `Folevi export of "${prep.workspaceName}" (${manifest.exportedAt}).\n\nEach document is a Markdown file; attachments are in assets/. manifest.json lists documents, folders and assets; blocks.json holds the canonical Folevi block data.\n`,
    );
    const bytes = zipSync(zip, { level: 6 });
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/zip" }));
    const filename = `${safeFilename(prep.workspaceName)}-folevi-export-${new Date().toISOString().slice(0, 10)}.zip`;
    const fileId: string = await ctx.runMutation(internal.exports.storeExport, { profileId: prep.profileId, workspaceId: prep.workspaceId, storageId, size: bytes.length, filename });
    const exp = Date.now() + 60 * 60_000;
    const sig = await signFileUrl(`${fileId}:${exp}`);
    return { url: `${process.env.CONVEX_SITE_URL ?? ""}/files/${fileId}?exp=${exp}&sig=${sig}`, filename, documents: docs.length, assets: assetCount };
  },
});
