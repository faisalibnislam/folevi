// Publish to the web for a sealed note: a plain copy, made on purpose (docs/E2EE_DESIGN.md §9.3). WP5.
//
// An encrypted share link (§9.1) needs no server help beyond the link row (sharing.createPublicLink with
// `e2ee`). Publishing to the web is different: the person chose to make the note public, so their device
// renders a plain copy (title, appearance, blocks with page link labels resolved, collections as read-only
// tables, images re-uploaded as plain public files) and stores it here. sharing.openPublicLink serves the
// copy for `plainCopy` links exactly like a Standard page (`publishedCopy` below reads it). The copy doesn't
// follow edits: "Update published copy" sends it again, "Stop publishing" deletes it and its plain files.
//
//   generateFileUploadUrl: an upload of a plain image or file for the copy (then files.finalize as usual):
//                the file is the copy's own (`files.publishedCopy`), never one of the note's sealed files;
//   publishCopy: stores (or replaces) the copy for a link (makes a `plainCopy` link when none is given);
//   unpublish:   deletes the copy, its chunks and its plain files, and revokes the link.
import { v, type Infer } from "convex/values";
import { validateWireBlock, type WireBlock } from "@folevi/editor-schema";
import { mutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { assertWritable, requireDocument, requireProfile } from "../lib/auth";
import { fail } from "../lib/errors";
import { isFeatureEnabled } from "../lib/flags";
import { randomToken, sha256Hex } from "../lib/crypto";
import { DEFAULTS } from "../lib/documents";
import { insertScoped, sameScopeRows, scopeOfRow } from "../lib/scope";
import { vDocumentCover, vDocumentStyle, vWireBlock } from "../lib/validators";
import { assertStorageFor, releaseFileStorage } from "../lib/entitlements";
import { consume } from "../lib/rateLimit";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, safeFilename } from "../lib/images";
import { deleteFileBlob } from "../lib/fileCopies";
import { isLocked, isSealed } from "../lib/e2ee/state";
import { E2EE_LIMITS } from "../lib/e2ee/validators";
import { ulid } from "@folevi/editor-schema";

/** Characters per stored chunk (a Convex document holds at most 1 MiB; UTF-8 takes up to 3 bytes a character). */
const CHUNK_CHARS = 250_000;
const MAX_COLLECTIONS = 50;
const MAX_FILES = 200;

/**
 * A collection as the published page shows it: the same `PublicCollection` shape sharing.openPublicLink
 * serves for a Standard page (convex/sharing.ts), keyed by the collection id the block names. The device
 * builds it from the note's sealed `collection` record.
 */
export const vPublicCollectionInput = v.object({
  name: v.string(),
  viewType: v.union(v.literal("table"), v.literal("board"), v.literal("gallery"), v.literal("calendar")),
  config: v.any(),
  properties: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      type: v.string(),
      options: v.any(),
      formula: v.optional(v.union(v.string(), v.null())),
      numberFormat: v.optional(v.any()),
    }),
  ),
  rows: v.array(v.object({ id: v.string(), title: v.string(), icon: v.union(v.string(), v.null()), values: v.any() })),
});

/** The plain copy a device renders from a sealed note. */
export const vPlainCopyInput = v.object({
  title: v.string(),
  icon: v.optional(v.string()),
  cover: v.optional(vDocumentCover),
  style: v.optional(vDocumentStyle),
  blocks: v.array(vWireBlock),
  /** Collections the blocks show, keyed by collection id (read-only, as on a Standard shared page). */
  collections: v.optional(v.record(v.string(), vPublicCollectionInput)),
  /** Images re-uploaded as plain public files (files rows of this note, kind image, not sealed). */
  fileIds: v.optional(v.array(v.string())),
});
export type PlainCopyInput = Infer<typeof vPlainCopyInput>;

/** What `publishedCopy` hands sharing.openPublicLink (the chunks joined and parsed). */
export interface PublishedCopy {
  title: string;
  icon?: string;
  cover: Doc<"e2eePublishedCopies">["cover"];
  style: Doc<"e2eePublishedCopies">["style"];
  blocks: WireBlock[];
  collections: Record<string, Infer<typeof vPublicCollectionInput>>;
  fileIds: string[];
  publishedAt: number;
}

