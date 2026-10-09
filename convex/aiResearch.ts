// Deep research (docs/AI_ASSISTANT.md milestone 6): a question researched in the background, from the
// chat or the /ai page, written up as a report with citations in the conversation.
//
//   start / regenerate: the question goes into the conversation (aiChat.post), a job row is created
//       (aiResearch, scoped like the conversation), the hourly limit is taken and the job's credits are
//       held up front (ai.begin with RESEARCH_PLAN). The person's notes are searched here, as the person
//       (only notes they can open), then the rest runs as a scheduled action.
//   run: plans sub-questions, runs a grounded web search for each (at most MAX_SEARCHES), reads the most
//       useful pages (at most MAX_PAGES, through lib/ai/web.ts readPage's guards), then writes a structured
//       report citing notes and pages with one numbering. Every step is shown live on the job. Searching
//       and reading stop after MAX_RESEARCH_MS; the report is then written from what was found.
//   cancel: the job stops at its next step (and Stop on its message does the same). However a job ends,
//       its credits are settled from what its calls really cost (metered), searches included.
//   saveAsNote: the finished report, with its sources, becomes a note where the conversation lives.
//
// Web research must be on in Settings > AI (checked on the server), and AI must be part of the plan
// (ai.begin: never in Core). Text from the web is untrusted data. Prompts, notes, pages and reports are
// never logged; only events, counts and codes are.
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { markdownToBlocks, ulid } from "@folevi/editor-schema";
import { assertWritable, requireIdentity, requireProfile, requireRowScope, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { insertScoped, sameScopeRows, scopeOfRow, vScopeArg } from "./lib/scope";
import { createDocument } from "./lib/create";
import { capabilities, provider } from "./lib/ai/provider";
import { titleFromQuestion, vAiContext } from "./lib/ai/chat";
import { aiPrefsOf } from "./lib/ai/prefs";
import { MAX_DRAFT_BLOCKS, MAX_DRAFT_CHARS } from "./lib/ai/writing";
import { entryPointsToShow, mergeSources, readPage, resolveLink, searchWeb, domainOf, WEB_RULE, webBlock, type WebSource } from "./lib/ai/web";
import {
  MAX_NOTES,
  MAX_PAGES,
  MAX_RESEARCH_MS,
  MAX_WEB_SOURCES,
  PLAN_SYSTEM,
  REPORT_RULES,
  RESEARCH_PAGE_CHARS,
  RESEARCH_PLAN,
  STALE_RESEARCH_MS,
  citedNumbers,
  parseSubQuestions,
  planPrompt,
  reportNoteMarkdown,
  reportPrompt,
  reportTitle,
  vReportSource,
  vResearchStep,
  type ReportSource,
  type ResearchNote,
  type ResearchStep,
} from "./lib/ai/research";
import { hybridSearch } from "./aiIndex";
import { metered, type Settled } from "./ai";
import { storedError } from "./aiChat";

type Ctx = QueryCtx | MutationCtx;

const GONE = "That research isn't there anymore.";
const WEB_OFF = "Web research is turned off in Settings > AI.";
const vError = v.object({ code: v.string(), message: v.string(), action: v.optional(v.string()), reason: v.optional(v.string()) });
const vUsage = v.object({ credits: v.number(), tokensIn: v.number(), tokensOut: v.number() });
const vNote = v.object({ id: v.string(), title: v.string(), text: v.string() });

/** The caller's own job, in a place they can still open (null otherwise: never someone else's). */
async function ownJob(ctx: Ctx, profile: Doc<"profiles">, publicId: string, level: "view" | "edit" = "view"): Promise<Doc<"aiResearch"> | null> {
  const job = await ctx.db
    .query("aiResearch")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  if (!job || job.profileId !== profile._id) return null;
  try {
    await requireRowScope(ctx, profile, job, level);
  } catch {
    return null;
  }
  return job;
}

function wireJob(job: Doc<"aiResearch">) {
  return {
    id: job.publicId,
    messageId: job.messageId,
    question: job.question,
    status: job.status,
    steps: job.steps,
    sources: job.sources ?? [],
    noteId: job.noteId ?? null,
    error: job.error ?? null,
    credits: job.usage?.credits ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------

/** The person's research jobs in a place (Personal or a workspace), latest first, with their conversation. */
export const list = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const workspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
    const rows = await ctx.db
      .query("aiResearch")
      .withIndex("by_profile_place", (q) => q.eq("profileId", profile._id).eq("workspaceId", workspaceId))
      .order("desc")
      .take(30);
    const out = [];
    for (const job of rows) {
      const c = await ctx.db.get(job.conversationId);
      if (!c || c.ephemeral) continue;
      out.push({ ...wireJob(job), conversationId: c.publicId });
    }
    return out;
  },
});

