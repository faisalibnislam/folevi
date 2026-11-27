// Foli AI on the person's own key (lib/ai/ownKey.ts, docs/PRICING_PLAN.md "Bring your own AI"): the
// request goes to their provider with their key and model, no credits are held or charged on any plan,
// the hourly limit still applies, and the key is never written to the database, a scheduled function's
// arguments or the logs. Every reply comes from a stubbed `fetch`: no real key is used.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { person, PERSONAL, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
type Seen = { url: string; body: Record<string, unknown>; headers: Headers };

const ANTHROPIC_KEY = "sk-ant-api03-OWNKEYSECRET-0000000000000000-ABCD";
const OPENAI_KEY = "sk-proj-OWNKEYSECRET-11111111111111111111-EFGH";
const GEMINI_KEY = "AIzaSyOWNKEYSECRET222222222222222222";

function stub(reply: () => Response): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}, headers: new Headers(init?.headers) });
      return reply();
    }),
  );
  return seen;
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const claude = (text: string) =>
  json({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 } });
const openai = (text: string) =>
  json({
    id: "resp_1",
    object: "response",
    created_at: 0,
    model: "gpt-6.1-terra",
    status: "completed",
    output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1000 },
  });
const gemini = (text: string) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 50 } });

/** Every header a request carried, as one string (to find the key in, whichever header the SDK uses). */
const headersOf = (s: Seen) => JSON.stringify([...s.headers.entries()]);

async function endTrial(t: T, p: Person) {
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    await ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 });
  });
}

/** Everything the request could have left behind, as one string: the key must be in none of it. */
async function everythingStored(t: T): Promise<string> {
  return await t.run(async (ctx) => {
    const tables = ["aiCreditHolds", "aiCreditPeriods", "aiUsage", "aiProviderKeys", "aiMessages", "aiConversations", "aiStreams", "rateLimits", "systemSettings", "adminAuditLogs"] as const;
    const rows: unknown[] = [];
    for (const table of tables) rows.push(await ctx.db.query(table).collect());
    rows.push(await ctx.db.system.query("_scheduled_functions").collect());
    return JSON.stringify(rows);
  });
}

/** Captures every console line while `work` runs. */
async function logsDuring(work: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" "))));
  try {
    await work().catch(() => undefined);
  } finally {
    for (const s of spies) s.mockRestore();
  }
  return lines.join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

