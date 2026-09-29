// AI credits: metering from Gemini's usage metadata, rounding, monthly periods, packs, refusals, the
// estimate held before a request, and the trial (docs/BILLING.md, convex/lib/credits.ts).
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CREDIT_NANO_USD, GEMINI_PRICES, costNano, creditsFor, estimateCredits, monthlyWindow } from "../../convex/lib/credits";
import { DAY_MS, addMonthsUtc } from "../../convex/lib/plans";
import { inWorkspace, person, PERSONAL, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
const FLASH = "gemini-3.8-flash";
const LITE = "gemini-flash-lite-latest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

async function endTrial(t: T, p: Person) {
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    await ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 });
  });
}

const balance = async (p: Person, scope = PERSONAL as typeof PERSONAL | ReturnType<typeof inWorkspace>) => await p.as.query(api.billing.credits, { scope });
/** Spends `credits` in an account the way a settled request does. */
async function spend(t: T, p: Person, promptTokens: number, outputTokens = 0, scope: typeof PERSONAL | ReturnType<typeof inWorkspace> = PERSONAL) {
  const { holdId } = await p.as.mutation(internal.ai.begin, { scope });
  return await t.mutation(internal.ai.settle, { holdId, calls: [{ model: FLASH, promptTokens, outputTokens, thoughtsTokens: 0 }] });
}

/** A Gemini reply (non-streaming) with usage metadata. */
function geminiReply(text: string, usage: { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount?: number }) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { ...usage, totalTokenCount: 0 } }), { status: 200 });
}

describe("pricing a request", () => {
  test("the rates live in one place, and 1 credit is $0.01 of Gemini cost, rounded up, at least 1", () => {
    expect(GEMINI_PRICES).toEqual({ flash: { inputNanoPerToken: 1500, outputNanoPerToken: 7500 }, flashLite: { inputNanoPerToken: 300, outputNanoPerToken: 2500 } });
    expect(CREDIT_NANO_USD).toBe(10_000_000);
    // 1M input tokens on Flash = $1.50 = 150 credits; 1M output = $7.50 = 750 credits.
    expect(creditsFor([{ model: FLASH, promptTokens: 1_000_000, outputTokens: 0, thoughtsTokens: 0 }])).toBe(150);
    expect(creditsFor([{ model: FLASH, promptTokens: 0, outputTokens: 1_000_000, thoughtsTokens: 0 }])).toBe(750);
    // Thinking tokens bill as output.
    expect(creditsFor([{ model: FLASH, promptTokens: 0, outputTokens: 500_000, thoughtsTokens: 500_000 }])).toBe(750);
    expect(creditsFor([{ model: LITE, promptTokens: 1_000_000, outputTokens: 1_000_000, thoughtsTokens: 0 }])).toBe(280);
    // Rounding is exact (integers): exactly 7 credits stays 7; a hair more is 8.
    expect(costNano([{ model: FLASH, promptTokens: 46_667, outputTokens: 0, thoughtsTokens: 0 }])).toBe(70_000_500);
    expect(creditsFor([{ model: FLASH, promptTokens: 0, outputTokens: 9_334, thoughtsTokens: 0 }])).toBe(8);
    expect(creditsFor([{ model: FLASH, promptTokens: 20_000, outputTokens: 5_333, thoughtsTokens: 0 }])).toBe(7);
    // Tiny requests still cost a credit; no call costs nothing.
    expect(creditsFor([{ model: LITE, promptTokens: 10, outputTokens: 5, thoughtsTokens: 0 }])).toBe(1);
    expect(creditsFor([])).toBe(0);
    // A request's calls are added before rounding.
    expect(creditsFor([{ model: LITE, promptTokens: 1000, outputTokens: 200, thoughtsTokens: 0 }, { model: FLASH, promptTokens: 12_000, outputTokens: 800, thoughtsTokens: 200 }])).toBe(3);
    // Unknown models are priced as Flash.
    expect(creditsFor([{ model: "gemini-some-new", promptTokens: 1_000_000, outputTokens: 0, thoughtsTokens: 0 }])).toBe(150);
  });

  test("the estimate is conservative: every planned call at its full input and maximum output", () => {
    const models = { main: FLASH, fast: LITE };
    expect(estimateCredits([{ fast: false, inputChars: 4000, maxOutputTokens: 2048 }], models)).toBe(2);
    expect(estimateCredits([{ fast: true, inputChars: 400, maxOutputTokens: 60 }], models)).toBe(1);
    expect(estimateCredits([{ fast: false, inputChars: 6000, maxOutputTokens: 6144 }], models)).toBe(5);
    expect(estimateCredits([], models)).toBe(0);
  });

  test("monthly windows follow the billing period's start, clamped to short months", () => {
    const jan31 = Date.UTC(2027, 0, 31, 12);
    expect(addMonthsUtc(jan31, 1)).toBe(Date.UTC(2027, 1, 28, 12));
    expect(monthlyWindow(jan31, Date.UTC(2027, 1, 10))).toEqual({ start: jan31, end: Date.UTC(2027, 1, 28, 12) });
    expect(monthlyWindow(jan31, Date.UTC(2027, 2, 1))).toEqual({ start: Date.UTC(2027, 1, 28, 12), end: Date.UTC(2027, 2, 31, 12) });
    // A yearly plan still resets monthly, from its start.
    const start = Date.UTC(2027, 3, 15);
    expect(monthlyWindow(start, Date.UTC(2027, 10, 20))).toEqual({ start: Date.UTC(2027, 10, 15), end: Date.UTC(2027, 11, 15) });
  });
});

