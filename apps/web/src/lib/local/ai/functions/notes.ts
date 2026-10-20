// The Foli AI functions that change notes or read them for the model, in local mode: applying a checked plan
// (aiActions.apply), saving a generated page (aiWriting.saveDraft), finding to-dos (aiTodos), translating a
// whole note and the version saved before a replacement (aiStudy), and remembered preferences (aiMemory).
// Each does what its server function does, for the library's one person.
import { applyTranslations, chunkSegments, MAX_TRANSLATE_CHARS, MAX_TRANSLATE_CHUNKS, parseTranslation, segmentsOf, translationRequest, translationsFor, TRANSLATE_CHUNK_CHARS } from "@folevi/ai-prompts/translate";
import { cleanLanguage, cleanTitleLine, MAX_DRAFT_BLOCKS, MAX_DRAFT_CHARS } from "@folevi/ai-prompts/writing";
import { findTodosRequest, parseActionItems, FIND_TODOS_MAX_OUTPUT } from "@folevi/ai-prompts/actionItems";
import { MAX_ACTIONS, MAX_NOTE_MARKDOWN } from "@folevi/ai-prompts/actions";
import { cleanMemoryText, MAX_MEMORIES, memoryKey, type MemoryKind } from "@folevi/ai-prompts/memory";
import { blocksToMarkdown, cloneBlocks, linkPeople, markdownToBlocks, matchOwner, ulid, type InlineNode, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { getFunctionName } from "convex/server";
import type { Id } from "@/lib/convex/api";
import { api } from "@/lib/convex/api";
import { fail } from "../../errors";
import { defineLocal, LOCAL_FUNCTIONS, type LocalMutationCtx, type LocalReader } from "../../registry";
import { checkScope, insertDocument, liveBlocks, ReaderLabels, requireProfile, toWireBlock } from "../../functions/shared";
import { applyOps } from "../../functions/sync";
import { copyCollectionsInto } from "../../functions/collections";
import { saveVersion } from "../../functions/documents.history";
import { MEMORY_KEY, memoryEntries, memoryFor, prefsOf, read, readableNote, requireAiProfile, type LocalMemoryEntry } from "../common";
import { localAi, textBudget } from "../provider";
import { conversation, conversationOfMessage, messagesOf, putMessages } from "../chatStore";

/** Runs another local mutation's handler inside this mutation (the same transaction). */
async function callMutation<Ref extends FunctionReference<"mutation", "public">>(ctx: LocalMutationCtx, ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>> {
  const fn = LOCAL_FUNCTIONS.get(getFunctionName(ref));
  if (!fn || fn.kind !== "mutation") throw new Error(`${getFunctionName(ref)} has no local handler.`);
  return (await (fn.handler as (c: LocalMutationCtx, a: unknown) => unknown)(ctx, args)) as FunctionReturnType<Ref>;
}

// ---- aiActions.apply ----------------------------------------------------------------------------------------

defineLocal(api.aiActions.apply, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  if (args.actions.length > MAX_ACTIONS) fail("limit_exceeded", `At most ${MAX_ACTIONS} changes at once.`);
  const existing = (await ctx.db.list("folders")).filter((f) => f.deletedAt === null);
  const folderIds = new Set(existing.map((f) => f.id));
  const byName = new Map(existing.map((f) => [f.name.trim().toLowerCase(), f.id]));
  const made = new Map<string, string>();
  const folders: { id: string; name: string }[] = [];
  const notes: { id: string; title: string }[] = [];
  let moved = 0;
  const folderFor = (a: { folderId?: string; folderName?: string }): string | null => {
    if (a.folderId) {
      if (!folderIds.has(a.folderId) && ![...made.values()].includes(a.folderId)) fail("not_found", "That folder is no longer there.");
      return a.folderId;
    }
    if (a.folderName) {
      const key = a.folderName.trim().toLowerCase();
      const id = made.get(key) ?? byName.get(key);
      if (!id) fail("not_found", `There's no folder called “${a.folderName}”.`);
      return id;
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
    const { id } = await callMutation(ctx, api.organization.createFolder, { scope: { kind: "personal" }, name });
    made.set(key, id);
    folders.push({ id, name });
  }
  for (const a of args.actions) {
    if (a.type === "createNote") {
      const title = a.title.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 300) || "Untitled";
      const folderId = folderFor(a);
      const { blocks } = markdownToBlocks(a.markdown.slice(0, MAX_NOTE_MARKDOWN));
      if (blocks.length > 2000) fail("limit_exceeded", "That note is too long.");
      const doc = await insertDocument(ctx, { title, folderId, blocks });
      notes.push({ id: doc.id, title });
    } else if (a.type === "moveNote") {
      const folderId = folderFor(a);
      if (!folderId) continue;
      const doc = await ctx.db.get("documents", a.noteId);
      if (!doc) fail("not_found", "Document not found.");
      const [r] = await applyOps(ctx, profile, [{ opId: ulid(), kind: "document.update", documentId: doc.id, patch: { folderId }, baseRevision: doc.revision } as SyncOp]);
      if (r?.status === "rejected") fail("invalid_argument", r.error?.message ?? "Could not move the note.");
      moved++;
    }
  }
  return { folders, notes, moved };
});

// ---- aiWriting.saveDraft ------------------------------------------------------------------------------------

defineLocal(api.aiWriting.saveDraft, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  if (args.markdown.length > MAX_DRAFT_CHARS) fail("limit_exceeded", "That draft is too long to save. Make it shorter first.");
  let folderId: string | null = null;
  if (args.folderId && args.kind === "note") {
    const folder = await ctx.db.get("folders", args.folderId);
    if (!folder || folder.deletedAt !== null) fail("not_found", "Folder not found.");
    folderId = folder.id;
  }
  const parsed = markdownToBlocks(args.markdown, { titleFromHeading: false }).blocks;
  // The library has one person: "@Name" becomes a mention only when it names them.
  const blocks = args.people ? linkPeople(parsed, [{ profileId: profile.id, displayName: profile.displayName }]) : parsed;
  if (blocks.length > MAX_DRAFT_BLOCKS) fail("limit_exceeded", "That draft has too many blocks to save.");
  const title = cleanTitleLine(args.title) || (args.kind === "template" ? "New template" : "Untitled");
  const doc = await insertDocument(ctx, { title, folderId, blocks, kind: args.kind === "template" ? "template" : "document" });
  return { id: doc.id };
});