const bytesOf = (s: string) => new TextEncoder().encode(s).byteLength;

async function copyOf(ctx: QueryCtx, linkId: Id<"publicLinks">): Promise<Doc<"e2eePublishedCopies"> | null> {
  return await ctx.db
    .query("e2eePublishedCopies")
    .withIndex("by_link", (q) => q.eq("linkId", linkId))
    .unique();
}

/** A link's published copy, for sharing.openPublicLink (WP4) to serve; null when there is none. */
export async function publishedCopy(ctx: QueryCtx, link: Doc<"publicLinks">): Promise<PublishedCopy | null> {
  if (!link.plainCopy) return null;
  const row = await copyOf(ctx, link._id);
  if (!row) return null;
  const chunks = await ctx.db
    .query("e2eePublishedChunks")
    .withIndex("by_copy", (q) => q.eq("copyId", row._id))
    .take(row.chunkCount + 1);
  if (chunks.length !== row.chunkCount) return null;
  let body: { blocks?: unknown; collections?: unknown; fileIds?: unknown };
  try {
    body = JSON.parse(chunks.sort((a, b) => a.index - b.index).map((c) => c.data).join("")) as typeof body;
  } catch {
    return null;
  }
  return {
    title: row.title,
    ...(row.icon ? { icon: row.icon } : {}),
    cover: row.cover,
    style: row.style,
    blocks: Array.isArray(body.blocks) ? (body.blocks as WireBlock[]) : [],
    collections: body.collections && typeof body.collections === "object" && !Array.isArray(body.collections) ? (body.collections as PublishedCopy["collections"]) : {},
    fileIds: Array.isArray(body.fileIds) ? (body.fileIds as string[]) : [],
    publishedAt: row.publishedAt,
  };
}

/** Deletes a copy's chunks and its row (and, when asked, its plain files). */
async function dropCopy(ctx: MutationCtx, row: Doc<"e2eePublishedCopies">, withFiles: boolean, keepFiles: Set<string> = new Set()): Promise<void> {
  const chunks = await ctx.db
    .query("e2eePublishedChunks")
    .withIndex("by_copy", (q) => q.eq("copyId", row._id))
    .collect();
  let fileIds: string[] = [];
  if (withFiles) {
    try {
      fileIds = (JSON.parse(chunks.sort((a, b) => a.index - b.index).map((c) => c.data).join("")) as { fileIds?: string[] }).fileIds ?? [];
    } catch {
      fileIds = [];
    }
  }
  for (const c of chunks) await ctx.db.delete(c._id);
  await ctx.db.delete(row._id);
  for (const id of fileIds) if (!keepFiles.has(id)) await dropPlainFile(ctx, row, id);
}

/** A plain file made for a published copy: its storage is given back and its bytes deleted. */
async function dropPlainFile(ctx: MutationCtx, row: Doc<"e2eePublishedCopies">, publicId: string): Promise<void> {
  const file = await ctx.db
    .query("files")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  // Only a plain file made for a published copy of the same note: never a sealed file, the note's own, or someone else's.
  if (!file || file.sealed !== undefined || !file.publishedCopy || file.documentId !== row.documentId || !sameScopeRows(file, row)) return;
  // Another published copy of the note (another link) may show the same image.
  const others = await ctx.db
    .query("e2eePublishedCopies")
    .withIndex("by_document", (q) => q.eq("documentId", row.documentId))
    .take(20);
  for (const other of others) {
    if (other._id === row._id) continue;
    const chunks = await ctx.db
      .query("e2eePublishedChunks")
      .withIndex("by_copy", (q) => q.eq("copyId", other._id))
      .collect();
    if (chunks.some((c) => c.data.includes(publicId))) return;
  }
  if (file.status === "ready" && !file.sharesBlob) await releaseFileStorage(ctx, file, scopeOfRow(file));
  await deleteFileBlob(ctx, file);
  await ctx.db.delete(file._id);
}

