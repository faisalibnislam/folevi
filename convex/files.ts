import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, requireDocument, requireProfile, requireWorkspace } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, safeFilename, sniff, stripJpeg, stripPng } from "./lib/images";
import { toHex } from "./lib/crypto";
import { signFileUrl as sign } from "./lib/fileUrls";
import { bump } from "./lib/metrics";

const INTENT_TTL_MS = 10 * 60_000;
const vKind = v.union(v.literal("image"), v.literal("file"), v.literal("avatar"), v.literal("cover"));

/** Step 1: authorize and issue a short-lived upload URL. */
export const generateUploadUrl = mutation({
  args: { workspaceId: v.string(), documentId: v.optional(v.string()), filename: v.string(), size: v.number(), mimeType: v.string(), kind: vKind },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "editor");
    let documentId: Id<"documents"> | undefined;
    if (args.documentId) {
      const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
      if (doc.workspaceId !== workspace._id) fail("forbidden", "Document belongs to another workspace.");
      documentId = doc._id;
    }
    await consume(ctx, "upload", profile._id);
    const max = args.kind === "file" ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
    if (!Number.isFinite(args.size) || args.size <= 0 || args.size > max) fail("invalid_argument", `Files can be up to ${Math.round(max / 1024 / 1024)} MB.`);
    if (workspace.storageUsedBytes + args.size > workspace.storageQuotaBytes) fail("quota_exceeded", "This workspace is out of storage.");
    const intentId = await ctx.db.insert("uploadIntents", {
      profileId: profile._id,
      workspaceId: workspace._id,
      documentId,
      kind: args.kind,
      filename: safeFilename(args.filename),
      declaredSize: args.size,
      declaredMime: args.mimeType.slice(0, 100),
      createdAt: Date.now(),
      expiresAt: Date.now() + INTENT_TTL_MS,
    });
    return { uploadUrl: await ctx.storage.generateUploadUrl(), intentId: intentId as string };
  },
});

