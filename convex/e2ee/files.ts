// Attachments of end-to-end encrypted notes (docs/E2EE_DESIGN.md §5.3 e2ee.files, §6.8). The device checks
// the plaintext (sniffed type, limits, metadata stripped) before it encrypts, so the server only ever holds
// ciphertext: it checks the stored blob's size and SHA-256 against what the device said, never its content,
// and counts the ciphertext bytes toward storage (§5.8).
//
//   generateUploadUrl  an upload URL for a sealed note's file (quota on the ciphertext size)
//   commit             records an uploaded sealed file (the file id is the device's: it is in the AAD contexts)
//   replaceBlob        swaps a file's bytes for a sealed copy (migration) or a re-sealed one (rotation)
//   updateMeta         a re-sealed metadata record (palette and the like)
//   rewrap             a pasted file in another note of the same space: same bytes, file key wrapped for that note
//
// WP3.
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { isValidId } from "@folevi/editor-schema";
import { assertWritable, requireDocument, requireIdentity, requireProfile } from "../lib/auth";
import { fail } from "../lib/errors";
import { consume } from "../lib/rateLimit";
import { adjustStorageUsed, assertStorageFor, storageChargeFor } from "../lib/entitlements";
import { insertScoped, sameScopeRows, scopeOfRow } from "../lib/scope";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "../lib/images";
import { toHex } from "../lib/crypto";
import { bump } from "../lib/metrics";
import { failE2ee } from "../lib/e2ee/state";
import { E2EE_LIMITS } from "../lib/e2ee/validators";
import { NoteKeyVersions, checkRecord } from "../lib/e2ee/sealedRows";

const INTENT_TTL_MS = 10 * 60_000;
/** A sealed file's kinds (note files; avatars, logos, exports and chat attachments are never sealed). */
const vSealedKind = v.union(v.literal("image"), v.literal("file"), v.literal("audio"), v.literal("cover"));
const vSealedFile = v.object({ key: v.bytes(), meta: v.bytes(), k: v.number(), plainSize: v.number() });
/** FLV1 keyed stream (mode 0x04): "FLV1", 0x04, chunk size, nonce prefix. */
const STREAM_HEADER = 17;
const CHUNK = 65536;

/** Ciphertext size of `plain` bytes in a keyed stream (§5.8: plaintext + 16 per 64 KiB chunk + 17). */
export function sealedSizeOf(plain: number): number {
  return plain + STREAM_HEADER + 16 * Math.max(1, Math.ceil(plain / CHUNK));
}

function maxPlainFor(kind: "image" | "file" | "audio" | "cover"): number {
  return kind === "file" || kind === "audio" ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
}

/** A sealed note the caller can write to. */
async function sealedNote(ctx: MutationCtx, profile: Doc<"profiles">, documentId: string): Promise<Doc<"documents">> {
  const { doc } = await requireDocument(ctx, profile, documentId, "write");
  if (doc.inTrash) fail("not_found", "Document not found.");
  if (doc.sealedAt === undefined && !doc.sealing) fail("invalid_argument", "This note isn't encrypted.");
  return doc;
}

/** The file key (wrapped by the note key, keyVersion = note key version) and the metadata (sealed with the file key, keyVersion 0). */
async function checkSealedFile(ctx: MutationCtx, doc: Doc<"documents">, sealed: typeof vSealedFile.type) {
  checkRecord(sealed.key, E2EE_LIMITS.keyWrapBytes, "The file key", sealed.k);
  checkRecord(sealed.meta, E2EE_LIMITS.fieldBytes, "The file's details", 0);
  if (!(await new NoteKeyVersions(ctx).has(doc._id, sealed.k))) failE2ee("e2ee_plaintext", "The file key names a key version this note doesn't have.");
  if (!Number.isInteger(sealed.plainSize) || sealed.plainSize < 0) fail("invalid_argument", "Invalid file size.");
}

