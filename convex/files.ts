import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, membership, requireDocument, requireProfile, requireWorkspace, resolveScope, memberAtLeast } from "./lib/auth";
import { fail } from "./lib/errors";
import { adjustStorageUsed, assertStorageFor } from "./lib/entitlements";
import { insertScoped, personalScope, scopeOfRow, vScopeArg, workspaceScope, type Scope } from "./lib/scope";
import { vImagePalette } from "./lib/validators";
import { consume } from "./lib/rateLimit";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, safeFilename, sameBytes, sniff, stripImageMetadata } from "./lib/images";
import { toHex } from "./lib/crypto";
import { signFileUrl as sign } from "./lib/fileUrls";
import { bump } from "./lib/metrics";
import { MAX_IDENTITY_IMAGE_BYTES } from "./lib/identityImages";

const INTENT_TTL_MS = 10 * 60_000;
const vKind = v.union(v.literal("image"), v.literal("file"), v.literal("avatar"), v.literal("logo"), v.literal("cover"));

function maxBytesFor(kind: Doc<"uploadIntents">["kind"]): number {
  return kind === "file" ? MAX_FILE_BYTES : kind === "avatar" || kind === "logo" ? MAX_IDENTITY_IMAGE_BYTES : MAX_IMAGE_BYTES;
}

/**
 * Step 1: authorize and issue a short-lived upload URL. Every file belongs to exactly one scope and counts
 * toward that scope's storage only: a page attachment to the page's scope; a profile picture to your
 * Personal; a workspace logo to that workspace; anything else to `scope`.
 */
