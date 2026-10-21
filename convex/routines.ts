// Foli AI routines (docs/AI_ASSISTANT.md, "Routines"): scheduled jobs that write a note for the person,
// on Pro and Pro AI. Two kinds (lib/ai/routines.ts): the Morning brief (daily) and Open loops (weekly).
// They follow the digest's pattern (convex/aiDigest.ts) and share its helpers.
//
//   list, save:  Settings > AI. Off by default; turning one on (or changing its schedule) sets when it's next
//                due in the person's time zone. `list` also shows the estimate before it's on: credits a run
//                holds and the most a month could cost, and what it spent this month against its cap.
//   runNow:      starts one at once (still within its plan and cap; a few an hour).
//   due:         every 15 minutes, finds routines that are due, moves each on to its next time, and starts
//                a job per routine (spread out).
//   run:         the job. `start` checks everything first (routine and AI still on, able to add pages where
//                it's saved, a plan with routines, room left under the monthly cap), reads its material as
//                the person (only what they can open) and holds the credits (ai.holdFor). Nothing to report:
//                no note, nothing spent. Then one model call (metered), and `deliver` saves a new note under
//                the person's Inbox page there, with an in-app notification (and a web push) linking to it.
//                The credits the run really cost are added to the routine's spend for the month.
//
// Routines never edit existing notes. A skip (no plan with routines, out of credits, the cap reached, no
// longer able to add pages there, the model failed) is told once per reason in the bell, never by email.
// Note content is never emailed or logged. Turning a routine off (or AI off) stops it: nothing is scheduled,
// read or sent.
import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { markdownToBlocks, plainText, rankSequence, SCHEMA_VERSION, ulid, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, PageReader, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { aiAccountFor, estimateCredits } from "./lib/credits";
import { consume } from "./lib/rateLimit";
import { personalScope, vScopeArg, workspaceScope, type Scope } from "./lib/scope";
import { provider } from "./lib/ai/provider";
import { indexEligible } from "./lib/ai/indexing";
import { unfence } from "./lib/ai/writing";
import { localDay, nextDigestAt } from "./lib/ai/digest";
import {
  blockHref,
  CAP_CHOICES,
  DEFAULT_CAP,
  isQuestion,
  loopText,
  MAX_LOOPS,
  morningEmpty,
  MORNING_LIMITS,
  morningRequest,
  nextPeriodLabel,
  openLoopsRequest,
  periodKey,
  pickLoops,
  PLAN_NOTE,
  PROSE_BLOCKS,
  QUESTION_WINDOW_MS,
  ROUTINE_DEFAULTS,
  ROUTINE_KINDS,
  ROUTINE_NAMES,
  routinePlan,
  routineSchedule,
  routineTier,
  routineTitle,
  RUNS_PER_MONTH,
  spentIn,
  STALE_TODO_MS,
  type LoopItem,
  type LoopKind,
  type MorningMaterial,
  type RoutineKind,
} from "./lib/ai/routines";
import { holdFor, metered } from "./ai";
import { backgroundAiAllowed, encryptedPlace, isInboxOrDigest, placeOf, queueAiNote, saveToInbox } from "./aiDigest";
import { isSealed } from "./lib/e2ee/state";
import { sealedAiCopy } from "./lib/ai/indexing";
import { storedError } from "./aiChat";
import { contradictionItems, scopeContradictionRows } from "./aiGraph";
import { schedulePush } from "./lib/push";

type Ctx = QueryCtx | MutationCtx;

const vKind = v.union(v.literal("morning"), v.literal("openLoops"));
const vLoopItem = v.object({
  kind: v.union(v.literal("overdue"), v.literal("stale"), v.literal("question"), v.literal("contradiction")),
  noteId: v.string(),
  noteTitle: v.string(),
  blockId: v.string(),
  text: v.string(),
  detail: v.string(),
});
/** Routines started per cron run (the rest wait for the next run, which comes at once). */
const DUE_BATCH = 100;
/** Blocks a routine note may have. */
const MAX_NOTE_BLOCKS = 200;
/** The longest stretch a brief looks back over (a long gap isn't read in full). */
const MAX_LOOKBACK_MS = 2 * 24 * 60 * 60_000;
/** Notes looked in for questions, and the most questions taken from one. */
const QUESTION_NOTES = 10;
const QUESTIONS_PER_NOTE = 2;
/** Contradictions from the graph an Open loops note lists at most. */
const LOOP_CONTRADICTIONS = 3;

const rowOf = (ctx: Ctx, profileId: Id<"profiles">, kind: RoutineKind) =>
  ctx.db
    .query("routines")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId).eq("kind", kind))
    .unique();

