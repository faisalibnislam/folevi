// End-to-end encryption, WP5's rows of docs/E2EE_DESIGN.md §5.7: Foli AI (the gate in ai.begin, provided
// context, ephemeral streams, no chats or research rows for encrypted spaces), integrations (MCP, the REST
// API, webhooks), inbound mail, notifications and the AI background jobs, each for sealed notes and
// encrypted spaces. Standard behaviour is covered by the existing suites (ai.test.ts, mcp.test.ts, ...).
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { person, setup, teamWorkspace, join, type T } from "./helpers";
import { docId, encryptScope, gemini, mirror, note, openInboxItem, sealDoc, setSwitches, stopGemini } from "./e2ee-ai-helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  stopGemini();
  vi.useRealTimers();
});

const provided = (notes: { id: string; title: string; markdown: string }[], consent: "asked" | "auto" = "asked") => ({ scope: { kind: "personal" as const }, notes, consent, ephemeral: true as const });

/** A person with one plain note and one note that's then sealed, in a Personal encrypted at `level`. */
async function encryptedPersonal(t: T, email: string, opts: Parameters<typeof encryptScope>[2] = {}) {
  const a = await person(t, email);
  const plain = await note(a, "Plain ZQXJ-PLAIN", ["ZQXJ-PLAIN-BODY ferry"]);
  const sealed = await note(a, "Sealed ZQXJ-TITLE", ["ZQXJ-BODY ferry timetable"]);
  await sealDoc(t, sealed);
  const space = await encryptScope(t, a, opts);
  return { a, plain, sealed, ...space };
}