// ---- aiTodos -----------------------------------------------------------------------------------------------

const TODO_TEXT = 24_000;
const TODO_NOTE_CHARS = 30_000;

/** Who a note's to-dos can go to: in a library, only its one person. */
async function people(db: LocalReader) {
  const p = await requireProfile({ db } as LocalMutationCtx);
  return [{ profileId: p.id, displayName: p.displayName, isYou: true }];
}

defineLocal(api.aiTodos.people, "query", async (ctx, args) => {
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc || doc.inTrash) fail("not_found", "Document not found.");
  return await people(ctx.db);
});

defineLocal(api.aiTodos.find, "action", async (ctx, args) => {
  checkScope(args.scope);
  const active = await localAi.active("findTodos");
  const text = (args.text ?? "").slice(0, TODO_TEXT);
  const withNote = !text.trim();
  const budget = textBudget(active, { serverChars: withNote ? TODO_NOTE_CHARS : TODO_TEXT, overheadChars: 1_800, answerTokens: FIND_TODOS_MAX_OUTPUT });
  const { note, who, memory } = await read(ctx, async (db) => {
    await requireAiProfile(db);
    const doc = await db.get("documents", args.documentId);
    if (!doc || doc.inTrash) fail("not_found", "Document not found.");
    let note: { title: string; text: string } | null = null;
    if (withNote) {
      const blocks = await new ReaderLabels(db).blocks((await liveBlocks(db, doc.id)).map(toWireBlock));
      const body = blocksToMarkdown(blocks).slice(0, Math.min(TODO_NOTE_CHARS, budget));
      note = { title: doc.title || "Untitled", text: body.trim() ? body : "" };
    }
    return { note, who: await people(db), memory: await memoryFor(db) };
  });
  if (withNote && !note?.text.trim()) fail("invalid_argument", "There's nothing in this note to find to-dos in yet.");
  const source = withNote ? note!.text : text.slice(0, budget);
  const raw = (await localAi.generate(findTodosRequest({ note, text: withNote ? undefined : source }), { memory })).text;
  const items = parseActionItems(raw, source).map((item) => {
    const { assigneeId, status } = matchOwner(item.owner, who);
    return { ...item, assigneeId, match: status };
  });
  return { items, people: who };
});