/** Someone whose routine can still run: an account in use, AI on, the routine on. */
const wantsRoutine = (p: Doc<"profiles"> | null, row: Doc<"routines">): p is Doc<"profiles"> => Boolean(p && (p.status === "active" || p.status === "pending_deletion") && p.aiEnabled !== false && row.enabled);

/** The scope a routine is about: Personal, or its workspace. */
const scopeOf = (profile: Doc<"profiles">, workspaceId: Id<"workspaces"> | undefined): Scope => (workspaceId ? workspaceScope(workspaceId) : personalScope(profile._id));

/** Whether the plan whose credits pay in `scope` includes routines (Pro or Pro AI, a trial counting as Pro AI). */
async function routinesIncluded(ctx: Ctx, profile: Doc<"profiles">, scope: Scope): Promise<boolean> {
  const access = await aiAccountFor(ctx, profile, scope);
  return access.allowed && routineTier(access.account.tier);
}

/** Credits one run holds (the estimate shown before it's on). */
const perRun = (kind: RoutineKind) => estimateCredits(routinePlan(kind), provider().models());

const PLAN_REFUSAL = `${PLAN_NOTE} Upgrade in Settings > Plan & billing.`;
const capMessage = (kind: RoutineKind, cap: number, period: string, locale?: string) =>
  `Your ${ROUTINE_NAMES[kind]} is paused until ${nextPeriodLabel(period, locale)}: it reached its monthly limit of ${cap} credits. Raise the limit in Settings > AI.`;

// ---------------------------------------------------------------------------------------------------
// Settings > AI
// ---------------------------------------------------------------------------------------------------

/**
 * Both routines with their settings, the estimate (credits a run, the most a month), what each spent this
 * month against its cap, when it's next due, its last note, and whether the person's plan includes it.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const now = Date.now();
    const period = periodKey(now, profile.timeZone);
    const routines = [];
    for (const kind of ROUTINE_KINDS) {
      const row = await rowOf(ctx, profile._id, kind);
      let context: { kind: "personal" } | { kind: "workspace"; workspaceId: string; name: string } = { kind: "personal" };
      let workspaceId: Id<"workspaces"> | undefined;
      if (row?.workspaceId) {
        const ws = await ctx.db.get(row.workspaceId);
        if (ws && ws.status !== "deleting") {
          context = { kind: "workspace", workspaceId: ws.publicId, name: ws.name };
          workspaceId = ws._id;
        }
      }
      const aiOn = profile.aiEnabled !== false;
      const available = aiOn && (await routinesIncluded(ctx, profile, scopeOf(profile, workspaceId)));
      const last = row?.lastDocumentId ? await ctx.db.get(row.lastDocumentId) : null;
      const credits = perRun(kind);
      const enabled = Boolean(row?.enabled && aiOn);
      routines.push({
        kind,
        name: ROUTINE_NAMES[kind],
        enabled,
        hour: row?.hour ?? ROUTINE_DEFAULTS[kind].hour,
        weekday: row?.weekday ?? ROUTINE_DEFAULTS[kind].weekday,
        monthlyCap: row?.monthlyCap ?? DEFAULT_CAP,
        context,
        estimate: { perRun: credits, perMonth: credits * RUNS_PER_MONTH[kind], runsPerMonth: RUNS_PER_MONTH[kind] },
        spent: spentIn(row?.spend, period),
        nextAt: enabled ? (row?.nextAt ?? null) : null,
        lastNoteId: last && !last.inTrash && last.deletedAt === undefined ? last.publicId : null,
        available,
        reason: available ? null : aiOn ? PLAN_NOTE : "Turn on Foli AI first.",
      });
    }
    return { routines, capChoices: [...CAP_CHOICES], timeZone: profile.timeZone };
  },
});

/**
 * Turns a routine on or off and changes its schedule, monthly limit, or where it's about (Personal, or a
 * workspace where the person can add pages). Turning on needs Foli AI on and a plan with routines. Returns
 * when it's next due (null while off).
 */
