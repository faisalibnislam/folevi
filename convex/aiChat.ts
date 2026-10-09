// AI conversations (docs/AI_ASSISTANT.md, "Conversations"): the /ai page and the floating chat.
//
// A conversation belongs to the person who started it (`profileId`), in the scope it was started in
// (their Personal or a workspace), and nobody else can read it. Messages are stored as they're written:
// `send` adds the person's message and an empty answer, then streams the answer into it (throttled
// patches; Stop marks it "stopped" and the stream ends at its next write). The answer comes from the same
// pipeline as Ask AI (ai.answerFromNotes): only notes the person can read, cited as [n], with the block a
// citation matched when one did. Credits are held and settled like every AI request (ai.begin, metered),
// and what an answer cost is stored on it. The first exchange names the conversation (the fast model).
//
// History off (Settings > AI): a conversation is `ephemeral`, deleted when its chat closes (`discard`)
// and swept after a day. Account and workspace deletion remove conversations (maintenance.ts).
//
// Privacy: prompts, note text and answers are never logged; only events, codes and counts are.
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { blockSearchText, ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, requireDocument, requireIdentity, requireProfile, requireRowScope, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { inScope, insertScoped, scopeOfRow, vScopeArg, type ScopeArg } from "./lib/scope";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { ReaderLabels } from "./lib/linkLabels";
import { aiPrefsOf } from "./lib/ai/prefs";
import { capabilities as modelCapabilities, provider } from "./lib/ai/provider";
import { vAiAction } from "./lib/aiActions";
import { wireRun } from "./lib/ai/tools/wire";
import { NEW_CHAT_TITLE, bestBlock, citingSentences, passageBlock, cleanTitle, conversationMarkdown, normalizeContext, titleFromQuestion, vAiContext, type AiContext } from "./lib/ai/chat";
import { answerFromNotes, answerPlan, gemini, hideFollowUps, metered, type AnswerSink, type Settled } from "./ai";
import { attachmentChips, claimAttachments, deleteConversationFiles, sweepUnsentAttachments, type AttachmentChip } from "./lib/ai/attachmentFiles";
import { answerWithFiles, filesPlan, type FileForModel } from "./aiAttachments";
import { domainOf, entryPointsToShow, extractUrls, resolveLink } from "./lib/ai/web";

type Ctx = QueryCtx | MutationCtx;

/** The longest message a person can send. */
export const MAX_MESSAGE = 4_000;
/** Messages a conversation can hold (then: start a new one). */
const MAX_MESSAGES = 400;
/** Messages a conversation shows (the latest). */
const SHOWN_MESSAGES = 200;
/** An answer still "streaming" after this long was cut off (a crashed request). */
const STALE_MS = 10 * 60_000;
/** History off: conversations left behind (a closed tab) are deleted after a day. */
const EPHEMERAL_TTL_MS = 24 * 60 * 60_000;
const SEARCH_TEXT_MAX = 20_000;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const GONE = "That conversation isn't there anymore.";

const vOutcome = v.union(
  v.object({ kind: v.literal("dismissed") }),
  v.object({ kind: v.literal("applied"), folders: v.array(v.object({ id: v.string(), name: v.string() })), notes: v.array(v.object({ id: v.string(), title: v.string() })), moved: v.number() }),
);
const vCitation = v.object({ n: v.number(), noteId: v.string(), title: v.string(), blockId: v.optional(v.string()), quote: v.optional(v.string()) });
const vWebCitation = v.object({ n: v.number(), url: v.string(), title: v.string(), domain: v.string() });
const vError = v.object({ code: v.string(), message: v.string(), action: v.optional(v.string()), reason: v.optional(v.string()) });

// ---------------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------------

const byPublicId = (ctx: Ctx, publicId: string) =>
  ctx.db
    .query("aiConversations")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();

/** The caller's own conversation, in a place they can still open (null otherwise: never someone else's). */
async function ownConversation(ctx: Ctx, profile: Doc<"profiles">, publicId: string): Promise<Doc<"aiConversations"> | null> {
  const c = await byPublicId(ctx, publicId);
  if (!c || c.profileId !== profile._id) return null;
  try {
    await requireRowScope(ctx, profile, c);
  } catch {
    return null;
  }
  return c;
}

async function requireConversation(ctx: Ctx, profile: Doc<"profiles">, publicId: string): Promise<Doc<"aiConversations">> {
  const c = await ownConversation(ctx, profile, publicId);
  if (!c) fail("not_found", GONE);
  return c;
}

/** One of the caller's own messages (in a conversation they can still open). */
async function requireMessage(ctx: Ctx, profile: Doc<"profiles">, messageId: Id<"aiMessages">): Promise<{ message: Doc<"aiMessages">; conversation: Doc<"aiConversations"> }> {
  const message = await ctx.db.get(messageId);
  const conversation = message && message.profileId === profile._id ? await ctx.db.get(message.conversationId) : null;
  if (!message || !conversation || !(await ownConversation(ctx, profile, conversation.publicId))) fail("not_found", GONE);
  return { message, conversation };
}

/** The conversation's scope, as clients and the AI pipeline name it. */
async function scopeArgOf(ctx: Ctx, c: Doc<"aiConversations">): Promise<ScopeArg> {
  const scope = scopeOfRow(c);
  if (scope.kind === "personal") return { kind: "personal" };
  const ws = await ctx.db.get(scope.workspaceId);
  if (!ws) fail("not_found", GONE);
  return { kind: "workspace", workspaceId: ws.publicId };
}

/** Checks the person can use a context where the conversation lives: notes they can read, a folder there. */
async function checkContext(ctx: Ctx, profile: Doc<"profiles">, c: Pick<Doc<"aiConversations">, "workspaceId" | "ownerProfileId">, context: AiContext): Promise<AiContext> {
  const clean = normalizeContext(context);
  if (clean.kind === "note" || clean.kind === "notes") {
    for (const id of clean.ids) await requireDocument(ctx, profile, id, "read");
  } else if (clean.kind === "folder") {
    const folder = await ctx.db
      .query("folders")
      .withIndex("by_public_id", (q) => q.eq("publicId", clean.ids[0]!))
      .unique();
    if (!folder || folder.deletedAt || !inScope(folder, scopeOfRow(c))) fail("not_found", "Folder not found.");
  }
  return clean;
}

/** Names for a context's notes or folder (only ones the person can still open). */
async function contextItems(ctx: Ctx, profile: Doc<"profiles">, c: Doc<"aiConversations">): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  if (c.context.kind === "note" || c.context.kind === "notes") {
    for (const id of c.context.ids) {
      const doc = await getDocumentByPublicId(ctx, id);
      if (doc && !doc.inTrash && accessAtLeast(await documentAccess(ctx, profile, doc), "read")) out.push({ id, name: doc.title || "Untitled" });
    }
  } else if (c.context.kind === "folder") {
    const folder = await ctx.db
      .query("folders")
      .withIndex("by_public_id", (q) => q.eq("publicId", c.context.ids[0]!))
      .unique();
    if (folder && !folder.deletedAt && inScope(folder, scopeOfRow(c))) out.push({ id: folder.publicId, name: folder.name });
  }
  return out;
}

