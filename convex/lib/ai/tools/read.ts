// The database half of the agent's read tools (lib/ai/tools/index.ts has the tools themselves). Each runs
// in a query as the person (aiAgent.inspect): only notes of the conversation's place (their Personal or a
// workspace) that they can open, never one in Trash, with links labelled as they may see them. Note text
// goes back wrapped as untrusted (untrusted.ts).
import type { Doc } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { blockSearchText, flattenTree, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, getDocumentByPublicId, PageReader } from "../../auth";
import { fail } from "../../errors";
import { liveBlocks, toWireBlock } from "../../documents";
import { ReaderLabels } from "../../linkLabels";
import { inScope, type Scope } from "../../scope";
import { duplicatePairs, noteSimilarity } from "./similarity";
import { untrusted } from "./untrusted";

export interface ReadEnv {
  profile: Doc<"profiles">;
  /** Where the conversation lives: the only place the agent reads and changes. */
  scope: Scope;
  /** What the conversation is about (public ids), for get_workspace_context. */
  context: { kind: string; ids: string[] };
  today: string;
}

/** Characters of one note get_note returns (get_notes: each). */
export const NOTE_CHARS = 12_000;
export const NOTES_CHARS = 5_000;
const NOT_HERE = "There's no note with that id here (or you can't open it).";

/** A note of this place the person can open (not in Trash), or a refusal the model sees. */
export async function readableNote(ctx: QueryCtx, env: ReadEnv, noteId: string): Promise<Doc<"documents">> {
  const doc = await getDocumentByPublicId(ctx, noteId);
  if (!doc || doc.inTrash || doc.deletedAt !== undefined || !inScope(doc, env.scope)) fail("not_found", NOT_HERE);
  if (!accessAtLeast(await documentAccess(ctx, env.profile, doc), "read")) fail("not_found", NOT_HERE);
  return doc;
}

/** One block as a line the model can read and point at: its id, a type mark, its text. */
function blockLine(b: WireBlock, depth: number): string {
  const p = b.props as Record<string, unknown>;
  const text = blockSearchText(b).replace(/\s+/g, " ").trim();
  let mark = "";
  switch (b.type) {
    case "heading":
      mark = `${"#".repeat(Number(p.level) || 1)} `;
      break;
    case "bulleted":
      mark = "- ";
      break;
    case "numbered":
      mark = "1. ";
      break;
    case "todo":
      mark = p.checked ? "- [x] " : "- [ ] ";
      if (typeof p.dueDate === "string") mark += `(due ${p.dueDate}) `;
      break;
    case "quote":
      mark = "> ";
      break;
    case "toggle":
      mark = "▸ ";
      break;
    case "paragraph":
    case "callout":
      break;
    default:
      mark = `(${b.type}) `;
  }
  return `${"  ".repeat(Math.min(depth, 6))}[${b.id}] ${mark}${text}`;
}

/** A note's live blocks in reading order, labelled for this reader. */
export async function readerBlocks(ctx: QueryCtx, env: ReadEnv, doc: Doc<"documents">): Promise<WireBlock[]> {
  return await new ReaderLabels(ctx, env.profile).blocks((await liveBlocks(ctx, doc._id)).map(toWireBlock));
}

/** A note as the model reads it: block lines with ids, cut at `max` characters. */
export async function noteForModel(ctx: QueryCtx, env: ReadEnv, doc: Doc<"documents">, max: number) {
  const blocks = await readerBlocks(ctx, env, doc);
  const lines = flattenTree(blocks).map((e) => blockLine(e.block, e.depth));
  let text = "";
  let shown = 0;
  for (const line of lines) {
    if (text.length + line.length + 1 > max) break;
    text += `${line}\n`;
    shown++;
  }
  const folder = doc.folderId ? await ctx.db.get(doc.folderId) : null;
  const title = doc.title || "Untitled";
  return {
    id: doc.publicId,
    title,
    folder: folder && !folder.deletedAt ? { id: folder.publicId, name: folder.name } : null,
    updated: new Date(doc.updatedAt).toISOString().slice(0, 10),
    blocks: lines.length,
    ...(shown < lines.length ? { truncated: `Showing the first ${shown} of ${lines.length} blocks.` } : {}),
    content: untrusted("note", { id: doc.publicId, title }, text.trimEnd() || "(empty note)"),
  };
}

/** Notes of this place the person can open, most recently edited first (not templates or archived ones). */
export async function recentNotes(ctx: QueryCtx, env: ReadEnv, n: number): Promise<Doc<"documents">[]> {
  const s = env.scope;
  const rows = await (
    s.kind === "personal"
      ? ctx.db.query("documents").withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", s.profileId).eq("inTrash", false))
      : ctx.db.query("documents").withIndex("by_workspace_trash", (q) => q.eq("workspaceId", s.workspaceId).eq("inTrash", false))
  )
    .order("desc")
    .take(n * 2);
  const reader = await PageReader.forScope(ctx, env.profile, s);
  const usable = rows.filter((d) => (d.kind === "document" || d.kind === "daily") && !d.archivedAt);
  return (await reader.filter(usable)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, n);
}