export const save = mutation({
  args: {
    kind: vKind,
    enabled: v.optional(v.boolean()),
    hour: v.optional(v.number()),
    weekday: v.optional(v.number()),
    monthlyCap: v.optional(v.number()),
    scope: v.optional(vScopeArg),
  },
  handler: async (ctx, args): Promise<{ nextAt: number | null }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (args.hour !== undefined && !(Number.isInteger(args.hour) && args.hour >= 0 && args.hour <= 23)) fail("invalid_argument", "Pick an hour of the day.");
    if (args.weekday !== undefined && !(Number.isInteger(args.weekday) && args.weekday >= 0 && args.weekday <= 6)) fail("invalid_argument", "Pick a day of the week.");
    if (args.monthlyCap !== undefined && !(CAP_CHOICES as readonly number[]).includes(args.monthlyCap)) fail("invalid_argument", "Pick a monthly limit.");
    const row = await rowOf(ctx, profile._id, args.kind);
    let workspaceId = row?.workspaceId;
    if (args.scope) {
      // A routine writes a note there, so the person must be able to add pages.
      const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
      workspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
    }
    const enabled = args.enabled ?? row?.enabled ?? false;
    if (enabled && profile.aiEnabled === false) fail("forbidden", "Turn on Foli AI first.");
    if (enabled && !(await routinesIncluded(ctx, profile, scopeOf(profile, workspaceId)))) fail("forbidden", PLAN_REFUSAL, { reason: "routines_not_included" });
    const hour = args.hour ?? row?.hour ?? ROUTINE_DEFAULTS[args.kind].hour;
    const weekday = args.weekday ?? row?.weekday ?? ROUTINE_DEFAULTS[args.kind].weekday;
    const monthlyCap = args.monthlyCap ?? row?.monthlyCap ?? DEFAULT_CAP;
    const now = Date.now();
    const nextAt = enabled ? nextDigestAt(now, routineSchedule(args.kind, hour, weekday), profile.timeZone) : undefined;
    const fields = { workspaceId, hour, weekday, monthlyCap, enabled, nextAt, updatedAt: now };
    if (row) {
      const moved = row.workspaceId !== workspaceId;
      // A new place starts afresh; a new limit may be reached again, and is told again.
      await ctx.db.replace(row._id, { ...row, ...fields, ...(moved ? { lastAt: undefined, lastSkip: undefined } : {}), ...(row.monthlyCap !== monthlyCap ? { lastSkip: undefined } : {}) });
    } else {
      await ctx.db.insert("routines", { profileId: profile._id, kind: args.kind, ...fields, createdAt: now });
    }
    return { nextAt: nextAt ?? null };
  },
});

/** Starts a routine now (it must be on), within its plan and monthly limit. A few an hour. */
export const runNow = mutation({
  args: { kind: vKind },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (profile.aiEnabled === false) fail("forbidden", "Turn on Foli AI first.");
    const row = await rowOf(ctx, profile._id, args.kind);
    if (!row?.enabled) fail("invalid_argument", "Turn the routine on first.");
    const place = await placeOf(ctx, profile, row.workspaceId);
    if (!place) fail("forbidden", "You can't add pages where it's saved anymore. Pick another place.");
    if (!(await routinesIncluded(ctx, profile, place.scope))) fail("forbidden", PLAN_REFUSAL, { reason: "routines_not_included" });
    const period = periodKey(Date.now(), profile.timeZone);
    if (spentIn(row.spend, period) + perRun(args.kind) > row.monthlyCap) fail("forbidden", capMessage(args.kind, row.monthlyCap, period, profile.locale));
    await consume(ctx, "routineRunNow", profile._id);
    await ctx.scheduler.runAfter(0, internal.routines.run, { routineId: row._id });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------------------------------

/** Cron: starts the routines that are due, each moved on to its next time first (so it's never doubled). */
export const due = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("routines")
      .withIndex("by_next", (q) => q.gte("nextAt", 0).lte("nextAt", now))
      .take(DUE_BATCH);
    let started = 0;
    for (const row of rows) {
      const profile = await ctx.db.get(row.profileId);
      if (!wantsRoutine(profile, row)) {
        // Off: nothing more is scheduled until it's turned on again.
        await ctx.db.patch(row._id, { nextAt: undefined, updatedAt: now });
        continue;
      }
      await ctx.db.patch(row._id, { nextAt: nextDigestAt(now, routineSchedule(row.kind, row.hour, row.weekday), profile.timeZone), updatedAt: now });
      await ctx.scheduler.runAfter(started * 2_000, internal.routines.run, { routineId: row._id });
      started++;
    }
    if (rows.length === DUE_BATCH) await ctx.scheduler.runAfter(started * 2_000, internal.routines.due, {});
    if (started) console.log(JSON.stringify({ event: "ai.routines_due", started }));
    return { started };
  },
});

