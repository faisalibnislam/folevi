// aiChat.* in local mode (convex/aiChat.ts): conversations kept on this device (chatStore.ts), answered by the
// model active here through the same pipeline as Ask AI (answer.ts), with citations pointing at the block an
// answer drew on, follow-up questions, offers to remember a preference, and plans of changes where the model
// has room for them. `capabilities` says what the active model can do, so the chat offers only that: no web,
// no files, no agent, no research in local mode.
import { blockSearchText, markdownToBlocks, ulid, type InlineNode } from "@folevi/editor-schema";
import { NEW_CHAT_TITLE, bestBlock, citingSentences, cleanTitle, conversationFilename, conversationMarkdown, normalizeContext, titleFromQuestion, type AiContext, type MarkdownMessage } from "@folevi/ai-prompts/chat";
import { chatTitleRequest, hideFollowUps } from "@folevi/ai-prompts/ask";
import { hideRemember } from "@folevi/ai-prompts/memory";
import { MAX_DRAFT_BLOCKS, MAX_DRAFT_CHARS } from "@folevi/ai-prompts/writing";
import type { Id } from "@/lib/convex/api";
import { api } from "@/lib/convex/api";
import { fail } from "../../errors";
import { defineLocal, type LocalActionCtx, type LocalReader, type LocalWriter } from "../../registry";
import { paginate, newestFirst, sortKey } from "../../paginate";
import { checkScope, insertDocument, liveBlocks, ReaderLabels, requireProfile, toWireBlock } from "../../functions/shared";
import { answerFromNotes, type AnswerSink } from "../answer";
import { prefsAll, prefsOf, read, requireAiProfile } from "../common";
import { localAi } from "../provider";
import { localAiState } from "../state";
import { cancelStream, claimStream, createStream, dropStream, readStream, streamKey, writeStream } from "../streams";
import { conversation, conversationOfMessage, conversations, deleteConversation, messagesOf, putConversation, putMessages, type LocalConversation, type LocalMessage } from "../chatStore";

export const MAX_MESSAGE = 4_000;
export const MAX_MESSAGES = 400;
const SHOWN_MESSAGES = 200;
const STALE_MS = 10 * 60_000;
const SEARCH_TEXT_MAX = 20_000;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const GONE = "That conversation isn't there anymore.";
const WEB_UNSUPPORTED = "The AI model in use can't search the web.";
const FILES_UNSUPPORTED = "Foli AI can't read files on this device yet.";

const appendSearch = (c: LocalConversation, text: string) => `${c.searchText}\n${text}`.slice(0, SEARCH_TEXT_MAX);

function listRow(c: LocalConversation) {
  return { id: c.id, title: c.title, pinned: c.pinned, context: c.context.kind, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt, shared: false, workspace: false };
}

function wireMessage(m: LocalMessage, now: number) {
  const stale = m.status === "streaming" && now - m.updatedAt > STALE_MS;
  return {
    id: m.id as Id<"aiMessages">,
    role: m.role,
    text: m.text,
    citations: m.citations ?? [],
    webCitations: [] as { n: number; url: string; title: string; domain: string }[],
    searchEntryPoints: [] as string[],
    actions: m.actions ?? null,
    actionsOutcome: m.actionsOutcome ?? null,
    suggestions: m.suggestions ?? [],
    status: stale ? ("error" as const) : m.status,
    live: Boolean(m.streamId) && m.status === "streaming" && !stale,
    phase: stale ? null : (m.phase ?? null),
    error: stale ? { code: "interrupted", message: "This answer was cut off. Try again." } : (m.error ?? null),
    credits: null,
    attachments: [],
    agent: null,
    memory: m.memory ? { kind: m.memory.kind, text: m.memory.text, status: m.memory.status } : null,
    createdAt: m.createdAt,
  };
}

async function requireConversation(db: LocalReader, id: string): Promise<LocalConversation> {
  const c = await conversation(db, id);
  if (!c) fail("not_found", GONE);
  return c;
}

/** A message and its conversation (the message id carries the conversation's). */
async function requireMessage(db: LocalReader, messageId: string): Promise<{ message: LocalMessage; conversation: LocalConversation; messages: LocalMessage[] }> {
  const c = await conversation(db, conversationOfMessage(messageId));
  const messages = c ? await messagesOf(db, c.id) : [];
  const message = messages.find((m) => m.id === messageId);
  if (!c || !message) fail("not_found", GONE);
  return { message, conversation: c, messages };
}

