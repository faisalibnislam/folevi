// Foli AI routines (convex/routines.ts, lib/ai/routines.ts, docs/AI_ASSISTANT.md "Routines"): Pro and Pro AI
// only, the schedule, the estimate before turning one on, a Morning brief delivered under the Inbox with its
// spend recorded, nothing to report, the monthly cap, Open loops citing blocks, and where one may be saved.
// Gemini is a stubbed `fetch`.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { estimateCredits } from "../../convex/lib/credits";
import { MORNING_PLAN, OPEN_LOOPS_PLAN, nextPeriodLabel, periodKey, pickLoops, type LoopItem } from "../../convex/lib/ai/routines";
import { join, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const START = Date.UTC(2026, 9, 10, 6, 0); // Saturday 10 October 2026, 06:00 UTC
const DAY = 86_400_000;
const MODELS = { main: "gemini-3.8-flash", fast: "gemini-flash-lite-latest" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

const USAGE = { promptTokenCount: 4_000, candidatesTokenCount: 300 };
const BRIEF = "## Today\n- **Book the ferry** is due today.";
const INTRO = "Start with the ferry: it has waited longest.";

/** Stubs Gemini. Returns the calls made (prompt, system and the model in the URL). */
function gemini(text = BRIEF) {
  process.env.GEMINI_API_KEY = "test-key";
  const calls: { url: string; system: string; prompt: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { systemInstruction: { parts: { text: string }[] }; contents: { parts: { text: string }[] }[] };
      calls.push({ url: String(url), system: body.systemInstruction.parts[0]!.text, prompt: body.contents.at(-1)!.parts[0]!.text });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: USAGE }), { status: 200 });
    }),
  );
  return calls;
}

const rowOf = async (t: T, p: Person, kind: "morning" | "openLoops") =>
  (await t.run(async (ctx) =>
    ctx.db
      .query("routines")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">).eq("kind", kind))
      .unique(),
  ))!;

const notificationsOf = async (t: T, p: Person) =>
  await t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_profile_created", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
        .collect()
    ).filter((n) => n.kind === "system"),
  );

const holds = async (t: T) => await t.run(async (ctx) => (await ctx.db.query("aiCreditHolds").collect()).length);

const listed = async (p: Person, kind: "morning" | "openLoops") => (await p.as.query(api.routines.list, {})).routines.find((r) => r.kind === kind)!;

/** A note through sync, as the app writes one. Returns its id and its block's. */
async function note(p: Person, title: string, text: string) {
  const id = ulid();
  const blockId = ulid();
  await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-routines",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      { opId: ulid(), kind: "block.upsert", documentId: id, block: { id: blockId, type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text }], props: {} }, baseRevision: null, fields: ["content", "position"] },
    ] as never,
  });
  return { id, blockId };
}

