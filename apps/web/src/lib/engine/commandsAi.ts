// Revision 7's commands (docs/NATIVE_APP_PLAN.md section 5.9): sending to Foli AI and everything around a chat.
// A send replies at once with the conversation's id: the answer is written in the background and arrives through
// `ai.conversation` (its message is `live` while `ai.stream` has the text so far), as the web's chat shows it.
// A refusal (out of credits, not included) is stored on the answer; anything else that fails is a toast.
import { ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { wantsAgent } from "@/components/ai/editIntent";
import type { EngineDeps } from "./context";
import { spaceArg, type CommandDef } from "./commands";
import { nativeToast } from "./toasts";
import { toEngineError } from "./live";
import { ownKeyArgs } from "@/lib/ai/ownKey";
import { BridgeError, bool, id, oneOf, only, text } from "./validate";
import type { ChatSendResult, CommandName, SettingsAskOption, SettingsAskResult } from "./protocol";

/** Runs an answer in the background; a failure the answer doesn't carry itself goes to native as a toast. */
function background(p: Promise<unknown>): void {
  void p.catch((e) => nativeToast(toEngineError(e).message, { tone: "error" }));
}

/** The person's own AI key for a Folevi Cloud request, when they turned one on (lib/ai/ownKey.ts). */
const ownKeyFor = async (deps: EngineDeps) => (deps.app.mode === "account" ? await ownKeyArgs() : {});

type ConversationData = { conversation: { scope: { kind: string; workspaceId?: string } }; messages: { id: string; actions: unknown[] | null }[] } | null;

export const AI_COMMANDS = {
  "ai.send": {
    async run(deps, args): Promise<ChatSendResult> {
      only(args, ["conversationId", "text", "space", "context", "web", "attachments", "mode"]);
      const q = (text(args, "text", { max: 4000 }) as string).trim();
      const space = spaceArg(deps, args);
      const conversationId = args.conversationId === undefined ? ulid() : id(args, "conversationId");
      const mode = args.mode === undefined ? "auto" : oneOf(args, "mode", ["auto", "ask", "agent", "research"] as const);
      let context: { kind: string; ids: string[] } | undefined;
      if (args.context !== undefined) {
        const c = args.context as Record<string, unknown>;
        if (!c || typeof c !== "object") throw new BridgeError("invalid_args", "context must be { kind, ids }.");
        context = { kind: oneOf(c, "kind", ["note", "notes", "folder", "workspace"] as const), ids: Array.isArray(c.ids) && c.ids.every((x) => typeof x === "string") ? (c.ids as string[]).slice(0, 50) : [] };
      }
      const attachments = Array.isArray(args.attachments) && args.attachments.every((x) => typeof x === "string") ? (args.attachments as string[]) : undefined;
      const base = { scope: space.scope, conversationId, text: q, ...(context ? { context } : {}), ...(attachments?.length ? { attachments } : {}) };
      // Research: a report from the web and the notes, its steps in `ai.research`.
      if (mode === "research") {
        if (deps.app.mode !== "account") throw new BridgeError("unavailable", "Research needs a Folevi account.");
        background(deps.client.action(api.aiResearch.start, base));
        return { conversationId, messageId: null };
      }
      const agent = deps.app.mode === "account" && (mode === "agent" || (mode === "auto" && wantsAgent(q)));
      const own = await ownKeyFor(deps);
      background(agent ? deps.client.action(api.aiAgent.send, { ...base, ...own }) : deps.client.action(api.aiChat.send, { ...base, ...own, ...(bool(args, "web", false) ? { web: true } : {}) }));
      return { conversationId, messageId: null };
    },
  },

  "ai.stop": {
    async run(deps, args) {
      only(args, ["messageId"]);
      await deps.client.mutation(api.aiChat.stop, { messageId: id(args, "messageId") });
      return { ok: true };
    },
  },

  "ai.regenerate": {
    async run(deps, args): Promise<ChatSendResult> {
      only(args, ["conversationId", "web"]);
      const conversationId = id(args, "conversationId");
      background(deps.client.action(api.aiChat.regenerate, { conversationId, ...(await ownKeyFor(deps)), ...(bool(args, "web", false) ? { web: true } : {}) }));
      return { conversationId, messageId: null };
    },
  },

  "ai.edit": {
    async run(deps, args): Promise<ChatSendResult> {
      only(args, ["conversationId", "messageId", "text", "web"]);
      const conversationId = id(args, "conversationId");
      const messageId = id(args, "messageId");
      const q = (text(args, "text", { max: 4000 }) as string).trim();
      const agent = deps.app.mode === "account" && wantsAgent(q);
      const own = await ownKeyFor(deps);
      background(agent ? deps.client.action(api.aiAgent.edit, { conversationId, messageId, text: q, ...own }) : deps.client.action(api.aiChat.edit, { conversationId, messageId, text: q, ...own, ...(bool(args, "web", false) ? { web: true } : {}) }));
      return { conversationId, messageId: null };
    },
  },

  "ai.rename": {
    async run(deps, args) {
      only(args, ["conversationId", "title"]);
      await deps.client.mutation(api.aiChat.rename, { conversationId: id(args, "conversationId"), title: text(args, "title", { max: 80 }) as string });
      return { ok: true };
    },
  },

  "ai.pin": {
    async run(deps, args) {
      only(args, ["conversationId", "pinned"]);
      await deps.client.mutation(api.aiChat.setPinned, { conversationId: id(args, "conversationId"), pinned: bool(args, "pinned") });
      return { ok: true };
    },
  },

  "ai.share": {
    async run(deps, args) {
      only(args, ["conversationId", "shared"]);
      const conversationId = id(args, "conversationId");
      if (bool(args, "shared")) await deps.client.mutation(api.aiSharing.share, { conversationId });
      else await deps.client.mutation(api.aiSharing.unshare, { conversationId });
      return { ok: true };
    },
  },

  "ai.remove": {
    async run(deps, args) {
      only(args, ["conversationId", "web"]);
      await deps.client.mutation(api.aiChat.remove, { conversationId: id(args, "conversationId") });
      return { ok: true };
    },
  },

  "ai.saveAsNote": {
    async run(deps, args) {
      only(args, ["conversationId", "messageId"]);
      const r = (await deps.client.mutation(api.aiChat.saveAsNote, { conversationId: id(args, "conversationId"), ...(args.messageId !== undefined ? { messageId: id(args, "messageId") } : {}) })) as { id: string };
      return { id: r.id };
    },
  },

  "ai.exportMarkdown": {
    async run(deps, args) {
      only(args, ["conversationId", "messageId"]);
      const r = (await deps.client.query(api.aiChat.exportMarkdown, { conversationId: id(args, "conversationId"), ...(args.messageId !== undefined ? { messageId: id(args, "messageId") } : {}) })) as { filename: string; markdown: string };
      return { filename: r.filename, markdown: r.markdown };
    },
  },

  "ai.actions": {
    // Apply: the answer's proposed changes (folders, notes, moves) in the conversation's space, then its outcome.
    async run(deps: EngineDeps, args) {
      only(args, ["conversationId", "messageId", "apply"]);
      const conversationId = id(args, "conversationId");
      const messageId = id(args, "messageId");
      if (!bool(args, "apply")) {
        await deps.client.mutation(api.aiChat.setActionsOutcome, { messageId, outcome: { kind: "dismissed" } });
        return { ok: true };
      }
      const data = (await deps.client.query(api.aiChat.get, { conversationId })) as ConversationData;
      const actions = data?.messages.find((m) => m.id === messageId)?.actions;
      if (!data || !actions?.length) throw new BridgeError("not_found", "Those changes aren't there any more.");
      const result = (await deps.client.mutation(api.aiActions.apply, { scope: data.conversation.scope, actions })) as Record<string, unknown>;
      await deps.client.mutation(api.aiChat.setActionsOutcome, { messageId, outcome: { kind: "applied", ...result } });
      return { ok: true };
    },
  },

  "ai.memory": {
    async run(deps, args) {
      only(args, ["messageId", "save"]);
      const messageId = id(args, "messageId");
      if (bool(args, "save")) await deps.client.mutation(api.aiMemory.saveProposal, { messageId });
      else await deps.client.mutation(api.aiMemory.dismissProposal, { messageId });
      return { ok: true };
    },
  },
  // Settings' Ask Foli AI (SettingsView.tsx SettingsSearch): Foli AI picks the settings that do what was asked.
  // An account's only: a library on this device has no Folevi Cloud to ask.
  "ai.settingsSearch": {
    async run(deps, args): Promise<SettingsAskResult> {
      only(args, ["space", "query", "options"]);
      const query = (text(args, "query", { max: 400 }) as string).trim();
      const space = spaceArg(deps, args);
      if (deps.app.mode !== "account" || !deps.app.capabilities.ai) throw new BridgeError("ai_unavailable", "Foli AI isn't on here.");
      if (!Array.isArray(args.options) || args.options.length > 200) throw new BridgeError("invalid_args", "options must be a list of settings.");
      const options: SettingsAskOption[] = args.options.map((o) => {
        const x = o as Record<string, unknown>;
        if (!x || typeof x !== "object" || typeof x.key !== "string" || typeof x.title !== "string" || typeof x.section !== "string") throw new BridgeError("invalid_args", "Each option is { key, title, section }.");
        return { key: x.key, title: x.title, section: x.section };
      });
      if (!query) return { keys: [], answer: "" };
      const r = (await deps.client.action(api.ai.settingsSearch, { scope: space.scope, query, options, ...(await ownKeyFor(deps)) })) as SettingsAskResult;
      return { keys: r.keys, answer: r.answer };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