const appendSearch = (c: Doc<"aiConversations">, text: string) => `${c.searchText}\n${text}`.slice(0, SEARCH_TEXT_MAX);

function listRow(c: Doc<"aiConversations">) {
  return { id: c.publicId, title: c.title, pinned: c.pinned, context: c.context.kind, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt };
}

function wireMessage(m: Doc<"aiMessages">, now: number, runs: Map<Id<"aiRuns">, Doc<"aiRuns">> = new Map(), files: Map<Id<"files">, AttachmentChip> = new Map()) {
  const stale = m.status === "streaming" && now - m.updatedAt > STALE_MS;
  const run = m.agent?.runId ? runs.get(m.agent.runId) : undefined;
  return {
    id: m._id,
    role: m.role,
    text: m.text,
    citations: m.citations ?? [],
    /** Web pages cited (web research), numbered after the notes. */
    webCitations: m.webCitations ?? [],
    /** Google's Search Suggestions for a grounded answer (HTML to show in a sandboxed frame only). */
    searchEntryPoints: m.searchEntryPoints ?? [],
    actions: m.actions ?? null,
    actionsOutcome: m.actionsOutcome ?? null,
    suggestions: m.suggestions ?? [],
    status: stale ? ("error" as const) : m.status,
    phase: stale ? null : (m.phase ?? null),
    error: stale ? { code: "interrupted", message: "This answer was cut off. Try again." } : (m.error ?? null),
    credits: m.usage?.credits ?? null,
    /** Files sent with the message (the ones the person can still open). */
    attachments: (m.attachments ?? []).flatMap((id) => files.get(id) ?? []),
    /** An agent's answer: the steps it took, and the changes it proposed (aiAgent.ts). */
    agent: m.agent ? { steps: m.agent.steps, run: run ? wireRun(run) : null } : null,
    createdAt: m.createdAt,
  };
}

/** The agent runs of some messages, by id (one read each). */
async function runsOf(ctx: Ctx, messages: Doc<"aiMessages">[]): Promise<Map<Id<"aiRuns">, Doc<"aiRuns">>> {
  const out = new Map<Id<"aiRuns">, Doc<"aiRuns">>();
  for (const m of messages) {
    const id = m.agent?.runId;
    if (!id) continue;
    const run = await ctx.db.get(id);
    if (run) out.set(id, run);
  }
  return out;
}

/** An agent run that changed notes and wasn't undone: its message must stay (it holds the Undo). */
const applied = (run: Doc<"aiRuns"> | null) => Boolean(run && (run.status === "done" || run.status === "partial" || run.status === "executing" || run.status === "undoing"));

