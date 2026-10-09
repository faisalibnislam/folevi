// The usage card (Settings > AI; billing.aiUsage, lib/ai/usage.ts): every request names its feature when it
// holds credits, and when it settles the credits are counted under that feature and day in the credit
// account's period. A seat in a paid workspace shows the seat's own use. Gemini is a stubbed `fetch`.
import { readdirSync, readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AI_FEATURES, dayKey, usageBreakdown } from "../../convex/lib/ai/usage";
import { creditsFor } from "../../convex/lib/credits";
import { inWorkspace, join, person, PERSONAL, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
const FLASH = "gemini-3.8-flash";
const DAY = 86_400_000;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

const usage = async (p: Person, scope: typeof PERSONAL | ReturnType<typeof inWorkspace> = PERSONAL) => await p.as.query(api.billing.aiUsage, { scope });
const creditsOf = (u: Awaited<ReturnType<typeof usage>>, feature: string) => u.features.find((f) => f.feature === feature)?.credits ?? 0;

function reply(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20_000, candidatesTokenCount: 400 } }), { status: 200 });
}

/** Gemini for every path: search terms, a streamed answer, a title, and plain replies for writing. */
function gemini() {
  process.env.GEMINI_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      if (url.includes("streamGenerateContent")) return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "An answer." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20_000, candidatesTokenCount: 400 } })}\r\n\r\n`, { status: 200 });
      if (init.body.includes("full-text search queries")) return reply(JSON.stringify({ queries: ["plans"], act: false }));
      if (init.body.includes("You name conversations")) return reply("Plans");
      if (init.body.includes("flowchart")) return reply(JSON.stringify({ nodes: [{ id: "a", text: "Start", shape: "terminal" }, { id: "b", text: "End", shape: "terminal" }], connectors: [{ from: "a", to: "b" }] }));
      return reply("Better text.");
    }),
  );
}

async function endTrial(t: T, p: Person) {
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    await ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 });
  });
}

describe("the breakdown", () => {
  test("every feature in order (Other only when used), and every day of the period so far", () => {
    const start = Date.parse("2026-10-01T00:00:00Z");
    const out = usageBreakdown({ features: { chat: 4, digests: 2 }, days: { "2026-10-01": 1, "2026-10-03": 5 } }, { start, end: start + 31 * DAY }, Date.parse("2026-10-04T12:00:00Z"));
    expect(out.features.map((f) => f.feature)).toEqual(AI_FEATURES.filter((f) => f !== "other"));
    expect(out.features.find((f) => f.feature === "chat")).toEqual({ feature: "chat", label: "Chat", credits: 4 });
    expect(out.total).toBe(6);
    expect(out.days).toEqual([
      { day: "2026-10-01", credits: 1 },
      { day: "2026-10-02", credits: 0 },
      { day: "2026-10-03", credits: 5 },
      { day: "2026-10-04", credits: 0 },
    ]);
    // Credits from a request without a feature show as Other.
    expect(usageBreakdown({ features: { other: 3 } }, { start, end: start + DAY }, start).features.at(-1)).toMatchObject({ feature: "other", credits: 3 });
    // Nothing used yet: zeros, one day.
    expect(usageBreakdown(null, { start, end: start + 31 * DAY }, start + 1000)).toMatchObject({ total: 0, days: [{ day: "2026-10-01", credits: 0 }] });
    // A period that ended lists its days up to its end, not today.
    expect(usageBreakdown(null, { start, end: start + 2 * DAY }, start + 40 * DAY).days.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("recording use by feature", () => {
  test("a hold keeps its feature; settling counts the credits under it and today", async () => {
    const t = setup();
    const a = await person(t, "usage-hold@example.com");
    const calls = [{ model: FLASH, promptTokens: 100_000, outputTokens: 0, thoughtsTokens: 0 }];
    const { holdId } = await a.as.mutation(internal.ai.begin, { scope: PERSONAL, feature: "agent" });
    expect(await t.run(async (ctx) => (await ctx.db.get(holdId))!.feature)).toBe("agent");
    await t.mutation(internal.ai.settle, { holdId, calls });
    // A request that didn't say what it was for counts as Other.
    const other = await a.as.mutation(internal.ai.begin, { scope: PERSONAL });
    await t.mutation(internal.ai.settle, { holdId: other.holdId, calls });
    // Settling twice counts once.
    await t.mutation(internal.ai.settle, { holdId, calls });

    const u = await usage(a);
    const each = creditsFor(calls);
    expect(creditsOf(u, "agent")).toBe(each);
    expect(creditsOf(u, "other")).toBe(each);
    expect(u.total).toBe(2 * each);
    expect(u.days.at(-1)).toEqual({ day: dayKey(Date.now()), credits: 2 * each });
    // The card's numbers agree with the meter.
    expect(u).toMatchObject({ aiIncluded: true, account: "personal", place: "Personal", used: 2 * each, monthlyLeft: u.allowance - 2 * each });
    expect(u.resetsAt).toBeGreaterThan(Date.now());
    // No content anywhere: only numbers by feature and day.
    const row = await t.run(async (ctx) => (await ctx.db.query("aiCreditPeriods").collect())[0]!);
    expect(row.features).toEqual({ agent: each, other: each });
  });

  test("chat, Ask AI, writing and flowcharts count under their own features", async () => {
    const t = setup();
    const a = await person(t, "usage-paths@example.com");
    gemini();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "What are my plans?" });
    const chat = creditsOf(await usage(a), "chat");
    expect(chat).toBeGreaterThan(0);
    await a.as.action(api.ai.ask, { scope: a.scope, question: "What are my plans?" });
    expect(creditsOf(await usage(a), "chat")).toBeGreaterThan(chat);
    await a.as.action(api.ai.write, { scope: a.scope, task: "improve", text: "The color is nice." });
    const writing = creditsOf(await usage(a), "writing");
    expect(writing).toBeGreaterThan(0);
    await a.as.action(api.ai.flowchart, { scope: a.scope, mode: "create", instruction: "Ship a feature" });
    const u = await usage(a);
    expect(creditsOf(u, "writing")).toBeGreaterThan(writing);
    expect(creditsOf(u, "agent") + creditsOf(u, "research") + creditsOf(u, "digests") + creditsOf(u, "other")).toBe(0);
    expect(u.total).toBe(u.used);
  });

  test("a seat in a paid workspace shows the seat's use, not Personal's", async () => {
    const t = setup();
    const owner = await person(t, "usage-owner@example.com");
    const member = await person(t, "usage-member@example.com");
    await endTrial(t, member);
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Usage Co" });
    await join(t, owner, member, "usage-member@example.com", id, "editor");
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    const ws = inWorkspace(id);
    const { holdId } = await member.as.mutation(internal.ai.begin, { scope: ws, feature: "research" });
    await t.mutation(internal.ai.settle, { holdId, calls: [{ model: FLASH, promptTokens: 200_000, outputTokens: 0, thoughtsTokens: 0 }] });

    const seat = await usage(member, ws);
    expect(seat).toMatchObject({ account: "seat", place: "Usage Co", allowance: 180, used: 30 });
    expect(creditsOf(seat, "research")).toBe(30);
    // Their Personal is untouched.
    const personal = await usage(member, PERSONAL);
    expect(personal).toMatchObject({ account: "personal", place: "Personal", used: 0, total: 0 });
    // Someone else's seat in the same workspace has its own.
    expect(await usage(owner, ws)).toMatchObject({ account: "seat", used: 0, total: 0 });
  });

  test("every place that holds credits says what for", () => {
    const dir = pathJoin(__dirname, "../../convex");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    const missing: string[] = [];
    let found = 0;
    for (const f of files) {
      const s = readFileSync(pathJoin(dir, f), "utf8");
      for (const m of s.matchAll(/internal\.ai\.begin,\s*\{([^;]*?)\}\)/g)) {
        found++;
        if (!/feature:/.test(m[1]!)) missing.push(`${f}: ${m[0].slice(0, 60)}`);
      }
      for (const m of s.matchAll(/await holdFor\(([^;]*?)\);/g)) {
        found++;
        if (!/"(chat|agent|writing|research|attachments|transcription|digests)"/.test(m[1]!)) missing.push(`${f}: ${m[0].slice(0, 60)}`);
      }
    }
    // Chat, agent, research, Ask AI, writing, flowcharts, catch-up, translation, transcription and digests.
    expect(found).toBeGreaterThanOrEqual(10);
    expect(missing).toEqual([]);
  });
});
