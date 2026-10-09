// AI attachments in the database (docs/AI_ASSISTANT.md, "Attachments"): which files a person may have
// the AI read, checking files as a message is posted, and cleaning up chat uploads.
//
// A file can be attached when the person can open it: a file of a note they can read (its images, files
// and recordings), or a file they uploaded into the chat (kind "attachment"). Chat uploads live in the
// conversation's scope, count toward its storage like any file, and only their uploader can open them.
// One is claimed by the conversation it's first sent in (`files.conversationId`), is deleted with that
// conversation (or the account or workspace), and one never sent is swept after a day.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { accessAtLeast, documentAccess } from "../auth";
import { releaseFileStorage } from "../entitlements";
import { fail } from "../errors";
import { bump } from "../metrics";
import { hasValidScope, inScope, scopeOfRow } from "../scope";
import { aiPrefsOf } from "./prefs";
import { capabilities } from "./provider";
import { attachmentKind, checkAttachment, checkInlineBudget, MAX_ATTACHMENTS, type AttachmentKind } from "./attachments";

type Ctx = QueryCtx | MutationCtx;

export const ATTACHMENTS_OFF = "Reading attachments and recordings is turned off in Settings > AI.";
export const FILE_GONE = "One of the attached files isn't there anymore, or you can't open it.";
/** A chat upload never sent is deleted after this long. */
const UNSENT_TTL_MS = 24 * 60 * 60_000;

export const fileByPublicId = (ctx: Ctx, publicId: string) =>
  ctx.db
    .query("files")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();

/**
 * Whether the person may have the AI read a file in `conversation`: their own chat upload (in the
 * conversation's scope, and not sent in another conversation), or a file of a note they can read (not in
 * Trash). Avatars, logos, covers and exports never.
 */
export async function canAttach(ctx: Ctx, profile: Doc<"profiles">, file: Doc<"files">, conversation: Doc<"aiConversations">): Promise<boolean> {
  if (file.status !== "ready" || !hasValidScope(file)) return false;
  if (file.kind === "attachment") {
    return file.uploadedBy === profile._id && inScope(file, scopeOfRow(conversation)) && (file.conversationId === undefined || file.conversationId === conversation._id);
  }
  if (!file.documentId || (file.kind !== "image" && file.kind !== "file" && file.kind !== "audio")) return false;
  const doc = await ctx.db.get(file.documentId);
  return Boolean(doc && !doc.inTrash && doc.deletedAt === undefined && accessAtLeast(await documentAccess(ctx, profile, doc), "read"));
}

/** What the model reads a file as: its kind, or the reason it can't. */
export function readableKind(file: Doc<"files">): { ok: true; kind: AttachmentKind } | { ok: false; reason: string } {
  const c = capabilities();
  return checkAttachment({ filename: file.filename, mimeType: file.mimeType, size: file.size }, { vision: c.vision, audioIn: c.audioIn });
}

/**
 * Checks the files attached to a message being posted (count, access, kind, size, the setting) and claims
 * chat uploads for the conversation. Returns their row ids, for `aiMessages.attachments`.
 */
export async function claimAttachments(ctx: MutationCtx, profile: Doc<"profiles">, conversation: Doc<"aiConversations">, fileIds: string[]): Promise<Id<"files">[]> {
  const ids = [...new Set(fileIds)];
  if (!ids.length) return [];
  if (!aiPrefsOf(profile).attachments) fail("forbidden", ATTACHMENTS_OFF);
  if (ids.length > MAX_ATTACHMENTS) fail("limit_exceeded", `Attach up to ${MAX_ATTACHMENTS} files to one message.`);
  const files: { row: Doc<"files">; kind: AttachmentKind }[] = [];
  for (const id of ids) {
    const row = await fileByPublicId(ctx, id);
    if (!row || !(await canAttach(ctx, profile, row, conversation))) fail("not_found", FILE_GONE);
    const check = readableKind(row);
    if (!check.ok) fail("unsupported_file", check.reason);
    files.push({ row, kind: check.kind });
  }
  const tooBig = checkInlineBudget(files.map((f) => ({ kind: f.kind, size: f.row.size })));
  if (tooBig) fail("limit_exceeded", tooBig);
  for (const { row } of files) if (row.kind === "attachment" && !row.conversationId) await ctx.db.patch(row._id, { conversationId: conversation._id });
  return files.map((f) => f.row._id);
}

/** A file as a message shows it (a chip): its name and kind. */
export interface AttachmentChip {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind | "file";
}

/** The attachments of some messages that the person can still open, by row id. */
export async function attachmentChips(ctx: Ctx, profile: Doc<"profiles">, conversation: Doc<"aiConversations">, messages: Doc<"aiMessages">[]): Promise<Map<Id<"files">, AttachmentChip>> {
  const out = new Map<Id<"files">, AttachmentChip>();
  for (const m of messages) {
    for (const id of m.attachments ?? []) {
      if (out.has(id)) continue;
      const f = await ctx.db.get(id);
      if (!f || !(await canAttach(ctx, profile, f, conversation))) continue;
      out.set(id, { id: f.publicId, name: f.filename, mimeType: f.mimeType, size: f.size, kind: attachmentKind(f) ?? "file" });
    }
  }
  return out;
}

async function deleteFile(ctx: MutationCtx, f: Doc<"files">): Promise<void> {
  await ctx.storage.delete(f.storageId);
  if (hasValidScope(f)) await releaseFileStorage(ctx, f, scopeOfRow(f));
  await bump(ctx, "storage_bytes", -f.size);
  await ctx.db.delete(f._id);
}

/** Deletes up to `limit` of a conversation's chat uploads. Returns how many it deleted. */
export async function deleteConversationFiles(ctx: MutationCtx, conversationId: Id<"aiConversations">, limit = 50): Promise<number> {
  const rows = await ctx.db
    .query("files")
    .withIndex("by_kind_conversation", (q) => q.eq("kind", "attachment").eq("conversationId", conversationId))
    .take(limit);
  for (const f of rows) await deleteFile(ctx, f);
  return rows.length;
}

/** Chat uploads that were never sent (the message was abandoned), after a day. Returns how many. */
export async function sweepUnsentAttachments(ctx: MutationCtx, now = Date.now()): Promise<number> {
  const rows = await ctx.db
    .query("files")
    .withIndex("by_kind_conversation", (q) => q.eq("kind", "attachment").eq("conversationId", undefined).lt("createdAt", now - UNSENT_TTL_MS))
    .take(50);
  for (const f of rows) await deleteFile(ctx, f);
  return rows.length;
}