export const generateUploadUrl = mutation({
  args: { scope: v.optional(vScopeArg), documentId: v.optional(v.string()), filename: v.string(), size: v.number(), mimeType: v.string(), kind: vKind },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    // Uploading into a page needs write access to that page, and the file belongs to the page's scope —
    // so someone a page was shared with ("Can edit") can add images to it without being in its
    // workspace (or being its Personal's owner). Uploads not tied to a page need to be able to edit there.
    let scope: Scope;
    let documentId: Id<"documents"> | undefined;
    if (args.kind === "avatar" || args.kind === "logo") {
      // Profile pictures and workspace logos are never page attachments; the server decides where they live.
      if (args.documentId) fail("invalid_argument", "Profile pictures and logos can't be attached to a page.");
      if (args.kind === "avatar") {
        // Your profile picture is a Personal file (it counts toward your personal storage).
        scope = personalScope(profile._id);
      } else {
        if (args.scope?.kind !== "workspace") fail("invalid_argument", "Logos belong to a workspace.");
        scope = workspaceScope((await requireWorkspace(ctx, profile, args.scope.workspaceId, "admin")).workspace._id);
      }
    } else if (args.documentId) {
      const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
      scope = scopeOfRow(doc);
      if (scope.kind === "workspace") {
        const owner = await ctx.db.get(scope.workspaceId);
        if (!owner || owner.status !== "active") fail("not_found", "Workspace not found.");
      }
      documentId = doc._id;
    } else {
      if (!args.scope) fail("invalid_argument", "Say where the file goes.");
      scope = (await resolveScope(ctx, profile, args.scope, "edit")).scope;
    }
    await consume(ctx, "upload", profile._id);
    const max = maxBytesFor(args.kind);
    if (!Number.isFinite(args.size) || args.size <= 0 || args.size > max) fail("invalid_argument", `Files can be up to ${Math.round(max / 1024 / 1024)} MB.`);
    // Against the scope's own limit: Personal uploads count toward the Personal plan, a team workspace's
    // toward that workspace's plan.
    const storageProblem = await assertStorageFor(ctx, scope, args.size, profile._id);
    if (storageProblem) fail("quota_exceeded", storageProblem);
    const intentId = await insertScoped(ctx, "uploadIntents", scope, {
      profileId: profile._id,
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
    const scope = scopeOfRow(intent);
    const storageProblem = await assertStorageFor(ctx, scope, args.size, args.profileId);
    if (storageProblem) fail("quota_exceeded", storageProblem);
    await ctx.db.patch(intent._id, { consumedAt: Date.now() });
    const publicId = ulid();
    await insertScoped(ctx, "files", scope, {
      publicId,
      storageId: args.storageId,
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
    await adjustStorageUsed(ctx, scope, args.size);
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
    const max = maxBytesFor(intent.kind);
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
      if (!width || !height) return await reject("That image couldn't be read. Try exporting it again as PNG or JPEG.");
      const stripped = stripImageMetadata(sniffed.mime, bytes);
      if (!sameBytes(stripped, bytes)) {
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

/** A file not attached to a page: its Personal's owner, or a member of its workspace, may see it. */
async function canSeeLooseFile(ctx: QueryCtx, profile: Doc<"profiles">, file: Doc<"files">): Promise<boolean> {
  const scope = scopeOfRow(file);
  if (scope.kind === "personal") return scope.profileId === profile._id;
  return Boolean(await membership(ctx, profile._id, scope.workspaceId));
}

/** …and its Personal's owner, or a workspace member who can edit, may change it. */
async function canEditLooseFile(ctx: QueryCtx, profile: Doc<"profiles">, file: Doc<"files">): Promise<boolean> {
  const scope = scopeOfRow(file);
  if (scope.kind === "personal") return scope.profileId === profile._id;
  const m = await membership(ctx, profile._id, scope.workspaceId);
  return memberAtLeast(m, "edit");
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Saves the page and text colours picked (in the browser) from a note style image. Only colours are
 * accepted — six-digit hex values and a tone — and only by someone who can edit the note it belongs to.
 */
export const setPalette = mutation({
  args: { fileId: v.string(), palette: vImagePalette },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const file = await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.fileId))
      .unique();
    if (!file || file.status !== "ready" || (file.kind !== "cover" && file.kind !== "image")) fail("not_found", "File not found.");
    if (file.documentId) {
      const doc = await ctx.db.get(file.documentId);
      if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("not_found", "File not found.");
    } else if (!(await canEditLooseFile(ctx, profile, file))) fail("not_found", "File not found.");
    const p = args.palette;
    const lower = (list: string[] | undefined) => list?.map((c) => c.toLowerCase());
    const colours = [p.paper, p.ink, p.paperDark, p.inkDark, p.accent, p.accentDark, ...(p.text ?? []), ...(p.textDark ?? []), ...(p.highlight ?? []), ...(p.highlightDark ?? [])].filter((c): c is string => c !== undefined);
    if (!colours.every((c) => HEX.test(c))) fail("invalid_argument", "Colours must be #rrggbb.");
    if ((p.text && p.text.length !== 5) || (p.textDark && p.textDark.length !== 5) || (p.highlight && p.highlight.length !== 4) || (p.highlightDark && p.highlightDark.length !== 4)) fail("invalid_argument", "Unexpected palette size.");
    if (p.names && (p.names.length !== 5 || !p.names.every((n) => /^[A-Za-z ]{1,20}$/.test(n)))) fail("invalid_argument", "Unexpected colour names.");
    // Convex values can't hold undefined: drop the fields this palette doesn't have.
    const palette = Object.fromEntries(
      Object.entries({
        paper: p.paper.toLowerCase(),
        ink: p.ink.toLowerCase(),
        paperDark: p.paperDark.toLowerCase(),
        inkDark: p.inkDark.toLowerCase(),
        tone: p.tone,
        accent: p.accent?.toLowerCase(),
        accentDark: p.accentDark?.toLowerCase(),
        text: lower(p.text),
        textDark: lower(p.textDark),
        names: p.names,
        highlight: lower(p.highlight),
        highlightDark: lower(p.highlightDark),
      }).filter(([, v]) => v !== undefined),
    ) as Doc<"files">["palette"];
    await ctx.db.patch(file._id, { palette });
    return null;
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
    const out: Record<string, { url: string; mimeType: string; filename: string; size: number; width: number | null; height: number | null; palette: Doc<"files">["palette"] | null }> = {};
    for (const id of args.fileIds.slice(0, 200)) {
      const file = await ctx.db
        .query("files")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique();
      if (!file || file.status !== "ready") continue;
      let allowed: boolean;
      if (file.documentId) {
        const doc = await ctx.db.get(file.documentId);
        allowed = Boolean(doc && accessAtLeast(await documentAccess(ctx, profile, doc), "read"));
      } else allowed = await canSeeLooseFile(ctx, profile, file);
      if (!allowed) continue;
      const sig = await sign(`${file.publicId}:${exp}`);
      out[id] = {
        url: `${site}/files/${file.publicId}?exp=${exp}&sig=${sig}`,
        mimeType: file.mimeType,
        filename: file.filename,
        size: file.size,
        width: file.width ?? null,
        height: file.height ?? null,
        palette: file.palette ?? null,
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


// ---------------------------------------------------------------- orphan cleanup (cron)

/** Blobs younger than this are never swept: an upload may still be between upload and finalize. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** Workspace export ZIPs are downloaded through a 1-hour link; the blob is kept a day, then removed. */
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a stored blob is still referenced by a Folevi table. Every table that keeps an
 * `Id<"_storage">` must be checked here, or the orphan sweep will delete its blobs.
 */
async function isStorageReferenced(ctx: MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  const file = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (file) return true;
  const snapshot = await ctx.db
    .query("documentSnapshots")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  return Boolean(snapshot);
}

/**
 * Deletes stored blobs that no row references: uploads that were never finalized (the browser went
 * away between upload and verification) and leftovers of failed replacements. Walks the storage table
 * in pages and reschedules itself until done.
 */
export const sweepOrphanedStorage = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const page = await ctx.db.system.query("_storage").paginate({ cursor: args.cursor ?? null, numItems: 100 });
    let deleted = 0;
    for (const blob of page.page) {
      if (blob._creationTime > now - ORPHAN_GRACE_MS) continue;
      if (await isStorageReferenced(ctx, blob._id)) continue;
      await ctx.storage.delete(blob._id);
      deleted++;
    }
    if (deleted) console.log(JSON.stringify({ event: "files.orphans_swept", deleted }));
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.files.sweepOrphanedStorage, { cursor: page.continueCursor, now });
    return { deleted, done: page.isDone };
  },
});

/** Removes workspace export ZIPs after their retention window (they are not counted toward quota). */
export const purgeExpiredExports = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = (args.now ?? Date.now()) - EXPORT_RETENTION_MS;
    const rows = await ctx.db
      .query("files")
      .withIndex("by_kind_created", (q) => q.eq("kind", "export").lt("createdAt", cutoff))
      .take(100);
    for (const f of rows) {
      await ctx.storage.delete(f.storageId);
      await ctx.db.delete(f._id);
    }
    if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.files.purgeExpiredExports, { now: args.now });
    return rows.length;
  },
});