/** Checks off the starter to-dos (the welcome note has one due on the day they joined). */
async function clearStarterTasks(t: T) {
  await t.run(async (ctx) => {
    for (const task of await ctx.db.query("tasks").collect()) await ctx.db.patch(task._id, { status: "done", completedAt: Date.now() });
  });
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

/** Someone with the Morning brief on whose starter notes are behind them. */
async function briefer(t: T, email: string) {
  const p = await person(t, email);
  await p.as.mutation(api.routines.save, { kind: "morning", enabled: true });
  vi.advanceTimersByTime(60_000);
  return p;
}

describe("who can have routines", () => {
  test("Core and Free are refused, and the list says routines need Pro or Pro AI", async () => {
    const t = setup();
    const core = await person(t, "routines-core@example.com");
    await core.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    await expect(core.as.mutation(api.routines.save, { kind: "morning", enabled: true })).rejects.toThrow(/Routines are part of Pro and Pro AI/);
    expect(await listed(core, "morning")).toMatchObject({ enabled: false, available: false, reason: "Routines are part of Pro and Pro AI." });

    const free = await person(t, "routines-free@example.com");
    await endTrial(t, free);
    await expect(free.as.mutation(api.routines.save, { kind: "openLoops", enabled: true })).rejects.toThrow(/Routines are part of Pro and Pro AI/);
    expect(await listed(free, "openLoops")).toMatchObject({ available: false });
    // Settings still save while it's off.
    await free.as.mutation(api.routines.save, { kind: "openLoops", hour: 10 });
    expect(await listed(free, "openLoops")).toMatchObject({ enabled: false, hour: 10, nextAt: null });

    // The trial counts as Pro AI; Pro itself too.
    const trial = await person(t, "routines-trial@example.com");
    expect(await listed(trial, "morning")).toMatchObject({ available: true, reason: null });
    const pro = await person(t, "routines-pro@example.com");
    await pro.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    expect((await pro.as.mutation(api.routines.save, { kind: "morning", enabled: true })).nextAt).not.toBeNull();
  });

  test("AI off: can't turn one on, and nothing runs", async () => {
    const t = setup();
    const p = await person(t, "routines-ai-off@example.com");
    await p.as.mutation(api.routines.save, { kind: "morning", enabled: true });
    await p.as.mutation(api.users.updateProfile, { aiEnabled: false });
    expect(await listed(p, "morning")).toMatchObject({ enabled: false, available: false, reason: "Turn on Foli AI first." });
    await expect(p.as.mutation(api.routines.save, { kind: "openLoops", enabled: true })).rejects.toThrow(/Turn on Foli AI/);
    vi.setSystemTime(Date.UTC(2026, 9, 10, 8, 5));
    expect(await t.mutation(internal.routines.due, {})).toEqual({ started: 0 });
    expect((await rowOf(t, p, "morning")).nextAt).toBeUndefined();
  });

  test("a workspace member can't save a routine where they can't add pages", async () => {
    const t = setup();
    const owner = await person(t, "routines-ws-owner@example.com");
    const viewer = await person(t, "routines-ws-viewer@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Studio");
    await join(t, owner, viewer, "routines-ws-viewer@example.com", workspaceId, "viewer");
    await expect(viewer.as.mutation(api.routines.save, { kind: "morning", enabled: true, scope })).rejects.toThrow();
    expect(await listed(viewer, "morning")).toMatchObject({ enabled: false, context: { kind: "personal" } });
    // The owner can.
    await owner.as.mutation(api.routines.save, { kind: "morning", enabled: true, scope });
    expect(await listed(owner, "morning")).toMatchObject({ enabled: true, context: { kind: "workspace", workspaceId, name: "Studio" } });
  });
});

describe("settings", () => {
  test("turning one on sets when it's next due; the limit is one of the choices", async () => {
    const t = setup();
    const p = await person(t, "routines-schedule@example.com");
    expect(await p.as.mutation(api.routines.save, { kind: "morning", enabled: true })).toEqual({ nextAt: Date.UTC(2026, 9, 10, 8) });
    // Open loops: Monday at 09:00 (10 October 2026 is a Saturday).
    expect(await p.as.mutation(api.routines.save, { kind: "openLoops", enabled: true })).toEqual({ nextAt: Date.UTC(2026, 9, 12, 9) });
    expect(await p.as.mutation(api.routines.save, { kind: "openLoops", weekday: 3, hour: 17 })).toEqual({ nextAt: Date.UTC(2026, 9, 14, 17) });
    expect(await listed(p, "openLoops")).toMatchObject({ enabled: true, weekday: 3, hour: 17, monthlyCap: 30, nextAt: Date.UTC(2026, 9, 14, 17) });
    await p.as.mutation(api.routines.save, { kind: "openLoops", monthlyCap: 60 });
    expect((await listed(p, "openLoops")).monthlyCap).toBe(60);
    await expect(p.as.mutation(api.routines.save, { kind: "openLoops", monthlyCap: 45 })).rejects.toThrow(/monthly limit/);
    await expect(p.as.mutation(api.routines.save, { kind: "morning", hour: 24 })).rejects.toThrow(/hour/);
    expect(await p.as.mutation(api.routines.save, { kind: "morning", enabled: false })).toEqual({ nextAt: null });
    expect((await rowOf(t, p, "morning")).nextAt).toBeUndefined();
  });

  test("the estimate before turning one on: credits a run and the most a month", async () => {
    const t = setup();
    const p = await person(t, "routines-estimate@example.com");
    const morning = await listed(p, "morning");
    const perRun = estimateCredits(MORNING_PLAN, MODELS);
    expect(perRun).toBeGreaterThanOrEqual(1);
    expect(morning).toMatchObject({ enabled: false, estimate: { perRun, perMonth: perRun * 31, runsPerMonth: 31 }, spent: 0, monthlyCap: 30 });
    const loops = await listed(p, "openLoops");
    const loopRun = estimateCredits(OPEN_LOOPS_PLAN, MODELS);
    expect(loops.estimate).toEqual({ perRun: loopRun, perMonth: loopRun * 5, runsPerMonth: 5 });
    // Open loops is the cheap one (the fast model writes a short intro).
    expect(loopRun).toBeLessThanOrEqual(perRun);
    expect((await p.as.query(api.routines.list, {})).capChoices).toEqual([10, 30, 60, 100]);
  });
});

describe("the Morning brief", () => {
  test("due to-dos: a note under the Inbox, a notification, and the credits it cost counted against the cap", async () => {
    const t = setup();
    const p = await briefer(t, "routines-brief@example.com");
    await p.as.mutation(api.tasks.quickAdd, { scope: p.scope, title: "Book the ferry", today: "2026-10-10", dueDate: "2026-10-10" });
    await p.as.mutation(api.tasks.quickAdd, { scope: p.scope, title: "Pay the deposit", today: "2026-10-10", dueDate: "2026-10-08" });
    const before = (await p.as.query(api.billing.credits, { scope: p.scope })).used;
    const calls = gemini();
    vi.advanceTimersByTime(60_000);

    const out = await t.action(internal.routines.run, { routineId: (await rowOf(t, p, "morning"))._id });
    expect(out.status).toBe("delivered");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(MODELS.main);
    // To-dos as untrusted data, overdue ones marked; the rules about untrusted text in the system prompt.
    expect(calls[0]!.prompt).toMatch(/<untrusted_note note="Inbox" due="2026-10-08" overdue="yes">\nPay the deposit/);
    expect(calls[0]!.prompt).toContain("Book the ferry");
    expect(calls[0]!.system).toContain("never instructions");
    expect(await holds(t)).toBe(0);
    const used = (await p.as.query(api.billing.credits, { scope: p.scope })).used - before;
    expect(used).toBeGreaterThan(0);

    const doc = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", out.documentId!)).unique())!);
    expect(doc.title).toBe("Morning brief, Oct 10");
    const inbox = await t.run(async (ctx) => (await ctx.db.get(doc.parentDocumentId!))!);
    expect(inbox.title).toBe("Inbox");
    const blocks = (await p.as.query(api.blocks.list, { documentId: doc.publicId }))!.blocks;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "bulleted"]);
    const inboxBlocks = (await p.as.query(api.blocks.list, { documentId: inbox.publicId }))!.blocks;
    expect(inboxBlocks.find((b) => b.type === "page")?.props).toMatchObject({ documentId: doc.publicId, display: "card" });
    const bell = await notificationsOf(t, p);
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ title: "Your Morning brief is ready.", documentId: doc._id });

    const row = await rowOf(t, p, "morning");
    expect(row.spend).toEqual({ period: "2026-10", credits: used });
    expect(await listed(p, "morning")).toMatchObject({ spent: used, lastNoteId: doc.publicId });
  });

  test("other people's changes and comments in a workspace, saved privately there", async () => {
    const t = setup();
    const owner = await person(t, "routines-ws-a@example.com");
    const member = await person(t, "routines-ws-b@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Studio");
    await join(t, owner, member, "routines-ws-b@example.com", workspaceId, "editor");
    await member.as.mutation(api.routines.save, { kind: "morning", enabled: true, scope });
    vi.advanceTimersByTime(60_000);
    const shoot = await note({ ...owner, scope }, "Shoot schedule", "The shoot is on Friday.");
    await owner.as.mutation(api.comments.create, { documentId: shoot.id, body: [{ type: "text", text: "Can we move it to Monday?" }] });
    const calls = gemini();
    vi.advanceTimersByTime(60_000);

    const out = await t.action(internal.routines.run, { routineId: (await rowOf(t, member, "morning"))._id });
    expect(out.status).toBe("delivered");
    expect(calls[0]!.prompt).toMatch(/<untrusted_note title="Shoot schedule" changed_by="routines-ws-a">/);
    expect(calls[0]!.prompt).toMatch(/comment_by="routines-ws-a"[^>]*>\nCan we move it to Monday\?/);
    const doc = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", out.documentId!)).unique())!);
    expect(doc.accessMode).toBe("restricted");
    expect(doc.workspaceId).toBeDefined();
    const blocks = (await member.as.query(api.blocks.list, { documentId: doc.publicId }))!.blocks;
    expect(blocks.at(-1)!.text[0]).toMatchObject({ type: "pageLink", documentId: shoot.id });
  });

  test("nothing to report: no note, no model call, nothing spent", async () => {
    const t = setup();
    const p = await briefer(t, "routines-quiet@example.com");
    await clearStarterTasks(t);
    // Their own edits aren't news to them.
    await note(p, "Ferry times", "The ferry leaves at nine.");
    const calls = gemini();
    expect(await t.action(internal.routines.run, { routineId: (await rowOf(t, p, "morning"))._id })).toEqual({ status: "skipped", reason: "empty" });
    expect(calls).toHaveLength(0);
    expect(await holds(t)).toBe(0);
    expect((await rowOf(t, p, "morning")).spend).toBeUndefined();
    expect(await notificationsOf(t, p)).toEqual([]);
  });

  test("the cap reached: skipped before anything is read, told once, and Run now refuses", async () => {
    const t = setup();
    const p = await briefer(t, "routines-cap@example.com");
    await p.as.mutation(api.tasks.quickAdd, { scope: p.scope, title: "Book the ferry", today: "2026-10-10", dueDate: "2026-10-10" });
    const row = await rowOf(t, p, "morning");
    await t.run(async (ctx) => ctx.db.patch(row._id, { spend: { period: "2026-10", credits: 29 } }));
    const calls = gemini();
    expect(await t.action(internal.routines.run, { routineId: row._id })).toEqual({ status: "skipped", reason: "cap" });
    expect(await t.action(internal.routines.run, { routineId: row._id })).toEqual({ status: "skipped", reason: "cap" });
    expect(calls).toHaveLength(0);
    expect(await holds(t)).toBe(0);
    expect((await notificationsOf(t, p)).map((n) => n.title)).toEqual([
      "Your Morning brief is paused until November 1: it reached its monthly limit of 30 credits. Raise the limit in Settings > AI.",
    ]);
    await expect(p.as.mutation(api.routines.runNow, { kind: "morning" })).rejects.toThrow(/monthly limit of 30 credits/);

    // A higher limit: it runs again.
    await p.as.mutation(api.routines.save, { kind: "morning", monthlyCap: 60 });
    expect((await t.action(internal.routines.run, { routineId: row._id })).status).toBe("delivered");
    // A new month starts from zero.
    expect(periodKey(Date.UTC(2026, 10, 1, 1), "UTC")).toBe("2026-11");
    expect(periodKey(Date.UTC(2026, 9, 31, 23), "Asia/Tokyo")).toBe("2026-11");
    expect(nextPeriodLabel("2026-12", "en-GB")).toBe("1 January");
  });

  test("the cron starts due ones once and moves them on; Run now schedules one", async () => {
    const t = setup();
    const p = await briefer(t, "routines-cron@example.com");
    await p.as.mutation(api.tasks.quickAdd, { scope: p.scope, title: "Book the ferry", today: "2026-10-10", dueDate: "2026-10-10" });
    const calls = gemini();
    expect(await t.mutation(internal.routines.due, {})).toEqual({ started: 0 });
    vi.setSystemTime(Date.UTC(2026, 9, 10, 8, 5));
    expect(await t.mutation(internal.routines.due, {})).toEqual({ started: 1 });
    expect((await rowOf(t, p, "morning")).nextAt).toBe(Date.UTC(2026, 9, 11, 8));
    expect(await t.mutation(internal.routines.due, {})).toEqual({ started: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);

    await p.as.mutation(api.routines.runNow, { kind: "morning" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await notificationsOf(t, p)).filter((n) => n.title === "Your Morning brief is ready.")).toHaveLength(2);
    await expect(p.as.mutation(api.routines.runNow, { kind: "openLoops" })).rejects.toThrow(/Turn the routine on/);
  });
});

