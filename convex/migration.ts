// Moving between "Keep notes on my devices" and a Folevi account (docs/LOCAL_MODE_PLAN.md §6, WP12). The app
// does the moving (apps/web/src/lib/migrate): a library goes up through the functions the editor already uses
// (sync.push, the folder and collection mutations, uploads), and an account comes down through these reads. What
// lives only here is what those functions don't already say: whether a library fits (preflight), every note of
// a place with what a list doesn't carry (Trash, Archive, nested pages, collection rows, synced content), and
// the text found in a note's files.
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireDocument, requireProfile, resolveScope } from "./lib/auth";
import { storageUsage } from "./lib/entitlements";
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "./lib/images";
import { personalScope, vScopeArg } from "./lib/scope";
import { fail } from "./lib/errors";
import { isSealed } from "./lib/e2ee/state";
import { sealedFieldsOf, type SealedDocumentFields } from "./lib/e2ee/sealedRows";

/** Notes counted in an account for the preflight's "you already have notes here" (counting stops after). */
const EXISTING_COUNT_CAP = 1000;

/**
 * Whether a library fits in the person's account, before anything is sent: its storage against the plan's,
 * and what's in the account already. Facts only (bytes and counts, never a price): the app words a shortfall
 * plainly ("Some files didn't fit") and never shows prices in local mode or on iPhone and iPad.
 */
export const preflight = query({
  args: {
    notes: v.number(),
    folders: v.number(),
    tags: v.number(),
    files: v.number(),
    /** Every attachment's size together. */
    fileBytes: v.number(),
    /** The largest attachment (one over the file limit can't be uploaded at all). */
    largestFileBytes: v.number(),
    versions: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    for (const n of [args.notes, args.folders, args.tags, args.files, args.fileBytes, args.largestFileBytes, args.versions ?? 0]) {
      if (!Number.isFinite(n) || n < 0) fail("invalid_argument", "Counts can't be negative.");
    }
    const usage = await storageUsage(ctx, personalScope(profile._id), profile._id);
    const availableBytes = Math.max(0, usage.limitBytes - usage.usedBytes);
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", profile._id).eq("inTrash", false))
      .take(EXISTING_COUNT_CAP + 1);
    const fits = args.fileBytes <= availableBytes;
    return {
      usedBytes: usage.usedBytes,
      limitBytes: usage.limitBytes,
      availableBytes,
      neededBytes: args.fileBytes,
      fits,
      /** How much more room the files need than is left (0 when they fit). */
      shortByBytes: fits ? 0 : args.fileBytes - availableBytes,
      maxFileBytes: MAX_FILE_BYTES,
      maxImageBytes: MAX_IMAGE_BYTES,
      /** The largest file is over the limit for one file. */
      tooLarge: args.largestFileBytes > MAX_FILE_BYTES,
      /** Notes already in the account's Personal (not in Trash), up to 1000; `existingMore` past that. */
      existingNotes: Math.min(existing.length, EXISTING_COUNT_CAP),
      existingMore: existing.length > EXISTING_COUNT_CAP,
      /** Read-only accounts (suspended, being deleted) take nothing. */
      writable: profile.status === "active",
    };
  },
});

/** A note of a place as a copy needs it: everything a document row says that the person may know. */
export interface MigrationDocument {
  id: string;
  kind: Doc<"documents">["kind"];
  parentDocumentId: string | null;
  folderId: string | null;
  title: string;
  icon: string | null;
  cover: Doc<"documents">["cover"];
  style: Doc<"documents">["style"];
  dailyDate: string | null;
  templateKey: string | null;
  /** On a collection row's note: its collection. */
  collectionId: string | null;
  rank: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  inTrash: boolean;
  starred: boolean;
  tagIds: string[];
  /** It has comments, or is shared beyond its place (people, an invitation, a public link): server-only. */
  hasComments: boolean;
  shared: boolean;
  /**
   * End-to-end encrypted (docs/E2EE_DESIGN.md §5.7): the title, appearance and meta are sealed (the plain
   * fields hold placeholders); the export-to-local flow opens them on the device.
   */
  sealed?: Partial<SealedDocumentFields> & { locked: boolean; lockedVia: string | null; fileIds: string[] };
}