// ---- aiStudy -----------------------------------------------------------------------------------------------

const PARALLEL = 3;
const PREVIEW_CHARS = 40_000;

defineLocal(api.aiStudy.versionBeforeReplace, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const saved = await saveVersion(ctx, doc, "ai_run");
  return { versionId: saved.id ?? null };
});

async function inParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

defineLocal(api.aiStudy.translateNote, "action", async (ctx, args) => {
  checkScope(args.scope);
  const active = await localAi.active("translate");
  const language = cleanLanguage(args.language);
  const source = await read(ctx, async (db) => {
    await requireAiProfile(db);
    const doc = await readableNote(db, args.documentId);
    if (doc.inTrash) fail("not_found", "Document not found.");
    const blocks: WireBlock[] = await new ReaderLabels(db).blocks((await liveBlocks(db, doc.id)).map(toWireBlock));
    return { title: doc.title || "Untitled", blocks };
  });
  const segments = segmentsOf(source.blocks);
  if (!segments.length) fail("invalid_argument", "There's no text in this note to translate.");
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  // On the device a piece is what fits beside the instructions and its translation (about a third of the room each).
  const chunkChars = active.provider === "on-device" ? Math.max(400, Math.floor(textBudget(active, { serverChars: TRANSLATE_CHUNK_CHARS, overheadChars: 1_200, answerTokens: Math.floor(active.contextTokens / 2) }))) : TRANSLATE_CHUNK_CHARS;
  const chunks = chunkSegments(segments, chunkChars);
  const maxChunks = active.provider === "on-device" ? MAX_TRANSLATE_CHUNKS * 3 : MAX_TRANSLATE_CHUNKS;
  if (chars > MAX_TRANSLATE_CHARS || chunks.length > maxChunks) fail("limit_exceeded", "This note is too long to translate in one go. Split it into shorter notes first.");
  const done = new Map<string, InlineNode[]>();
  // One request at a time on the device (the model runs one session at a time well); three with a key.
  await inParallel(chunks, active.provider === "on-device" ? 1 : PARALLEL, async (chunk) => {
    const req = translationRequest(chunk, language);
    const out = await localAi.generate(active.provider === "on-device" ? { ...req, maxOutputTokens: Math.min(req.maxOutputTokens ?? 8192, Math.floor(active.contextTokens / 2)) } : req);
    for (const [key, nodes] of parseTranslation(out.text, chunk)) done.set(key, nodes);
  });
  if (!done.size) fail("invalid_argument", "The translation didn't come back right. Try again.");
  const translations = translationsFor(source.blocks, done);
  const counts = { translated: done.size, untranslated: segments.length - done.size };
  if (args.output === "note") {
    const title = `${source.title} (${language})`;
    const id = await ctx.mutate(async (m) => {
      const doc = await m.db.get("documents", args.documentId);
      if (!doc) fail("not_found", "Document not found.");
      const blocks = applyTranslations((await liveBlocks(m.db, doc.id)).map(toWireBlock), translations);
      const copy = await insertDocument(m, { title, icon: doc.icon, folderId: doc.folderId, parentDocumentId: doc.parentDocumentId, style: doc.style, cover: doc.cover, blocks: cloneBlocks(blocks) });
      await copyCollectionsInto(m, copy.id);
      return copy.id;
    });
    return { id, title, ...counts };
  }
  const preview = blocksToMarkdown(applyTranslations(source.blocks, translations)).slice(0, PREVIEW_CHARS);
  return { translations, preview, ...counts };
});

// ---- aiMemory ----------------------------------------------------------------------------------------------

function wireMemory(e: LocalMemoryEntry) {
  return { id: e.id as Id<"aiMemories">, kind: e.kind, text: e.text, source: e.source, workspace: null, updatedAt: e.updatedAt };
}

