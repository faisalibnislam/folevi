// The write tools' proposals (lib/ai/tools/index.ts has the tools). Each runs in a query as the person
// (aiAgent.propose): it checks they can make the change (write access before anything else), that what it
// names exists in this place, and records what it found (titles, folders, block revisions) so approval can
// tell whether anything changed since. Nothing here writes: the result is an operation for the preview.
import type { Doc } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { blockSearchText, normalizeForSearch } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, documentAccessInfo, getDocumentByPublicId, requireRowScope } from "../../auth";
import { fail } from "../../errors";
import { liveBlocks } from "../../documents";
import { inScope, scopeFields, type Scope } from "../../scope";
import { MAX_EDITS, MAX_ITEMS, MAX_MERGE, MAX_OPS, MAX_TAGS, q, type AgentOp, type BlockEdit, type OpKind } from "./ops";
import { scopeFolders, scopeTags, type ReadEnv } from "./read";
import { cleanText } from "./schema";

const NOT_HERE = "There's no note with that id here (or you can't open it).";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A note of this place the person can edit (not in Trash). Write access is checked before anything else. */
export async function writableNote(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope, noteId: string): Promise<Doc<"documents">> {
  const doc = await getDocumentByPublicId(ctx, noteId);
  if (!doc || doc.deletedAt !== undefined || !inScope(doc, scope)) fail("not_found", NOT_HERE);
  const access = await documentAccess(ctx, profile, doc);
  if (access === "none") fail("not_found", NOT_HERE);
  if (!accessAtLeast(access, "write")) fail("forbidden", `You can only read ${q(doc.title)}, so it can't be changed.`);
  if (doc.inTrash) fail("forbidden", `${q(doc.title)} is in Trash.`);
  return doc;
}

/** Whether the person may add notes and folders here (their Personal, or a workspace where they can edit). */
export async function requireCreate(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope): Promise<void> {
  try {
    await requireRowScope(ctx, profile, scopeFields(scope), "edit");
  } catch {
    fail("forbidden", "You can't add notes or folders here.");
  }
}

/** Folders, tags and moves are for members of the place, not guests of one page. */
async function requireMember(ctx: QueryCtx, profile: Doc<"profiles">, doc: Doc<"documents">): Promise<void> {
  if (!(await documentAccessInfo(ctx, profile, doc)).inScope) fail("forbidden", "Only members can file or tag notes here.");
}

/**
 * Where a note goes: an existing folder of this place (by id or name), a folder an earlier operation of the
 * run makes (by name), or none ("none", or nothing given).
 */