// ---------------------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------------------

type Skip = "off" | "plan" | "credits" | "access" | "busy" | "error" | "cap";

const SKIP_TITLES: Record<Exclude<Skip, "off" | "busy" | "cap">, (name: string) => string> = {
  plan: (n) => `Your ${n} was skipped: routines are part of Pro and Pro AI.`,
  credits: (n) => `Your ${n} was skipped: you're out of AI credits.`,
  access: (n) => `Your ${n} was skipped: you can't add pages where it's saved anymore. Pick another place in Settings > AI.`,
  error: (n) => `Your ${n} couldn't be written this time. It will try again next time.`,
};

/** Records a skip, and tells the person once per reason (the cap: once a month), in the bell only. */
async function skip(ctx: MutationCtx, row: Doc<"routines">, profile: Doc<"profiles"> | null, reason: Skip): Promise<{ status: "skipped"; reason: Skip }> {
  const period = periodKey(Date.now(), profile?.timeZone ?? "UTC");
  const key = reason === "cap" ? `cap:${period}` : reason;
  if (reason !== "off" && reason !== "busy" && row.lastSkip !== key) {
    await ctx.db.insert("notifications", {
      profileId: row.profileId,
      ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      kind: "system",
      title: reason === "cap" ? capMessage(row.kind, row.monthlyCap, period, profile?.locale) : SKIP_TITLES[reason](ROUTINE_NAMES[row.kind]),
      createdAt: Date.now(),
    });
  }
  await ctx.db.patch(row._id, { lastSkip: key, updatedAt: Date.now() });
  console.log(JSON.stringify({ event: "ai.routine_skipped", kind: row.kind, reason }));
  return { status: "skipped", reason };
}

/** Adds what a run really cost to the routine's spend this month. */
async function addSpend(ctx: MutationCtx, row: Doc<"routines">, profile: Doc<"profiles"> | null, credits: number): Promise<void> {
  if (credits <= 0) return;
  const period = periodKey(Date.now(), profile?.timeZone ?? "UTC");
  await ctx.db.patch(row._id, { spend: { period, credits: spentIn(row.spend, period) + credits } });
}

/** Reads notes as the person: a note they can open (live), or null. Cached per run. */
function noteReader(ctx: Ctx, profile: Doc<"profiles">) {
  const seen = new Map<Id<"documents">, Doc<"documents"> | null>();
  return async (id: Id<"documents">) => {
    if (!seen.has(id)) {
      const d = await ctx.db.get(id);
      seen.set(id, d && !d.inTrash && d.deletedAt === undefined && accessAtLeast(await documentAccess(ctx, profile, d), "read") ? d : null);
    }
    return seen.get(id)!;
  };
}

/** Open to-dos in a place: in a workspace only the person's own (assigned to them or made by them). */
const ownTask = (scope: Scope, profile: Doc<"profiles">) => (t: Doc<"tasks">) => !t.documentInTrash && (scope.kind === "personal" || t.assigneeId === profile._id || t.createdBy === profile._id);

/** Open to-dos due on or before `day` (soonest first). */
const openDueBy = (ctx: Ctx, scope: Scope, day: string, before: boolean) =>
  scope.kind === "personal"
    ? ctx.db.query("tasks").withIndex("by_owner_status_due", (q) => (before ? q.eq("ownerProfileId", scope.profileId).eq("status", "open").gte("dueDate", "").lt("dueDate", day) : q.eq("ownerProfileId", scope.profileId).eq("status", "open").gte("dueDate", "").lte("dueDate", day)))
    : ctx.db.query("tasks").withIndex("by_workspace_status_due", (q) => (before ? q.eq("workspaceId", scope.workspaceId).eq("status", "open").gte("dueDate", "").lt("dueDate", day) : q.eq("workspaceId", scope.workspaceId).eq("status", "open").gte("dueDate", "").lte("dueDate", day)));

/** Notes in a place edited since `since`, latest first. */
const editedSince = (ctx: Ctx, scope: Scope, since: number) =>
  (scope.kind === "personal"
    ? ctx.db.query("documents").withIndex("by_owner_updated", (q) => q.eq("ownerProfileId", scope.profileId).gt("updatedAt", since))
    : ctx.db.query("documents").withIndex("by_workspace_updated", (q) => q.eq("workspaceId", scope.workspaceId).gt("updatedAt", since))
  ).order("desc");