/** Names for a context's notes or folder (only ones still there). */
async function contextItems(db: LocalReader, c: LocalConversation): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  if (c.context.kind === "note" || c.context.kind === "notes") {
    for (const id of c.context.ids) {
      const d = await db.get("documents", id);
      if (d && !d.inTrash) out.push({ id, name: d.title || "Untitled" });
    }
  } else if (c.context.kind === "folder") {
    const f = await db.get("folders", c.context.ids[0]!);
    if (f && f.deletedAt === null) out.push({ id: f.id, name: f.name });
  }
  return out;
}

/** The context as stored: notes that are there, a folder that's there. */
async function checkContext(db: LocalReader, context: AiContext): Promise<AiContext> {
  const clean = normalizeContext(context);
  if (clean.kind === "note" || clean.kind === "notes") {
    for (const id of clean.ids) if (!(await db.get("documents", id))) fail("not_found", "Document not found.");
  } else if (clean.kind === "folder") {
    const f = await db.get("folders", clean.ids[0]!);
    if (!f || f.deletedAt !== null) fail("not_found", "Folder not found.");
  }
  return clean;
}

async function createConversation(db: LocalWriter, now: number, id: string | undefined, context: AiContext | undefined): Promise<LocalConversation> {
  const p = await requireAiProfile(db);
  const cid = id ?? ulid();
  if (!ULID.test(cid)) fail("invalid_argument", "That conversation id isn't valid.");
  if (await conversation(db, cid)) fail("not_found", GONE);
  const c: LocalConversation = {
    id: cid,
    title: NEW_CHAT_TITLE,
    titled: false,
    pinned: false,
    context: await checkContext(db, context ?? normalizeContext(undefined)),
    model: localAiState().active?.model ?? null,
    ephemeral: !prefsOf(p).history,
    searchText: "",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  };
  await putConversation(db, c);
  putMessages(db, cid, []);
  return c;
}

// ---- the list and one conversation ------------------------------------------------------------------------

defineLocal(api.aiChat.capabilities, "query", async (ctx) => {
  ctx.watch?.("ai:state");
  const profile = await requireProfile(ctx);
  const active = localAiState().active;
  const prefs = prefsAll(profile);
  return {
    model: active ? active.model : "",
    vision: false,
    audioIn: false,
    tools: false,
    json: Boolean(active),
    longContext: Boolean(active && active.provider !== "on-device"),
    searchGrounding: false,
    contextWindow: active ? active.contextTokens : 0,
    prefs,
  };
});

defineLocal(api.aiChat.pinned, "query", async (ctx, args) => {
  checkScope(args.scope);
  return (await conversations(ctx.db))
    .filter((c) => c.pinned && !c.ephemeral)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, 50)
    .map(listRow);
});