/**
 * Every note of a place, Archive, Trash, nested pages, templates, collection rows and synced content
 * included, a page at a time, in the order they last changed. Personal, or a workspace the person manages
 * (owner or admin), for "Keep my notes on this Mac" (plan §6.2).
 */
export const documents = query({
  args: { scope: vScopeArg, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope, "admin");
    const base = ctx.db.query("documents");
    const result = await (
      scope.kind === "personal"
        ? base.withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId))
        : base.withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId))
    ).paginate(args.paginationOpts);
    const publicOf = new Map<string, string | null>();
    const publicId = async (id: string | undefined) => {
      if (!id) return null;
      if (!publicOf.has(id)) publicOf.set(id, ((await ctx.db.get(id as never)) as { publicId?: string } | null)?.publicId ?? null);
      return publicOf.get(id) ?? null;
    };
    const page: MigrationDocument[] = [];
    for (const d of result.page) {
      const star = await ctx.db
        .query("stars")
        .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", d._id))
        .unique();
      const tagIds: string[] = [];
      for (const link of await ctx.db
        .query("documentTags")
        .withIndex("by_document", (q) => q.eq("documentId", d._id))
        .take(20)) {
        const tag = await ctx.db.get(link.tagId);
        if (tag) tagIds.push(tag.publicId);
      }
      const thread = await ctx.db
        .query("commentThreads")
        .withIndex("by_document", (q) => q.eq("documentId", d._id))
        .first();
      const grant = await ctx.db
        .query("documentPermissions")
        .withIndex("by_document", (q) => q.eq("documentId", d._id))
        .first();
      const link = await ctx.db
        .query("publicLinks")
        .withIndex("by_document", (q) => q.eq("documentId", d._id))
        .first();
      page.push({
        id: d.publicId,
        kind: d.kind,
        parentDocumentId: await publicId(d.parentDocumentId),
        folderId: await publicId(d.folderId),
        title: d.title,
        icon: d.icon ?? null,
        cover: d.cover,
        style: d.style,
        dailyDate: d.dailyDate ?? null,
        templateKey: d.templateKey ?? null,
        collectionId: await publicId(d.collectionId),
        rank: d.rank,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        archivedAt: d.archivedAt ?? null,
        inTrash: d.inTrash,
        starred: Boolean(star),
        tagIds,
        hasComments: Boolean(thread),
        shared: Boolean(grant || link) || d.accessMode === "restricted",
        ...(isSealed(d)
          ? {
              sealed: {
                ...sealedFieldsOf(d),
                locked: d.locked === true,
                lockedVia: await publicId(d.lockedVia),
                fileIds: d.fileIds ?? [],
              },
            }
          : {}),
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * The text found in a note's files and drawings, with the text itself (fileText.forDocument only says what
 * was read), for copying it with the note. For people who can edit the note, like fileText.save.
 */
export const fileTexts = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    // A sealed note's found text is a sealed record (e2ee.pull gives it to the device).
    if (isSealed(doc)) return [];
    const rows = await ctx.db
      .query("fileTexts")
      .withIndex("by_document_block", (q) => q.eq("documentId", doc._id))
      .take(500);
    const out: { fileId: string | null; blockId: string; source: Doc<"fileTexts">["source"]; by: Doc<"fileTexts">["by"]; text: string; pageStarts: number[] | null; hash: string }[] = [];
    for (const r of rows) {
      const file = r.fileId ? await ctx.db.get(r.fileId) : null;
      if (r.fileId && (!file || file.documentId !== doc._id)) continue;
      out.push({ fileId: file?.publicId ?? null, blockId: r.blockId, source: r.source, by: r.by, text: r.text, pageStarts: r.pageStarts ?? null, hash: r.hash });
    }
    return out;
  },
});