describe("metering real requests", () => {
  test("a request is charged from Gemini's usage metadata; cheap tasks go to Flash-Lite; nothing about the text is stored", async () => {
    const t = setup();
    const a = await person(t, "meter@example.com");
    await endTrial(t, a);
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    process.env.GEMINI_API_KEY = "test-key";
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        // 30k prompt + 1k answer + 2k thinking on Flash: 45M + 22.5M = 67.5M nano-dollars = 7 credits.
        return url.includes("lite") ? geminiReply("Fixed text", { promptTokenCount: 300, candidatesTokenCount: 40 }) : geminiReply("A longer rewrite", { promptTokenCount: 30_000, candidatesTokenCount: 1000, thoughtsTokenCount: 2000 });
      }),
    );
    await a.as.action(api.ai.write, { scope: a.scope, task: "longer", text: "Secret draft text" });
    let b = await balance(a);
    expect(b).toMatchObject({ allowance: 180, used: 7, available: 173 });
    expect(urls[0]).toContain(`/${FLASH}:generateContent`);
    // Fixing spelling uses Flash-Lite: 1 credit.
    await a.as.action(api.ai.write, { scope: a.scope, task: "fix", text: "Secrit draft" });
    expect(urls[1]).toContain(`/${LITE}:generateContent`);
    b = await balance(a);
    expect(b.used).toBe(8);
    const usage = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ count: 2, credits: 8, tokensIn: 30_300, tokensOut: 3040, scope: "personal" });
    expect(JSON.stringify(usage)).not.toMatch(/draft|Fixed|rewrite/i);
    // No hold is left behind.
    expect(await t.run(async (ctx) => (await ctx.db.query("aiCreditHolds").collect()).length)).toBe(0);
  });

  test("a streamed answer is charged from the last usage metadata in the stream", async () => {
    const t = setup();
    const a = await person(t, "stream-meter@example.com");
    process.env.GEMINI_API_KEY = "test-key";
    const sse = [
      { candidates: [{ content: { parts: [{ text: "Hello" }] } }], usageMetadata: { promptTokenCount: 50_000, candidatesTokenCount: 2 } },
      { candidates: [{ content: { parts: [{ text: " there" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 50_000, candidatesTokenCount: 400, thoughtsTokenCount: 100 } },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`)
      .join("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    const streamId = await a.as.mutation(api.ai.startStream, {});
    const { text } = await a.as.action(api.ai.write, { scope: a.scope, task: "draft", instruction: "Say hello", streamId });
    expect(text).toBe("Hello there");
    // 50k × 1,500 + 500 × 7,500 = 78.75M nano-dollars: 8 credits (not the sum of the chunks).
    expect((await balance(a)).used).toBe(8);
  });

  test("a failed reply that Gemini still billed is charged; a refused request isn't", async () => {
    const t = setup();
    const a = await person(t, "failed@example.com");
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply("", { promptTokenCount: 20_000, candidatesTokenCount: 0 })));
    await expect(a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "x" })).rejects.toThrow(/returned nothing/);
    expect((await balance(a)).used).toBe(3);
    await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
    await expect(a.as.action(api.ai.write, { scope: a.scope, task: "summarize", text: "x" })).rejects.toThrow(/turned off/);
    expect((await balance(a)).used).toBe(3);
  });
});

describe("balances, periods and packs", () => {
  test("Free: 25 credits each calendar month (UTC), refused when they're gone, back next month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2027, 0, 20, 10));
    const t = setup();
    const a = await person(t, "free-credits@example.com");
    await endTrial(t, a);
    expect(await balance(a)).toMatchObject({ allowance: 25, available: 25, resetsAt: Date.UTC(2027, 1, 1), account: "personal" });
    await spend(t, a, 160_000); // 24 credits
    expect(await balance(a)).toMatchObject({ used: 24, available: 1, monthlyShareLeft: 1 / 25 });
    await spend(t, a, 1000); // 1 credit
    const err = await a.as.mutation(internal.ai.begin, { scope: PERSONAL }).catch((e: { data: Record<string, unknown> }) => e.data);
    expect(err).toMatchObject({ code: "out_of_credits", message: "You've used this month's AI credits. They reset on February 1. Upgrade for more in Settings → Plan & billing.", resetsAt: Date.UTC(2027, 1, 1), available: 0, action: "upgrade" });
    vi.setSystemTime(Date.UTC(2027, 1, 1, 0, 1));
    expect(await balance(a)).toMatchObject({ used: 0, available: 25, resetsAt: Date.UTC(2027, 2, 1) });
  });

  test("Pro: packs are used after the monthly credits, soonest-expiring first; expired ones don't count", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2027, 0, 10));
    const t = setup();
    const a = await person(t, "packs-order@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    await a.as.mutation(api.billing.testBuyCredits, { pack: "credits_500", scope: PERSONAL });
    vi.setSystemTime(Date.UTC(2027, 0, 11));
    await a.as.mutation(api.billing.testBuyCredits, { pack: "credits_1000", scope: PERSONAL });
    expect(await balance(a)).toMatchObject({ allowance: 180, packCredits: 1500, available: 1680, canBuy: true });
    await spend(t, a, 1_300_000); // 195 credits: 180 monthly, then 15 from the older pack
    const packs = await t.run(async (ctx) => (await ctx.db.query("aiCreditPacks").collect()).sort((x, y) => x.purchasedAt - y.purchasedAt));
    expect(packs.map((p) => p.remaining)).toEqual([485, 1000]);
    expect(await balance(a)).toMatchObject({ monthlyLeft: 0, packCredits: 1485 });
    // Packs last 12 months from purchase.
    expect(packs.map((p) => p.expiresAt)).toEqual([Date.UTC(2028, 0, 10), Date.UTC(2028, 0, 11)]);
    // An expired pack no longer counts (and isn't used).
    await t.run(async (ctx) => ctx.db.patch(packs[0]!._id, { expiresAt: Date.now() - 1 }));
    expect((await balance(a)).packCredits).toBe(1000);
    await spend(t, a, 10_000); // 2 credits: from the second pack
    expect(await t.run(async (ctx) => (await ctx.db.get(packs[0]!._id))!.remaining)).toBe(485);
    expect((await balance(a)).packCredits).toBe(998);
  });

  test("the estimate is held before a request: parallel requests can't spend the same credits", async () => {
    const t = setup();
    const a = await person(t, "holds@example.com");
    await endTrial(t, a);
    await spend(t, a, 140_000); // 21 of 25
    const plan = [{ fast: false, inputChars: 6000, maxOutputTokens: 6144 }]; // about 5 credits
    const err = await a.as.mutation(internal.ai.begin, { scope: PERSONAL, plan }).catch((e: { data: Record<string, unknown> }) => e.data);
    expect(err).toMatchObject({ code: "out_of_credits", available: 4, needed: 5 });
    expect(String(err.message)).toMatch(/^This needs about 5 AI credits and you have 4 left\./);
    // Two small requests at once: the first holds 1 credit… the balance shows it.
    const first = await a.as.mutation(internal.ai.begin, { scope: PERSONAL, plan: [{ fast: true, inputChars: 400, maxOutputTokens: 60 }] });
    expect(await balance(a)).toMatchObject({ held: 1, available: 3 });
    await t.mutation(internal.ai.settle, { holdId: first.holdId, calls: [] });
    expect(await balance(a)).toMatchObject({ held: 0, available: 4 });
    // Settling twice charges once.
    const second = await a.as.mutation(internal.ai.begin, { scope: PERSONAL });
    await t.mutation(internal.ai.settle, { holdId: second.holdId, calls: [{ model: LITE, promptTokens: 10, outputTokens: 10, thoughtsTokens: 0 }] });
    await t.mutation(internal.ai.settle, { holdId: second.holdId, calls: [{ model: LITE, promptTokens: 10, outputTokens: 10, thoughtsTokens: 0 }] });
    expect((await balance(a)).available).toBe(3);
  });

  test("a request that costs more than what's left takes the balance to zero and records the difference", async () => {
    const t = setup();
    const a = await person(t, "overrun@example.com");
    await endTrial(t, a);
    await spend(t, a, 146_667); // 23 credits (22.0 + a hair)
    expect((await balance(a)).available).toBe(2);
    await spend(t, a, 100_000); // 15 credits, 2 available
    expect((await balance(a)).available).toBe(0);
    const period = await t.run(async (ctx) => (await ctx.db.query("aiCreditPeriods").collect())[0]!);
    expect(period).toMatchObject({ used: 25, overrun: 13 });
  });

  test("the trial has 100 credits for its whole length; afterwards Free's 25 a month", async () => {
    const t = setup();
    const a = await person(t, "trial-credits@example.com");
    expect(await balance(a)).toMatchObject({ allowance: 100, trialing: true, plan: "Pro AI trial", canBuy: false });
    await spend(t, a, 600_000); // 90
    expect((await balance(a)).available).toBe(10);
    const err = await a.as.mutation(internal.ai.begin, { scope: PERSONAL, plan: [{ fast: false, inputChars: 400_000, maxOutputTokens: 2048 }] }).catch((e: { data: Record<string, unknown> }) => e.data);
    expect(err).toMatchObject({ code: "out_of_credits" });
    await endTrial(t, a);
    expect(await balance(a)).toMatchObject({ allowance: 25, available: 25, trialing: false });
  });

  test("a paid workspace seat: its own monthly credits and packs, 'buy more' when they're gone", async () => {
    const t = setup();
    const owner = await person(t, "seat-owner@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Seat credits" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    const ws = inWorkspace(id);
    expect(await balance(owner, ws)).toMatchObject({ account: "seat", allowance: 180, canBuy: true });
    await owner.as.mutation(api.billing.testBuyCredits, { pack: "credits_500", scope: ws });
    expect(await balance(owner, ws)).toMatchObject({ packCredits: 500, available: 680 });
    // Personal is separate: the pack isn't there.
    expect((await balance(owner, PERSONAL)).packCredits).toBe(0);
    await spend(t, owner, 4_600_000, 0, ws); // 690 credits
    const err = await owner.as.mutation(internal.ai.begin, { scope: ws }).catch((e: { data: Record<string, unknown> }) => e.data);
    expect(err).toMatchObject({ code: "out_of_credits", action: "buy" });
    expect(String(err.message)).toMatch(/You've used this month's AI credits in this workspace\. They reset on .+\. Buy more in Settings → Plan & billing\./);
    const accounts = await owner.as.query(api.billing.creditAccounts, {});
    expect(accounts.accounts.map((x) => [x.kind, x.name, x.available])).toEqual([
      ["personal", "Personal", 100],
      ["seat", "Seat credits", 0],
    ]);
  });
});