export const intentForFinalize = internalQuery({
  args: { intentId: v.id("uploadIntents"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    const meta = await ctx.db.system.get(args.storageId);
    return { intent, meta };
  },
});

export const commitFile = internalMutation({
  args: {
    intentId: v.id("uploadIntents"),
    profileId: v.id("profiles"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    kind: vKind,
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.consumedAt || intent.profileId !== args.profileId || intent.expiresAt < Date.now()) fail("expired", "Upload expired. Try again.");
    const workspace = (await ctx.db.get(intent.workspaceId))!;
    if (workspace.storageUsedBytes + args.size > workspace.storageQuotaBytes) fail("quota_exceeded", "This workspace is out of storage.");
    await ctx.db.patch(intent._id, { consumedAt: Date.now() });
    const publicId = ulid();
    await ctx.db.insert("files", {
      publicId,
      storageId: args.storageId,
      workspaceId: intent.workspaceId,
      documentId: intent.documentId,
      uploadedBy: args.profileId,
      filename: intent.filename,
      mimeType: args.mimeType,
      size: args.size,
      sha256: args.sha256,
      kind: args.kind,
      width: args.width,
      height: args.height,
      status: "ready",
      createdAt: Date.now(),
    });
    await ctx.db.patch(workspace._id, { storageUsedBytes: workspace.storageUsedBytes + args.size });
    await bump(ctx, "storage_bytes", args.size);
    return publicId;
  },
});

export const currentProfileId = internalQuery({
  args: {},
  handler: async (ctx) => (await requireProfile(ctx))._id,
});

/**
 * Step 2: verify the uploaded bytes. Sniffs the real type, enforces limits, checks the client
 * checksum, strips image metadata (re-storing a clean copy), and records the file.
 */
export const finalize = action({
  args: { intentId: v.string(), storageId: v.id("_storage"), sha256: v.string() },
  handler: async (ctx, args): Promise<{ fileId: string; mimeType: string; width: number | null; height: number | null; size: number }> => {
    const profileId: Id<"profiles"> = await ctx.runQuery(internal.files.currentProfileId, {});
    const intentId = args.intentId as Id<"uploadIntents">;
    const { intent, meta } = await ctx.runQuery(internal.files.intentForFinalize, { intentId, storageId: args.storageId });
    const reject = async (message: string): Promise<never> => {
      await ctx.storage.delete(args.storageId);
      fail("unsupported_file", message);
    };
    if (!intent || intent.profileId !== profileId || intent.consumedAt || intent.expiresAt < Date.now() || !meta) return await reject("Upload expired. Try again.");
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) return await reject("Upload not found.");
    let bytes = new Uint8Array(await blob.arrayBuffer());
    const max = intent.kind === "file" ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
    if (bytes.length > max || bytes.length !== intent.declaredSize) return await reject("The file size didn't match.");
    const clientHash = args.sha256.toLowerCase();
    const serverHash = toHex(await crypto.subtle.digest("SHA-256", bytes));
    if (clientHash !== serverHash) return await reject("The file was damaged during upload. Try again.");
    const sniffed = sniff(bytes);
    const wantsImage = intent.kind !== "file";
    if (wantsImage && sniffed.kind !== "image") return await reject("Images must be PNG, JPEG, GIF or WebP.");
    let storageId = args.storageId;
    let width: number | undefined;
    let height: number | undefined;
    if (sniffed.kind === "image") {
      width = sniffed.width;
      height = sniffed.height;
      if (width && height && width * height > MAX_IMAGE_PIXELS) return await reject("That image is too large.");
      const stripped = sniffed.mime === "image/jpeg" ? stripJpeg(bytes) : sniffed.mime === "image/png" ? stripPng(bytes) : bytes;
      if (stripped.length !== bytes.length) {
        storageId = await ctx.storage.store(new Blob([stripped as Uint8Array<ArrayBuffer>], { type: sniffed.mime }));
        await ctx.storage.delete(args.storageId);
        bytes = stripped as Uint8Array<ArrayBuffer>;
      }
    }
    const finalHash = toHex(await crypto.subtle.digest("SHA-256", bytes));
    const fileId: string = await ctx.runMutation(internal.files.commitFile, {
      intentId,
      profileId,
      storageId,
      mimeType: sniffed.mime,
      size: bytes.length,
      sha256: finalHash,
      width,
      height,
      kind: intent.kind === "file" && sniffed.kind === "image" ? "image" : intent.kind,
    });
    return { fileId, mimeType: sniffed.mime, width: width ?? null, height: height ?? null, size: bytes.length };
  },
});

/** Short-lived signed URLs served by our HTTP action with safe headers (never the raw storage URL). */
export const urls = query({
  args: { fileIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const site = process.env.CONVEX_SITE_URL ?? "";
    // Round expiry to the hour so the query result is cacheable and stable for re-renders.
    const exp = Math.floor(args.now / 3_600_000) * 3_600_000 + 2 * 3_600_000;
    const out: Record<string, { url: string; mimeType: string; filename: string; size: number; width: number | null; height: number | null }> = {};
    for (const id of args.fileIds.slice(0, 200)) {
      const file = await ctx.db
        .query("files")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique();
      if (!file || file.status !== "ready") continue;
      let allowed = false;
      if (file.documentId) {
        const doc = await ctx.db.get(file.documentId);
        allowed = Boolean(doc && accessAtLeast(await documentAccess(ctx, profile, doc), "read"));
      } else {
        const m = await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", file.workspaceId).eq("profileId", profile._id))
          .unique();
        allowed = Boolean(m);
      }
      if (!allowed) continue;
      const sig = await sign(`${file.publicId}:${exp}`);
      out[id] = {
        url: `${site}/files/${file.publicId}?exp=${exp}&sig=${sig}`,
        mimeType: file.mimeType,
        filename: file.filename,
        size: file.size,
        width: file.width ?? null,
        height: file.height ?? null,
      };
    }
    return out;
  },
});

export const byPublicId = internalQuery({
  args: { fileId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.fileId))
      .unique(),
});

