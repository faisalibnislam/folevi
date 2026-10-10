import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { ulid, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess } from "./auth";
import { adjustStorageUsed, assertStorageFor, storageChargeFor } from "./entitlements";
import { fail } from "./errors";
import { bump } from "./metrics";
import { insertScoped, scopeOfRow } from "./scope";

/** File kinds a note shows (block images, files and recordings, and its theme image). */
const NOTE_FILE_KINDS = new Set<Doc<"files">["kind"]>(["image", "file", "audio", "cover"]);

/**
 * A copied note owns its files. A file belongs to one note (`files.documentId`): readers of that note may
 * open it, and it's deleted when that note is purged. So when blocks (or a theme image) are copied into a
 * new note (Duplicate, a copy of a version, a note from a template), each file they show gets a row of
 * its own on the copy, counted toward the copy's storage like an upload. Deleting the original for good
 * then never takes the copy's images, files or recordings with it. (Merging moves files instead: see
 * moveFiles in lib/ai/tools/execute.ts.)
 *
 * Usage: `blocks()` / `cover()` before creating the note (they point it at the new file ids), then
 * `commit(note)` once it exists. The bytes are copied by an action right after (a mutation can't read
 * stored files); until then the new row shares the original's blob, and `deleteFileBlob` never deletes
 * a blob another row still uses.
 */
export class FileCopies {
  private readonly copies = new Map<string, { source: Doc<"files">; publicId: string }>();
  private readonly readable = new Map<Id<"documents">, boolean>();

  constructor(
    private readonly ctx: MutationCtx,
    private readonly actor: Doc<"profiles">,
  ) {}

  /** The blocks, pointing at the copy's own files. */
  async blocks(blocks: WireBlock[]): Promise<WireBlock[]> {
    const out: WireBlock[] = [];
    for (const b of blocks) {
      const fileId = (b.props as { fileId?: unknown }).fileId;
      const copied = typeof fileId === "string" && fileId ? await this.copyOf(fileId) : null;
      out.push(copied ? { ...b, props: { ...b.props, fileId: copied } } : b);
    }
    return out;
  }

  /** The note theme, pointing at the copy's own image. */
  async cover(cover: Doc<"documents">["cover"] | undefined): Promise<Doc<"documents">["cover"] | undefined> {
    if (cover?.kind !== "image" || !cover.value) return cover;
    const copied = await this.copyOf(cover.value);
    return copied ? { ...cover, value: copied } : cover;
  }

  /** Makes the copy's file rows (the note now exists) and schedules copying their bytes. */
  async commit(doc: Doc<"documents">): Promise<void> {
    if (!this.copies.size) return;
    const ctx = this.ctx;
    const scope = scopeOfRow(doc);
    const bytes = [...this.copies.values()].reduce((n, c) => n + c.source.size, 0);
    // Copies take room like uploads do: refused only when they'd go over the limit.
    const storageProblem = await assertStorageFor(ctx, scope, bytes, this.actor._id, doc._id);
    if (storageProblem) fail("quota_exceeded", storageProblem);
    const chargedTo = scope.kind === "workspace" ? await storageChargeFor(ctx, scope.workspaceId, this.actor._id, doc._id) : undefined;
    const now = Date.now();
    for (const { source, publicId } of this.copies.values()) {
      const fileId = await insertScoped(ctx, "files", scope, {
        publicId,
        storageId: source.storageId,
        documentId: doc._id,
        uploadedBy: this.actor._id,
        chargedTo,
        filename: source.filename,
        mimeType: source.mimeType,
        size: source.size,
        sha256: source.sha256,
        kind: source.kind,
        width: source.width,
        height: source.height,
        palette: source.palette,
        status: "ready",
        createdAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.files.copyBlob, { fileId, from: source.storageId });
    }
    await adjustStorageUsed(ctx, scope, bytes, chargedTo);
    await bump(ctx, "storage_bytes", bytes);
  }

  /**
   * The new id for a file the copy shows, or null to keep the reference as it is: files that aren't a
   * note's (loose theme images stay where they are), aren't ready, or belong to a note the person can't
   * read (a copy never opens up someone else's file).
   */
  private async copyOf(fileId: string): Promise<string | null> {
    const known = this.copies.get(fileId);
    if (known) return known.publicId;
    const source = await this.ctx.db
      .query("files")
      .withIndex("by_public_id", (q) => q.eq("publicId", fileId))
      .unique();
    if (!source?.documentId || source.status !== "ready" || !NOTE_FILE_KINDS.has(source.kind)) return null;
    if (!(await this.canRead(source.documentId))) return null;
    const publicId = ulid();
    this.copies.set(fileId, { source, publicId });
    return publicId;
  }

  private async canRead(documentId: Id<"documents">): Promise<boolean> {
    let ok = this.readable.get(documentId);
    if (ok === undefined) {
      const doc = await this.ctx.db.get(documentId);
      ok = Boolean(doc && accessAtLeast(await documentAccess(this.ctx, this.actor, doc), "read"));
      this.readable.set(documentId, ok);
    }
    return ok;
  }
}

/** Deletes a file row's stored bytes, unless another row still uses them (a copy whose own bytes aren't made yet). */
export async function deleteFileBlob(ctx: MutationCtx, file: Doc<"files">): Promise<void> {
  const users = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
    .take(2);
  if (users.some((f) => f._id !== file._id)) return;
  await ctx.storage.delete(file.storageId);
}