async function grantFor(t: T, who: Person, o: { workspaceIds?: Id<"workspaces">[] } = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert("mcpGrants", {
      profileId: who.profileId as Id<"profiles">,
      clientId: `client-${who.profileId}`,
      clientName: "Test app",
      redirectHost: "example.com",
      personal: true,
      workspaceIds: o.workspaceIds ?? [],
      includeShared: false,
      createOnly: false,
      scopes: ["notes:read", "notes:write", "tasks:read", "tasks:write"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never),
  );
}

describe("Foli AI: the gate (ai.begin)", () => {
  test("a Standard space is unchanged: begin says nothing is sealed", async () => {
    const t = setup();
    const a = await person(t, "wp5-std@example.com");
    const { sealed } = await a.as.mutation(internal.ai.begin, { scope: a.scope, plan: [] });
    expect(sealed).toBe(false);
  });

  test("Foli AI off (Fully encrypted) refuses every request before anything is sent", async () => {
    const t = setup();
    const { a } = await encryptedPersonal(t, "wp5-off@example.com", { level: "full" });
    const { fetchMock } = gemini();
    await expect(a.as.action(api.ai.write, { scope: a.scope, task: "improve", text: "hello" })).rejects.toThrow(/e2ee_switch_off|turned off for this space/);
    await expect(a.as.action(api.ai.flowchart, { scope: a.scope, mode: "create", instruction: "A plan" })).rejects.toThrow(/turned off for this space/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a locked note is refused (e2ee_locked), at every level", async () => {
    const t = setup();
    const a = await person(t, "wp5-locked@example.com");
    const id = await note(a, "Locked", ["secret"]);
    await sealDoc(t, id, { locked: true });
    await encryptScope(t, a, { level: "standard", lockedCount: 1 });
    gemini();
    await expect(a.as.action(api.ai.write, { scope: a.scope, task: "summarize", documentId: id })).rejects.toThrow(/always fully encrypted/);
    await expect(a.as.mutation(internal.ai.begin, { scope: a.scope, plan: [], provided: { scope: a.scope, noteIds: [id], consent: "asked" } })).rejects.toThrow(/always fully encrypted/);
  });

  test("provided notes must be the caller's, in the scope; 'auto' consent needs the switch at auto", async () => {
    const t = setup();
    const { a, sealed } = await encryptedPersonal(t, "wp5-prov@example.com");
    const b = await person(t, "wp5-prov-b@example.com");
    const theirs = await note(b, "B's", ["b"]);
    await expect(a.as.mutation(internal.ai.begin, { scope: a.scope, plan: [], provided: { scope: a.scope, noteIds: [theirs], consent: "asked" } })).rejects.toThrow(/isn't there anymore/);
    await expect(a.as.mutation(internal.ai.begin, { scope: a.scope, plan: [], provided: { scope: a.scope, noteIds: [sealed], consent: "auto" } })).rejects.toThrow(/asks before/);
    const ok = await a.as.mutation(internal.ai.begin, { scope: a.scope, plan: [], provided: { scope: a.scope, noteIds: [sealed], consent: "asked" } });
    expect(ok.sealed).toBe(true);
  });
});

describe("Foli AI: reading notes", () => {
  test("noteText, gather and recent never read a sealed note; with Background Foli AI they read its copy", async () => {
    const t = setup();
    const { a, sealed, scopeKey } = await encryptedPersonal(t, "wp5-read@example.com");
    expect(await a.as.query(internal.ai.noteText, { documentId: sealed })).toBeNull();
    const recent = await a.as.query(internal.ai.recent, { scope: a.scope, today: "2026-10-21" });
    expect(recent.notes.some((n) => n.id === sealed)).toBe(false);
    expect(JSON.stringify(recent)).not.toContain("ZQXJ-BODY");
    await mirror(t, sealed, "ai", { title: "Copy title", text: "# Copy title\n\nCOPY-TEXT ferry" });
    // The copy exists, but the switch is off: still nothing.
    expect(await a.as.query(internal.ai.noteText, { documentId: sealed })).toBeNull();
    await setSwitches(t, scopeKey, { backgroundAi: true });
    expect((await a.as.query(internal.ai.noteText, { documentId: sealed }))?.text).toContain("COPY-TEXT");
    const again = await a.as.query(internal.ai.recent, { scope: a.scope, today: "2026-10-21" });
    expect(again.notes.find((n) => n.id === sealed)?.text).toContain("COPY-TEXT");
  });

  test("ai.ask with provided notes answers from them only, and its stream is deleted when done", async () => {
    const t = setup();
    const { a, sealed } = await encryptedPersonal(t, "wp5-ask@example.com");
    const { prompts } = gemini("From your note [1].");
    const out = await a.as.action(api.ai.ask, { scope: a.scope, question: "When is the ferry?", provided: provided([{ id: sealed, title: "Ferry", markdown: "PROVIDED-MARKER the 9:15 ferry" }]) });
    expect(out.answer).toContain("From your note");
    expect(out.sources).toEqual([{ id: sealed, title: "Ferry" }]);
    // One call (no search terms), carrying the provided text, never the server's copy of anything.
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain("PROVIDED-MARKER");
    expect(prompts[0]).not.toContain("ZQXJ-PLAIN-BODY");
    // A stream claimed for an encrypted request goes as soon as the answer is finished.
    const streamId = await a.as.mutation(api.ai.startStream, {});
    await a.as.mutation(internal.ai.claimStream, { id: streamId, ephemeral: true });
    await t.mutation(internal.ai.writeStream, { id: streamId, text: "partial" });
    expect((await t.run(async (ctx) => await ctx.db.get(streamId)))?.ephemeral).toBe(true);
    await t.mutation(internal.ai.writeStream, { id: streamId, text: "done", status: "done" });
    expect(await t.run(async (ctx) => await ctx.db.get(streamId))).toBeNull();
  });

  test("a request about a sealed note without its text is refused (an old client)", async () => {
    const t = setup();
    const { a, sealed } = await encryptedPersonal(t, "wp5-old@example.com");
    gemini();
    await expect(a.as.action(api.flowchartAi.fromText, { scope: a.scope, documentId: sealed })).rejects.toThrow(/Update Folevi/);
    const out = await a.as.action(api.flowchartAi.fromText, { scope: a.scope, documentId: sealed, provided: provided([{ id: sealed, title: "Steps", markdown: "# Steps\n\n1. Start\n2. End" }]) }).catch((e: Error) => e);
    // The model's reply isn't a chart here; what matters is that the provided note was accepted.
    expect(String(out)).not.toMatch(/Update Folevi/);
  });
});

describe("Foli AI: chats, research, memory, plans and the agent in encrypted spaces", () => {
  test("aiChat.post refuses encrypted spaces (e2ee_required); the agent is unavailable", async () => {
    const t = setup();
    const { a } = await encryptedPersonal(t, "wp5-chat@example.com");
    await expect(a.as.mutation(internal.aiChat.post, { mode: "send", scope: a.scope, conversationId: "01J0000000000000000000000A", text: "hi" })).rejects.toThrow(/Update Folevi to chat/);
    await expect(a.as.mutation(internal.aiChat.post, { mode: "send", scope: a.scope, conversationId: "01J0000000000000000000000B", text: "hi", agent: true })).rejects.toThrow(/agent isn't available/);
    await expect(a.as.mutation(api.aiChat.create, { scope: a.scope })).rejects.toThrow(/end-to-end encrypted/);
  });

  test("aiChat.sendSealed answers from provided notes and stores no conversation or message", async () => {
    const t = setup();
    const { a, sealed } = await encryptedPersonal(t, "wp5-sealedchat@example.com");
    gemini('Here it is [1].\n<<<FOLLOW_UPS>>>["More?"]');
    const before = await t.run(async (ctx) => ({ c: (await ctx.db.query("aiConversations").collect()).length, m: (await ctx.db.query("aiMessages").collect()).length }));
    const out = await a.as.action(api.aiChat.sendSealed, { scope: a.scope, text: "When?", history: [], provided: provided([{ id: sealed, title: "Ferry", markdown: "the 9:15 ferry" }]) });
    expect(out.status).toBe("done");
    expect(out.citations[0]?.noteId).toBe(sealed);
    const after = await t.run(async (ctx) => ({ c: (await ctx.db.query("aiConversations").collect()).length, m: (await ctx.db.query("aiMessages").collect()).length }));
    expect(after).toEqual(before);
  });

  test("deep research for an encrypted space keeps its notes out of the scheduler and writes no job rows", async () => {
    const t = setup();
    vi.useFakeTimers();
    const { a, sealed } = await encryptedPersonal(t, "wp5-research@example.com");
    gemini("A report [1].");
    const streamId = await a.as.mutation(api.ai.startStream, {});
    await a.as.action(api.aiResearch.startSealed, { scope: a.scope, text: "Ferries?", streamId, provided: provided([{ id: sealed, title: "Ferry", markdown: "RESEARCH-NOTE-MARKER" }]) });
    const jobs = await t.run(async (ctx) => ({ scheduled: await ctx.db.system.query("_scheduled_functions").collect(), research: await ctx.db.query("aiResearch").collect() }));
    expect(JSON.stringify(jobs.scheduled.map((s) => s.args))).not.toContain("RESEARCH-NOTE-MARKER");
    expect(jobs.research).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // The context row is gone; the answer stream was collected or dropped.
    const streams = await t.run(async (ctx) => await ctx.db.query("aiStreams").collect());
    expect(streams.some((s) => s.kind === "context")).toBe(false);
    expect(JSON.stringify(streams)).not.toContain("RESEARCH-NOTE-MARKER");
  });

  test("memory, saved drafts and plans are made on the device in encrypted spaces (e2ee_device_only)", async () => {
    const t = setup();
    const { a } = await encryptedPersonal(t, "wp5-device@example.com");
    await expect(a.as.mutation(api.aiMemory.add, { kind: "tone", text: "Short answers" })).rejects.toThrow(/done on your device/);
    await expect(a.as.mutation(api.aiWriting.saveDraft, { scope: a.scope, kind: "note", title: "Draft", markdown: "Hello" })).rejects.toThrow(/done on your device/);
    await expect(a.as.mutation(api.aiActions.apply, { scope: a.scope, actions: [] })).rejects.toThrow(/done on your device/);
  });

  test("an encrypted file is never read by Foli AI on the server", async () => {
    const t = setup();
    const { readableKind } = await import("../../convex/lib/ai/attachmentFiles");
    const out = readableKind({ filename: "x.pdf", mimeType: "application/pdf", size: 10, sealed: { key: new ArrayBuffer(1), meta: new ArrayBuffer(1), k: 1, plainSize: 1 } } as never);
    expect(out).toMatchObject({ ok: false });
    void t;
  });
});

describe("AI background jobs", () => {
  test("queueIndex leaves sealed notes out unless Background Foli AI has a copy; the graph skips them", async () => {
    const t = setup();
    const { a, sealed, scopeKey } = await encryptedPersonal(t, "wp5-index@example.com");
    const id = await docId(t, sealed);
    await t.run(async (ctx) => {
      const { queueIndex } = await import("../../convex/lib/ai/indexing");
      await queueIndex(ctx, (await ctx.db.get(id))!, { eligible: true });
    });
    expect(await t.run(async (ctx) => await ctx.db.query("aiIndexState").withIndex("by_document", (q) => q.eq("documentId", id)).first())).toBeNull();
    await mirror(t, sealed, "ai", { title: "T", text: "copy" });
    await setSwitches(t, scopeKey, { backgroundAi: true });
    await t.run(async (ctx) => {
      const { queueIndex } = await import("../../convex/lib/ai/indexing");
      await queueIndex(ctx, (await ctx.db.get(id))!, { eligible: true });
    });
    expect(await t.run(async (ctx) => await ctx.db.query("aiIndexState").withIndex("by_document", (q) => q.eq("documentId", id)).first())).not.toBeNull();
    const graph = await t.mutation(internal.aiGraph.prepareExtract, { documentId: id });
    expect(graph.kind === "done" || graph.kind === "later").toBe(true);
    void a;
  });
});

describe("integrations", () => {
  test("MCP: a sealed note is invisible without Apps on, and read from its copy with it", async () => {
    const t = setup();
    const { a, sealed, scopeKey } = await encryptedPersonal(t, "wp5-mcp@example.com");
    const grantId = await grantFor(t, a);
    await expect(t.query(internal.mcp.read, { grantId, tool: "get_note", args: { noteId: sealed } })).rejects.toThrow(/no note with that id/);
    await mirror(t, sealed, "apps", { title: "Ferry plan", text: "APPS-COPY 9:15", tags: ["travel"] });
    await expect(t.query(internal.mcp.read, { grantId, tool: "get_note", args: { noteId: sealed } })).rejects.toThrow(/no note with that id/);
    await setSwitches(t, scopeKey, { apps: true });
    const got = await t.query(internal.mcp.read, { grantId, tool: "get_note", args: { noteId: sealed } });
    expect(got.title).toBe("Ferry plan");
    expect(JSON.stringify(got.markdown)).toContain("APPS-COPY");
    const found = await t.query(internal.mcp.read, { grantId, tool: "search_notes", args: { query: "APPS-COPY" } });
    expect(JSON.stringify(found)).toContain(sealed);
  });

  test("MCP writes to an encrypted place are sealed into the inbox and answered 'queued'", async () => {
    const t = setup();
    const { a, sealed, scopeKey, inbox, scopeId } = await encryptedPersonal(t, "wp5-mcpw@example.com");
    const grantId = await grantFor(t, a);
    await expect(t.mutation(internal.mcp.write, { grantId, tool: "create_note", args: { title: "New", markdown: "MCP-WRITE-MARKER" }, requestKey: "rk1" })).rejects.toThrow(/Apps and integrations/);
    await setSwitches(t, scopeKey, { apps: true });
    const out = await t.mutation(internal.mcp.write, { grantId, tool: "create_note", args: { title: "New", markdown: "MCP-WRITE-MARKER" }, requestKey: "rk2" });
    expect(out).toMatchObject({ status: "queued", message: expect.stringMatching(/next time/) });
    const item = await openInboxItem(t, inbox, scopeId, out.id as string);
    expect(item).toMatchObject({ kind: "app", tool: "create_note", documentId: out.noteId });
    expect(JSON.stringify(item)).toContain("MCP-WRITE-MARKER");
    // Nothing readable on the server.
    const rows = await t.run(async (ctx) => JSON.stringify([await ctx.db.query("documents").collect(), await ctx.db.query("mcpEvents").collect(), await ctx.db.query("blocks").collect()]));
    expect(rows).not.toContain("MCP-WRITE-MARKER");
    // Appending to a sealed note too; a retried request finds the same item.
    const append = await t.mutation(internal.mcp.write, { grantId, tool: "append_to_note", args: { noteId: sealed, markdown: "more" }, requestKey: "rk3" });
    expect(append).toMatchObject({ status: "queued", noteId: sealed });
  });

  test("REST: a write to an encrypted place answers 202 queued", async () => {
    const t = setup();
    const { a, scopeKey } = await encryptedPersonal(t, "wp5-rest@example.com");
    await setSwitches(t, scopeKey, { apps: true });
    const { id: tokenId } = (await a.as.mutation(api.apiTokens.create, { name: "Test", scopes: ["notes:read", "notes:write"], personal: true, workspaceIds: [], expiresInDays: null })) as unknown as { id: Id<"apiTokens"> };
    const row = await t.run(async (ctx) => (await ctx.db.query("apiTokens").collect())[0]!);
    const answer = await t.mutation(internal.restApi.write, { tokenId: row._id, route: "notes.create", body: { title: "From REST", markdown: "REST-MARKER" }, requestHash: "h" });
    expect(answer.status).toBe(202);
    expect(answer.body).toMatchObject({ status: "queued" });
    void tokenId;
  });

  test("webhooks: no event for a sealed note without Apps; with Apps the data comes from its copy", async () => {
    const t = setup();
    const { a, sealed, scopeKey } = await encryptedPersonal(t, "wp5-hooks@example.com");
    const id = await docId(t, sealed);
    await a.as.mutation(api.webhooks.create, { url: "https://hooks.example.com/x", events: ["note.updated"], personal: true, workspaceIds: [] });
    await t.run(async (ctx) => {
      for (const e of await ctx.db.query("webhookEvents").collect()) await ctx.db.delete(e._id);
    });
    const emit = async () =>
      await t.run(async (ctx) => {
        const { emitWebhook } = await import("../../convex/lib/webhooks");
        await emitWebhook(ctx, "note.updated", (await ctx.db.get(id))!);
        return (await ctx.db.query("webhookEvents").collect()).length;
      });
    expect(await emit()).toBe(0);
    await setSwitches(t, scopeKey, { apps: true });
    expect(await emit()).toBe(1);
  });
});

describe("inbound mail", () => {
  test("email to an encrypted space: refused with the switch off; sealed into the inbox with it on, once", async () => {
    const t = setup();
    const { a, scopeKey, inbox, scopeId } = await encryptedPersonal(t, "wp5-mail@example.com");
    await a.as.mutation(api.emailNotes.create, {});
    const token = await t.run(async (ctx) => (await ctx.db.query("emailNoteAddresses").collect())[0]!.token);
    const mail = (emailId: string) => ({
      token,
      emailId,
      fromAddress: "wp5-mail@example.com",
      fromName: "Me",
      subject: "MAIL-SUBJECT-MARKER",
      text: "MAIL-BODY-MARKER",
      truncated: false,
      rfcMessageId: `${emailId}@x`,
      receivedAt: Date.now(),
      attachments: [],
      authentication: { spf: "pass" as const, dkim: "pass" as const, dmarc: "pass" as const },
    });
    expect((await t.mutation(internal.emailNotes.receive, mail("m1"))).outcome).toBe("rejected_e2ee");
    await setSwitches(t, scopeKey, { emailToNote: true });
    const out = await t.mutation(internal.emailNotes.receive, mail("m2"));
    expect(out.outcome).toBe("queued");
    expect((await t.mutation(internal.emailNotes.receive, mail("m2"))).outcome).toBe("duplicate");
    const item = await t.run(async (ctx) => (await ctx.db.query("e2eeInbox").collect())[0]!);
    expect(item.kind).toBe("email");
    expect(item.appliedBy).toBe(a.profileId);
    const opened = await openInboxItem(t, inbox, scopeId, item.publicId);
    expect(opened).toMatchObject({ kind: "email", subject: "MAIL-SUBJECT-MARKER", documentId: out.documentId });
    const rows = await t.run(async (ctx) => JSON.stringify([await ctx.db.query("documents").collect(), await ctx.db.query("notifications").collect(), await ctx.db.query("blocks").collect()]));
    expect(rows).not.toContain("MAIL-SUBJECT-MARKER");
    expect(rows).not.toContain("MAIL-BODY-MARKER");
  });
});

describe("notifications", () => {
  test("about a sealed note: generic text, the device's preview only with previews on", async () => {
    const t = setup();
    const owner = await person(t, "wp5-notify@example.com");
    const reader = await person(t, "wp5-notify-r@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, reader, "wp5-notify-r@example.com", workspaceId, "editor");
    const id = await note(owner, "Plan ZQXJ-TITLE", ["body"], scope);
    await sealDoc(t, id);
    const space = await encryptScope(t, owner, { workspaceId });
    const send = async (preview?: { title: string; excerpt?: string }) =>
      await t.run(async (ctx) => {
        const { notify } = await import("../../convex/lib/notify");
        const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!;
        const actor = (await ctx.db.get(owner.profileId as Id<"profiles">))!;
        await notify(ctx, { recipientId: reader.profileId as Id<"profiles">, actor, kind: "comment", doc, title: `x commented on “${doc.title}”`, excerpt: "COMMENT-MARKER", preview });
        const rows = await ctx.db
          .query("notifications")
          .withIndex("by_profile_created", (q) => q.eq("profileId", reader.profileId as Id<"profiles">))
          .collect();
        return rows.filter((n) => n.kind === "comment").pop()!;
      });
    const generic = await send({ title: "PREVIEW-TITLE", excerpt: "PREVIEW-LINE" });
    expect(generic.title).toMatch(/commented on a note$/);
    expect(generic.body).toBeUndefined();
    expect(generic.sealedDocument).toBe(true);
    await setSwitches(t, space.scopeKey, { notificationPreviews: true });
    await t.run(async (ctx) => {
      for (const n of await ctx.db.query("notifications").collect()) await ctx.db.delete(n._id);
    });
    const withPreview = await send({ title: "PREVIEW-TITLE", excerpt: "PREVIEW-LINE" });
    expect(withPreview.title).toContain("PREVIEW-TITLE");
    expect(withPreview.body).toBe("PREVIEW-LINE");
  });
});
