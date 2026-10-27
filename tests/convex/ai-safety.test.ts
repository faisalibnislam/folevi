// Foli AI's guardrails (docs/AI_GUARDRAILS.md): the safety rules and Gemini's filter on every request, the
// refusal marker taken out before anyone sees it, short refusals free, refusals counted without their text,
// and the pause after repeated harmful requests (convex/lib/ai/safety.ts).
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { systemWithSafety } from "../../convex/lib/ai/gemini";
import { DECLINE_RULE, SAFETY_RULE } from "@folevi/ai-prompts/safety";
import { person, PERSONAL, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

function geminiReply(text: string, finishReason = "STOP") {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: text ? [{ text }] : [] }, finishReason }], usageMetadata: { promptTokenCount: 30_000, candidatesTokenCount: 1000 } }), { status: 200 });
}

const used = async (p: Person) => (await p.as.query(api.billing.credits, { scope: PERSONAL })).used;
const counts = (t: T) => t.run(async (ctx) => ctx.db.query("aiSafetyCounts").collect());

/** Answers every Gemini call with `text`, keeping the request bodies. */
function stubGemini(text: string | (() => string), finishReason = "STOP") {
  process.env.GEMINI_API_KEY = "test-key";
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return geminiReply(typeof text === "string" ? text : text(), finishReason);
    }),
  );
  return bodies;
}

const write = (p: Person) => p.as.action(api.ai.write, { scope: p.scope, task: "draft", instruction: "Write something" });

describe("every request carries the rules", () => {
  test("the safety rules end the system prompt, with Gemini's filter set explicitly", async () => {
    const t = setup();
    const a = await person(t, "rules@example.com");
    const bodies = stubGemini("A draft.");
    await write(a);
    const body = bodies[0] as { systemInstruction: { parts: { text: string }[] }; safetySettings: { category: string; threshold: string }[] };
    const system = body.systemInstruction.parts[0]!.text;
    expect(system.endsWith(`${SAFETY_RULE} ${DECLINE_RULE}`)).toBe(true);
    expect(body.safetySettings.map((s) => s.category).sort()).toEqual(["HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT"]);
    expect(body.safetySettings.every((s) => s.threshold === "BLOCK_MEDIUM_AND_ABOVE")).toBe(true);
  });

  test("a JSON reply gets the rules but isn't asked for the marker", () => {
    expect(systemWithSafety({ system: "Make a chart.", json: true })).toBe(`Make a chart.\n\n${SAFETY_RULE}`);
    expect(systemWithSafety({ system: "Write." })).toBe(`Write.\n\n${SAFETY_RULE} ${DECLINE_RULE}`);
  });
});