async function createConversation(ctx: MutationCtx, profile: Doc<"profiles">, scopeArg: ScopeArg, publicId: string | undefined, context: AiContext | undefined): Promise<Doc<"aiConversations">> {
  if (profile.aiEnabled === false) fail("forbidden", "The AI Assistant is turned off in your settings.");
  const { scope } = await resolveScope(ctx, profile, scopeArg);
  const id = publicId ?? ulid();
  if (!ULID.test(id)) fail("invalid_argument", "That conversation id isn't valid.");
  if (await byPublicId(ctx, id)) fail("not_found", GONE);
  const fields = scope.kind === "personal" ? { ownerProfileId: scope.profileId } : { workspaceId: scope.workspaceId };
  const clean = await checkContext(ctx, profile, fields, context ?? normalizeContext(undefined));
  const now = Date.now();
  const rowId = await insertScoped(ctx, "aiConversations", scope, {
    publicId: id,
    profileId: profile._id,
    title: NEW_CHAT_TITLE,
    pinned: false,
    context: clean,
    model: provider().models().main,
    sharedWith: "none",
    // History off: this conversation lasts only while its chat is open.
    ...(aiPrefsOf(profile).history ? {} : { ephemeral: true }),
    searchText: "",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });
  return (await ctx.db.get(rowId))!;
}

/** Deletes a conversation and its messages (a long one's remaining messages go in the background). */
async function deleteConversation(ctx: MutationCtx, c: Doc<"aiConversations">): Promise<void> {
  const runs = await ctx.db
    .query("aiRuns")
    .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
    .take(200);
  for (const r of runs) await ctx.db.delete(r._id);
  // Its research jobs (a running one notices at its next step, stops and settles its credits).
  const research = await ctx.db
    .query("aiResearch")
    .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
    .take(200);
  for (const r of research) await ctx.db.delete(r._id);
  const messages = await ctx.db
    .query("aiMessages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
    .take(401);
  for (const m of messages.slice(0, 400)) await ctx.db.delete(m._id);
  if (messages.length > 400) await ctx.scheduler.runAfter(0, internal.aiChat.purgeMessages, { conversationId: c._id });
  // Files uploaded into it (a note's files stay with the note); many go in the background.
  if ((await deleteConversationFiles(ctx, c._id)) === 50) await ctx.scheduler.runAfter(0, internal.aiChat.purgeFiles, { conversationId: c._id });
  await ctx.db.delete(c._id);
}

// ---------------------------------------------------------------------------------------------------
// The conversation list and one conversation
// ---------------------------------------------------------------------------------------------------

/** What the model can do (the client offers only that), and the person's AI settings. */
export const capabilities = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const c = modelCapabilities();
    return {
      model: c.model,
      vision: c.vision,
      audioIn: c.audioIn,
      tools: c.tools,
      json: c.json,
      longContext: c.longContext,
      searchGrounding: c.searchGrounding,
      contextWindow: c.contextWindow,
      prefs: aiPrefsOf(profile),
    };
  },
});

/** Pinned conversations in a place (Personal or a workspace), latest first. */
export const pinned = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const workspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
    const rows = await ctx.db
      .query("aiConversations")
      .withIndex("by_profile_place", (q) => q.eq("profileId", profile._id).eq("workspaceId", workspaceId).eq("pinned", true))
      .order("desc")
      .take(50);
    return rows.filter((c) => !c.ephemeral).map(listRow);
  },
});

/**
 * The person's conversations in a place, latest first: the unpinned ones page by page, or, with `search`,
 * every match in the titles and messages (pinned ones first, one page).
 */
export const list = query({
  args: { scope: vScopeArg, search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const workspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
    const term = (args.search ?? "").trim().slice(0, 100);
    if (term) {
      const found = await ctx.db
        .query("aiConversations")
        .withSearchIndex("search", (s) => s.search("searchText", term).eq("profileId", profile._id).eq("workspaceId", workspaceId))
        .take(40);
      const rows = found.filter((c) => !c.ephemeral && c.profileId === profile._id && c.workspaceId === workspaceId);
      rows.sort((a, b) => Number(b.pinned) - Number(a.pinned));
      return { page: rows.map(listRow), isDone: true, continueCursor: "" };
    }
    const result = await ctx.db
      .query("aiConversations")
      .withIndex("by_profile_place", (q) => q.eq("profileId", profile._id).eq("workspaceId", workspaceId).eq("pinned", false))
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.filter((c) => !c.ephemeral).map(listRow) };
  },
});