/** The research jobs in one of the person's conversations (each on the message holding its report). */
export const forConversation = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const c = await ctx.db
      .query("aiConversations")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.conversationId))
      .unique();
    if (!c || c.profileId !== profile._id) return [];
    const rows = await ctx.db
      .query("aiResearch")
      .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
      .take(100);
    return rows.filter((r) => r.profileId === profile._id).map(wireJob);
  },
});

// ---------------------------------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------------------------------

/** Whether this person may research the web now: their settings, and a model that can search. */
export const allowed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    if (!aiPrefsOf(profile).webResearch) fail("forbidden", WEB_OFF);
    if (!capabilities().searchGrounding) fail("maintenance", "The AI model in use can't search the web.");
    return null;
  },
});

/** Creates the job for an answer that's been posted (as the person: their message, in their conversation). */
export const create = internalMutation({
  args: { messageId: v.id("aiMessages"), question: v.string() },
  handler: async (ctx, args): Promise<{ researchId: string }> => {
    const profile = await requireProfile(ctx);
    const m = await ctx.db.get(args.messageId);
    if (!m || m.profileId !== profile._id || m.role !== "assistant" || m.status !== "streaming") fail("not_found", GONE);
    const now = Date.now();
    const publicId = ulid();
    await insertScoped(ctx, "aiResearch", scopeOfRow(m), {
      publicId,
      profileId: profile._id,
      conversationId: m.conversationId,
      messageId: m._id,
      question: args.question.slice(0, 4_000),
      status: "running",
      steps: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(m._id, { phase: "research", updatedAt: now });
    return { researchId: publicId };
  },
});

/** The hourly limit on research jobs (before any credits are held). */
export const limit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    await consume(ctx, "aiResearch", profile._id);
    return null;
  },
});

/** Keeps the job's credit hold, to settle when it ends. */
export const setHold = internalMutation({
  args: { researchId: v.string(), holdId: v.id("aiCreditHolds") },
  handler: async (ctx, args) => {
    const job = await byId(ctx, args.researchId);
    if (job) await ctx.db.patch(job._id, { holdId: args.holdId, updatedAt: Date.now() });
    return null;
  },
});

const byId = (ctx: Ctx, publicId: string) =>
  ctx.db
    .query("aiResearch")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();

/**
 * Starts a job for a posted answer: the limit, the credit hold, the person's notes (searched as them), then
 * the rest in the background. A refusal (Core, out of credits, the limit) fails the job and is stored on
 * the answer, not thrown.
 */
