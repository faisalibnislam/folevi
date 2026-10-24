// Revision 11's commands: declining an invitation (R11.2), the support form (R13.5), "Always fully encrypted" for
// a folder (R9.1) and Foli AI drafts of a template or a note (R9.4).
import { api } from "@/lib/convex/api";
import type { CommandDef } from "./commands";
import { spaceArg } from "./commands";
import { BridgeError, bool, id, nullableId, oneOf, only, optionalId, text } from "./validate";
import type { AiGenerateResult, CommandName, NoteCreateResult, SupportSendResult } from "./protocol";

export const EXTRA_COMMANDS = {
  "invite.decline": {
    // Nobody is told; the invitation's notification goes from the bell (workspaces.declineInvite, sharing.declinePageInvite).
    async run(deps, args) {
      only(args, ["kind", "inviteId", "token"]);
      const kind = oneOf(args, "kind", ["workspace", "page"] as const);
      const inviteId = optionalId(args, "inviteId");
      const token = text(args, "token", { max: 200, optional: true });
      if ((inviteId === undefined) === (token === undefined)) throw new BridgeError("invalid_args", "invite.decline needs an inviteId or a token.");
      const by = inviteId !== undefined ? { inviteId } : { token };
      await deps.client.mutation(kind === "page" ? api.sharing.declinePageInvite : api.workspaces.declineInvite, by);
      return { ok: true };
    },
  },

  "support.send": {
    // The website's /api/support needs its own session cookie; the apps file through Convex with theirs.
    async run(deps, args): Promise<SupportSendResult> {
      only(args, ["topic", "message", "name"]);
      if (deps.app.mode !== "account") throw new BridgeError("unavailable", "Sign in to Folevi to send a request from the app, or email support@folevi.com.");
      const topic = text(args, "topic", { max: 40 }) as string;
      const message = text(args, "message", { max: 5000 }) as string;
      const name = text(args, "name", { max: 80, optional: true, allowEmpty: true }) ?? "";
      const r = (await deps.client.mutation(api.support.submitFromApp, { topic, message, name })) as { number: number | null };
      return { number: r.number ?? null };
    },
  },

  "folder.lock": {
    async run(deps, args) {
      only(args, ["id", "locked", "space"]);
      const folderId = id(args, "id");
      const locked = bool(args, "locked");
      const space = spaceArg(deps, args);
      const run = () => deps.client.mutation(api.e2ee.content.setFolderLocked, { folderId, locked });
      try {
        await run();
      } catch (e) {
        // The first lock in a space that has no key yet (the account has keys from another space): make the
        // space's key, then lock (components/e2ee/LockDialog.tsx, the same retry).
        if (!locked || (e as { data?: { code?: string } }).data?.code !== "e2ee_not_set_up" || !deps.hasKeys?.()) throw e;
        const { setup } = await import("@/lib/e2ee/keys");
        await setup.setUpSpace(space.scope);
        await run();
      }
      return { ok: true };
    },
  },

  "ai.generate": {
    async run(deps, args): Promise<AiGenerateResult> {
      only(args, ["kind", "instruction", "space"]);
      if (!deps.app.capabilities.ai) throw new BridgeError("ai_unavailable", "Foli AI isn't on here.");
      const kind = oneOf(args, "kind", ["template", "note"] as const);
      const instruction = (text(args, "instruction", { max: 4000 }) as string).trim();
      if (!instruction) throw new BridgeError("invalid_args", "Say what to write.");
      const space = spaceArg(deps, args);
      const out = (await deps.client.action(api.ai.write, { scope: space.scope, task: kind === "template" ? "template" : "page", instruction })) as { text: string; title?: string };
      return { title: out.title || instruction.slice(0, 80), text: out.text };
    },
  },

  "ai.saveDraft": {
    async run(deps, args): Promise<NoteCreateResult> {
      only(args, ["kind", "title", "text", "space", "folderId"]);
      const kind = oneOf(args, "kind", ["template", "note"] as const);
      const title = text(args, "title", { max: 300, allowEmpty: true }) as string;
      const markdown = text(args, "text", { max: 200_000 }) as string;
      const folderId = nullableId(args, "folderId");
      const space = spaceArg(deps, args);
      const r = (await deps.client.mutation(api.aiWriting.saveDraft, { scope: space.scope, kind, title, markdown, ...(folderId ? { folderId } : {}) })) as { id: string };
      return { id: r.id };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
