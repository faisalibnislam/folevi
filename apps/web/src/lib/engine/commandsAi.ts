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
import { BridgeError, bool, id, oneOf, only, text } from "./validate";
import type { ChatSendResult, CommandName } from "./protocol";

/** Runs an answer in the background; a failure the answer doesn't carry itself goes to native as a toast. */
function background(p: Promise<unknown>): void {
  void p.catch((e) => nativeToast(toEngineError(e).message, { tone: "error" }));
}

type ConversationData = { conversation: { scope: { kind: string; workspaceId?: string } }; messages: { id: string; actions: unknown[] | null }[] } | null;

export const AI_COMMANDS = {
  "ai.send": {
    async run(deps, args): Promise<ChatSendResult> {
      only(args, ["conversationId", "text", "space", "context", "web", "attachments", "mode"]);
      const q = (text(args, "text", { max: 4000 }) as string).trim();
      const space = spaceArg(deps, args);
      const conversationId = args.conversationId === undefined ? ulid() : id(args, "conversationId");
      const mode = args.mode === undefined ? "auto" : oneOf(args, "mode", ["auto", "ask", "agent"] as const);
      let context: { kind: string; ids: string[] } | undefined;
      if (args.context !== undefined) {
        const c = args.context as Record<string, unknown>;
        if (!c || typeof c !== "object") throw new BridgeError("invalid_args", "context must be { kind, ids }.");
        context = { kind: oneOf(c, "kind", ["note", "notes", "folder", "workspace"] as const), ids: Array.isArray(c.ids) && c.ids.every((x) => typeof x === "string") ? (c.ids as string[]).slice(0, 50) : [] };
      }
      const attachments = Array.isArray(args.attachments) && args.attachments.every((x) => typeof x === "string") ? (args.attachments as string[]) : undefined;
      const base = { scope: space.scope, conversationId, text: q, ...(context ? { context } : {}), ...(attachments?.length ? { attachments } : {}) };
      const agent = deps.app.mode === "account" && (mode === "agent" || (mode === "auto" && wantsAgent(q)));
      background(agent ? deps.client.action(api.aiAgent.send, base) : deps.client.action(api.aiChat.send, { ...base, ...(bool(args, "web", false) ? { web: true } : {}) }));
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
      background(deps.client.action(api.aiChat.regenerate, { conversationId, ...(bool(args, "web", false) ? { web: true } : {}) }));
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
      background(agent ? deps.client.action(api.aiAgent.edit, { conversationId, messageId, text: q }) : deps.client.action(api.aiChat.edit, { conversationId, messageId, text: q, ...(bool(args, "web", false) ? { web: true } : {}) }));
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
} satisfies Partial<Record<CommandName, CommandDef>>;