/** One of the person's conversations with its latest messages, or null (gone, or not theirs). */
export const get = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const c = await ownConversation(ctx, profile, args.conversationId);
    if (!c) return null;
    const rows = await ctx.db
      .query("aiMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
      .order("desc")
      .take(SHOWN_MESSAGES);
    const runs = await runsOf(ctx, rows);
    const files = await attachmentChips(ctx, profile, c, rows);
    const now = Date.now();
    return {
      conversation: {
        id: c.publicId,
        title: c.title,
        pinned: c.pinned,
        ephemeral: c.ephemeral === true,
        scope: await scopeArgOf(ctx, c),
        context: { kind: c.context.kind, items: await contextItems(ctx, profile, c) },
        createdAt: c.createdAt,
        lastMessageAt: c.lastMessageAt,
      },
      messages: rows.reverse().map((m) => wireMessage(m, now, runs, files)),
    };
  },
});

/** A conversation as Markdown, to download. */
export const exportMarkdown = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const c = await requireConversation(ctx, profile, args.conversationId);
    const messages = await ctx.db
      .query("aiMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
      .take(MAX_MESSAGES);
    const name = c.title.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Conversation";
    return { filename: `${name}.md`, markdown: conversationMarkdown(c.title, messages, Date.now()) };
  },
});

// ---------------------------------------------------------------------------------------------------
// Changing conversations
// ---------------------------------------------------------------------------------------------------

/** Starts an empty conversation (the client may pick its id, a ULID). Returns its id. */
export const create = mutation({
  args: { scope: vScopeArg, conversationId: v.optional(v.string()), context: v.optional(vAiContext) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    return (await createConversation(ctx, profile, args.scope, args.conversationId, args.context)).publicId;
  },
});

export const rename = mutation({
  args: { conversationId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const c = await requireConversation(ctx, profile, args.conversationId);
    const title = args.title.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!title) fail("invalid_argument", "Give the conversation a name.");
    await ctx.db.patch(c._id, { title, titled: true, searchText: appendSearch(c, title), updatedAt: Date.now() });
    return null;
  },
});

export const setPinned = mutation({
  args: { conversationId: v.string(), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const c = await requireConversation(ctx, profile, args.conversationId);
    await ctx.db.patch(c._id, { pinned: args.pinned });
    return null;
  },
});

/** What the conversation is about (notes, a folder, or everything here) for the next questions. */
export const setContext = mutation({
  args: { conversationId: v.string(), context: vAiContext },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const c = await requireConversation(ctx, profile, args.conversationId);
    await ctx.db.patch(c._id, { context: await checkContext(ctx, profile, c, args.context), updatedAt: Date.now() });
    return null;
  },
});

/** Deletes a conversation for good. */
export const remove = mutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const c = await ownConversation(ctx, profile, args.conversationId);
    if (c) await deleteConversation(ctx, c);
    return null;
  },
});

/** The chat closed: with history off, its conversation goes now (kept conversations are untouched). */
export const discard = mutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const c = await ownConversation(ctx, profile, args.conversationId);
    if (c?.ephemeral) await deleteConversation(ctx, c);
    return null;
  },
});

/** Stop: the answer being written stops at its next write (what it had is kept). */
export const stop = mutation({
  args: { messageId: v.id("aiMessages") },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { message } = await requireMessage(ctx, profile, args.messageId);
    if (message.status === "streaming") await ctx.db.patch(message._id, { status: "stopped", phase: undefined, updatedAt: Date.now() });
    return null;
  },
});