/** A note that's news: not archived, a template, the Inbox, or a digest or routine note of theirs. */
const isNews = (d: Doc<"documents">, profile: Doc<"profiles">) => !d.archivedAt && d.kind !== "template" && !isInboxOrDigest(d, profile._id);

/** What a Morning brief tells: due to-dos, notes others changed and their comments since `since`. */
async function morningMaterial(ctx: Ctx, profile: Doc<"profiles">, scope: Scope, since: number, now: number): Promise<MorningMaterial> {
  const today = localDay(now, profile.timeZone);
  const readDoc = noteReader(ctx, profile);
  const mine = ownTask(scope, profile);
  const names = new Map<Id<"profiles">, string>();
  const nameOf = async (id: Id<"profiles">) => {
    if (!names.has(id)) {
      const p = await ctx.db.get(id);
      names.set(id, p && p.status !== "deleted" ? p.displayName : "Someone");
    }
    return names.get(id)!;
  };

  const tasks: MorningMaterial["tasks"] = [];
  for (const t of await openDueBy(ctx, scope, today, false).take(80)) {
    if (tasks.length >= MORNING_LIMITS.tasks) break;
    if (!t.dueDate || !mine(t)) continue;
    const d = await readDoc(t.documentId);
    if (d) tasks.push({ title: t.title.slice(0, 200), due: t.dueDate, note: d.title || "Untitled", overdue: t.dueDate < today });
  }

  // Notes someone else edited last, since the last brief.
  const changed: MorningMaterial["changed"] = [];
  for (const d of await editedSince(ctx, scope, since).take(80)) {
    if (changed.length >= MORNING_LIMITS.notes) break;
    if (d.lastEditedBy === profile._id || !isNews(d, profile) || !(await readDoc(d._id))) continue;
    // An encrypted note: its readable copy for Foli AI (Background Foli AI on), else it's left out.
    const copy = isSealed(d) ? await sealedAiCopy(ctx, d) : null;
    if (isSealed(d) && !copy) continue;
    changed.push({ id: d.publicId, title: (copy ? copy.title : d.title) || "Untitled", text: (copy ? copy.text : d.searchText).slice(0, MORNING_LIMITS.noteChars), by: await nameOf(d.lastEditedBy) });
  }

  const recent = await (
    scope.kind === "personal"
      ? ctx.db.query("comments").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("comments").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
  )
    .order("desc")
    .take(80);
  const comments: MorningMaterial["comments"] = [];
  for (const c of recent) {
    if (c.createdAt <= since || comments.length >= MORNING_LIMITS.comments) break;
    if (c.deletedAt !== undefined || c.authorId === profile._id) continue;
    const d = await readDoc(c.documentId);
    if (!d) continue;
    const text = plainText((Array.isArray(c.body) ? c.body : []) as InlineNode[]).replace(/\s+/g, " ").trim();
    if (text) comments.push({ note: d.title || "Untitled", author: await nameOf(c.authorId), text: text.slice(0, MORNING_LIMITS.commentChars) });
  }
  return { today, tasks, changed, comments };
}

/**
 * Open loops in a place, found without AI: overdue to-dos, to-dos open for more than a week, contradictions
 * from the graph (where the plan has it) and questions left in notes the person edited in the last 30 days.
 * At most 7, each citing its block.
 */