async function launch(ctx: ActionCtx, messageId: Id<"aiMessages">): Promise<{ messageId: Id<"aiMessages">; researchId: string; status: "running" | "error" }> {
  const turn = await ctx.runQuery(internal.aiChat.turn, { messageId });
  const { researchId } = await ctx.runMutation(internal.aiResearch.create, { messageId, question: turn.question });
  const steps: ResearchStep[] = [];
  let holdId: Id<"aiCreditHolds">;
  try {
    await ctx.runMutation(internal.aiResearch.limit, {});
    ({ holdId } = await ctx.runMutation(internal.ai.begin, { scope: turn.scope, plan: RESEARCH_PLAN, feature: "research" }));
    await ctx.runMutation(internal.aiResearch.setHold, { researchId, holdId });
  } catch (e) {
    const error = storedError(e);
    console.warn(JSON.stringify({ event: "ai.research_refused", code: error.code }));
    await ctx.runMutation(internal.aiResearch.finish, { researchId, status: "failed", steps, error });
    await ctx.runMutation(internal.aiChat.finishMessage, { messageId, status: "error", error });
    return { messageId, researchId, status: "error" };
  }
  // The person's notes: the ones the conversation is about first, then a search (as the person, so only
  // notes they can open). The background part can't act as them, so it gets what's found here.
  steps.push({ kind: "notes", label: "Searching your notes", status: "running" });
  await ctx.runMutation(internal.aiResearch.progress, { researchId, steps });
  const notes: ResearchNote[] = [];
  const ids = turn.context.kind === "note" || turn.context.kind === "notes" ? turn.context.ids.slice(0, 3) : [];
  for (const id of ids) {
    try {
      const n = await ctx.runQuery(internal.ai.noteText, { documentId: id });
      notes.push({ id: n.id, title: n.title, text: n.text.slice(0, 6_000) });
    } catch {
      /* gone, or no longer theirs */
    }
  }
  try {
    const folderId = turn.context.kind === "folder" ? turn.context.ids[0] : undefined;
    for (const n of await hybridSearch(ctx, { scope: turn.scope, question: turn.question, queries: [turn.question.slice(0, 200)], limit: MAX_NOTES, folderId })) {
      if (!n.recent && notes.length < MAX_NOTES && !notes.some((x) => x.id === n.id)) notes.push({ id: n.id, title: n.title, text: n.text.slice(0, 6_000) });
    }
    steps[0] = { kind: "notes", label: notes.length ? `Found ${notes.length === 1 ? "1 note" : `${notes.length} notes`}` : "No notes matched", status: "done", count: notes.length };
  } catch {
    steps[0] = { kind: "notes", label: "Couldn't search your notes", status: "failed" };
  }
  await ctx.runMutation(internal.aiResearch.progress, { researchId, steps });
  await ctx.scheduler.runAfter(0, internal.aiResearch.run, { researchId, notes, nameIt: !turn.titled && !turn.ephemeral });
  console.log(JSON.stringify({ event: "ai.research_started", notes: notes.length }));
  return { messageId, researchId, status: "running" };
}

/**
 * Researches a question in a conversation (a new one gets the id the client picked). Returns at once; the
 * job runs in the background and shows its steps as it goes. Refused outright when web research is off.
 */
export const start = action({
  args: { scope: vScopeArg, conversationId: v.string(), text: v.string(), context: v.optional(vAiContext) },
  handler: async (ctx, args): Promise<{ messageId: Id<"aiMessages">; researchId: string; status: "running" | "error" }> => {
    await requireIdentity(ctx);
    await ctx.runQuery(internal.aiResearch.allowed, {});
    const { messageId } = await ctx.runMutation(internal.aiChat.post, { mode: "send", scope: args.scope, conversationId: args.conversationId, text: args.text, context: args.context });
    return await launch(ctx, messageId);
  },
});

/** Researches the last question again (a new job in place of the last answer). */
export const regenerate = action({
  args: { conversationId: v.string() },
  handler: async (ctx, args): Promise<{ messageId: Id<"aiMessages">; researchId: string; status: "running" | "error" }> => {
    await requireIdentity(ctx);
    await ctx.runQuery(internal.aiResearch.allowed, {});
    const { messageId } = await ctx.runMutation(internal.aiChat.post, { mode: "regenerate", conversationId: args.conversationId });
    return await launch(ctx, messageId);
  },
});

// ---------------------------------------------------------------------------------------------------
// Running (in the background, without the person's session: only internal functions that check nothing
// about the caller, on rows the job already names)
// ---------------------------------------------------------------------------------------------------

export const load = internalQuery({
  args: { researchId: v.string() },
  handler: async (ctx, args) => {
    const job = await byId(ctx, args.researchId);
    return job ? { status: job.status, question: job.question, holdId: job.holdId ?? null, messageId: job.messageId, conversationId: job.conversationId, steps: job.steps, createdAt: job.createdAt } : null;
  },
});

/**
 * Shows the job's steps. Returns false once it should stop: cancelled, deleted, or its answer stopped
 * (Stop in the chat cancels the job too).
 */
