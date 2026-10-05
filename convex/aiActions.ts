// Applying what Ask AI proposed (lib/aiActions.ts), once the person has checked it: make folders, write
// notes into them, move notes into them. Everything is authorized here as if the person did it by hand.
import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { markdownToBlocks, rankBetween, ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, requireDocument, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { nextSeq } from "./lib/seq";
import { inScope, insertScoped, vScopeArg, type Scope } from "./lib/scope";
import { randomFolderColor } from "./lib/folderColors";
import { createDocument } from "./lib/create";
import { SyncEngine } from "./lib/syncEngine";
import { MAX_ACTIONS, MAX_NOTE_MARKDOWN } from "./lib/aiActions";
import type { QueryCtx } from "./_generated/server";

async function scopeFolders(ctx: QueryCtx, scope: Scope): Promise<Doc<"folders">[]> {
  const base = ctx.db.query("folders");
  const rows = await (scope.kind === "personal"
    ? base.withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
    : base.withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
  ).collect();
  return rows.filter((f) => !f.deletedAt);
}

/** The folders Ask AI may name in a plan (where the person is). */
export const folders = internalQuery({
  args: { scope: vScopeArg },
  handler: async (ctx, args): Promise<{ id: string; name: string }[]> => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    return (await scopeFolders(ctx, scope)).slice(0, 200).map((f) => ({ id: f.publicId, name: f.name }));
  },
});

const vAction = v.union(
  v.object({ type: v.literal("createFolder"), name: v.string() }),
  v.object({ type: v.literal("createNote"), title: v.string(), markdown: v.string(), folderId: v.optional(v.string()), folderName: v.optional(v.string()) }),
  v.object({ type: v.literal("moveNote"), noteId: v.string(), noteTitle: v.string(), folderId: v.optional(v.string()), folderName: v.optional(v.string()) }),
);

/** Applies a checked plan. Returns what was made and moved, for links in the chat. */
export const apply = mutation({
  args: { scope: vScopeArg, actions: v.array(vAction) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    if (args.actions.length > MAX_ACTIONS) fail("limit_exceeded", `At most ${MAX_ACTIONS} changes at once.`);
    const existing = await scopeFolders(ctx, scope);
    const folderIds = new Map<string, Id<"folders">>(existing.map((f) => [f.publicId, f._id]));
    const byName = new Map<string, Doc<"folders">>(existing.map((f) => [f.name.trim().toLowerCase(), f]));
    const made = new Map<string, { id: Id<"folders">; publicId: string }>();
    const folders: { id: string; name: string }[] = [];
    const notes: { id: string; title: string }[] = [];
    let moved = 0;

    const folderFor = (a: { folderId?: string; folderName?: string }): { id: Id<"folders">; publicId: string } | null => {
      if (a.folderId) {
        const id = folderIds.get(a.folderId);
        if (!id) fail("not_found", "That folder is no longer there.");
        return { id, publicId: a.folderId };
      }
      if (a.folderName) {
        const key = a.folderName.trim().toLowerCase();
        const mine = made.get(key) ?? (byName.has(key) ? { id: byName.get(key)!._id, publicId: byName.get(key)!.publicId } : undefined);
        if (!mine) fail("not_found", `There's no folder called “${a.folderName}”.`);
        return mine;
      }
      return null;
    };

    // Folders first, so notes can go into them.
    for (const a of args.actions) {
      if (a.type !== "createFolder") continue;
      const name = a.name.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80);
      if (!name) continue;
      const key = name.toLowerCase();
      if (byName.has(key) || made.has(key)) continue;
      const last = [...existing.map((f) => f.rank)].sort().pop() ?? null;
      const publicId = ulid();
      const now = Date.now();
      const id = await insertScoped(ctx, "folders", scope, {
        publicId,
        name,
        color: randomFolderColor(),
        rank: rankBetween(last, null),
        createdBy: profile._id,
        createdAt: now,
        updatedAt: now,
        seq: await nextSeq(ctx, scope),
      });
      made.set(key, { id, publicId });
      folders.push({ id: publicId, name });
    }

    for (const a of args.actions) {
      if (a.type === "createNote") {
        const title = a.title.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 300) || "Untitled";
        const folder = folderFor(a);
        const { blocks } = markdownToBlocks(a.markdown.slice(0, MAX_NOTE_MARKDOWN));
        if (blocks.length > 2000) fail("limit_exceeded", "That note is too long.");
        const doc = await createDocument(ctx, { scope, actor: profile, title, folderId: folder?.id, blocks });
        notes.push({ id: doc.publicId, title });
      } else if (a.type === "moveNote") {
        const folder = folderFor(a);
        if (!folder) continue;
        const { doc } = await requireDocument(ctx, profile, a.noteId, "write");
        if (!inScope(doc, scope)) fail("forbidden", "That note is in a different place.");
        if (!accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("forbidden", "You can't move that note.");
        const engine = new SyncEngine(ctx, profile, "server");
        const [r] = await engine.applyAll(null, [{ opId: ulid(), kind: "document.update", documentId: doc.publicId, patch: { folderId: folder.publicId }, baseRevision: doc.revision }]);
        if (r?.status === "rejected") fail("invalid_argument", r.error?.message ?? "Could not move the note.");
        moved++;
      }
    }
    return { folders, notes, moved };
  },
});