/** Step 1: an upload URL for a sealed file of a note. The quota is checked on the ciphertext size. */
export const generateUploadUrl = mutation({
  args: { documentId: v.string(), kind: vSealedKind, declaredSize: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await sealedNote(ctx, profile, args.documentId);
    const scope = scopeOfRow(doc);
    if (scope.kind === "workspace") {
      const ws = await ctx.db.get(scope.workspaceId);
      if (!ws || ws.status !== "active") fail("not_found", "Workspace not found.");
    }
    await consume(ctx, "upload", profile._id);
    const max = sealedSizeOf(maxPlainFor(args.kind));
    if (!Number.isFinite(args.declaredSize) || args.declaredSize <= STREAM_HEADER || args.declaredSize > max) fail("invalid_argument", `Files can be up to ${Math.round(maxPlainFor(args.kind) / 1024 / 1024)} MB.`);
    const storageProblem = await assertStorageFor(ctx, scope, args.declaredSize, profile._id, doc._id);
    if (storageProblem) fail("quota_exceeded", storageProblem);
    const intentId = await insertScoped(ctx, "uploadIntents", scope, {
      profileId: profile._id,
      documentId: doc._id,
      kind: args.kind,
      filename: "file",
      declaredSize: args.declaredSize,
      declaredMime: "application/octet-stream",
      createdAt: Date.now(),
      expiresAt: Date.now() + INTENT_TTL_MS,
    });
    return { uploadUrl: await ctx.storage.generateUploadUrl(), intentId: intentId as string };
  },
});

export const intentFor = internalQuery({
  args: { intentId: v.id("uploadIntents"), storageId: v.id("_storage") },
  handler: async (ctx, args) => ({ intent: await ctx.db.get(args.intentId), meta: await ctx.db.system.get(args.storageId), profileId: (await requireProfile(ctx))._id }),
});

/** Checks a stored blob is the keyed stream the device said: its size, SHA-256 and header. Never its content. */
async function verifyBlob(ctx: { storage: { get(id: Id<"_storage">): Promise<Blob | null>; delete(id: Id<"_storage">): Promise<void> } }, storageId: Id<"_storage">, size: number, sha256: string): Promise<void> {
  const blob = await ctx.storage.get(storageId);
  const reject = async (message: string): Promise<never> => {
    await ctx.storage.delete(storageId);
    fail("unsupported_file", message);
  };
  if (!blob) return await reject("Upload not found.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== size) return await reject("The file size didn't match.");
  if (bytes.length < STREAM_HEADER || bytes[0] !== 0x46 || bytes[1] !== 0x4c || bytes[2] !== 0x56 || bytes[3] !== 0x31 || bytes[4] !== 0x04) return await reject("That isn't an encrypted file.");
  if (toHex(await crypto.subtle.digest("SHA-256", bytes)) !== sha256.toLowerCase()) return await reject("The file was damaged during upload. Try again.");
}

/** Step 2: records an uploaded sealed file once its blob checks out. */
export const commit = action({
  args: { intentId: v.string(), documentId: v.string(), fileId: v.string(), storageId: v.id("_storage"), sealed: vSealedFile, size: v.number(), sha256: v.string() },
  handler: async (ctx, args): Promise<{ fileId: string; size: number }> => {
    await requireIdentity(ctx);
    const intentId = args.intentId as Id<"uploadIntents">;
    const { intent, meta, profileId } = await ctx.runQuery(internal.e2ee.files.intentFor, { intentId, storageId: args.storageId });
    if (!intent || intent.profileId !== profileId || intent.consumedAt || intent.expiresAt < Date.now() || !meta || args.size !== intent.declaredSize) {
      await ctx.storage.delete(args.storageId);
      fail("expired", "Upload expired. Try again.");
    }
    await verifyBlob(ctx, args.storageId, args.size, args.sha256);
    await ctx.runMutation(internal.e2ee.files.commitSealed, { ...args, intentId, profileId });
    return { fileId: args.fileId, size: args.size };
  },
});

export const commitSealed = internalMutation({
  args: { intentId: v.id("uploadIntents"), profileId: v.id("profiles"), documentId: v.string(), fileId: v.string(), storageId: v.id("_storage"), sealed: vSealedFile, size: v.number(), sha256: v.string() },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.consumedAt || intent.profileId !== args.profileId || intent.expiresAt < Date.now()) fail("expired", "Upload expired. Try again.");
    const doc = intent.documentId ? await ctx.db.get(intent.documentId) : null;
    if (!doc || doc.publicId !== args.documentId) fail("not_found", "Document not found.");
    if (!isValidId(args.fileId)) fail("invalid_argument", "Invalid file id.");
    const taken = await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.fileId))
      .unique();
    if (taken) fail("invalid_argument", "That file id is taken.");
    await checkSealedFile(ctx, doc, args.sealed);
    const scope = scopeOfRow(intent);
    const storageProblem = await assertStorageFor(ctx, scope, args.size, args.profileId, intent.documentId);
    if (storageProblem) fail("quota_exceeded", storageProblem);
    await ctx.db.patch(intent._id, { consumedAt: Date.now() });
    const chargedTo = scope.kind === "workspace" ? await storageChargeFor(ctx, scope.workspaceId, args.profileId, intent.documentId) : undefined;
    await insertScoped(ctx, "files", scope, {
      publicId: args.fileId,
      storageId: args.storageId,
      documentId: doc._id,
      uploadedBy: args.profileId,
      chargedTo,
      filename: "file",
      mimeType: "application/octet-stream",
      size: args.size,
      sha256: args.sha256.toLowerCase(),
      kind: intent.kind === "avatar" || intent.kind === "logo" || intent.kind === "attachment" ? "file" : intent.kind,
      status: "ready",
      createdAt: Date.now(),
      sealed: args.sealed,
    });
    await addFileId(ctx, doc, args.fileId);
    await adjustStorageUsed(ctx, scope, args.size, chargedTo);
    await bump(ctx, "storage_bytes", args.size);
    return null;
  },
});

