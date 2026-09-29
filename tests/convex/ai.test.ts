import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { person, setup } from "./helpers";

describe("AI assistant", () => {
  test("without a server key, AI requests fail cleanly (and never reach the network)", async () => {
    const t = setup();
    const a = await person(t, "ai-nokey@example.com");
    delete process.env.GEMINI_API_KEY;
    await expect(a.as.action(api.ai.write, { workspaceId: a.workspaceId, task: "improve", text: "hello" })).rejects.toThrow(/isn't set up/);
    await expect(a.as.action(api.ai.write, { workspaceId: a.workspaceId, task: "not-a-task" })).rejects.toThrow(/Unknown AI action/);
  });

  test("the AI only ever reads notes the person can open", async () => {
    const t = setup();
    const a = await person(t, "ai-owner@example.com");
    const b = await person(t, "ai-other@example.com");
    // A's notes (seeded) are visible to A…
    const mine = await a.as.query(internal.ai.gather, { workspaceId: a.workspaceId, queries: ["coastal weekend"], limit: 5 });
    expect(mine.map((n) => n.title)).toContain("Trip Sketch: Coastal Weekend");
    const id = mine.find((n) => n.title === "Trip Sketch: Coastal Weekend")!.id;
    const note = await a.as.query(internal.ai.noteText, { documentId: id });
    expect(note.text).toMatch(/ferry/i);
    // …but not to B: not through their workspace, not by id.
    await expect(b.as.query(internal.ai.gather, { workspaceId: a.workspaceId, queries: ["coastal weekend"], limit: 5 })).rejects.toThrow();
    await expect(b.as.query(internal.ai.noteText, { documentId: id })).rejects.toThrow(/not found/i);
    const theirs = await b.as.query(internal.ai.gather, { workspaceId: b.workspaceId, queries: ["coastal weekend"], limit: 5 });
    expect(theirs.every((n) => n.id !== id)).toBe(true);
  });

  test("turned off in settings, the server refuses AI requests (before anything is sent)", async () => {
    const t = setup();
    const a = await person(t, "ai-off@example.com");
    expect((await a.as.query(api.users.me, {})).state === "ready" && (await a.as.query(api.users.me, {}) as { profile: { aiEnabled: boolean } }).profile.aiEnabled).toBe(true);
    await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
    process.env.GEMINI_API_KEY = "test-key-never-used";
    await expect(a.as.action(api.ai.write, { workspaceId: a.workspaceId, task: "improve", text: "hello" })).rejects.toThrow(/turned off/);
    await expect(a.as.action(api.ai.ask, { workspaceId: a.workspaceId, question: "anything?" })).rejects.toThrow(/turned off/);
    delete process.env.GEMINI_API_KEY;
    const me = (await a.as.query(api.users.me, {})) as { profile: { aiEnabled: boolean } };
    expect(me.profile.aiEnabled).toBe(false);
  });

  test("folder-scoped search only returns that folder's notes; the brief only sees readable notes", async () => {
    const t = setup();
    const a = await person(t, "ai-folder@example.com");
    const b = await person(t, "ai-folder-b@example.com");
    const org = await a.as.query(api.organization.index, { workspaceId: a.workspaceId });
    const projects = org.folders.find((f) => f.name === "Projects")!;
    const inProjects = await a.as.query(internal.ai.gather, { workspaceId: a.workspaceId, queries: ["garden", "weekend"], limit: 8, folderId: projects.id });
    expect(inProjects.length).toBeGreaterThan(0);
    expect(inProjects.map((n) => n.title)).not.toContain("Trip Sketch: Coastal Weekend");
    // Another workspace's folder is refused.
    await expect(b.as.query(internal.ai.gather, { workspaceId: b.workspaceId, queries: ["garden"], limit: 8, folderId: projects.id })).rejects.toThrow(/not found/i);
    const recent = await a.as.query(internal.ai.recent, { workspaceId: a.workspaceId, today: "2026-09-27" });
    expect(recent.notes.length).toBeGreaterThan(0);
    await expect(b.as.query(internal.ai.recent, { workspaceId: a.workspaceId, today: "2026-09-27" })).rejects.toThrow();
  });

  test("AI streams are private to their owner, stoppable, and hold only the reply", async () => {
    const t = setup();
    const a = await person(t, "ai-stream@example.com");
    const b = await person(t, "ai-stream-b@example.com");
    const id = await a.as.mutation(api.ai.startStream, {});
    expect(await a.as.query(api.ai.stream, { id })).toEqual({ text: "", status: "pending" });
    // Someone else can't read, stop or claim it.
    expect(await b.as.query(api.ai.stream, { id })).toBeNull();
    await b.as.mutation(api.ai.cancelStream, { id });
    await expect(b.as.mutation(internal.ai.claimStream, { id })).rejects.toThrow(/expired/);
    // The owner's AI call claims it and writes into it; Stop makes the next write report "stop".
    await a.as.mutation(internal.ai.claimStream, { id });
    expect(await t.mutation(internal.ai.writeStream, { id, text: "Hello there" })).toBe(true);
    expect(await a.as.query(api.ai.stream, { id })).toEqual({ text: "Hello there", status: "streaming" });
    await a.as.mutation(api.ai.cancelStream, { id });
    expect(await t.mutation(internal.ai.writeStream, { id, text: "Hello there, more" })).toBe(false);
    // A stream can only be claimed once.
    await expect(a.as.mutation(internal.ai.claimStream, { id })).rejects.toThrow(/expired/);
    // Old rows are swept.
    await t.run(async (ctx) => ctx.db.patch(id, { createdAt: Date.now() - 2 * 60 * 60_000 }));
    expect((await t.mutation(internal.ai.sweepStreams, {})).deleted).toBe(1);
  });

  test("flowcharts: the model's JSON is sanitised before it's returned, and the usual gates apply", async () => {
    const t = setup();
    const a = await person(t, "ai-flowchart@example.com");
    process.env.GEMINI_API_KEY = "test-key";
    const reply = { direction: "TD", nodes: [{ id: "s", shape: "terminator", text: "Start" }, { id: "x", shape: "hexagon", text: "Do <b>it</b>", color: "#f00" }], edges: [{ from: "s", to: "x" }, { from: "x", to: "ghost" }] };
    const prompts: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      prompts.push(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: "STOP" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const draft = await a.as.action(api.ai.flowchart, { workspaceId: a.workspaceId, mode: "create", instruction: "Ship a feature" });
      expect(draft.nodes.map((n) => [n.id, n.shape, n.color])).toEqual([
        ["s", "terminator", "neutral"],
        ["x", "process", "neutral"],
      ]);
      expect(draft.edges).toEqual([{ from: "s", to: "x", label: "", style: "solid", arrow: "end" }]);
      // Updating sends the current chart (no positions) and needs one.
      const current = JSON.stringify({ v: 1, nodes: [{ id: "s", shape: "terminator", x: 0, y: 0, w: 160, h: 56, text: "Start" }], edges: [] });
      await a.as.action(api.ai.flowchart, { workspaceId: a.workspaceId, mode: "update", instruction: "add a review step", current });
      expect(prompts[1]).toContain("Start");
      expect(prompts[1]).not.toContain('\\"w\\"');
      await expect(a.as.action(api.ai.flowchart, { workspaceId: a.workspaceId, mode: "update", instruction: "add a step", current: "" })).rejects.toThrow(/no flowchart/);
      await expect(a.as.action(api.ai.flowchart, { workspaceId: a.workspaceId, mode: "create", instruction: "  " })).rejects.toThrow(/Describe/);
      // Turned off in settings: refused before anything is sent.
      await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
      const calls = fetchMock.mock.calls.length;
      await expect(a.as.action(api.ai.flowchart, { workspaceId: a.workspaceId, mode: "create", instruction: "Ship a feature" })).rejects.toThrow(/turned off/);
      expect(fetchMock.mock.calls.length).toBe(calls);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GEMINI_API_KEY;
    }
  });
});