async function openLoops(ctx: Ctx, profile: Doc<"profiles">, scope: Scope, now: number): Promise<LoopItem[]> {
  const today = localDay(now, profile.timeZone);
  const readDoc = noteReader(ctx, profile);
  const mine = ownTask(scope, profile);
  const fromTask = async (t: Doc<"tasks">, kind: LoopKind, detail: string): Promise<LoopItem | null> => {
    const d = await readDoc(t.documentId);
    return d ? { kind, noteId: d.publicId, noteTitle: d.title || "Untitled", blockId: t.blockId, text: loopText(t.title) || "Untitled to-do", detail } : null;
  };

  const overdue: LoopItem[] = [];
  for (const t of await openDueBy(ctx, scope, today, true).take(60)) {
    if (overdue.length >= MAX_LOOPS) break;
    const item = mine(t) ? await fromTask(t, "overdue", `due ${t.dueDate}`) : null;
    if (item) overdue.push(item);
  }

  // Unchecked for more than a week, oldest first.
  const open = await (
    scope.kind === "personal"
      ? ctx.db.query("tasks").withIndex("by_owner_status_due", (q) => q.eq("ownerProfileId", scope.profileId).eq("status", "open"))
      : ctx.db.query("tasks").withIndex("by_workspace_status_due", (q) => q.eq("workspaceId", scope.workspaceId).eq("status", "open"))
  ).take(300);
  const stale: LoopItem[] = [];
  for (const t of open.filter((t) => t._creationTime < now - STALE_TODO_MS && mine(t)).sort((a, b) => a._creationTime - b._creationTime)) {
    if (stale.length >= MAX_LOOPS) break;
    const item = await fromTask(t, "stale", `open since ${localDay(t._creationTime, profile.timeZone)}`);
    if (item) stale.push(item);
  }

  // Lines that contradict others, from the knowledge graph (only where it's built: plans with semantic search).
  const contradictions: LoopItem[] = [];
  if (await indexEligible(ctx, scope, now)) {
    const reader = await PageReader.forScope(ctx, profile, scope);
    for (const c of await contradictionItems(ctx, reader, await scopeContradictionRows(ctx, scope), LOOP_CONTRADICTIONS)) {
      const verb = c.kind === "supersedes" ? "may replace" : "disagrees with";
      contradictions.push({ kind: "contradiction", noteId: c.from.id, noteTitle: c.from.title || "Untitled", blockId: c.from.blockId, text: loopText(c.from.quote), detail: `${verb} "${loopText(c.to.quote).slice(0, 90)}" in ${c.to.title || "Untitled"}` });
    }
  }

  // Questions left in notes the person edited lately.
  const questions: LoopItem[] = [];
  let looked = 0;
  for (const d of await editedSince(ctx, scope, now - QUESTION_WINDOW_MS).take(60)) {
    if (looked >= QUESTION_NOTES || questions.length >= MAX_LOOPS) break;
    if (d.lastEditedBy !== profile._id || !isNews(d, profile) || !(await readDoc(d._id))) continue;
    looked++;
    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_document_deleted", (q) => q.eq("documentId", d._id).eq("deletedAt", undefined))
      .take(300);
    let found = 0;
    for (const b of blocks.sort((x, y) => (x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : 0))) {
      if (found >= QUESTIONS_PER_NOTE) break;
      if (!PROSE_BLOCKS.has(b.type)) continue;
      const text = plainText((Array.isArray(b.text) ? b.text : []) as InlineNode[]).trim();
      if (!isQuestion(text)) continue;
      questions.push({ kind: "question", noteId: d.publicId, noteTitle: d.title || "Untitled", blockId: b.blockId, text: loopText(text), detail: "" });
      found++;
    }
  }
  return pickLoops([overdue, stale, contradictions, questions]);
}

type Started =
  | { status: "skipped"; reason: Skip | "empty" }
  | ({ status: "go"; holdId: Id<"aiCreditHolds">; until: number; today: string } & ({ kind: "morning"; morning: MorningMaterial } | { kind: "openLoops"; loops: LoopItem[] }));

/**
 * Everything before the model call: the checks (the cap before anything is read), the material (read as the
 * person) and the credit hold. Refusals are skips, never thrown.
 */
export const start = internalMutation({
  args: { routineId: v.id("routines") },
  handler: async (ctx, args): Promise<Started> => {
    const row = await ctx.db.get(args.routineId);
    if (!row) return { status: "skipped", reason: "off" };
    const profile = await ctx.db.get(row.profileId);
    if (!wantsRoutine(profile, row)) return { status: "skipped", reason: "off" };
    const place = await placeOf(ctx, profile, row.workspaceId);
    if (!place) return await skip(ctx, row, profile, "access");
    // No plan with routines here: nothing is read or sent.
    if (!(await routinesIncluded(ctx, profile, place.scope))) return await skip(ctx, row, profile, "plan");
    // An encrypted space: only with Background Foli AI on (docs/E2EE_DESIGN.md §7.2).
    if (!(await backgroundAiAllowed(ctx, place.scope))) return { status: "skipped", reason: "off" };
    const until = Date.now();
    if (spentIn(row.spend, periodKey(until, profile.timeZone)) + perRun(row.kind) > row.monthlyCap) return await skip(ctx, row, profile, "cap");
    const today = localDay(until, profile.timeZone);
    let found: { kind: "morning"; morning: MorningMaterial } | { kind: "openLoops"; loops: LoopItem[] };
    if (row.kind === "morning") {
      const since = Math.max(row.lastAt ?? until - 24 * 60 * 60_000, until - MAX_LOOKBACK_MS);
      const morning = await morningMaterial(ctx, profile, place.scope, since, until);
      found = { kind: "morning", morning };
    } else {
      found = { kind: "openLoops", loops: await openLoops(ctx, profile, place.scope, until) };
    }
    if (found.kind === "morning" ? morningEmpty(found.morning) : !found.loops.length) {
      // Nothing to report: no note, nothing spent.
      await ctx.db.patch(row._id, { lastAt: until, lastSkip: undefined, updatedAt: until });
      return { status: "skipped", reason: "empty" };
    }
    let holdId: Id<"aiCreditHolds">;
    try {
      holdId = await holdFor(ctx, profile, place.scope, routinePlan(row.kind), [], "routines");
    } catch (e) {
      const code = storedError(e).code;
      return await skip(ctx, row, profile, code === "out_of_credits" ? "credits" : code === "rate_limited" ? "busy" : "plan");
    }
    return { status: "go", holdId, until, today, ...found };
  },
});

