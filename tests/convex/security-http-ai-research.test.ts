// Deep research reads the notes a conversation is about. Those can live somewhere other than the conversation
// (a page someone shared from a Personal whose owner turned Foli AI off), and nothing from such a place is ever sent to AI, whoever
// asks. Chat named the notes to the gate; research didn't, so their text went into its prompts (security audit
// 2026-11-26, L2).
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, setup, ulid } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

const SECRET = "Orion merger terms";

/** Every request the server makes, with a plain Gemini answer for each model call. */
function network() {
  process.env.GEMINI_API_KEY = "test-key";
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: { body?: string } = {}) => {
      bodies.push(`${String(input)}\n${String(init.body ?? "")}`);
      if (String(input).includes(":batchEmbedContents")) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: ["one"] }) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } }), { status: 200 });
    }),
  );
  return bodies;
}

describe("deep research and notes from another place", { timeout: 60_000 }, () => {
  test("a note shared from a Personal with Foli AI turned off is never sent: the job is refused before any request", async () => {
    vi.useFakeTimers();
    const t = setup();
    const core = await person(t, "research-core@example.com");
    const guest = await person(t, "research-guest@example.com");
    await core.as.mutation(api.users.updateProfile, { aiEnabled: false });
    const { id: note } = await core.as.mutation(api.documents.create, { scope: core.scope, title: SECRET });
    await core.as.mutation(api.sharing.grant, { documentId: note, email: "research-guest@example.com", role: "viewer" });
    const bodies = network();

    const conversationId = ulid();
    const started = await guest.as.action(api.aiResearch.start, { scope: guest.scope, conversationId, text: "Research what this note is about", context: { kind: "note", ids: [note] } });
    expect(started.status).toBe("error");
    const [job] = await guest.as.query(api.aiResearch.forConversation, { conversationId });
    expect(job).toMatchObject({ status: "failed", error: { code: "forbidden", reason: "ai_not_included" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(bodies.filter((b) => b.includes(SECRET))).toEqual([]);
    expect(bodies).toEqual([]);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiCreditHolds").collect()).length)).toBe(0);
  });

  test("a note of the person's own still goes into the research", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "research-own@example.com");
    const { id: note } = await a.as.mutation(api.documents.create, { scope: a.scope, title: "Ferry plans for Friday" });
    const bodies = network();
    const started = await a.as.action(api.aiResearch.start, { scope: a.scope, conversationId: ulid(), text: "Research ferries", context: { kind: "note", ids: [note] } });
    expect(started.status).toBe("running");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(bodies.some((b) => b.includes("Ferry plans for Friday"))).toBe(true);
  });
});
