// Revision 7's views (docs/NATIVE_APP_PLAN.md section 5.9): the Foli AI chat's conversations, one conversation
// with its messages, the answer streaming in (aiChat.streamText, a live query, so streaming costs nothing new),
// and what Foli AI can do here. Through the page's client, so an encrypted space's chat is the E2EE router's
// (decrypted in memory only, never written to the device: these sources don't persist).
import type { FunctionReference } from "convex/server";
import { api } from "@/lib/convex/api";
import type { ViewContext } from "./context";
import { QuerySource } from "./live";
import { requireSpace, type ValueViewDef } from "./views";
import { id, only, optionalId, text } from "./validate";
import type { ChatAction, ChatConversationRow, ChatConversationValue, ChatMessage, EngineError, ViewName } from "./protocol";

type Args = Record<string, unknown>;

/** Chat sources are never kept on the device: a chat can quote encrypted notes. */
function chatSource<T>(ctx: ViewContext, ref: FunctionReference<"query">, args: Record<string, unknown>): QuerySource<T> {
  return new QuerySource<T>(ctx.deps().client, ref, args, { kept: null });
}

type RowData = { id: string; title: string; pinned: boolean; context: string; lastMessageAt: number; createdAt: number; shared: boolean };

export const conversationRow = (c: RowData): ChatConversationRow => ({ id: c.id, title: c.title ?? "", pinned: c.pinned, context: c.context ?? "none", lastMessageAt: c.lastMessageAt, createdAt: c.createdAt, shared: Boolean(c.shared) });

const RECENT = 50;

const conversations: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["space", "search"]);
    const out: Args = {};
    const space = optionalId(args, "space");
    if (space !== undefined) out.space = space;
    if (args.search !== undefined) out.search = text(args, "search", { max: 100, allowEmpty: true });
    return out;
  },
  create: (ctx, args) => {
    const space = requireSpace(ctx.deps(), args.space as string | undefined);
    const search = ((args.search as string | undefined) ?? "").trim();
    const pinned = search ? null : chatSource<RowData[]>(ctx, api.aiChat.pinned, { scope: space.scope });
    const list = chatSource<{ page: RowData[]; isDone: boolean }>(ctx, api.aiChat.list, { scope: space.scope, ...(search ? { search } : {}), paginationOpts: { numItems: RECENT, cursor: null } });
    return {
      signals: [list, ...(pinned ? [pinned] : [])],
      compute: () => {
        const l = list.snapshot();
        const p = pinned?.snapshot();
        const error = l.error ?? p?.error ?? null;
        if (error) return { value: undefined, stale: false, error };
        if (l.value === undefined || (p && p.value === undefined)) return { value: undefined, stale: true, error: null };
        const rows = l.value.page.map(conversationRow);
        return {
          value: search ? { pinned: rows.filter((r) => r.pinned), recent: rows.filter((r) => !r.pinned), more: false } : { pinned: (p?.value ?? []).map(conversationRow), recent: rows, more: !l.value.isDone },
          stale: false,
          error: null,
        };
      },
    };
  },
};

type ActionData = { type: string; name?: string; title?: string; markdown?: string; folderId?: string; folderName?: string; noteId?: string; noteTitle?: string };

export function chatAction(a: ActionData): ChatAction {
  return {
    type: a.type,
    title: a.type === "createFolder" ? (a.name ?? "") : a.type === "moveNote" ? (a.noteTitle ?? "") : (a.title ?? ""),
    markdown: a.markdown ?? null,
    noteId: a.noteId ?? null,
    folderId: a.folderId ?? null,
    folderName: a.folderName ?? a.name ?? null,
  };
}

type MessageData = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: { n: number; noteId: string; title: string; blockId?: string }[];
  webCitations: { n: number; url: string; title: string; domain: string }[];
  suggestions: string[];
  status: string;
  live: boolean;
  phase: string | null;
  error: { code: string; message: string } | null;
  credits: number | null;
  attachments: { id: string; name: string; mimeType: string; size: number; kind: string }[];
  actions: ActionData[] | null;
  actionsOutcome: { kind: string } | null;
  agent: { steps: { tool: string; count: number; ok: boolean }[]; more: boolean } | null;
  memory: { kind: string; text: string; status: string } | null;
  createdAt: number;
};