/** The block after the last root block in `body`, `n` of them. */
function ranksAfter(body: WireBlock[], n: number): string[] {
  const last = body.filter((b) => b.parentId === null).reduce<string | null>((max, b) => (max === null || b.rank > max ? b.rank : max), null);
  return rankSequence(n, last, null);
}

const LOOP_SECTIONS: { kind: LoopKind; heading: string }[] = [
  { kind: "overdue", heading: "Overdue" },
  { kind: "stale", heading: "Open for a while" },
  { kind: "contradiction", heading: "Contradictions" },
  { kind: "question", heading: "Questions" },
];

/** Open loops as blocks: a heading per kind, each item a bullet linking to its block, then where it is. */
function loopBlocks(body: WireBlock[], items: LoopItem[]): WireBlock[] {
  const out: WireBlock[] = [];
  const sections = LOOP_SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.kind === s.kind) })).filter((s) => s.items.length);
  const ranks = ranksAfter(body, sections.reduce((n, s) => n + 1 + s.items.length, 0));
  let r = 0;
  for (const s of sections) {
    out.push({ id: ulid(), type: "heading", parentId: null, rank: ranks[r++]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: s.heading }], props: { level: 2 } });
    for (const it of s.items) {
      const where = it.detail ? ` (${it.detail}), in ${it.noteTitle}` : `, in ${it.noteTitle}`;
      out.push({
        id: ulid(),
        type: "bulleted",
        parentId: null,
        rank: ranks[r++]!,
        schemaVersion: SCHEMA_VERSION,
        text: [
          { type: "text", text: it.text, marks: [{ type: "link", href: blockHref(it.noteId, it.blockId) }] },
          { type: "text", text: where },
        ],
        props: {},
      });
    }
  }
  return out;
}

/**
 * Saves a run as a new note under the person's Inbox page, with a notification (and a web push) linking to
 * it. What the run cost is added to the month's spend first, whatever happens next.
 */