/** Notes which files a sealed note references (§5.2 fileIds), for access and clean-up. */
async function addFileId(ctx: MutationCtx, doc: Doc<"documents">, fileId: string) {
  const ids = doc.fileIds ?? [];
  if (ids.includes(fileId) || ids.length >= 500) return;
  await ctx.db.patch(doc._id, { fileIds: [...ids, fileId] });
}

/**
 * Swaps a file's bytes for a sealed copy (the seal migration's files phase) or a copy sealed again (rotation),
 * or back to plaintext (unseal: `sealed` null, `plain` given). The size difference moves storage; the old blob
 * goes once nothing uses it.
 */
export const replaceBlob = action({
  args: {
    intentId: v.string(),
    fileId: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    sha256: v.string(),
    sealed: v.union(vSealedFile, v.null()),
    plain: v.optional(v.object({ filename: v.string(), mimeType: v.string(), width: v.optional(v.number()), height: v.optional(v.number()) })),
  },
  handler: async (ctx, args): Promise<null> => {
    await requireIdentity(ctx);
    const intentId = args.intentId as Id<"uploadIntents">;
    const { intent, meta, profileId } = await ctx.runQuery(internal.e2ee.files.intentFor, { intentId, storageId: args.storageId });
    if (!intent || intent.profileId !== profileId || intent.consumedAt || intent.expiresAt < Date.now() || !meta || args.size !== intent.declaredSize) {
      await ctx.storage.delete(args.storageId);
      fail("expired", "Upload expired. Try again.");
    }
    if (args.sealed) await verifyBlob(ctx, args.storageId, args.size, args.sha256);
    else {
      // Back to plaintext: the device ran the usual checks before uploading; the hash is still checked.
      const blob = await ctx.storage.get(args.storageId);
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      if (!bytes || bytes.length !== args.size || toHex(await crypto.subtle.digest("SHA-256", bytes)) !== args.sha256.toLowerCase()) {
        await ctx.storage.delete(args.storageId);
        fail("unsupported_file", "The file was damaged during upload. Try again.");
      }
    }
    const old = await ctx.runMutation(internal.e2ee.files.swapSealed, { ...args, intentId, profileId });
    if (old) await ctx.storage.delete(old);
    return null;
  },
});