/** Records what became of an answer's proposed changes (applied through aiActions.apply, or not now). */
export const setActionsOutcome = mutation({
  args: { messageId: v.id("aiMessages"), outcome: vOutcome },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { message } = await requireMessage(ctx, profile, args.messageId);
    if (!message.actions?.length) fail("invalid_argument", "There were no changes to apply.");
    await ctx.db.patch(message._id, { actionsOutcome: args.outcome });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------------------------------

/**
 * Adds a turn: the person's message (send), a fresh answer to the last one (regenerate), or an edited
 * message with everything after it dropped (edit). Creates the empty answer the AI then writes into.
 */
export const post = internalMutation({
  args: {
    mode: v.union(v.literal("send"), v.literal("regenerate"), v.literal("edit")),
    conversationId: v.string(),
    scope: v.optional(vScopeArg),
    text: v.optional(v.string()),
    messageId: v.optional(v.id("aiMessages")),
    context: v.optional(vAiContext),
    /** The answer comes from the agent (aiAgent.ts): it records its steps and proposed changes. */
    agent: v.optional(v.boolean()),
    /** Files sent with the message (public ids): a note's files, or ones uploaded into the chat. */
    attachments: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ messageId: Id<"aiMessages"> }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (profile.aiEnabled === false) fail("forbidden", "The AI Assistant is turned off in your settings.");
    const text = (args.text ?? "").trim();
    if (args.mode !== "regenerate") {
      if (!text) fail("invalid_argument", "Ask a question first.");
      if (text.length > MAX_MESSAGE) fail("invalid_argument", `That message is too long (at most ${MAX_MESSAGE.toLocaleString("en-US")} characters).`);
    }
    let c = await ownConversation(ctx, profile, args.conversationId);
    if (!c) {
      // A new conversation (the client picked its id); anything else is gone.
      if (args.mode !== "send" || !args.scope) fail("not_found", GONE);
      c = await createConversation(ctx, profile, args.scope, args.conversationId, args.context);
    } else if (args.context) {
      await ctx.db.patch(c._id, { context: await checkContext(ctx, profile, c, args.context) });
    }
    const messages = await ctx.db
      .query("aiMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
      .take(MAX_MESSAGES + 1);
    const now = Date.now();
    if (messages.some((m) => m.status === "streaming" && now - m.updatedAt < STALE_MS)) fail("invalid_argument", "Wait for the answer to finish, or stop it first.");
    // Answers about to be dropped (regenerate, edit) take their agent runs with them, but never one whose
    // changes were applied: its Undo lives there.
    const dropped = args.mode === "regenerate" ? messages.slice(-1) : args.mode === "edit" ? messages.slice(messages.findIndex((m) => m._id === args.messageId) + 1) : [];
    for (const m of dropped) {
      const run = m.agent?.runId ? await ctx.db.get(m.agent.runId) : null;
      if (applied(run)) fail("invalid_argument", "Those changes were applied. Undo them first, or start a new conversation.");
      if (run) await ctx.db.delete(run._id);
      const research = await ctx.db
        .query("aiResearch")
        .withIndex("by_message", (q) => q.eq("messageId", m._id))
        .first();
      if (research) await ctx.db.delete(research._id);
    }
    if (args.mode === "send") {
      if (messages.length >= MAX_MESSAGES) fail("limit_exceeded", "This conversation is full. Start a new one.");
      // Each file is checked (access, kind, size, Settings > AI) before anything is sent (lib/ai/attachmentFiles.ts).
      const attachments = await claimAttachments(ctx, profile, c, args.attachments ?? []);
      await insertScoped(ctx, "aiMessages", scopeOfRow(c), { conversationId: c._id, profileId: profile._id, role: "user", text, ...(attachments.length ? { attachments } : {}), status: "done", createdAt: now, updatedAt: now });
    } else if (args.mode === "regenerate") {
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant" || !messages.some((m) => m.role === "user")) fail("invalid_argument", "There's no answer to write again.");
      await ctx.db.delete(last._id);
    } else {
      const at = messages.findIndex((m) => m._id === args.messageId);
      const edited = messages[at];
      if (!edited || edited.role !== "user") fail("not_found", "That message isn't there anymore.");
      await ctx.db.patch(edited._id, { text, updatedAt: now });
      for (const m of messages.slice(at + 1)) await ctx.db.delete(m._id);
    }
    const messageId = await insertScoped(ctx, "aiMessages", scopeOfRow(c), { conversationId: c._id, profileId: profile._id, role: "assistant", text: "", status: "streaming", phase: "thinking", ...(args.agent ? { agent: { steps: [] } } : {}), createdAt: now, updatedAt: now });
    await ctx.db.patch(c._id, { updatedAt: now, lastMessageAt: now, ...(text ? { searchText: appendSearch(c, text) } : {}) });
    return { messageId };
  },
});

/** What an answer needs: the question it answers, the conversation before it, and what it's about. */
export const turn = internalQuery({
  args: { messageId: v.id("aiMessages") },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { message, conversation: c } = await requireMessage(ctx, profile, args.messageId);
    if (message.role !== "assistant") fail("not_found", GONE);
    const messages = await ctx.db
      .query("aiMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
      .take(MAX_MESSAGES + 1);
    const before = messages.slice(0, messages.findIndex((m) => m._id === message._id));
    const asked = before.map((m) => m.role).lastIndexOf("user");
    if (asked < 0) fail("invalid_argument", "Ask a question first.");
    const history = before
      .slice(0, asked)
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.status !== "error" && m.text.trim())
      .slice(-6)
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.text.slice(0, 3000) }));
    return {
      conversationId: c._id,
      scope: await scopeArgOf(ctx, c),
      context: c.context,
      question: before[asked]!.text,
      history,
      titled: c.titled === true,
      ephemeral: c.ephemeral === true,
    };
  },
});

/** Writes the answer so far, or what the assistant is doing. Returns false once the person pressed Stop. */
export const writeMessage = internalMutation({
  args: { messageId: v.id("aiMessages"), text: v.optional(v.string()), phase: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.messageId);
    if (!m || m.status !== "streaming") return false;
    await ctx.db.patch(m._id, { ...(args.text !== undefined ? { text: args.text.slice(0, 60_000) } : {}), ...(args.phase ? { phase: args.phase.slice(0, 20) } : {}), updatedAt: Date.now() });
    return true;
  },
});