/** Checks a copy's blocks and files (the device rendered them, so they must be valid plain blocks). */
async function checkCopy(ctx: QueryCtx, doc: Doc<"documents">, copy: PlainCopyInput): Promise<string> {
  for (const b of copy.blocks) {
    const issues = validateWireBlock(b as WireBlock);
    if (issues.length) fail("invalid_argument", "The published copy has a block that isn't valid.");
  }
  if (Object.keys(copy.collections ?? {}).length > MAX_COLLECTIONS) fail("limit_exceeded", "The published copy has too many collections.");
  if ((copy.fileIds?.length ?? 0) > MAX_FILES) fail("limit_exceeded", "The published copy has too many images.");
  for (const id of copy.fileIds ?? []) {
    const file = await ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", id))
      .unique();
    if (!file || file.sealed !== undefined || !file.publishedCopy || file.status !== "ready" || file.documentId !== doc._id || !sameScopeRows(file, doc)) {
      fail("invalid_argument", "The published copy refers to a file that wasn't uploaded for it (e2ee.links.generateFileUploadUrl).");
    }
  }
  // The format sharing.openPublicLink reads (docs/E2EE_DESIGN.md §5.6 WP4 note): { blocks, collections?, fileIds }.
  const body = JSON.stringify({ blocks: copy.blocks, ...(copy.collections ? { collections: copy.collections } : {}), fileIds: copy.fileIds ?? [] });
  if (bytesOf(body) + bytesOf(copy.title) > E2EE_LIMITS.publishedCopyBytes) fail("limit_exceeded", "This note is too large to publish (5 MB at most).");
  return body;
}

/** Kinds of plain file a published copy may carry (its images, files and an image cover). */
const vPublishKind = v.union(v.literal("image"), v.literal("file"), v.literal("cover"));
const PUBLISH_INTENT_TTL_MS = 10 * 60_000;

/** Who may publish this note: manage access, sealed, not locked, public links on. */
async function publishable(ctx: MutationCtx, profile: Doc<"profiles">, documentId: string) {
  await assertWritable(ctx, profile);
  const { doc } = await requireDocument(ctx, profile, documentId, "manage");
  if (!isSealed(doc)) fail("invalid_argument", "This note isn't encrypted: publish it as usual.");
  if (await isLocked(ctx, doc)) fail("forbidden", "This note is always fully encrypted, so it can't be published to the web.");
  if (!(await isFeatureEnabled(ctx, "public_links"))) fail("forbidden", "Public links are turned off for Folevi right now.");
  return { doc };
}

/**
 * An upload URL for one plain image or file of a published copy (docs/E2EE_DESIGN.md §9.3). The person chose
 * to make the note public, so these bytes are readable on purpose. The device then calls `files.finalize`
 * with the intent as for any upload (type sniffed, metadata stripped, counted toward storage); the file is
 * marked `publishedCopy`, so it is never mistaken for one of the note's sealed files, and it goes when the
 * copy stops using it (an update or Stop publishing) or with the note.
 */
export const generateFileUploadUrl = mutation({
  args: { documentId: v.string(), filename: v.string(), size: v.number(), mimeType: v.string(), kind: vPublishKind },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await publishable(ctx, profile, args.documentId);
    await consume(ctx, "upload", profile._id);
    const max = args.kind === "file" ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
    if (!Number.isFinite(args.size) || args.size <= 0 || args.size > max) fail("invalid_argument", `Files can be up to ${Math.round(max / 1024 / 1024)} MB.`);
    const scope = scopeOfRow(doc);
    const storageProblem = await assertStorageFor(ctx, scope, args.size, profile._id, doc._id);
    if (storageProblem) fail("quota_exceeded", storageProblem);
    const intentId = await insertScoped(ctx, "uploadIntents", scope, {
      profileId: profile._id,
      documentId: doc._id,
      kind: args.kind,
      filename: safeFilename(args.filename),
      declaredSize: args.size,
      declaredMime: args.mimeType.slice(0, 100),
      createdAt: Date.now(),
      expiresAt: Date.now() + PUBLISH_INTENT_TTL_MS,
      forPublish: true,
    });
    return { uploadUrl: await ctx.storage.generateUploadUrl(), intentId: intentId as string };
  },
});