export const swapSealed = internalMutation({
  args: {
    intentId: v.id("uploadIntents"),
    profileId: v.id("profiles"),
    fileId: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    sha256: v.string(),
    sealed: v.union(vSealedFile, v.null()),
    plain: v.optional(v.object({ filename: v.string(), mimeType: v.string(), width: v.optional(v.number()), height: v.optional(v.number()) })),
  },
  handler: async (ctx, args): Promise<Id<"_storage"> | null> => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.consumedAt || intent.profileId !== args.profileId || intent.expiresAt < Date.now()) fail("expired", "Upload expired. Try again.");
    const file = await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.fileId))
      .unique();
    if (!file || file.status !== "ready" || !file.documentId || file.documentId !== intent.documentId) fail("not_found", "File not found.");
    const doc = (await ctx.db.get(file.documentId))!;
    if (args.sealed) await checkSealedFile(ctx, doc, args.sealed);
    else if (!args.plain) fail("invalid_argument", "Say what the file is.");
    const scope = scopeOfRow(file);
    await ctx.db.patch(intent._id, { consumedAt: Date.now() });
    // Storage: this row now counts its new bytes. If it counted the old ones and another row still shows them,
    // that row takes the count over; if nobody uses them any more they go.
    const users = (
      await ctx.db
        .query("files")
        .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
        .take(50)
    ).filter((f) => f._id !== file._id && f.status === "ready");
    if (!file.sharesBlob) {
      const heir = users.find((f) => f.sharesBlob);
      if (heir) await ctx.db.patch(heir._id, { sharesBlob: undefined, chargedTo: file.chargedTo });
      else await adjustStorageUsed(ctx, scope, -file.size, file.chargedTo);
    }
    await adjustStorageUsed(ctx, scope, args.size, file.chargedTo);
    await bump(ctx, "storage_bytes", args.size - (file.sharesBlob ? 0 : file.size));
    await ctx.db.patch(file._id, {
      storageId: args.storageId,
      size: args.size,
      sha256: args.sha256.toLowerCase(),
      sharesBlob: undefined,
      ...(args.sealed
        ? { sealed: args.sealed, filename: "file", mimeType: "application/octet-stream", width: undefined, height: undefined, palette: undefined }
        : { sealed: undefined, filename: args.plain!.filename.slice(0, 200), mimeType: args.plain!.mimeType.slice(0, 100), width: args.plain!.width, height: args.plain!.height }),
    });
    if (args.sealed) await addFileId(ctx, doc, file.publicId);
    if (users.length) return null;
    const snapshot = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
      .first();
    return snapshot ? null : file.storageId;
  },
});

/** A sealed file's metadata sealed again (the palette picked from a note style image, a fixed name). */
export const updateMeta = mutation({
  args: { fileId: v.string(), meta: v.bytes() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const file = await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.fileId))
      .unique();
    if (!file || file.status !== "ready" || !file.sealed || !file.documentId) fail("not_found", "File not found.");
    const doc = await ctx.db.get(file.documentId);
    if (!doc) fail("not_found", "File not found.");
    await requireDocument(ctx, profile, doc.publicId, "write");
    const meta = checkRecord(args.meta, E2EE_LIMITS.fieldBytes, "The file's details", 0);
    await ctx.db.patch(file._id, { sealed: { ...file.sealed, meta } });
    return null;
  },
});

/**
 * A file pasted into another note of the same space (§5.7 files.shareForPaste): a new row for the target
 * note that shares the bytes (`sharesBlob`, counted once) with the file key wrapped by the target note's key
 * and the metadata sealed for the new row. The bytes keep their own context (`file/<source file id>`), so the
 * device records the source file id inside the new metadata to open them (a device-side convention).
 */
export const rewrap = mutation({
  args: { fileId: v.string(), targetDocumentId: v.string(), newFileId: v.string(), key: v.bytes(), meta: v.bytes(), k: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const source = await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.fileId))
      .unique();
    if (!source || source.status !== "ready" || !source.sealed || !source.documentId) fail("not_found", "File not found.");
    const from = await ctx.db.get(source.documentId);
    if (!from) fail("not_found", "File not found.");
    await requireDocument(ctx, profile, from.publicId, "read");
    const target = await sealedNote(ctx, profile, args.targetDocumentId);
    if (!sameScopeRows(target, source)) failE2ee("e2ee_device_only", "Files are shared between notes of the same space only; copy it instead.");
    if (!isValidId(args.newFileId)) fail("invalid_argument", "Invalid file id.");
    const existing = await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.newFileId))
      .unique();
    if (existing) {
      if (existing.documentId !== target._id || existing.storageId !== source.storageId) fail("invalid_argument", "That file id is taken.");
      return { fileId: existing.publicId };
    }
    const sealed = { key: args.key, meta: args.meta, k: args.k, plainSize: source.sealed.plainSize };
    await checkSealedFile(ctx, target, sealed);
    await insertScoped(ctx, "files", scopeOfRow(target), {
      publicId: args.newFileId,
      storageId: source.storageId,
      documentId: target._id,
      uploadedBy: source.uploadedBy,
      chargedTo: source.chargedTo,
      sharesBlob: true,
      filename: "file",
      mimeType: "application/octet-stream",
      size: source.size,
      sha256: source.sha256,
      kind: source.kind,
      status: "ready",
      createdAt: Date.now(),
      sealed,
    });
    await addFileId(ctx, target, args.newFileId);
    return { fileId: args.newFileId };
  },
});