/** Settles an answer: its text, sources, proposed changes, follow-ups and cost, or what went wrong. */
export const finishMessage = internalMutation({
  args: {
    messageId: v.id("aiMessages"),
    status: v.union(v.literal("done"), v.literal("error")),
    text: v.optional(v.string()),
    citations: v.optional(v.array(vCitation)),
    webCitations: v.optional(v.array(vWebCitation)),
    searchEntryPoints: v.optional(v.array(v.string())),
    actions: v.optional(v.array(vAiAction)),
    suggestions: v.optional(v.array(v.string())),
    error: v.optional(vError),
    usage: v.optional(v.object({ credits: v.number(), tokensIn: v.number(), tokensOut: v.number() })),
  },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.messageId);
    if (!m) return null;
    // Stopped stays stopped (with what was written); an error after Stop is just a stop.
    const stopped = m.status === "stopped";
    const now = Date.now();
    await ctx.db.patch(m._id, {
      status: stopped ? "stopped" : args.status,
      phase: undefined,
      ...(args.text !== undefined ? { text: args.text.slice(0, 60_000) } : {}),
      ...(args.citations?.length ? { citations: args.citations } : {}),
      ...(args.webCitations?.length ? { webCitations: args.webCitations } : {}),
      // Capped again here: whole chips only, 32 KB together.
      ...(args.searchEntryPoints?.length ? { searchEntryPoints: entryPointsToShow(args.searchEntryPoints) } : {}),
      ...(args.actions?.length ? { actions: args.actions } : {}),
      ...(args.suggestions?.length && !stopped ? { suggestions: args.suggestions } : {}),
      ...(args.error && !stopped ? { error: args.error } : {}),
      ...(args.usage ? { usage: args.usage } : {}),
      updatedAt: now,
    });
    const c = await ctx.db.get(m.conversationId);
    if (c && args.text) await ctx.db.patch(c._id, { searchText: appendSearch(c, args.text), updatedAt: now });
    return null;
  },
});

/** Names a conversation from its first exchange (unless the person already named it). */
export const setTitle = internalMutation({
  args: { conversationId: v.id("aiConversations"), title: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.conversationId);
    if (!c || c.titled) return null;
    const title = args.title.slice(0, 80) || NEW_CHAT_TITLE;
    await ctx.db.patch(c._id, { title, titled: true, searchText: `${title}\n${c.searchText}`.slice(0, SEARCH_TEXT_MAX) });
    return null;
  },
});

/** For each cited note the person can read: the block that best matches what the answer said about it. */
export const locate = internalQuery({
  args: { items: v.array(v.object({ noteId: v.string(), said: v.string(), blockIds: v.optional(v.array(v.string())) })) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const out: { noteId: string; blockId: string; quote: string }[] = [];
    for (const item of args.items.slice(0, 12)) {
      const doc = await getDocumentByPublicId(ctx, item.noteId);
      if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) continue;
      // Link labels as this person may see them: a quote never shows a title they can't.
      const blocks = await new ReaderLabels(ctx, profile).blocks((await liveBlocks(ctx, doc._id)).map(toWireBlock));
      const texts = blocks.map((b) => ({ id: b.id, text: blockSearchText(b) }));
      // Passages from semantic search: the block is one of theirs; otherwise the closest match in the note.
      const hit = item.blockIds?.length ? passageBlock(texts, item.blockIds, item.said) : bestBlock(texts, item.said);
      if (hit) out.push({ noteId: item.noteId, ...hit });
    }
    return out;
  },
});

/** A request's error, as stored on the answer: the person-readable message and what helps. */
export function storedError(e: unknown): { code: string; message: string; action?: string; reason?: string } {
  const data = (e as { data?: unknown })?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.code === "string" && typeof d.message === "string") {
      return { code: d.code, message: d.message.slice(0, 500), ...(typeof d.action === "string" ? { action: d.action } : {}), ...(typeof d.reason === "string" ? { reason: d.reason } : {}) };
    }
  }
  return { code: "internal", message: "Something went wrong. Try again." };
}

/** Web research for one answer is refused: Settings > AI turned it off, or the model can't search. */
const WEB_OFF = "Web research is turned off in Settings > AI.";
const WEB_UNSUPPORTED = "The AI model in use can't search the web.";

/**
 * Writes an answer into its message: the AI pipeline, credits, citations, follow-ups and the title. With
 * `web` (the Web toggle) it also searches the web; pages linked in the question are read when web
 * research is allowed. Notes and pages are cited with one numbering.
 */
