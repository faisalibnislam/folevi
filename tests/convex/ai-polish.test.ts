// Milestone 9 part B (docs/AI_ASSISTANT.md): a meeting summary saved as a new note gets real mentions (resolved on the server for the
// people who can be mentioned there), and the agent can offer to remember a preference like a chat answer.
// Gemini is a stubbed `fetch`.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { REMEMBER } from "../../convex/lib/ai/memory";
import { inWorkspace, join, person, setup, teamWorkspace, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});


describe("a meeting summary saved as a new note", () => {
  const SUMMARY = "## Action items\n\n- [ ] @Ana: Book the hall (due 2026-11-02)\n- [ ] @Zed: Nobody by that name\n- [ ] Plain line with no one";

  const savedBlocks = async (p: Person, id: string) => (await p.as.query(api.blocks.list, { documentId: id }))!.blocks;

  test("in a workspace, '@Name' becomes a mention of a member, and the to-do is theirs; names that match nobody stay text", async () => {
    const t = setup();
    const owner = await person(t, "mtg-owner@example.com");
    const ana = await person(t, "ana@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Studio");
    await join(t, owner, ana, "ana@example.com", workspaceId, "editor");
    const { id } = await owner.as.mutation(api.aiWriting.saveDraft, { scope: inWorkspace(workspaceId), kind: "note", title: "Meeting summary: Sync", markdown: SUMMARY, people: true });
    const todos = (await savedBlocks(owner, id)).filter((b) => b.type === "todo");
    expect(todos).toHaveLength(3);
    expect(todos[0]!.text[0]).toEqual({ type: "mention", userId: ana.profileId, label: "ana" });
    expect(todos[0]!.props).toMatchObject({ assigneeId: ana.profileId, dueDate: "2026-11-02" });
    expect(todos[1]!.text.every((n) => n.type === "text")).toBe(true);
    expect(todos[1]!.props.assigneeId).toBeUndefined();
    expect(todos[2]!.text).toEqual([{ type: "text", text: "Plain line with no one" }]);
  });

  test("in Personal only its owner can be mentioned; without `people` nothing is linked", async () => {
    const t = setup();
    const ana = await person(t, "ana@example.com");
    await person(t, "zed@example.com");
    const { id } = await ana.as.mutation(api.aiWriting.saveDraft, { scope: ana.scope, kind: "note", title: "Notes", markdown: SUMMARY, people: true });
    const todos = (await savedBlocks(ana, id)).filter((b) => b.type === "todo");
    expect(todos[0]!.text[0]).toMatchObject({ type: "mention", userId: ana.profileId });
    // Someone outside this Personal isn't mentioned, even with a matching name.
    expect(todos[1]!.text.some((n) => n.type === "mention")).toBe(false);

    const plain = await ana.as.mutation(api.aiWriting.saveDraft, { scope: ana.scope, kind: "note", title: "Plain", markdown: SUMMARY });
    const plainTodos = (await savedBlocks(ana, plain.id)).filter((b) => b.type === "todo");
    expect(plainTodos[0]!.text.some((n) => n.type === "mention")).toBe(false);
    expect(plainTodos[0]!.props.assigneeId).toBeUndefined();
  });
});

describe("the agent can offer to remember a preference", () => {
  /** Gemini for the agent: one final answer (no tool calls). Records each system prompt. */
  function agentReply(text: string) {
    process.env.GEMINI_API_KEY = "test-key";
    const systems: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        if (url.includes(":batchEmbedContents")) return new Response("{}", { status: 500 });
        const body = JSON.parse(init.body) as { systemInstruction?: { parts: { text: string }[] } };
        systems.push(body.systemInstruction?.parts[0]?.text ?? "");
        return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 50 } }), { status: 200 });
      }),
    );
    return systems;
  }

  async function askAgent(p: Person, text: string) {
    const conversationId = ulid();
    const sent = await p.as.action(api.aiAgent.send, { scope: p.scope, conversationId, text });
    return (await p.as.query(api.aiChat.get, { conversationId }))!.messages.find((m) => m.id === sent.messageId)!;
  }

  test("the offer comes off the answer and waits on the message; Save turns it into memory", async () => {
    const t = setup();
    const a = await person(t, "agent-mem@example.com");
    const systems = agentReply(`Nothing to change yet.\n${REMEMBER} {"kind": "instruction", "text": "Keep titles short"}`);
    const answer = await askAgent(a, "From now on keep my note titles short.");
    expect(systems.some((s) => s.includes(REMEMBER))).toBe(true);
    expect(answer.text).toBe("Nothing to change yet.");
    expect(answer.memory).toEqual({ kind: "instruction", text: "Keep titles short", status: "proposed" });
    expect(await t.run(async (ctx) => await ctx.db.query("aiMemories").collect())).toEqual([]);
    await a.as.mutation(api.aiMemory.saveProposal, { messageId: answer.id });
    const saved = await t.run(async (ctx) => await ctx.db.query("aiMemories").collect());
    expect(saved.map((m) => [m.kind, m.text, m.source])).toEqual([["instruction", "Keep titles short", "chat"]]);
  });

  test("memory off: the agent isn't told it may offer one, and a stray marker is left as text, not offered", async () => {
    const t = setup();
    const a = await person(t, "agent-mem-off@example.com");
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { memory: false } });
    const systems = agentReply(`Done.\n${REMEMBER} {"kind": "tone", "text": "Playful"}`);
    const answer = await askAgent(a, "Be playful.");
    expect(systems.every((s) => !s.includes(REMEMBER))).toBe(true);
    expect(answer.memory).toBeNull();
  });
});