export const progress = internalMutation({
  args: { researchId: v.string(), steps: v.array(vResearchStep) },
  handler: async (ctx, args) => {
    const job = await byId(ctx, args.researchId);
    if (!job || job.status !== "running") return false;
    const m = await ctx.db.get(job.messageId);
    const now = Date.now();
    if (!m || m.status !== "streaming") {
      await ctx.db.patch(job._id, { status: "cancelled", steps: stopSteps(args.steps), finishedAt: now, updatedAt: now });
      return false;
    }
    await ctx.db.patch(job._id, { steps: args.steps.slice(-20), updatedAt: now });
    await ctx.db.patch(m._id, { updatedAt: now });
    return true;
  },
});

/** Steps still running when a job stops are marked skipped. */
const stopSteps = (steps: ResearchStep[]) => steps.map((s) => (s.status === "running" ? { ...s, status: "skipped" as const } : s));

/** Settles a job: done (with its sources), failed (with why) or cancelled, and what it cost. */
export const finish = internalMutation({
  args: {
    researchId: v.string(),
    status: v.union(v.literal("done"), v.literal("failed"), v.literal("cancelled")),
    steps: v.array(vResearchStep),
    sources: v.optional(v.array(vReportSource)),
    error: v.optional(vError),
    usage: v.optional(vUsage),
  },
  handler: async (ctx, args) => {
    const job = await byId(ctx, args.researchId);
    if (!job) return null;
    const now = Date.now();
    // Cancelled stays cancelled (what it cost is still recorded).
    const status = job.status === "cancelled" ? "cancelled" : args.status;
    await ctx.db.patch(job._id, {
      status,
      steps: (status === "done" ? args.steps : stopSteps(args.steps)).slice(-20),
      holdId: undefined,
      ...(args.sources?.length && status === "done" ? { sources: args.sources } : {}),
      ...(args.error && status === "failed" ? { error: args.error } : {}),
      ...(args.usage ? { usage: args.usage } : {}),
      finishedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/** The answer of a cancelled job: stopped (the job card says so). */
export const stopMessage = internalMutation({
  args: { messageId: v.id("aiMessages"), usage: v.optional(vUsage) },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.messageId);
    if (m && (m.status === "streaming" || m.status === "stopped")) await ctx.db.patch(m._id, { status: "stopped", phase: undefined, ...(args.usage ? { usage: args.usage } : {}), updatedAt: Date.now() });
    return null;
  },
});

/** Thrown inside a run when the job should stop (cancelled, or its conversation was deleted). */
class Cancelled extends Error {}

/** A failure that ends the whole job (the AI isn't set up, out of time): anything else skips one search. */
const fatal = (e: unknown) => {
  const code = (e as { data?: { code?: unknown } })?.data?.code;
  return code === "maintenance" || code === "rate_limited";
};

export const run = internalAction({
  args: { researchId: v.string(), notes: v.array(vNote), nameIt: v.boolean() },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.aiResearch.load, { researchId: args.researchId });
    if (!job) return null;
    const { question, messageId } = job;
    if (!job.holdId) return null;
    if (job.status !== "running") {
      // Cancelled before it began: nothing was spent, the hold goes.
      await ctx.runMutation(internal.ai.settle, { holdId: job.holdId, calls: [] });
      return null;
    }
    const steps: ResearchStep[] = [...job.steps];
    const deadline = job.createdAt + MAX_RESEARCH_MS;
    const show = async () => {
      if (!(await ctx.runMutation(internal.aiResearch.progress, { researchId: args.researchId, steps }))) throw new Cancelled();
    };
    const step = async (s: ResearchStep) => {
      steps.push(s);
      await show();
      return steps.length - 1;
    };
    const update = async (i: number, patch: Partial<ResearchStep>) => {
      steps[i] = { ...steps[i]!, ...patch };
      await show();
    };
    const notes = args.notes;
    let cost: Settled | undefined;
    try {
      const out = await metered(
        ctx,
        job.holdId,
        async (meter) => {
          // 1. The plan: a few sub-questions to search for.
          let i = await step({ kind: "plan", label: "Planning the research", status: "running" });
          const plan = await provider().generate({ system: PLAN_SYSTEM, prompt: planPrompt(question, notes.map((n) => n.title)), json: true, temperature: 0.2, maxOutputTokens: 800 }, meter);
          const subs = parseSubQuestions(plan.text, question);
          await update(i, { status: "done", label: `Planned ${subs.length === 1 ? "1 search" : `${subs.length} searches`}`, count: subs.length });

          // 2. A grounded web search for each, until the time is up.
          const web: WebSource[] = [];
          const findings: string[] = [];
          // Google's Search Suggestions for each search, shown with the report as Google requires.
          const entryPoints: string[] = [];
          for (const q of subs) {
            if (Date.now() > deadline) {
              await step({ kind: "search", label: `Skipped (out of time): ${q}`, status: "skipped" });
              continue;
            }
            i = await step({ kind: "search", label: `Searching the web: ${q}`, status: "running" });
            try {
              const r = await searchWeb(q, meter, question);
              if (r.summary) findings.push(r.summary);
              if (r.entryPoint) entryPoints.push(r.entryPoint);
              mergeSources(web, r.sources, MAX_WEB_SOURCES);
              await update(i, { status: "done", label: `Searched the web: ${q}`, count: r.sources.length });
            } catch (e) {
              if (e instanceof Cancelled || fatal(e)) throw e;
              await update(i, { status: "failed", label: `Couldn't search: ${q}` });
            }
          }

          // 3. The most useful pages, read in full (the ones most of the findings rest on come first).
          const toRead = [...web].sort((a, b) => b.text.length - a.text.length).slice(0, MAX_PAGES);
          if (toRead.length && Date.now() <= deadline) {
            i = await step({ kind: "read", label: "Reading pages", status: "running" });
            let read = 0;
            for (const s of toRead) {
              if (Date.now() > deadline) break;
              const page = await readPage(s.url, RESEARCH_PAGE_CHARS);
              if (page.ok) {
                const at = web.indexOf(s);
                web[at] = { url: page.url, title: page.title || s.title, domain: page.domain, text: `${s.text ? `${s.text}\n\n` : ""}${page.text}`, kind: "page" };
                read++;
              }
              await show();
            }
            await update(i, { status: read ? "done" : "failed", label: read ? `Read ${read === 1 ? "1 page" : `${read} pages`}` : "Couldn't read the pages", count: read });
          }

          // 4. The report, citing notes and pages with one numbering.
          i = await step({ kind: "write", label: "Writing the report", status: "running" });
          const res = await provider().generate(
            {
              system: [...REPORT_RULES, WEB_RULE].join("\n"),
              prompt: reportPrompt(question, subs, notes, web.length ? webBlock(web, notes.length + 1) : "", findings),
              temperature: 0.3,
              maxOutputTokens: 6_144,
            },
            meter,
          );
          await update(i, { status: "done", label: "Wrote the report" });
          return { report: res.text, web, entryPoints };
        },
        async (c) => {
          cost = c;
        },
      );

      // Sources: what the report cites, numbered as it cites them (Google's links become the pages' own).
      const cited = citedNumbers(out.report);
      const sources: ReportSource[] = notes.map((n, k) => ({ n: k + 1, kind: "note" as const, id: n.id, title: n.title })).filter((s) => cited.has(s.n));
      for (const [k, w] of out.web.entries()) {
        const n = notes.length + k + 1;
        if (!cited.has(n)) continue;
        const url = w.kind === "search" ? await resolveLink(w.url) : w.url;
        sources.push({ n, kind: "web", url, title: w.title.slice(0, 200), domain: (url === w.url ? w.domain : domainOf(url)) || w.domain });
      }
      await ctx.runMutation(internal.aiResearch.finish, { researchId: args.researchId, status: "done", steps, sources, usage: cost });
      await ctx.runMutation(internal.aiChat.finishMessage, {
        messageId,
        status: "done",
        text: out.report,
        citations: sources.flatMap((s) => (s.kind === "note" ? [{ n: s.n, noteId: s.id, title: s.title }] : [])),
        webCitations: sources.flatMap((s) => (s.kind === "web" ? [{ n: s.n, url: s.url, title: s.title, domain: s.domain }] : [])),
        searchEntryPoints: entryPointsToShow(out.entryPoints),
        usage: cost,
      });
      if (args.nameIt) await ctx.runMutation(internal.aiChat.setTitle, { conversationId: job.conversationId, title: titleFromQuestion(question) });
      console.log(JSON.stringify({ event: "ai.research_done", steps: steps.length, sources: sources.length, credits: cost?.credits ?? 0 }));
    } catch (e) {
      if (e instanceof Cancelled) {
        await ctx.runMutation(internal.aiResearch.finish, { researchId: args.researchId, status: "cancelled", steps, usage: cost });
        await ctx.runMutation(internal.aiResearch.stopMessage, { messageId, usage: cost });
        console.log(JSON.stringify({ event: "ai.research_cancelled", credits: cost?.credits ?? 0 }));
        return null;
      }
      const error = storedError(e);
      console.warn(JSON.stringify({ event: "ai.research_error", code: error.code }));
      await ctx.runMutation(internal.aiResearch.finish, { researchId: args.researchId, status: "failed", steps, error, usage: cost });
      await ctx.runMutation(internal.aiChat.finishMessage, { messageId, status: "error", error, usage: cost });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Acting on a job
// ---------------------------------------------------------------------------------------------------

/** Stops a running job at its next step (what it found so far isn't written up). */
export const cancel = mutation({
  args: { researchId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const job = await ownJob(ctx, profile, args.researchId);
    if (!job) fail("not_found", GONE);
    if (job.status !== "running") return null;
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "cancelled", steps: stopSteps(job.steps), finishedAt: now, updatedAt: now });
    const m = await ctx.db.get(job.messageId);
    if (m?.status === "streaming") await ctx.db.patch(m._id, { status: "stopped", phase: undefined, updatedAt: now });
    return null;
  },
});

/**
 * Saves a finished report as a note where the conversation lives (optionally in a folder there): the report,
 * then its sources (notes by name, pages as links). Saving again opens the same note while it exists.
 */
export const saveAsNote = mutation({
  args: { researchId: v.string(), folderId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const job = await ownJob(ctx, profile, args.researchId);
    if (!job) fail("not_found", GONE);
    if (job.status !== "done") fail("invalid_argument", "The report isn't finished yet.");
    if (job.noteId) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_public_id", (q) => q.eq("publicId", job.noteId!))
        .unique();
      if (existing && !existing.inTrash && existing.deletedAt === undefined) return { id: existing.publicId };
    }
    const { scope } = await requireRowScope(ctx, profile, job, "edit", GONE);
    const m = await ctx.db.get(job.messageId);
    if (!m?.text.trim()) fail("not_found", "The report isn't there anymore.");
    const markdown = reportNoteMarkdown(m.text, job.sources ?? []);
    if (markdown.length > MAX_DRAFT_CHARS) fail("limit_exceeded", "That report is too long to save as a note.");
    await consume(ctx, "bulk", profile._id);
    let folderId;
    if (args.folderId) {
      const folder = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
        .unique();
      if (!folder || folder.deletedAt || !sameScopeRows(folder, job)) fail("not_found", "Folder not found.");
      folderId = folder._id;
    }
    const { blocks } = markdownToBlocks(markdown, { titleFromHeading: false });
    if (blocks.length > MAX_DRAFT_BLOCKS) fail("limit_exceeded", "That report has too many blocks to save as a note.");
    const doc = await createDocument(ctx, { scope, actor: profile, title: reportTitle(job.question), folderId, blocks, kind: "document" });
    await ctx.db.patch(job._id, { noteId: doc.publicId, updatedAt: Date.now() });
    return { id: doc.publicId };
  },
});

/** Every half hour: jobs still "running" long after they started were cut off (a crash) and are failed. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("aiResearch")
      .withIndex("by_status_updated", (q) => q.eq("status", "running").lt("updatedAt", now - STALE_RESEARCH_MS))
      .take(100);
    for (const job of stuck) {
      await ctx.db.patch(job._id, { status: "failed", steps: stopSteps(job.steps), holdId: undefined, error: { code: "interrupted", message: "This research was cut off. Try again." }, finishedAt: now, updatedAt: now });
    }
    return { failed: stuck.length };
  },
});