async function addEntry(ctx: LocalMutationCtx, kind: MemoryKind, raw: string, source: "settings" | "chat"): Promise<string> {
  const text = cleanMemoryText(raw);
  if (text.length < 2) fail("invalid_argument", "Write what to remember first.");
  const existing = await memoryEntries(ctx.db);
  const same = existing.find((e) => memoryKey(e.kind, e.text) === memoryKey(kind, text));
  if (same) return same.id;
  if (existing.length >= MAX_MEMORIES) fail("limit_exceeded", `You can keep ${MAX_MEMORIES} memories here. Delete one first.`);
  const now = ctx.now();
  const id = `mem_${ulid()}`;
  ctx.db.put("meta", MEMORY_KEY, [...existing, { id, kind, text, source, createdAt: now, updatedAt: now }]);
  return id;
}

defineLocal(api.aiMemory.list, "query", async (ctx) => {
  const p = await requireProfile(ctx);
  return { on: prefsOf(p).memory && p.aiEnabled !== false, max: MAX_MEMORIES, items: (await memoryEntries(ctx.db)).map(wireMemory) };
});

defineLocal(api.aiMemory.add, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (args.workspaceId) fail("not_found", "Workspace not found.");
  return (await addEntry(ctx, args.kind, args.text, "settings")) as Id<"aiMemories">;
});

defineLocal(api.aiMemory.update, "mutation", async (ctx, args) => {
  const all = await memoryEntries(ctx.db);
  const row = all.find((e) => e.id === args.id);
  if (!row) fail("not_found", "That memory isn't there anymore.");
  const text = args.text === undefined ? row.text : cleanMemoryText(args.text);
  if (text.length < 2) fail("invalid_argument", "Write what to remember first.");
  ctx.db.put(
    "meta",
    MEMORY_KEY,
    all.map((e) => (e.id === row.id ? { ...e, kind: args.kind ?? e.kind, text, updatedAt: ctx.now() } : e)),
  );
  return null;
});

defineLocal(api.aiMemory.remove, "mutation", async (ctx, args) => {
  const all = await memoryEntries(ctx.db);
  if (!all.some((e) => e.id === args.id)) fail("not_found", "That memory isn't there anymore.");
  ctx.db.put(
    "meta",
    MEMORY_KEY,
    all.filter((e) => e.id !== args.id),
  );
  return null;
});

defineLocal(api.aiMemory.clear, "mutation", async (ctx) => {
  const all = await memoryEntries(ctx.db);
  ctx.db.put("meta", MEMORY_KEY, []);
  return all.length;
});

/** One of the library's chat answers that offers a memory. */
async function proposal(ctx: LocalMutationCtx, messageId: string) {
  const c = await conversation(ctx.db, conversationOfMessage(messageId));
  const messages = c ? await messagesOf(ctx.db, c.id) : [];
  const m = messages.find((x) => x.id === messageId);
  if (!c || !m || m.role !== "assistant" || !m.memory) fail("not_found", "That suggestion isn't there anymore.");
  return { c, messages, m, memory: m.memory };
}

defineLocal(api.aiMemory.saveProposal, "mutation", async (ctx, args) => {
  const p = await requireProfile(ctx);
  const { c, messages, m, memory } = await proposal(ctx, args.messageId);
  if (!prefsOf(p).memory) fail("forbidden", "Memory is turned off in Settings > AI.");
  if (memory.status === "saved") return null;
  await addEntry(ctx, memory.kind, memory.text, "chat");
  putMessages(
    ctx.db,
    c.id,
    messages.map((x) => (x.id === m.id ? { ...x, memory: { ...memory, status: "saved" as const } } : x)),
  );
  return null;
});

defineLocal(api.aiMemory.dismissProposal, "mutation", async (ctx, args) => {
  const { c, messages, m, memory } = await proposal(ctx, args.messageId);
  if (memory.status === "proposed")
    putMessages(
      ctx.db,
      c.id,
      messages.map((x) => (x.id === m.id ? { ...x, memory: { ...memory, status: "dismissed" as const } } : x)),
    );
  return null;
});

