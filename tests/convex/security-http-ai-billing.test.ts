// A declined request is free only when it was nothing but one short refusal (security audit 2026-11-26, M7). The
// marker that makes a refusal free is text the model writes, so before this a whole agent run (several heavy
// calls and billed web searches) cost nothing when its short closing message carried the marker.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { billableCalls, creditsFor, type CallUsage } from "../../convex/lib/credits";
import { person, PERSONAL, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const MODEL = "gemini-3.8-flash";
const work = (searches = 0): CallUsage => ({ model: MODEL, promptTokens: 60_000, outputTokens: 4_000, thoughtsTokens: 0, ...(searches ? { searches } : {}) });
const shortRefusal = (kind: "other" | "harmful" = "other"): CallUsage => ({ model: MODEL, promptTokens: 60_000, outputTokens: 40, thoughtsTokens: 0, refused: { kind, free: true } });
const longRefusal: CallUsage = { model: MODEL, promptTokens: 60_000, outputTokens: 2_000, thoughtsTokens: 0, refused: { kind: "other", free: false } };

const used = async (p: Person) => (await p.as.query(api.billing.credits, { scope: PERSONAL })).used;

async function settle(t: T, p: Person, calls: CallUsage[]) {
  const before = await used(p);
  const { holdId } = await p.as.mutation(internal.ai.begin, { scope: PERSONAL });
  await t.mutation(internal.ai.settle, { holdId, calls });
  return (await used(p)) - before;
}

describe("what a refused request costs", { timeout: 30_000 }, () => {
  test("one short refusal and nothing else: free", async () => {
    const t = setup();
    const a = await person(t, "bill-single@example.com");
    expect(await settle(t, a, [shortRefusal()])).toBe(0);
  });

  test("an agent run that ends its closing message with the marker still pays for the work before it", async () => {
    const t = setup();
    const a = await person(t, "bill-run@example.com");
    const steps = [work(), work(2), work()];
    const cost = creditsFor(steps);
    expect(cost).toBeGreaterThan(0);
    // Before the fix this settled at 0.
    expect(await settle(t, a, [...steps, shortRefusal()])).toBe(cost);
    // A search first, then a normal answer after a marked call: the same.
    expect(await settle(t, a, [shortRefusal(), ...steps])).toBe(cost);
  });

  test("marking every step doesn't make the run free: one refusal at most is waived", async () => {
    const t = setup();
    const a = await person(t, "bill-every@example.com");
    const marked = [shortRefusal(), shortRefusal(), shortRefusal(), shortRefusal()];
    expect(billableCalls(marked)).toHaveLength(3);
    expect(await settle(t, a, marked)).toBe(creditsFor(marked.slice(0, 3)));
  });

  test("a long reply that carries a marker is charged, alone or with others; the refusal is still counted", async () => {
    const t = setup();
    const a = await person(t, "bill-long@example.com");
    expect(await settle(t, a, [longRefusal])).toBe(creditsFor([longRefusal]));
    expect(await settle(t, a, [work(), longRefusal])).toBe(creditsFor([work(), longRefusal]));
    expect(await settle(t, a, [work(), shortRefusal("harmful")])).toBe(creditsFor([work()]));
    const counts = await t.run(async (ctx) => ctx.db.query("aiSafetyCounts").collect());
    expect(counts.filter((c) => c.kind === "harmful").reduce((n, c) => n + c.count, 0)).toBe(1);
    expect(counts.filter((c) => c.kind === "other").reduce((n, c) => n + c.count, 0)).toBe(2);
  });

  test("no refusal: every call is charged, as before", () => {
    const calls = [work(), work(1)];
    expect(billableCalls(calls)).toBe(calls);
    expect(billableCalls([])).toEqual([]);
  });
});