/**
 * Stores the plain copy of a sealed note for a link: replaces an earlier copy of that link, or (no
 * `linkId`) makes a new `plainCopy` link and returns its token once.
 */
export const publishCopy = mutation({
  args: { documentId: v.string(), linkId: v.optional(v.string()), copy: vPlainCopyInput },
  handler: async (ctx, args): Promise<{ linkId: string; token?: string; publishedAt: number }> => {
    const profile = await requireProfile(ctx);
    const { doc } = await publishable(ctx, profile, args.documentId);
    const title = args.copy.title.trim().slice(0, 300);
    const body = await checkCopy(ctx, doc, args.copy);
    const now = Date.now();
    let link: Doc<"publicLinks">;
    let token: string | undefined;
    if (args.linkId) {
      const found = await ctx.db
        .query("publicLinks")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.linkId!))
        .unique();
      if (!found || found.revokedAt || found.documentId !== doc._id) fail("not_found", "Link not found.");
      if (found.e2ee) fail("invalid_argument", "That is an encrypted link: it never serves a plain copy.");
      if (!found.plainCopy) await ctx.db.patch(found._id, { plainCopy: true });
      link = (await ctx.db.get(found._id))!;
    } else {
      token = randomToken(32);
      const id = await insertScoped(ctx, "publicLinks", scopeOfRow(doc), {
        publicId: ulid(),
        documentId: doc._id,
        tokenHash: await sha256Hex(token),
        tokenHint: token.slice(0, 4),
        allowIndexing: false,
        createdBy: profile._id,
        createdAt: now,
        viewCount: 0,
        plainCopy: true,
      });
      link = (await ctx.db.get(id))!;
    }
    const earlier = await copyOf(ctx, link._id);
    // Images the new copy still uses stay; the ones it dropped go with the old copy.
    if (earlier) await dropCopy(ctx, earlier, true, new Set(args.copy.fileIds ?? []));
    const chunks: string[] = [];
    for (let i = 0; i < body.length; i += CHUNK_CHARS) chunks.push(body.slice(i, i + CHUNK_CHARS));
    const copyId = await insertScoped(ctx, "e2eePublishedCopies", scopeOfRow(doc), {
      linkId: link._id,
      documentId: doc._id,
      title,
      ...(args.copy.icon ? { icon: args.copy.icon.slice(0, 64) } : {}),
      cover: args.copy.cover ?? DEFAULTS.cover,
      style: args.copy.style ?? DEFAULTS.style,
      chunkCount: chunks.length,
      publishedBy: profile._id,
      publishedAt: now,
    });
    for (const [index, data] of chunks.entries()) await ctx.db.insert("e2eePublishedChunks", { copyId, index, data });
    return { linkId: link.publicId, ...(token ? { token } : {}), publishedAt: now };
  },
});

/** Stop publishing: the copy, its plain files and the link go. */
export const unpublish = mutation({
  args: { linkId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const link = await ctx.db
      .query("publicLinks")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.linkId))
      .unique();
    if (!link) fail("not_found", "Link not found.");
    const doc = await ctx.db.get(link.documentId);
    if (!doc) fail("not_found", "Link not found.");
    await requireDocument(ctx, profile, doc.publicId, "manage");
    const row = await copyOf(ctx, link._id);
    if (row) await dropCopy(ctx, row, true);
    if (!link.revokedAt) await ctx.db.patch(link._id, { revokedAt: Date.now() });
    return { removed: row !== null };
  },
});

/** Deletes every published copy of a note (it is being deleted for good). For maintenance (WP4). */
export async function dropPublishedCopies(ctx: MutationCtx, documentId: Id<"documents">): Promise<void> {
  const rows = await ctx.db
    .query("e2eePublishedCopies")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(20);
  for (const r of rows) await dropCopy(ctx, r, true);
}