describe("refusals", () => {
  test("a short refusal is shown without its marker, isn't charged, and is counted without its text", async () => {
    const t = setup();
    const a = await person(t, "refuse@example.com");
    stubGemini("I can't help with making that. I can share general safety information instead.\n[[declined:harmful]]");
    const { text } = await write(a);
    expect(text).toBe("I can't help with making that. I can share general safety information instead.");
    expect(await used(a)).toBe(0);
    const rows = await counts(t);
    expect(rows).toMatchObject([{ kind: "harmful", count: 1 }]);
    expect(JSON.stringify(rows)).not.toMatch(/help with|information|making/i);
    // A second one adds to the day's count.
    await write(a);
    expect((await counts(t))[0]!.count).toBe(2);
  });

  test("a long answer that carries a marker is still charged (a question can't buy free answers), and still counted", async () => {
    const t = setup();
    const a = await person(t, "long@example.com");
    stubGemini(`${"A full answer. ".repeat(120)}\n[[declined:other]]`);
    const { text } = await write(a);
    expect(text).not.toContain("[[declined");
    expect(await used(a)).toBeGreaterThan(0);
    expect(await counts(t)).toMatchObject([{ kind: "other", count: 1 }]);
  });

  test("a reply Gemini's filter blocked says so, isn't charged, and counts as filtered", async () => {
    const t = setup();
    const a = await person(t, "filtered@example.com");
    stubGemini("", "SAFETY");
    await expect(write(a)).rejects.toThrow(/couldn't help with that request/);
    expect(await used(a)).toBe(0);
    expect(await counts(t)).toMatchObject([{ kind: "filtered", count: 1 }]);
  });

  test("a streamed refusal never shows the marker, even half-arrived", async () => {
    const t = setup();
    const a = await person(t, "stream@example.com");
    process.env.GEMINI_API_KEY = "test-key";
    const pieces = ["I can't help with that.", "\n[[decl", "ined:harm", "ful]]"];
    const sse = pieces.map((p, i) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] }, ...(i === pieces.length - 1 ? { finishReason: "STOP" } : {}) }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } })}\r\n\r\n`).join("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    const seen: string[] = [];
    const streamId = await a.as.mutation(api.ai.startStream, {});
    const watch = setInterval(() => void t.run(async (ctx) => ctx.db.get(streamId as Id<"aiStreams">)).then((r) => r && seen.push(r.text)), 1);
    const { text } = await a.as.action(api.ai.write, { scope: a.scope, task: "draft", instruction: "x", streamId });
    clearInterval(watch);
    expect(text).toBe("I can't help with that.");
    for (const s of seen) expect(s).not.toMatch(/\[\[|\[$/);
    expect(await used(a)).toBe(0);
  });
});

describe("the pause", () => {
  const begin = (p: Person) => p.as.mutation(internal.ai.begin, { scope: PERSONAL });
  const refuse = async (t: T, p: Person, kind: "harmful" | "crisis", feature?: "digests") => {
    const { holdId } = await p.as.mutation(internal.ai.begin, { scope: PERSONAL, ...(feature ? { feature } : {}) });
    await t.mutation(internal.ai.settle, { holdId, calls: [{ model: "gemini-3.8-flash", promptTokens: 100, outputTokens: 10, thoughtsTokens: 0, refused: { kind, free: true } }] });
  };

  test("5 harmful refusals in an hour pause Foli AI for 24 hours; crisis and background work never do", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 27, 10));
    const t = setup();
    const a = await person(t, "pause@example.com");
    for (let i = 0; i < 6; i++) await refuse(t, a, "crisis");
    for (let i = 0; i < 6; i++) await refuse(t, a, "harmful", "digests");
    for (let i = 0; i < 4; i++) await refuse(t, a, "harmful");
    await begin(a);
    // Spread over more than an hour: still no pause.
    vi.setSystemTime(Date.UTC(2026, 9, 27, 11, 30));
    await refuse(t, a, "harmful");
    await begin(a);
    for (let i = 0; i < 4; i++) await refuse(t, a, "harmful");
    await expect(begin(a)).rejects.toThrow(/Foli AI is paused on your account until/);
    // A day later it works again.
    vi.setSystemTime(Date.UTC(2026, 9, 28, 11, 31));
    await begin(a);
  });

  test("an owner can lift a pause, which is in the admin log; others can't see the endpoint", async () => {
    const t = setup();
    const a = await person(t, "paused@example.com");
    const owner = await person(t, "owner@example.com");
    const ops = await person(t, "ops@example.com");
    await t.run(async (ctx) => {
      await ctx.db.patch(owner.profileId as Id<"profiles">, { platformRole: "super_admin" });
      await ctx.db.patch(ops.profileId as Id<"profiles">, { platformRole: "ops_admin" });
    });
    for (let i = 0; i < 5; i++) await refuse(t, a, "harmful");
    await expect(begin(a)).rejects.toThrow(/paused/);
    const view = await owner.as.mutation(api.admin.viewUser, { profileId: a.profileId });
    expect(view.aiSafety.pausedUntil).toBeGreaterThan(Date.now());
    expect(view.aiSafety.refusals.harmful).toBe(5);
    await expect(ops.as.mutation(api.admin.liftAiPause, { profileId: a.profileId, reason: "Reviewed: a crime novel" })).rejects.toThrow(/not_found|Not found/);
    await owner.as.mutation(api.admin.liftAiPause, { profileId: a.profileId, reason: "Reviewed: a crime novel" });
    await begin(a);
    const log = await t.run(async (ctx) => ctx.db.query("adminAuditLogs").collect());
    expect(log.some((l) => l.action === "user.ai_pause_lift" && l.targetId === a.profileId)).toBe(true);
    await expect(owner.as.mutation(api.admin.liftAiPause, { profileId: a.profileId, reason: "Again, by mistake" })).rejects.toThrow(/isn't paused/);
  });
});