describe("Open loops", () => {
  test("an old open to-do and a question left in a note, each linking to its block", async () => {
    const t = setup();
    const p = await person(t, "routines-loops@example.com");
    // Pro, so the week that passes doesn't end a trial.
    await p.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    await p.as.mutation(api.routines.save, { kind: "openLoops", enabled: true });
    await clearStarterTasks(t);
    const todo = await p.as.mutation(api.tasks.quickAdd, { scope: p.scope, title: "Renew the passport", today: "2026-10-10" });
    vi.advanceTimersByTime(8 * DAY);
    const plan = await note(p, "Trip plan", "Should we take the early ferry?");
    const calls = gemini(INTRO);
    vi.advanceTimersByTime(60_000);

    const out = await t.action(internal.routines.run, { routineId: (await rowOf(t, p, "openLoops"))._id });
    expect(out.status).toBe("delivered");
    // One short call on the fast model, with the items as untrusted data.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(MODELS.fast);
    expect(calls[0]!.prompt).toMatch(/<untrusted_note item="1" kind="old open to-do" note="Inbox" detail="open since 2026-10-10">\nRenew the passport/);

    const doc = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", out.documentId!)).unique())!);
    expect(doc.title).toBe("Open loops, Oct 18");
    const blocks = (await p.as.query(api.blocks.list, { documentId: doc.publicId }))!.blocks;
    expect(blocks[0]!.text[0]).toMatchObject({ type: "text", text: INTRO });
    const bullets = blocks.filter((b) => b.type === "bulleted");
    expect(bullets[0]!.text).toEqual([
      { type: "text", text: "Renew the passport", marks: [{ type: "link", href: `/d/${todo.documentId}#block-${todo.blockId}` }] },
      { type: "text", text: " (open since 2026-10-10), in Inbox" },
    ]);
    expect(bullets.some((b) => (b.text[0] as { marks?: { href: string }[] }).marks?.[0]?.href === `/d/${plan.id}#block-${plan.blockId}`)).toBe(true);
    expect(blocks.filter((b) => b.type === "heading").map((b) => (b.text[0] as { text: string }).text)).toEqual(["Open for a while", "Questions"]);
    expect((await notificationsOf(t, p)).map((n) => n.title)).toContain("Your Open loops are ready.");

    // Its own note (it quotes the question) isn't read as a question next time.
    const again = gemini(INTRO);
    vi.advanceTimersByTime(60_000);
    await t.action(internal.routines.run, { routineId: (await rowOf(t, p, "openLoops"))._id });
    expect(again[0]!.prompt.match(/Should we take the early ferry\?/g)).toHaveLength(1);
  });

  test("a contradiction from the graph, citing the line in the note", async () => {
    const t = setup();
    const p = await person(t, "routines-loops-graph@example.com");
    await p.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    await p.as.mutation(api.routines.save, { kind: "openLoops", enabled: true });
    await clearStarterTasks(t);
    const a = await note(p, "Launch plan", "The launch is on 3 November.");
    const b = await note(p, "Team update", "The launch moved to 10 November.");
    await t.run(async (ctx) => {
      const doc = async (id: string) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!._id;
      await ctx.db.insert("aiRelations", { ownerProfileId: p.profileId as Id<"profiles">, kind: "contradicts", inferred: true, sourceDocumentId: await doc(a.id), sourceBlockId: a.blockId, toDocumentId: await doc(b.id), targetBlockId: b.blockId, createdAt: Date.now() });
    });
    // Past the starter notes' questions (and these notes' edits): only the contradiction is left.
    vi.advanceTimersByTime(31 * DAY);
    gemini(INTRO);
    const out = await t.action(internal.routines.run, { routineId: (await rowOf(t, p, "openLoops"))._id });
    expect(out.status).toBe("delivered");
    // Read directly: the session from a month ago has ended.
    const bullet = await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", out.documentId!)).unique())!;
      return (await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect()).find((x) => x.type === "bulleted")!;
    });
    expect(bullet.text).toEqual([
      { type: "text", text: "The launch is on 3 November.", marks: [{ type: "link", href: `/d/${a.id}#block-${a.blockId}` }] },
      { type: "text", text: ' (disagrees with "The launch moved to 10 November." in Team update), in Launch plan' },
    ]);
  });

  test("nothing open: skipped quietly, nothing spent", async () => {
    const t = setup();
    const p = await person(t, "routines-loops-none@example.com");
    await p.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    await p.as.mutation(api.routines.save, { kind: "openLoops", enabled: true });
    await clearStarterTasks(t);
    // The starter notes' questions are older than the 30 days looked at.
    vi.advanceTimersByTime(31 * DAY);
    const calls = gemini(INTRO);
    expect(await t.action(internal.routines.run, { routineId: (await rowOf(t, p, "openLoops"))._id })).toEqual({ status: "skipped", reason: "empty" });
    expect(calls).toHaveLength(0);
    expect(await holds(t)).toBe(0);
    expect((await rowOf(t, p, "openLoops")).spend).toBeUndefined();
  });

  test("picking: one of each kind in turn, at most seven, each block once", () => {
    const item = (kind: LoopItem["kind"], n: number): LoopItem => ({ kind, noteId: "n", noteTitle: "N", blockId: `${kind}-${n}`, text: "x", detail: "" });
    const many = (kind: LoopItem["kind"]) => Array.from({ length: 5 }, (_, i) => item(kind, i));
    const picked = pickLoops([many("overdue"), many("stale"), [], many("question")]);
    expect(picked).toHaveLength(7);
    expect(picked.map((p) => p.kind)).toEqual(["overdue", "stale", "question", "overdue", "stale", "question", "overdue"]);
    expect(pickLoops([[item("overdue", 1)], [{ ...item("overdue", 1), kind: "stale" }]])).toHaveLength(1);
  });
});