export function chatMessage(m: MessageData): ChatMessage {
  const error: EngineError | null = m.error ? { code: m.error.code, message: m.error.message } : null;
  return {
    id: m.id,
    role: m.role,
    text: m.text ?? "",
    status: m.status,
    live: Boolean(m.live),
    phase: m.phase ?? null,
    error,
    citations: (m.citations ?? []).map((c) => ({ n: c.n, noteId: c.noteId, title: c.title, blockId: c.blockId ?? null })),
    webCitations: (m.webCitations ?? []).map((c) => ({ n: c.n, url: c.url, title: c.title, domain: c.domain })),
    suggestions: m.suggestions ?? [],
    credits: m.credits ?? null,
    attachments: (m.attachments ?? []).map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, kind: a.kind })),
    actions: (m.actions ?? []).map(chatAction),
    actionsOutcome: m.actionsOutcome?.kind ?? null,
    agentSteps: m.agent?.steps.map((s) => ({ tool: s.tool, count: s.count, ok: s.ok })) ?? [],
    agentMore: Boolean(m.agent?.more),
    memory: m.memory ? { kind: m.memory.kind, text: m.memory.text, status: m.memory.status } : null,
    createdAt: m.createdAt,
  };
}

type ConversationData = {
  conversation: { id: string; title: string; pinned: boolean; ephemeral: boolean; scope: { kind: string; workspaceId?: string }; context: { kind: string }; shared: boolean; canShare: boolean; createdAt: number; lastMessageAt: number };
  messages: MessageData[];
} | null;

export function conversationValue(d: ConversationData): ChatConversationValue {
  if (!d) return { found: false, conversation: null, messages: [] };
  const c = d.conversation;
  return {
    found: true,
    conversation: { id: c.id, title: c.title ?? "", pinned: c.pinned, ephemeral: c.ephemeral, space: c.scope.kind === "personal" ? "personal" : (c.scope.workspaceId ?? "personal"), context: c.context.kind, shared: c.shared, canShare: c.canShare, createdAt: c.createdAt, lastMessageAt: c.lastMessageAt },
    messages: d.messages.map(chatMessage),
  };
}

const conversation: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, ["conversationId"]), { conversationId: id(args, "conversationId") }),
  create: (ctx, args) => {
    const src = chatSource<ConversationData>(ctx, api.aiChat.get, { conversationId: args.conversationId });
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        return { value: conversationValue(s.value), stale: false, error: null };
      },
    };
  },
};

const stream: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, ["messageId"]), { messageId: id(args, "messageId") }),
  create: (ctx, args) => {
    const src = chatSource<{ text: string } | null>(ctx, api.aiChat.streamText, { messageId: args.messageId });
    return {
      signals: [src],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        return { value: { messageId: args.messageId as string, text: s.value?.text ?? null }, stale: false, error: null };
      },
    };
  },
};

type CapabilitiesData = { vision: boolean; searchGrounding: boolean; prefs: { history: boolean; attachments: boolean; webResearch: boolean } };

const capabilities: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: (ctx) => {
    if (ctx.deps().app.mode === "local") {
      return { signals: [ctx.appSignal], compute: () => ({ value: { available: ctx.deps().app.capabilities.ai, vision: false, webResearch: false, attachments: false, history: true, agent: false }, stale: false, error: null }) };
    }
    const src = chatSource<CapabilitiesData>(ctx, api.aiChat.capabilities, {});
    return {
      signals: [src, ctx.appSignal],
      compute: () => {
        const s = src.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const c = s.value;
        return { value: { available: ctx.deps().app.capabilities.ai, vision: c.vision, webResearch: c.searchGrounding && c.prefs.webResearch, attachments: c.prefs.attachments, history: c.prefs.history, agent: true }, stale: false, error: null };
      },
    };
  },
};

export const AI_VALUE_VIEWS = {
  "ai.conversations": conversations,
  "ai.conversation": conversation,
  "ai.stream": stream,
  "ai.capabilities": capabilities,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