async function respond(ctx: ActionCtx, messageId: Id<"aiMessages">, web = false): Promise<{ status: "done" | "error" }> {
  const turn = await ctx.runQuery(internal.aiChat.turn, { messageId });
  // Files sent with the question (and earlier ones), checked again as the person (aiAttachments.ts). A
  // message with files is answered from them and the conversation's notes.
  let files: { files: FileForModel[]; noteIds: string[] };
  try {
    files = await ctx.runQuery(internal.aiAttachments.forTurn, { messageId });
  } catch (e) {
    const error = storedError(e);
    console.warn(JSON.stringify({ event: "ai.chat_refused", code: error.code }));
    await ctx.runMutation(internal.aiChat.finishMessage, { messageId, status: "error", error });
    return { status: "error" };
  }
  const withFiles = files.files.length > 0;
  // Web research must be allowed by the person's settings (checked here, on the server) and the model.
  const prefs = await ctx.runQuery(internal.aiAgent.prefs, {});
  const refusal = web && !prefs.webResearch ? WEB_OFF : web && !modelCapabilities().searchGrounding ? WEB_UNSUPPORTED : null;
  if (refusal) {
    await ctx.runMutation(internal.aiChat.finishMessage, { messageId, status: "error", error: { code: "forbidden", message: refusal } });
    return { status: "error" };
  }
  const urls = prefs.webResearch ? extractUrls(turn.question) : [];
  const withWeb = web || urls.length > 0;
  const notesOnly = turn.context.kind === "note" || turn.context.kind === "notes";
  const documentIds = notesOnly ? turn.context.ids : [];
  const folderId = turn.context.kind === "folder" ? turn.context.ids[0] : undefined;
  const nameIt = !turn.titled && !turn.ephemeral;
  const historyChars = turn.history.reduce((n, t) => n + t.text.length + 12, 0);
  const plan = [
    ...(withFiles ? filesPlan({ questionChars: turn.question.length, historyChars, notes: documentIds.length, files: files.files }) : answerPlan({ questionChars: turn.question.length, historyChars, focusNotes: documentIds.length, search: !notesOnly, ...(withWeb ? { web: { search: web, pages: urls.length } } : {}) })),
    ...(nameIt ? [{ fast: true, inputChars: 2_400, maxOutputTokens: 40 }] : []),
  ];
  let holdId: Id<"aiCreditHolds">;
  try {
    ({ holdId } = await ctx.runMutation(internal.ai.begin, { scope: turn.scope, documentIds: [...documentIds, ...files.noteIds], noteOnly: notesOnly, plan }));
  } catch (e) {
    const error = storedError(e);
    console.warn(JSON.stringify({ event: "ai.chat_refused", code: error.code }));
    await ctx.runMutation(internal.aiChat.finishMessage, { messageId, status: "error", error });
    return { status: "error" };
  }
  const sink: AnswerSink = {
    write: (text) => ctx.runMutation(internal.aiChat.writeMessage, { messageId, text }),
    finish: async (text) => void (await ctx.runMutation(internal.aiChat.writeMessage, { messageId, text })),
    fail: async () => {},
    phase: async (phase) => void (await ctx.runMutation(internal.aiChat.writeMessage, { messageId, phase })),
    shown: hideFollowUps,
  };
  let cost: Settled | undefined;
  try {
    const out = await metered(
      ctx,
      holdId,
      async (meter) => {
        const out = withFiles
          ? await answerWithFiles(ctx, { question: turn.question, history: turn.history, documentIds, files: files.files, sink }, meter)
          : await answerFromNotes(ctx, { scope: turn.scope, question: turn.question, history: turn.history, documentIds, notesOnly, folderId, sink, chat: true, ...(withWeb ? { web: { search: web, urls } } : {}) }, meter);
        if (nameIt && out.answer) {
          let title = "";
          try {
            title = cleanTitle(
              await gemini({
                fast: true,
                temperature: 0.3,
                maxOutputTokens: 40,
                system: "You name conversations in a notes app.",
                prompt: `Question: ${turn.question.slice(0, 1000)}\n\nAnswer: ${out.answer.slice(0, 1200)}\n\nWrite a short title for this conversation: 2 to 6 words, in the question's language, no quotes. Reply with the title only.`,
              }, meter),
            );
          } catch {
            /* the question's first words will do */
          }
          await ctx.runMutation(internal.aiChat.setTitle, { conversationId: turn.conversationId, title: title || titleFromQuestion(turn.question) });
        }
        return out;
      },
      async (c) => {
        cost = c;
      },
    );
    const cited = out.notes.map((n, i) => ({ n: i + 1, noteId: n.id, title: n.title })).filter((c) => out.cited.has(c.n - 1));
    const passages = new Map(out.notes.map((n) => [n.id, n.blockIds]));
    const found = cited.length ? await ctx.runQuery(internal.aiChat.locate, { items: cited.map((c) => ({ noteId: c.noteId, said: citingSentences(out.answer, c.n), blockIds: passages.get(c.noteId) })) }) : [];
    const citations = cited.map((c) => {
      const hit = found.find((f) => f.noteId === c.noteId);
      return hit ? { ...c, blockId: hit.blockId, quote: hit.quote } : c;
    });
    // Web pages cited, numbered after the notes; a search result's Google link becomes the page's own.
    const webCitations = await Promise.all(
      (out.web ?? [])
        .map((w, i) => ({ ...w, n: out.notes.length + i + 1 }))
        .filter((w) => out.cited.has(w.n - 1))
        .map(async (w) => {
          const url = w.kind === "search" ? await resolveLink(w.url) : w.url;
          return { n: w.n, url, title: w.title.slice(0, 200), domain: (url === w.url ? w.domain : domainOf(url)) || w.domain };
        }),
    );
    await ctx.runMutation(internal.aiChat.finishMessage, { messageId, status: "done", text: out.answer, citations, webCitations, ...("searchEntryPoint" in out && out.searchEntryPoint ? { searchEntryPoints: [out.searchEntryPoint] } : {}), actions: out.actions, suggestions: out.suggestions, usage: cost });
    return { status: "done" };
  } catch (e) {
    const error = storedError(e);
    console.warn(JSON.stringify({ event: "ai.chat_error", code: error.code }));
    await ctx.runMutation(internal.aiChat.finishMessage, { messageId, status: "error", error, usage: cost });
    return { status: "error" };
  }
}