async function folderTarget(ctx: QueryCtx, scope: Scope, earlier: AgentOp[], folderId: string, folderName: string): Promise<Pick<AgentOp, "folderId" | "folderName" | "folderOp"> | null> {
  if (!folderId && !folderName) return null;
  if (folderId === "none") return { folderId: null };
  const folders = await scopeFolders(ctx, scope);
  if (folderId) {
    const f = folders.find((x) => x.publicId === folderId);
    if (f) return { folderId: f.publicId, folderName: f.name };
    const made = earlier.find((o) => o.kind === "create_folder" && o.id === folderId);
    if (made) return { folderOp: made.id, folderName: made.folderName };
    fail("not_found", "There's no folder with that id here. Use list_folders, or create_folder first.");
  }
  const key = folderName.toLowerCase();
  const f = folders.find((x) => x.name.trim().toLowerCase() === key);
  if (f) return { folderId: f.publicId, folderName: f.name };
  const made = earlier.find((o) => o.kind === "create_folder" && (o.folderName ?? "").toLowerCase() === key);
  if (made) return { folderOp: made.id, folderName: made.folderName };
  fail("not_found", `There's no folder called ${q(folderName)}. Propose create_folder first, or use list_folders.`);
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const where = (t: Pick<AgentOp, "folderName"> | null) => (t?.folderName ? ` in ${q(t.folderName)}` : "");

type Proposer = (ctx: QueryCtx, env: ReadEnv, args: Record<string, unknown>, earlier: AgentOp[]) => Promise<Omit<AgentOp, "id" | "kind" | "status">>;

/** The write tools' proposals, by tool name. Arguments were checked against the tool's schema. */
export const PROPOSERS: Record<OpKind, Proposer> = {
  async create_folder(ctx, env, args, earlier) {
    await requireCreate(ctx, env.profile, env.scope);
    const name = cleanText(str(args.name).replace(/[\r\n]+/g, " "), 80);
    if (!name) fail("invalid_argument", "Give the folder a name.");
    const key = name.toLowerCase();
    const existing = (await scopeFolders(ctx, env.scope)).find((f) => f.name.trim().toLowerCase() === key);
    if (existing) fail("invalid_argument", `There's already a folder called ${q(existing.name)} (id ${existing.publicId}). Use it instead.`);
    if (earlier.some((o) => o.kind === "create_folder" && (o.folderName ?? "").toLowerCase() === key)) fail("invalid_argument", "That folder is already proposed.");
    return { summary: `New folder ${q(name)}`, folderName: name };
  },

  async create_note(ctx, env, args, earlier) {
    await requireCreate(ctx, env.profile, env.scope);
    const title = cleanText(str(args.title).replace(/[\r\n]+/g, " "), 200);
    if (!title) fail("invalid_argument", "Give the note a title.");
    const target = await folderTarget(ctx, env.scope, earlier, str(args.folderId), str(args.folderName));
    return { summary: `New note ${q(title)}${where(target)}`, title, markdown: str(args.markdown), ...(target ?? {}) };
  },

  async update_note(ctx, env, args, earlier) {
    const doc = await writableNote(ctx, env.profile, env.scope, str(args.noteId));
    if (earlier.some((o) => o.kind === "update_note" && o.noteId === doc.publicId)) fail("invalid_argument", "Put every edit to one note in a single update_note call.");
    const blocks = new Map((await liveBlocks(ctx, doc._id)).map((b) => [b.blockId, b]));
    const raw = (args.edits as Record<string, unknown>[]) ?? [];
    if (!raw.length) fail("invalid_argument", "Give at least one edit.");
    if (raw.length > MAX_EDITS) fail("invalid_argument", `At most ${MAX_EDITS} edits per note.`);
    const touched = new Set<string>();
    const edits: BlockEdit[] = [];
    for (const e of raw) {
      const action = str(e.action) as BlockEdit["action"];
      const markdown = str(e.markdown);
      if (action === "insert") {
        const after = str(e.afterBlockId);
        if (after && !blocks.has(after)) fail("not_found", `There's no block ${after} in that note. Use the ids get_note shows.`);
        if (!markdown.trim()) fail("invalid_argument", "An insert needs markdown.");
        edits.push({ action, afterBlockId: after || null, markdown });
        continue;
      }
      const id = str(e.blockId);
      const b = blocks.get(id);
      if (!b) fail("not_found", `There's no block ${id || "(none given)"} in that note. Use the ids get_note shows.`);
      if (touched.has(id)) fail("invalid_argument", `Block ${id} is edited twice. Combine the edits.`);
      touched.add(id);
      const before = blockSearchText({ type: b.type, text: b.text as never, props: b.props as never });
      if (action === "replace") {
        if (!markdown.trim()) fail("invalid_argument", "A replace needs markdown (use delete to remove a block).");
        edits.push({ action, blockId: id, markdown, before, baseRev: b.contentRev });
      } else {
        edits.push({ action: "delete", blockId: id, before, baseRev: b.contentRev });
      }
    }
    const n = edits.length;
    return { summary: `Edit ${q(doc.title)} (${n} change${n === 1 ? "" : "s"})`, noteId: doc.publicId, noteTitle: doc.title || "Untitled", edits, baseContentSeq: doc.contentSeq };
  },

  async append_to_note(ctx, env, args) {
    const doc = await writableNote(ctx, env.profile, env.scope, str(args.noteId));
    const markdown = str(args.markdown);
    if (!markdown.trim()) fail("invalid_argument", "Give the markdown to add.");
    return { summary: `Add to the end of ${q(doc.title)}`, noteId: doc.publicId, noteTitle: doc.title || "Untitled", markdown, baseContentSeq: doc.contentSeq };
  },

  async rename_note(ctx, env, args, earlier) {
    const doc = await writableNote(ctx, env.profile, env.scope, str(args.noteId));
    const title = cleanText(str(args.title).replace(/[\r\n]+/g, " "), 200);
    if (!title) fail("invalid_argument", "Give the new title.");
    if (title === doc.title) fail("invalid_argument", "That's already its title.");
    if (earlier.some((o) => o.kind === "rename_note" && o.noteId === doc.publicId)) fail("invalid_argument", "That note is already being renamed.");
    return { summary: `Rename ${q(doc.title)} to ${q(title)}`, noteId: doc.publicId, noteTitle: doc.title || "Untitled", title, fromTitle: doc.title };
  },

  async move_note(ctx, env, args, earlier) {
    const doc = await writableNote(ctx, env.profile, env.scope, str(args.noteId));
    await requireMember(ctx, env.profile, doc);
    const target = await folderTarget(ctx, env.scope, earlier, str(args.folderId), str(args.folderName));
    if (!target) fail("invalid_argument", "Say which folder (folderId, folderName, or \"none\" for no folder).");
    const from = doc.folderId ? await ctx.db.get(doc.folderId) : null;
    const fromId = from && !from.deletedAt ? from.publicId : null;
    if (!target.folderOp && (target.folderId ?? null) === fromId) fail("invalid_argument", "It's already there.");
    if (earlier.some((o) => o.kind === "move_note" && o.noteId === doc.publicId)) fail("invalid_argument", "That note is already being moved.");
    const summary = target.folderId === null ? `Take ${q(doc.title)} out of ${q(from?.name ?? "its folder")}` : `Move ${q(doc.title)} to ${q(target.folderName ?? "the folder")}`;
    return { summary, noteId: doc.publicId, noteTitle: doc.title || "Untitled", ...target, fromFolderId: fromId, ...(from && !from.deletedAt ? { fromFolderName: from.name } : {}) };
  },

  async add_tags(ctx, env, args) {
    const doc = await writableNote(ctx, env.profile, env.scope, str(args.noteId));
    await requireMember(ctx, env.profile, doc);
    const names = [...new Map(((args.tags as string[]) ?? []).map((t) => cleanText(t.replace(/^#+/, "").replace(/[\r\n]+/g, " "), 40)).filter(Boolean).map((t) => [normalizeForSearch(t), t])).entries()];
    if (!names.length) fail("invalid_argument", "Give at least one tag.");
    if (names.length > MAX_TAGS) fail("invalid_argument", `At most ${MAX_TAGS} tags at once.`);
    const tags = await scopeTags(ctx, env.scope);
    const links = await ctx.db
      .query("documentTags")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(100);
    const has = new Set(links.map((l) => l.tagId as string));
    const wanted = names.filter(([key]) => {
      const t = tags.find((x) => x.normalizedName === key);
      return !t || !has.has(t._id);
    });
    if (!wanted.length) fail("invalid_argument", "It already has those tags.");
    const shown = wanted.map(([key, name]) => tags.find((x) => x.normalizedName === key)?.name ?? name);
    return { summary: `Tag ${q(doc.title)} with ${shown.map((t) => `#${t}`).join(", ")}`, noteId: doc.publicId, noteTitle: doc.title || "Untitled", tags: shown };
  },

  async create_checklist(ctx, env, args, earlier) {
    const items = ((args.items as string[]) ?? []).map((t) => cleanText(t.replace(/[\r\n]+/g, " "), 300)).filter(Boolean);
    if (!items.length) fail("invalid_argument", "Give at least one item.");
    if (items.length > MAX_ITEMS) fail("invalid_argument", `At most ${MAX_ITEMS} items.`);
    const title = cleanText(str(args.title).replace(/[\r\n]+/g, " "), 200);
    const noteId = str(args.noteId);
    if (noteId) {
      const doc = await writableNote(ctx, env.profile, env.scope, noteId);
      return { summary: `Add a checklist of ${items.length} to ${q(doc.title)}`, noteId: doc.publicId, noteTitle: doc.title || "Untitled", ...(title ? { title } : {}), items: items.map((text) => ({ text })), baseContentSeq: doc.contentSeq };
    }
    await requireCreate(ctx, env.profile, env.scope);
    if (!title) fail("invalid_argument", "Give a title for the new checklist (or a noteId to add it to).");
    const target = await folderTarget(ctx, env.scope, earlier, str(args.folderId), str(args.folderName));
    return { summary: `New checklist ${q(title)}${where(target)}`, title, items: items.map((text) => ({ text })), ...(target ?? {}) };
  },

  async create_tasks(ctx, env, args, earlier) {
    const raw = (args.tasks as { title?: unknown; dueDate?: unknown }[]) ?? [];
    const items: { text: string; dueDate?: string }[] = [];
    for (const t of raw) {
      const text = cleanText(str(t.title).replace(/[\r\n]+/g, " "), 300);
      if (!text) continue;
      const due = str(t.dueDate);
      if (due && (!DATE.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) fail("invalid_argument", `"${due}" isn't a date. Use YYYY-MM-DD.`);
      items.push(due ? { text, dueDate: due } : { text });
    }
    if (!items.length) fail("invalid_argument", "Give at least one task.");
    if (items.length > MAX_ITEMS) fail("invalid_argument", `At most ${MAX_ITEMS} tasks.`);
    const n = `${items.length} task${items.length === 1 ? "" : "s"}`;
    const noteId = str(args.noteId);
    if (noteId) {
      const doc = await writableNote(ctx, env.profile, env.scope, noteId);
      return { summary: `Add ${n} to ${q(doc.title)}`, noteId: doc.publicId, noteTitle: doc.title || "Untitled", items, baseContentSeq: doc.contentSeq };
    }
    await requireCreate(ctx, env.profile, env.scope);
    const title = cleanText(str(args.title).replace(/[\r\n]+/g, " "), 200) || "Tasks";
    const target = await folderTarget(ctx, env.scope, earlier, str(args.folderId), str(args.folderName));
    return { summary: `New note ${q(title)} with ${n}${where(target)}`, title, items, ...(target ?? {}) };
  },

  async merge_notes(ctx, env, args, earlier) {
    const target = await writableNote(ctx, env.profile, env.scope, str(args.targetId));
    const ids = [...new Set((args.sourceIds as string[]) ?? [])].filter((id) => id !== target.publicId);
    if (!ids.length) fail("invalid_argument", "Give the notes to merge into it (not the note itself).");
    if (ids.length > MAX_MERGE) fail("invalid_argument", `At most ${MAX_MERGE} notes at once.`);
    const sources: { id: string; title: string }[] = [];
    for (const id of ids) {
      const s = await writableNote(ctx, env.profile, env.scope, id);
      sources.push({ id: s.publicId, title: s.title || "Untitled" });
    }
    const busy = new Set([target.publicId, ...ids]);
    if (earlier.some((o) => o.kind === "merge_notes" && [o.noteId, ...(o.sources ?? []).map((s) => s.id)].some((id) => id && busy.has(id)))) fail("invalid_argument", "Those notes are already part of a proposed merge.");
    const n = sources.length;
    return {
      summary: `Merge ${n} note${n === 1 ? "" : "s"} into ${q(target.title)} (then move ${n === 1 ? "it" : "them"} to Trash)`,
      noteId: target.publicId,
      noteTitle: target.title || "Untitled",
      sources,
      baseContentSeq: target.contentSeq,
    };
  },
};

/** The most a run may propose, checked before each proposal. */
export function checkRoom(earlier: AgentOp[]): void {
  if (earlier.length >= MAX_OPS) fail("limit_exceeded", `That's the most changes one run can propose (${MAX_OPS}). Finish with what's proposed.`);
}