describe("Foli AI on your own key", () => {
  test("Free with no credits left: the request goes to Anthropic on the person's key and model, nothing is charged, and it counts as Your key", async () => {
    const t = setup();
    const a = await person(t, "own-free@example.com");
    await endTrial(t, a);
    const seen = stub(claude("A short summary."));
    const { text } = await a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Some notes to summarize.", ownKey: { provider: "anthropic", apiKey: ANTHROPIC_KEY, model: "claude-opus-5-5" } });
    expect(text).toBe("A short summary.");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(headersOf(seen[0]!)).toContain(ANTHROPIC_KEY);
    expect(seen[0]!.body.model).toBe("claude-opus-5-5");

    const usage = await a.as.query(api.billing.aiUsage, { scope: PERSONAL });
    expect(usage).toMatchObject({ used: 0, held: 0, total: 0, ownKeyRequests: 1 });
    const state = await t.run(async (ctx) => ({ holds: await ctx.db.query("aiCreditHolds").collect(), usage: await ctx.db.query("aiUsage").collect() }));
    expect(state.holds).toHaveLength(0);
    expect(state.usage[0]).toMatchObject({ count: 1, credits: 0, tokensIn: 1200 });
  });

  test("the key is never stored, scheduled or logged, also when the provider refuses it", async () => {
    const t = setup();
    const a = await person(t, "own-secret@example.com");
    stub(claude("Fine."));
    const ok = await logsDuring(() => a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Notes.", ownKey: { provider: "anthropic", apiKey: ANTHROPIC_KEY } }));
    expect(ok).not.toContain("OWNKEYSECRET");

    stub(json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));
    let message = "";
    const refused = await logsDuring(async () => {
      try {
        await a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Notes.", ownKey: { provider: "anthropic", apiKey: ANTHROPIC_KEY } });
      } catch (e) {
        message = JSON.stringify((e as { data?: unknown }).data ?? String(e));
      }
    });
    expect(message).toContain("Anthropic refused your key");
    expect(message).not.toContain("OWNKEYSECRET");
    expect(refused).not.toContain("OWNKEYSECRET");
    expect(await everythingStored(t)).not.toContain("OWNKEYSECRET");
  });

  test("Core, with no AI in its plan, uses Foli AI on its own key; without one it's still refused", async () => {
    const t = setup();
    const a = await person(t, "own-core@example.com");
    await t.run(async (ctx) => {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_profile", (q) => q.eq("profileId", a.profileId as Id<"profiles">))
        .unique();
      await ctx.db.patch(sub!._id, { plan: "core", status: "active", trialEndsAt: undefined });
    });
    process.env.GEMINI_API_KEY = "platform-key-not-used";
    const seen = stub(openai("Done."));
    await expect(a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Notes." })).rejects.toThrow();
    expect(seen).toHaveLength(0);
    const { text } = await a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Notes.", ownKey: { provider: "openai", apiKey: OPENAI_KEY } });
    expect(text).toBe("Done.");
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(headersOf(seen[0]!)).toContain(OPENAI_KEY);
    // No model picked: the default for the provider.
    expect(seen[0]!.body.model).toBe("gpt-6.1-sol");
  });

  test("Gemini on the person's key, never the platform's", async () => {
    const t = setup();
    const a = await person(t, "own-gemini@example.com");
    process.env.GEMINI_API_KEY = "platform-key-not-used";
    const seen = stub(gemini("Gemini summary."));
    await a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Notes.", ownKey: { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-3.8-flash" } });
    const call = seen.find((s) => s.url.includes("generativelanguage"))!;
    expect(call.url).toContain("gemini-3.8-flash");
    expect(`${call.url} ${headersOf(call)}`).toContain(GEMINI_KEY);
    expect(`${call.url} ${headersOf(call)}`).not.toContain("platform-key-not-used");
  });

  test("the hourly limit still applies to own-key requests", async () => {
    const t = setup();
    const a = await person(t, "own-limit@example.com");
    stub(claude("Ok."));
    await a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Notes.", ownKey: { provider: "anthropic", apiKey: ANTHROPIC_KEY } });
    const limits = await t.run(async (ctx) => await ctx.db.query("rateLimits").collect());
    expect(limits.some((l) => /^ai(High)?:/.test(l.bucket) && l.count === 1)).toBe(true);
  });

  test("an own-key hold never runs on Folevi's key, and a hold with credits never on someone's own key", async () => {
    const t = setup();
    const a = await person(t, "own-hold@example.com");
    const own = await a.as.mutation(internal.ai.begin, { scope: PERSONAL, ownKey: { provider: "anthropic" } });
    const hold = await t.run(async (ctx) => await ctx.db.get(own.holdId));
    expect(hold).toMatchObject({ credits: 0, ownKey: "anthropic" });
    expect(JSON.stringify(hold)).not.toContain("sk-");
    // Settling it charges nothing whatever the calls cost.
    expect(await t.mutation(internal.ai.settle, { holdId: own.holdId, calls: [{ model: "claude-opus-5-5", promptTokens: 900_000, outputTokens: 90_000, thoughtsTokens: 0 }] })).toEqual({ credits: 0, overrun: 0 });
    expect(await a.as.query(api.billing.aiUsage, { scope: PERSONAL })).toMatchObject({ used: 0, ownKeyRequests: 1 });
  });

  test("a key that doesn't look like one is refused without echoing it", async () => {
    const t = setup();
    const a = await person(t, "own-shape@example.com");
    const seen = stub(claude("Never."));
    const err = await a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "Notes.", ownKey: { provider: "anthropic", apiKey: "short key" } }).catch((e: { data: Record<string, unknown> }) => e.data);
    expect(err).toMatchObject({ code: "invalid_argument", message: "That doesn't look like a Anthropic key." });
    expect(JSON.stringify(err)).not.toContain("short key");
    expect(seen).toHaveLength(0);
  });

  test("Test key: one short call with the picked model; a refusal comes back in words", async () => {
    const t = setup();
    const a = await person(t, "own-test@example.com");
    const seen = stub(claude("OK"));
    expect(await a.as.action(api.ai.testOwnKey, { ownKey: { provider: "anthropic", apiKey: ANTHROPIC_KEY, model: "claude-haiku-5-5" } })).toEqual({ ok: true, model: "claude-haiku-5-5" });
    expect(seen[0]!.body.model).toBe("claude-haiku-5-5");
    stub(json({ error: { message: "Incorrect API key provided", type: "invalid_request_error" } }, 401));
    const res = await a.as.action(api.ai.testOwnKey, { ownKey: { provider: "openai", apiKey: OPENAI_KEY } });
    expect(res).toEqual({ ok: false, message: "OpenAI refused your key. Check it in Settings, Foli AI, Your own AI key." });
    expect(await everythingStored(t)).not.toContain("OWNKEYSECRET");
  });
});