/**
 * Sends a message and writes the answer. A new conversation is created with the id the client picked (a
 * ULID), so it can show the conversation while the answer streams. Refusals (out of credits, AI not
 * included) are stored on the answer, not thrown.
 */
export const send = action({
  args: { scope: vScopeArg, conversationId: v.string(), text: v.string(), context: v.optional(vAiContext), web: v.optional(v.boolean()), attachments: v.optional(v.array(v.string())) },
  handler: async (ctx, args): Promise<{ messageId: Id<"aiMessages">; status: "done" | "error" }> => {
    await requireIdentity(ctx);
    const { messageId } = await ctx.runMutation(internal.aiChat.post, { mode: "send", scope: args.scope, conversationId: args.conversationId, text: args.text, context: args.context, attachments: args.attachments });
    return { messageId, ...(await respond(ctx, messageId, args.web === true)) };
  },
});

/** Writes the last answer again. */
export const regenerate = action({
  args: { conversationId: v.string(), web: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ messageId: Id<"aiMessages">; status: "done" | "error" }> => {
    await requireIdentity(ctx);
    const { messageId } = await ctx.runMutation(internal.aiChat.post, { mode: "regenerate", conversationId: args.conversationId });
    return { messageId, ...(await respond(ctx, messageId, args.web === true)) };
  },
});

/** Changes one of the person's messages, drops everything after it, and answers again. */
export const edit = action({
  args: { conversationId: v.string(), messageId: v.id("aiMessages"), text: v.string(), web: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ messageId: Id<"aiMessages">; status: "done" | "error" }> => {
    await requireIdentity(ctx);
    const { messageId } = await ctx.runMutation(internal.aiChat.post, { mode: "edit", conversationId: args.conversationId, messageId: args.messageId, text: args.text });
    return { messageId, ...(await respond(ctx, messageId, args.web === true)) };
  },
});

// ---------------------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------------------

/** The rest of a long conversation's messages, after the conversation was deleted. */
export const purgeMessages = internalMutation({
  args: { conversationId: v.id("aiConversations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("aiMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .take(400);
    for (const m of rows) await ctx.db.delete(m._id);
    if (rows.length === 400) await ctx.scheduler.runAfter(0, internal.aiChat.purgeMessages, { conversationId: args.conversationId });
    return null;
  },
});

/** The rest of a deleted conversation's uploaded files (lib/ai/attachmentFiles.ts). */
export const purgeFiles = internalMutation({
  args: { conversationId: v.id("aiConversations") },
  handler: async (ctx, args) => {
    if ((await deleteConversationFiles(ctx, args.conversationId)) === 50) await ctx.scheduler.runAfter(0, internal.aiChat.purgeFiles, { conversationId: args.conversationId });
    return null;
  },
});

/**
 * Hourly: history-off conversations left behind for a day, answers cut off mid-way (a crash), and files
 * uploaded into a chat but never sent.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const old = await ctx.db
      .query("aiConversations")
      .withIndex("by_ephemeral_updated", (q) => q.eq("ephemeral", true).lt("updatedAt", now - EPHEMERAL_TTL_MS))
      .take(50);
    for (const c of old) await deleteConversation(ctx, c);
    const stuck = await ctx.db
      .query("aiMessages")
      .withIndex("by_status_updated", (q) => q.eq("status", "streaming").lt("updatedAt", now - STALE_MS))
      .take(200);
    for (const m of stuck) await ctx.db.patch(m._id, { status: "error", phase: undefined, error: { code: "interrupted", message: "This answer was cut off. Try again." }, updatedAt: now });
    const files = await sweepUnsentAttachments(ctx, now);
    return { conversations: old.length, messages: stuck.length, files };
  },
});