defineLocal(api.aiChat.list, "query", async (ctx, args) => {
  checkScope(args.scope);
  const all = (await conversations(ctx.db)).filter((c) => !c.ephemeral);
  const term = (args.search ?? "").trim().slice(0, 100).toLowerCase();
  if (term) {
    const words = term.split(/\s+/).filter(Boolean);
    const rows = all.filter((c) => {
      const hay = `${c.title}\n${c.searchText}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt - a.lastMessageAt);
    return { page: rows.slice(0, 40).map(listRow), isDone: true, continueCursor: "" };
  }
  const page = paginate(
    all.filter((c) => !c.pinned),
    (c) => sortKey(newestFirst(c.lastMessageAt), c.id),
    args.paginationOpts,
  );
  return { ...page, page: page.page.map(listRow) };
});

defineLocal(api.aiChat.get, "query", async (ctx, args) => {
  const c = await conversation(ctx.db, args.conversationId);
  if (!c) return null;
  const rows = (await messagesOf(ctx.db, c.id)).slice(-SHOWN_MESSAGES);
  const now = ctx.now();
  return {
    conversation: {
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      ephemeral: c.ephemeral,
      scope: { kind: "personal" as const },
      context: { kind: c.context.kind, items: await contextItems(ctx.db, c) },
      shared: false,
      canShare: false,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt,
    },
    messages: rows.map((m) => wireMessage(m, now)),
  };
});

function markdownMessages(messages: LocalMessage[]): MarkdownMessage[] {
  return messages.map((m) => ({ role: m.role, text: m.text, citations: m.citations }));
}

function oneAnswer(messages: LocalMessage[], messageId: string): LocalMessage[] {
  const at = messages.findIndex((m) => m.id === messageId);
  const answer = messages[at];
  if (!answer || answer.role !== "assistant") fail("not_found", "That answer isn't there anymore.");
  const asked = messages.slice(0, at).map((m) => m.role).lastIndexOf("user");
  return asked < 0 ? [answer] : [messages[asked]!, answer];
}

defineLocal(api.aiChat.exportMarkdown, "query", async (ctx, args) => {
  const c = await requireConversation(ctx.db, args.conversationId);
  const all = await messagesOf(ctx.db, c.id);
  const messages = args.messageId ? oneAnswer(all, args.messageId) : all;
  return { filename: `${conversationFilename(c.title)}.md`, markdown: conversationMarkdown(args.messageId ? null : c.title, markdownMessages(messages), ctx.now()) };
});

defineLocal(api.aiChat.exportAll, "query", async (ctx, args) => {
  const kept = (await conversations(ctx.db)).filter((c) => !c.ephemeral);
  const page = paginate(kept, (c) => sortKey(newestFirst(c.lastMessageAt), c.id), { ...args.paginationOpts, numItems: Math.min(Math.max(1, args.paginationOpts.numItems), 10) });
  const files: { folder: string; name: string; markdown: string; lastMessageAt: number }[] = [];
  for (const c of page.page) files.push({ folder: "Personal", name: conversationFilename(c.title), markdown: conversationMarkdown(c.title, markdownMessages(await messagesOf(ctx.db, c.id)), ctx.now()), lastMessageAt: c.lastMessageAt });
  return { page: files, isDone: page.isDone, continueCursor: page.continueCursor };
});

defineLocal(api.aiChat.streamText, "query", async (ctx, args) => {
  const c = await conversation(ctx.db, conversationOfMessage(args.messageId));
  const m = c ? (await messagesOf(ctx.db, c.id)).find((x) => x.id === args.messageId) : undefined;
  if (!m?.streamId) return null;
  ctx.watch?.(streamKey(m.streamId));
  const s = readStream(m.streamId);
  return s ? { text: s.text } : null;
});

// ---- changing conversations -------------------------------------------------------------------------------

defineLocal(api.aiChat.create, "mutation", async (ctx, args) => {
  checkScope(args.scope);
  return (await createConversation(ctx.db, ctx.now(), args.conversationId, args.context)).id;
});

defineLocal(api.aiChat.rename, "mutation", async (ctx, args) => {
  const c = await requireConversation(ctx.db, args.conversationId);
  const title = args.title.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) fail("invalid_argument", "Give the conversation a name.");
  await putConversation(ctx.db, { ...c, title, titled: true, searchText: appendSearch(c, title), updatedAt: ctx.now() });
  return null;
});

defineLocal(api.aiChat.setPinned, "mutation", async (ctx, args) => {
  const c = await requireConversation(ctx.db, args.conversationId);
  await putConversation(ctx.db, { ...c, pinned: args.pinned });
  return null;
});

defineLocal(api.aiChat.setContext, "mutation", async (ctx, args) => {
  const c = await requireConversation(ctx.db, args.conversationId);
  await putConversation(ctx.db, { ...c, context: await checkContext(ctx.db, args.context), updatedAt: ctx.now() });
  return null;
});

const noteRef = (i: number) => `FoleviNoteRef${i}x`;
const NOTE_REF = /^FoleviNoteRef(\d+)x$/;

defineLocal(api.aiChat.saveAsNote, "mutation", async (ctx, args) => {
  const c = await requireConversation(ctx.db, args.conversationId);
  const all = await messagesOf(ctx.db, c.id);
  const messages = args.messageId ? oneAnswer(all, args.messageId) : all;
  if (!messages.some((m) => m.role === "assistant" && m.text.trim())) fail("invalid_argument", "There's nothing to save yet.");
  const refs: { noteId: string; n: number; title: string }[] = [];
  const markdown = conversationMarkdown(null, markdownMessages(messages), ctx.now(), (cite) => {
    refs.push({ noteId: cite.noteId ?? "", n: cite.n, title: cite.title });
    return `- ${noteRef(refs.length - 1)}`;
  });
  if (markdown.length > MAX_DRAFT_CHARS) fail("limit_exceeded", "That conversation is too long to save as a note. Save one answer instead.");
  const { blocks } = markdownToBlocks(markdown, { titleFromHeading: false });
  if (blocks.length > MAX_DRAFT_BLOCKS) fail("limit_exceeded", "That conversation has too many blocks to save as a note.");
  for (const b of blocks) {
    const ref = NOTE_REF.exec(b.text.map((n) => (n.type === "text" ? n.text : "")).join(""));
    const cited = ref ? refs[Number(ref[1])] : undefined;
    if (!cited) continue;
    const doc = cited.noteId ? await ctx.db.get("documents", cited.noteId) : undefined;
    const open = doc && !doc.inTrash;
    const text: InlineNode[] = open ? [{ type: "text", text: `[${cited.n}] ` }, { type: "pageLink", documentId: doc.id, label: doc.title || "Untitled" }] : [{ type: "text", text: `[${cited.n}] ${cited.title}` }];
    b.text = text;
  }
  const question = messages.find((m) => m.role === "user")?.text ?? "";
  const title = args.messageId ? titleFromQuestion(question || c.title) : c.title;
  const doc = await insertDocument(ctx, { title, blocks, kind: "document" });
  return { id: doc.id };
});

defineLocal(api.aiChat.remove, "mutation", async (ctx, args) => {
  const c = await conversation(ctx.db, args.conversationId);
  if (c) {
    for (const m of await messagesOf(ctx.db, c.id)) if (m.streamId) cancelStream(m.streamId);
    await deleteConversation(ctx.db, c.id);
  }
  return null;
});

defineLocal(api.aiChat.discard, "mutation", async (ctx, args) => {
  const c = await conversation(ctx.db, args.conversationId);
  if (c?.ephemeral) {
    for (const m of await messagesOf(ctx.db, c.id)) if (m.streamId) cancelStream(m.streamId);
    await deleteConversation(ctx.db, c.id);
  }
  return null;
});

defineLocal(api.aiChat.stop, "mutation", async (ctx, args) => {
  const { message, conversation: c, messages } = await requireMessage(ctx.db, args.messageId);
  if (message.status !== "streaming") return null;
  const live = message.streamId ? readStream(message.streamId) : null;
  if (message.streamId) {
    cancelStream(message.streamId);
    dropStream(message.streamId);
  }
  putMessages(
    ctx.db,
    c.id,
    messages.map((m) => (m.id === message.id ? { ...m, status: "stopped" as const, phase: undefined, streamId: undefined, ...(live ? { text: live.text } : {}), updatedAt: ctx.now() } : m)),
  );
  return null;
});

defineLocal(api.aiChat.setActionsOutcome, "mutation", async (ctx, args) => {
  const { message, conversation: c, messages } = await requireMessage(ctx.db, args.messageId);
  if (!message.actions?.length) fail("invalid_argument", "There were no changes to apply.");
  putMessages(
    ctx.db,
    c.id,
    messages.map((m) => (m.id === message.id ? { ...m, actionsOutcome: args.outcome } : m)),
  );
  return null;
});

// ---- asking -------------------------------------------------------------------------------------------------

interface PostArgs {
  mode: "send" | "regenerate" | "edit";
  conversationId: string;
  text?: string;
  messageId?: string;
  context?: AiContext;
  scope?: { kind: string };
}

/** Adds a turn and the empty answer the model writes into (convex/aiChat.ts post). */
async function post(ctx: LocalActionCtx, args: PostArgs): Promise<{ messageId: string; streamId: string }> {
  return await ctx.mutate(async (m) => {
    await requireAiProfile(m.db);
    const text = (args.text ?? "").trim();
    if (args.mode !== "regenerate") {
      if (!text) fail("invalid_argument", "Ask a question first.");
      if (text.length > MAX_MESSAGE) fail("invalid_argument", `That message is too long (at most ${MAX_MESSAGE.toLocaleString("en-US")} characters).`);
    }
    const now = m.now();
    let c = await conversation(m.db, args.conversationId);
    if (!c) {
      if (args.mode !== "send" || !args.scope) fail("not_found", GONE);
      c = await createConversation(m.db, now, args.conversationId, args.context);
    } else if (args.context) {
      c = { ...c, context: await checkContext(m.db, args.context) };
    }
    let messages = await messagesOf(m.db, c.id);
    if (messages.some((x) => x.status === "streaming" && now - x.updatedAt < STALE_MS)) fail("invalid_argument", "Wait for the answer to finish, or stop it first.");
    if (args.mode === "send") {
      if (messages.length >= MAX_MESSAGES) fail("limit_exceeded", "This conversation is full. Start a new one.");
      messages = [...messages, { id: `${c.id}~${ulid()}`, role: "user", text, status: "done", createdAt: now, updatedAt: now }];
    } else if (args.mode === "regenerate") {
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant" || !messages.some((x) => x.role === "user")) fail("invalid_argument", "There's no answer to write again.");
      messages = messages.slice(0, -1);
    } else {
      const at = messages.findIndex((x) => x.id === args.messageId);
      const edited = messages[at];
      if (!edited || edited.role !== "user") fail("not_found", "That message isn't there anymore.");
      messages = [...messages.slice(0, at), { ...edited, text, updatedAt: now }];
    }
    const streamId = createStream(now);
    const messageId = `${c.id}~${ulid()}`;
    messages = [...messages, { id: messageId, role: "assistant", text: "", status: "streaming", phase: "thinking", streamId, createdAt: now, updatedAt: now }];
    putMessages(m.db, c.id, messages);
    const named = args.mode === "send" && text && !c.titled && !c.ephemeral && c.title === NEW_CHAT_TITLE ? { title: titleFromQuestion(text) } : {};
    await putConversation(m.db, { ...c, updatedAt: now, lastMessageAt: now, ...named, ...(text ? { searchText: appendSearch(c, text) } : {}) });
    return { messageId, streamId };
  });
}

/** Changes one message (and the conversation's search text when it settles). */
async function patchMessage(ctx: LocalActionCtx, messageId: string, patch: (m: LocalMessage) => LocalMessage | null, onConversation?: (c: LocalConversation) => LocalConversation): Promise<LocalMessage | null> {
  return await ctx.mutate(async (m) => {
    const c = await conversation(m.db, conversationOfMessage(messageId));
    if (!c) return null;
    const messages = await messagesOf(m.db, c.id);
    const at = messages.findIndex((x) => x.id === messageId);
    if (at < 0) return null;
    const next = patch(messages[at]!);
    if (!next) return messages[at]!;
    putMessages(
      m.db,
      c.id,
      messages.map((x, i) => (i === at ? next : x)),
    );
    if (onConversation) await putConversation(m.db, onConversation(c));
    return next;
  });
}

function storedError(e: unknown): { code: string; message: string; action?: string; reason?: string } {
  const data = (e as { data?: unknown })?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.code === "string" && typeof d.message === "string") return { code: d.code, message: d.message.slice(0, 500), ...(typeof d.action === "string" ? { action: d.action } : {}), ...(typeof d.reason === "string" ? { reason: d.reason } : {}) };
  }
  return { code: "internal", message: "Something went wrong. Try again." };
}

/** Writes the answer into its message (convex/aiChat.ts respond). Refusals are stored on it, not thrown. */
async function respond(ctx: LocalActionCtx, messageId: string, streamId: string, opts: { web: boolean; attachments: boolean }): Promise<{ status: "done" | "error" }> {
  const finishError = async (error: { code: string; message: string; action?: string; reason?: string }) => {
    dropStream(streamId);
    await patchMessage(ctx, messageId, (m) => ({ ...m, status: m.status === "stopped" ? "stopped" : "error", phase: undefined, streamId: undefined, ...(m.status === "stopped" ? {} : { error }), updatedAt: ctx.now() }));
    return { status: "error" as const };
  };
  if (opts.attachments) return await finishError({ code: "unsupported_file", message: FILES_UNSUPPORTED });
  if (opts.web) return await finishError({ code: "forbidden", message: WEB_UNSUPPORTED });
  const signal = claimStream(streamId) ?? undefined;
  try {
    const turn = await read(ctx, async (db) => {
      const { message, conversation: c, messages } = await requireMessage(db, messageId);
      const before = messages.slice(0, messages.findIndex((m) => m.id === message.id));
      const asked = before.map((m) => m.role).lastIndexOf("user");
      if (asked < 0) fail("invalid_argument", "Ask a question first.");
      const history = before
        .slice(0, asked)
        .filter((m) => m.status !== "error" && m.text.trim())
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 3000) }));
      const p = await requireAiProfile(db);
      return { c, question: before[asked]!.text, history, memoryOn: prefsOf(p).memory };
    });
    const notesOnly = turn.c.context.kind === "note" || turn.c.context.kind === "notes";
    const documentIds = notesOnly ? turn.c.context.ids : [];
    const folderId = turn.c.context.kind === "folder" ? turn.c.context.ids[0] : undefined;
    const nameIt = !turn.c.titled && !turn.c.ephemeral;
    const sink: AnswerSink = {
      write: (text) => writeStream(streamId, text),
      finish: (text) => void writeStream(streamId, text),
      fail: () => {},
      phase: (phase) => void patchMessage(ctx, messageId, (m) => (m.status === "streaming" ? { ...m, phase: phase.slice(0, 20), updatedAt: ctx.now() } : null)),
      shown: (text) => hideFollowUps(hideRemember(text)),
      signal,
    };
    const out = await answerFromNotes(ctx, { question: turn.question, history: turn.history, documentIds, notesOnly, folderId, sink, chat: true, remember: turn.memoryOn && localAiState().features.memory });
    if (nameIt && out.answer && !out.stopped) {
      let title = "";
      try {
        title = cleanTitle((await localAi.generate(chatTitleRequest({ question: turn.question, answer: out.answer }))).text);
      } catch {
        /* the question's first words will do */
      }
      await ctx.mutate(async (m) => {
        const c = await conversation(m.db, turn.c.id);
        if (c && !c.titled) await putConversation(m.db, { ...c, title: (title || titleFromQuestion(turn.question)).slice(0, 80) || NEW_CHAT_TITLE, titled: true, searchText: `${title}\n${c.searchText}`.slice(0, SEARCH_TEXT_MAX) });
      });
    }
    const cited = out.notes.map((n, i) => ({ n: i + 1, noteId: n.id, title: n.title })).filter((c) => out.cited.has(c.n - 1));
    const citations = cited.length
      ? await read(ctx, async (db) => {
          const labels = new ReaderLabels(db);
          const outCites = [];
          for (const c of cited.slice(0, 12)) {
            const doc = await db.get("documents", c.noteId);
            if (!doc) {
              outCites.push(c);
              continue;
            }
            const blocks = await labels.blocks((await liveBlocks(db, doc.id)).map(toWireBlock));
            const hit = bestBlock(
              blocks.map((b) => ({ id: b.id, text: blockSearchText(b) })),
              citingSentences(out.answer, c.n),
            );
            outCites.push(hit ? { ...c, blockId: hit.blockId, quote: hit.quote } : c);
          }
          return [...outCites, ...cited.slice(12)];
        })
      : [];
    dropStream(streamId);
    await patchMessage(
      ctx,
      messageId,
      (m) => {
        const stopped = m.status === "stopped";
        return {
          ...m,
          status: stopped ? "stopped" : "done",
          phase: undefined,
          streamId: undefined,
          text: stopped ? m.text : out.answer.slice(0, 60_000),
          ...(citations.length ? { citations } : {}),
          ...(out.actions?.length ? { actions: out.actions } : {}),
          ...(out.suggestions.length && !stopped ? { suggestions: out.suggestions } : {}),
          ...(out.memory && !stopped ? { memory: { ...out.memory, status: "proposed" as const } } : {}),
          updatedAt: ctx.now(),
        };
      },
      (c) => ({ ...c, searchText: appendSearch(c, out.answer), updatedAt: ctx.now() }),
    );
    return { status: "done" };
  } catch (e) {
    return await finishError(storedError(e));
  }
}

defineLocal(api.aiChat.send, "action", async (ctx, args) => {
  checkScope(args.scope);
  const { messageId, streamId } = await post(ctx, { mode: "send", scope: args.scope, conversationId: args.conversationId, text: args.text, context: args.context });
  return { messageId: messageId as Id<"aiMessages">, ...(await respond(ctx, messageId, streamId, { web: args.web === true, attachments: Boolean(args.attachments?.length) })) };
});

defineLocal(api.aiChat.regenerate, "action", async (ctx, args) => {
  const { messageId, streamId } = await post(ctx, { mode: "regenerate", conversationId: args.conversationId });
  return { messageId: messageId as Id<"aiMessages">, ...(await respond(ctx, messageId, streamId, { web: args.web === true, attachments: false })) };
});

defineLocal(api.aiChat.edit, "action", async (ctx, args) => {
  const { messageId, streamId } = await post(ctx, { mode: "edit", conversationId: args.conversationId, messageId: args.messageId, text: args.text });
  return { messageId: messageId as Id<"aiMessages">, ...(await respond(ctx, messageId, streamId, { web: args.web === true, attachments: false })) };
});
