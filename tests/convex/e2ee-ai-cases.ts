// WP5's flows for the no-plaintext scan (docs/E2EE_DESIGN.md §11.2): each case builds its own encrypted
// Personal, runs one feature with marker strings, and says which markers it used and where (if anywhere)
// they may appear readable. tests/convex/e2ee-features.test.ts runs them and scans every table; WP3's
// e2ee-no-plaintext.test.ts can import `noPlaintextCases` from here (or from e2ee-features.test.ts, as the
// design names it) and run them under its own scan of tables, blobs and scheduler arguments.
import { vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { person, type T } from "./helpers";
import { encryptScope, gemini, mirror, note, sealDoc, setSwitches, stopGemini, type Switches } from "./e2ee-ai-helpers";

export interface NoPlaintextCase {
  name: string;
  /** The switches the case turns on (none: everything off). */
  switches: Partial<Switches>;
  /** Runs the flow; returns the markers it used, and the tables where they may appear readable (a switch's copies). */
  run(t: T): Promise<{ markers: string[]; allowedIn: string[] }>;
}

async function world(t: T, email: string, switches: Partial<Switches>) {
  const a = await person(t, email);
  // Made before encryption (its plaintext history is the seal migration's to purge, WP3), so it carries no marker.
  const id = await note(a, "A note", ["Some text"]);
  await sealDoc(t, id);
  const space = await encryptScope(t, a, { switches });
  return { a, id, ...space };
}

export const noPlaintextCases: NoPlaintextCase[] = [
  {
    name: "Foli AI asked with provided notes (ask, chat, research): nothing kept",
    switches: { foliAi: "ask" },
    async run(t) {
      const { a, id } = await world(t, "np-ai@example.com", { foliAi: "ask" });
      gemini("ZQXJ-ANSWER-wp5");
      const provided = { scope: { kind: "personal" as const }, notes: [{ id, title: "ZQXJ-PTITLE-wp5", markdown: "ZQXJ-PBODY-wp5" }], consent: "asked" as const, ephemeral: true as const };
      try {
        const streamId = await a.as.mutation(api.ai.startStream, {});
        await a.as.action(api.ai.ask, { scope: a.scope, question: "ZQXJ-QUESTION-wp5", provided, streamId }).catch(() => null);
        await a.as.action(api.aiChat.sendSealed, { scope: a.scope, text: "ZQXJ-QUESTION-wp5", history: [], provided });
        vi.useFakeTimers();
        const research = await a.as.mutation(api.ai.startStream, {});
        await a.as.action(api.aiResearch.startSealed, { scope: a.scope, text: "ZQXJ-QUESTION-wp5", provided, streamId: research });
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        await a.as.mutation(api.aiResearch.collect, { streamId: research });
      } finally {
        vi.useRealTimers();
        stopGemini();
      }
      return { markers: ["ZQXJ-PBODY-wp5", "ZQXJ-PTITLE-wp5", "ZQXJ-QUESTION-wp5", "ZQXJ-ANSWER-wp5"], allowedIn: [] };
    },
  },
  {
    name: "Email to note: sealed into the inbox",
    switches: { emailToNote: true },
    async run(t) {
      const { a } = await world(t, "np-mail@example.com", { emailToNote: true });
      await a.as.mutation(api.emailNotes.create, {});
      const token = await t.run(async (ctx) => (await ctx.db.query("emailNoteAddresses").collect())[0]!.token);
      await t.mutation(internal.emailNotes.receive, {
        token,
        emailId: "np1",
        fromAddress: "np-mail@example.com",
        fromName: "Me",
        subject: "ZQXJ-MAILSUBJ-wp5",
        text: "ZQXJ-MAILBODY-wp5",
        truncated: false,
        rfcMessageId: null,
        receivedAt: Date.now(),
        attachments: ["ZQXJ-ATTACH-wp5.pdf"],
        authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
      });
      return { markers: ["ZQXJ-MAILSUBJ-wp5", "ZQXJ-MAILBODY-wp5", "ZQXJ-ATTACH-wp5"], allowedIn: [] };
    },
  },
  {
    name: "MCP write: sealed into the inbox",
    switches: { apps: true },
    async run(t) {
      const { a, id } = await world(t, "np-mcp@example.com", { apps: true });
      const grantId = await t.run(async (ctx) =>
        ctx.db.insert("mcpGrants", {
          profileId: a.profileId as Id<"profiles">,
          clientId: "np-client",
          clientName: "Test app",
          redirectHost: "example.com",
          personal: true,
          workspaceIds: [],
          includeShared: false,
          createOnly: false,
          scopes: ["notes:read", "notes:write", "tasks:read", "tasks:write"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as never),
      );
      await t.mutation(internal.mcp.write, { grantId, tool: "create_note", args: { title: "ZQXJ-MCPTITLE-wp5", markdown: "ZQXJ-MCPBODY-wp5" }, requestKey: "np1" });
      await t.mutation(internal.mcp.write, { grantId, tool: "append_to_note", args: { noteId: id, markdown: "ZQXJ-MCPAPPEND-wp5" }, requestKey: "np2" });
      return { markers: ["ZQXJ-MCPTITLE-wp5", "ZQXJ-MCPBODY-wp5", "ZQXJ-MCPAPPEND-wp5"], allowedIn: [] };
    },
  },
  {
    name: "Reminders and notifications without previews: generic text",
    switches: {},
    async run(t) {
      const { a, id } = await world(t, "np-remind@example.com", {});
      await a.as.mutation(api.e2ee.reminders.put, { documentId: id, blockId: "b1", profileId: a.profileId, remindAt: Date.now() - 1000, preview: { title: "ZQXJ-TODO-wp5", note: "ZQXJ-NOTE-wp5" } });
      await t.mutation(internal.e2ee.reminders.process, {});
      return { markers: ["ZQXJ-TODO-wp5", "ZQXJ-NOTE-wp5"], allowedIn: [] };
    },
  },
  {
    name: "Search everywhere and Apps: copies only in e2eeMirrors, gone after the purge",
    switches: { searchEverywhere: true, apps: true },
    async run(t) {
      const { a, id, scopeKey } = await world(t, "np-mirror@example.com", { searchEverywhere: true, apps: true, backgroundAi: true });
      await a.as.mutation(api.e2ee.mirrors.put, { scope: a.scope, purpose: "search", documentId: id, title: "ZQXJ-MIRROR-wp5", text: "ZQXJ-MIRROR-wp5 text", contentHash: "h1" });
      await mirror(t, id, "ai", { title: "ZQXJ-MIRROR-wp5", text: "ZQXJ-MIRROR-wp5" });
      await setSwitches(t, scopeKey, { searchEverywhere: false, backgroundAi: false });
      const scope = { kind: "personal" as const, profileId: a.profileId as Id<"profiles"> };
      await t.mutation(internal.e2ee.mirrors.purge, { scope, purpose: "search" });
      await t.mutation(internal.e2ee.mirrors.purge, { scope, purpose: "ai" });
      return { markers: ["ZQXJ-MIRROR-wp5"], allowedIn: [] };
    },
  },
];