export const deliver = internalMutation({
  args: { routineId: v.id("routines"), until: v.number(), credits: v.number(), markdown: v.string(), noteIds: v.array(v.string()), loops: v.array(vLoopItem) },
  handler: async (ctx, args): Promise<{ status: "delivered"; documentId: string } | { status: "skipped"; reason: Skip }> => {
    const row = await ctx.db.get(args.routineId);
    if (!row) return { status: "skipped", reason: "off" };
    const profile = await ctx.db.get(row.profileId);
    await addSpend(ctx, row, profile, args.credits);
    if (!wantsRoutine(profile, row)) return { status: "skipped", reason: "off" };
    const place = await placeOf(ctx, profile, row.workspaceId);
    if (!place) return await skip(ctx, row, profile, "access");

    // What the model wrote (the brief, or Open loops' intro), then for the brief links to the notes others
    // changed (the ones the person can still open), for Open loops the items, each linking to its block.
    const text = unfence(args.markdown).trim();
    const labels = new Map<string, string>();
    const body: WireBlock[] = text ? markdownToBlocks(text, { titleFromHeading: false }).blocks.slice(0, MAX_NOTE_BLOCKS) : [];
    if (row.kind === "openLoops") {
      body.push(...loopBlocks(body, args.loops.slice(0, MAX_LOOPS)));
    } else {
      const links: Doc<"documents">[] = [];
      for (const id of args.noteIds.slice(0, MORNING_LIMITS.notes)) {
        const d = await getDocumentByPublicId(ctx, id);
        if (!d || d.inTrash || !accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
        const copy = isSealed(d) ? await sealedAiCopy(ctx, d) : null;
        if (isSealed(d) && !copy) continue;
        labels.set(d.publicId, (copy ? copy.title : d.title) || "Untitled");
        links.push(d);
      }
      if (links.length) {
        const ranks = ranksAfter(body, links.length + 1);
        body.push({ id: ulid(), type: "heading", parentId: null, rank: ranks[0]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Notes" }], props: { level: 2 } });
        links.forEach((d, i) => body.push({ id: ulid(), type: "bulleted", parentId: null, rank: ranks[i + 1]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "pageLink", documentId: d.publicId, label: labels.get(d.publicId) ?? "Untitled" }], props: {} }));
      }
    }
    const title = row.kind === "morning" ? "Your Morning brief is ready." : "Your Open loops are ready.";
    // An encrypted space: one of the person's devices makes the note (sealed) from the inbox item.
    if (await encryptedPlace(ctx, place.scope)) {
      const { documentId } = await queueAiNote(ctx, profile, place, "routine", routineTitle(row.kind, args.until, profile.timeZone, profile.locale), body);
      await ctx.db.insert("notifications", {
        profileId: profile._id,
        ...(place.scope.kind === "workspace" ? { workspaceId: place.scope.workspaceId } : {}),
        kind: "system",
        title: `${title} It's added to your Inbox when one of your devices opens Folevi.`,
        createdAt: Date.now(),
      });
      await ctx.db.patch(row._id, { lastAt: args.until, lastSkip: undefined, updatedAt: Date.now() });
      return { status: "delivered", documentId };
    }
    const doc = await saveToInbox(ctx, profile, place, routineTitle(row.kind, args.until, profile.timeZone, profile.locale), body);
    await ctx.db.insert("notifications", {
      profileId: profile._id,
      ...(place.scope.kind === "workspace" ? { workspaceId: place.scope.workspaceId } : {}),
      kind: "system",
      documentId: doc._id,
      title,
      createdAt: Date.now(),
    });
    // And to the browsers and iPhones and iPads that asked for push (only that it's ready, never what it says).
    await schedulePush(ctx, { profileId: profile._id, kind: "routine", title, path: `/d/${doc.publicId}`, tag: `routine:${row._id}`, noteId: doc.publicId });
    await ctx.db.patch(row._id, { lastAt: args.until, lastDocumentId: doc._id, lastSkip: undefined, updatedAt: Date.now() });
    return { status: "delivered", documentId: doc.publicId };
  },
});

/** A brief the model couldn't write: what it cost is counted, the person is told once, the next one covers this stretch too. */
export const failed = internalMutation({
  args: { routineId: v.id("routines"), credits: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.routineId);
    if (!row) return null;
    const profile = await ctx.db.get(row.profileId);
    await addSpend(ctx, row, profile, args.credits);
    return await skip(ctx, row, profile, "error");
  },
});

/** The job for one routine (started by `due` or `runNow`). */
export const run = internalAction({
  args: { routineId: v.id("routines") },
  handler: async (ctx, args): Promise<{ status: string; reason?: string; documentId?: string }> => {
    const started = await ctx.runMutation(internal.routines.start, { routineId: args.routineId });
    if (started.status !== "go") return started;
    let text = "";
    let credits = 0;
    try {
      const req = started.kind === "morning" ? morningRequest(started.morning) : openLoopsRequest(started.today, started.loops);
      text = await metered(
        ctx,
        started.holdId,
        async (meter) => (await provider().generate(req, meter)).text,
        async (cost) => {
          credits = cost.credits;
        },
      );
    } catch (e) {
      console.warn(JSON.stringify({ event: "ai.routine_failed", kind: started.kind, code: storedError(e).code }));
    }
    // Open loops' list stands without its intro; a brief without its text is nothing.
    if (!text.trim() && started.kind === "morning") return await ctx.runMutation(internal.routines.failed, { routineId: args.routineId, credits }).then((r) => r ?? { status: "skipped", reason: "off" });
    return await ctx.runMutation(internal.routines.deliver, {
      routineId: args.routineId,
      until: started.until,
      credits,
      markdown: text,
      noteIds: started.kind === "morning" ? started.morning.changed.map((n) => n.id) : [],
      loops: started.kind === "openLoops" ? started.loops : [],
    });
  },
});