export async function scopeFolders(ctx: QueryCtx, scope: Scope): Promise<Doc<"folders">[]> {
  const rows = await (
    scope.kind === "personal"
      ? ctx.db.query("folders").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("folders").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
  ).take(500);
  return rows.filter((f) => !f.deletedAt).sort((a, b) => (a.rank < b.rank ? -1 : 1));
}

export async function scopeTags(ctx: QueryCtx, scope: Scope): Promise<Doc<"tags">[]> {
  return await (
    scope.kind === "personal"
      ? ctx.db.query("tags").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("tags").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
  ).take(500);
}

type Reader = (ctx: QueryCtx, env: ReadEnv, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

/** The read tools' database parts, by tool name. Arguments were checked against the tool's schema. */
export const READERS: Record<string, Reader> = {
  async get_note(ctx, env, args) {
    const doc = await readableNote(ctx, env, str(args.noteId));
    return await noteForModel(ctx, env, doc, Math.min(num(args.maxChars, NOTE_CHARS), 20_000));
  },

  async get_notes(ctx, env, args) {
    const ids = [...new Set((args.noteIds as string[]) ?? [])];
    const notes: Record<string, unknown>[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const doc = await readableNote(ctx, env, id).catch(() => null);
      if (doc) notes.push(await noteForModel(ctx, env, doc, NOTES_CHARS));
      else missing.push(id);
    }
    return { notes, ...(missing.length ? { notFound: missing } : {}) };
  },

  async list_folders(ctx, env) {
    const folders = await scopeFolders(ctx, env.scope);
    const byId = new Map(folders.map((f) => [f._id, f]));
    return {
      folders: folders.slice(0, 200).map((f) => ({ id: f.publicId, name: f.name, ...(f.parentFolderId && byId.get(f.parentFolderId) ? { inside: byId.get(f.parentFolderId)!.name } : {}) })),
    };
  },

  async list_tags(ctx, env) {
    const tags = await scopeTags(ctx, env.scope);
    return { tags: tags.slice(0, 200).map((t) => ({ id: t.publicId, name: t.name })) };
  },

  async find_duplicates(ctx, env, args) {
    const focus = str(args.noteId);
    const notes = await recentNotes(ctx, env, 150);
    if (focus && !notes.some((n) => n.publicId === focus)) notes.push(await readableNote(ctx, env, focus));
    const pairs = duplicatePairs(
      notes.map((d) => ({ id: d.publicId, title: d.title || "Untitled", text: d.searchText.slice(0, 4_000) })),
      0.5,
      focus || undefined,
    ).slice(0, num(args.limit, 10));
    return {
      checked: notes.length,
      pairs: pairs.map((p) => ({ a: { id: p.a.id, title: p.a.title }, b: { id: p.b.id, title: p.b.title }, similarity: p.score })),
    };
  },

  async compare_notes(ctx, env, args) {
    const [a, b] = (args.noteIds as string[]) ?? [];
    if (!a || !b || a === b) fail("invalid_argument", "Give two different note ids.");
    const da = await readableNote(ctx, env, a);
    const db = await readableNote(ctx, env, b);
    return {
      similarity: noteSimilarity({ title: da.title, text: da.searchText }, { title: db.title, text: db.searchText }),
      a: await noteForModel(ctx, env, da, NOTES_CHARS),
      b: await noteForModel(ctx, env, db, NOTES_CHARS),
    };
  },

  async get_workspace_context(ctx, env) {
    const s = env.scope;
    const place = s.kind === "personal" ? "Personal" : ((await ctx.db.get(s.workspaceId))?.name ?? "Workspace");
    const recent = await recentNotes(ctx, env, 12);
    const folders = await scopeFolders(ctx, s);
    const tags = await scopeTags(ctx, s);
    const about: { id: string; title: string }[] = [];
    if (env.context.kind === "note" || env.context.kind === "notes") {
      for (const id of env.context.ids) {
        const doc = await readableNote(ctx, env, id).catch(() => null);
        if (doc) about.push({ id: doc.publicId, title: doc.title || "Untitled" });
      }
    }
    const folder = env.context.kind === "folder" ? folders.find((f) => f.publicId === env.context.ids[0]) : undefined;
    return {
      today: env.today,
      place,
      ...(about.length ? { conversationIsAbout: about } : {}),
      ...(folder ? { conversationIsAboutFolder: { id: folder.publicId, name: folder.name } } : {}),
      folders: folders.length,
      tags: tags.length,
      recentNotes: recent.map((d) => ({ id: d.publicId, title: d.title || "Untitled", updated: new Date(d.updatedAt).toISOString().slice(0, 10) })),
    };
  },

  /** find_related's note: its title and opening text, to search with (lib/ai/tools/related.ts). */
  async related_seed(ctx, env, args) {
    const doc = await readableNote(ctx, env, str(args.noteId));
    return { id: doc.publicId, title: doc.title || "Untitled", text: doc.searchText.slice(0, 1_500) };
  },
};
