// AI digests (docs/AI_ASSISTANT.md, "Memory, suggestions, digests"): an opt-in summary of what changed
// in a person's notes, daily or weekly at an hour of their day, about their Personal or one workspace.
//
//   settings, save: Settings > AI. Off by default; turning it on (or changing the schedule) sets when it's
//                   next due in the person's time zone (lib/ai/digest.ts nextDigestAt).
//   due:            every 15 minutes, finds digests that are due, moves each on to its next time, and
//                   starts a job per person (spread out).
//   run:            the job. `start` checks everything first (digests and AI still on, still in the
//                   workspace and able to add pages there, a plan with AI), reads what changed since the
//                   last digest as the person (recently edited notes, new and due tasks, other people's
//                   comments; only what they can open, a few of each), and holds the credits (ai.holdFor,
//                   like every request). Nothing changed: no digest, nothing spent. Then one model call
//                   (metered, so it settles what it really cost), and `deliver` saves the digest as a note
//                   under the person's Inbox page there, with an in-app notification linking to it.
//
// A skipped digest (no AI on the plan, out of credits, no longer in the workspace, the model failed) is
// told once per reason in the notification bell, never by email. Note content is never emailed or logged.
// Turning digests off (or AI off) stops everything: nothing is scheduled, read or sent.
import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { markdownToBlocks, plainText, rankBetween, rankSequence, SCHEMA_VERSION, ulid, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { aiAccountFor } from "./lib/credits";
import { createDocument } from "./lib/create";
import { liveBlocks } from "./lib/documents";
import { SyncEngine } from "./lib/syncEngine";
import { personalScope, vScopeArg, workspaceScope, type Scope, type ScopeArg } from "./lib/scope";
import { aiPrefsOf, aiPrefsPatch } from "./lib/ai/prefs";
import { provider } from "./lib/ai/provider";
import { unfence } from "./lib/ai/writing";
import {
  cleanSchedule,
  DEFAULT_SCHEDULE,
  DIGEST_LIMITS,
  DIGEST_PLAN,
  digestEmpty,
  digestRequest,
  digestTitle,
  localDay,
  nextDigestAt,
  periodMs,
  type DigestMaterial,
} from "./lib/ai/digest";
import { holdFor, metered } from "./ai";
import { ensureInbox } from "./tasks";
import { storedError } from "./aiChat";

type Ctx = QueryCtx | MutationCtx;

const vFrequency = v.union(v.literal("daily"), v.literal("weekly"));
/** How often the cron looks for due digests (and so how late one can be). */
export const DUE_EVERY_MINUTES = 15;
/** Digests started per cron run (the rest wait for the next run, which comes at once). */
const DUE_BATCH = 100;
/** Blocks a digest note may have. */
const MAX_DIGEST_BLOCKS = 200;
/** The longest stretch a digest looks back over, in periods (a long gap isn't read in full). */
const MAX_LOOKBACK_PERIODS = 2;

const rowOf = (ctx: Ctx, profileId: Id<"profiles">) =>
  ctx.db
    .query("aiDigests")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();

/** Someone who can still have digests: an account in use, AI on, digests on. */
const wantsDigests = (p: Doc<"profiles"> | null): p is Doc<"profiles"> => Boolean(p && (p.status === "active" || p.status === "pending_deletion") && p.aiEnabled !== false && aiPrefsOf(p).digests);

const frequencyLabel = (f: "daily" | "weekly") => (f === "weekly" ? "weekly" : "daily");

// ---------------------------------------------------------------------------------------------------
// Settings > AI
// ---------------------------------------------------------------------------------------------------

/** The person's digest: on or off, the schedule, where it's about, and when it's next due. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const row = await rowOf(ctx, profile._id);
    const enabled = aiPrefsOf(profile).digests;
    let context: { kind: "personal" } | { kind: "workspace"; workspaceId: string; name: string } = { kind: "personal" };
    if (row?.contextWorkspaceId) {
      const ws = await ctx.db.get(row.contextWorkspaceId);
      if (ws && ws.status !== "deleting") context = { kind: "workspace", workspaceId: ws.publicId, name: ws.name };
    }
    const last = row?.lastDocumentId ? await ctx.db.get(row.lastDocumentId) : null;
    return {
      enabled,
      frequency: row?.frequency ?? DEFAULT_SCHEDULE.frequency,
      hour: row?.hour ?? DEFAULT_SCHEDULE.hour,
      weekday: row?.weekday ?? DEFAULT_SCHEDULE.weekday,
      context,
      nextAt: enabled ? (row?.nextAt ?? null) : null,
      lastNoteId: last && !last.inTrash && last.deletedAt === undefined ? last.publicId : null,
      timeZone: profile.timeZone,
    };
  },
});

/**
 * Turns digests on or off and changes the schedule or where they're about (Personal, or a workspace where
 * the person can add pages). Returns when the next one is due (null while off).
 */
export const save = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    frequency: v.optional(vFrequency),
    hour: v.optional(v.number()),
    weekday: v.optional(v.number()),
    scope: v.optional(vScopeArg),
  },
  handler: async (ctx, args): Promise<{ nextAt: number | null }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (args.hour !== undefined && !(Number.isInteger(args.hour) && args.hour >= 0 && args.hour <= 23)) fail("invalid_argument", "Pick an hour of the day.");
    if (args.weekday !== undefined && !(Number.isInteger(args.weekday) && args.weekday >= 0 && args.weekday <= 6)) fail("invalid_argument", "Pick a day of the week.");
    const enabled = args.enabled ?? aiPrefsOf(profile).digests;
    if (enabled && profile.aiEnabled === false) fail("forbidden", "Turn on the AI Assistant first.");
    const row = await rowOf(ctx, profile._id);
    const schedule = cleanSchedule({ frequency: args.frequency ?? row?.frequency, hour: args.hour ?? row?.hour, weekday: args.weekday ?? row?.weekday });
    let contextWorkspaceId = row?.contextWorkspaceId;
    if (args.scope) {
      // A digest is a note there, so the person must be able to add pages.
      const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
      contextWorkspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
    }
    if (args.enabled !== undefined) await ctx.db.patch(profile._id, aiPrefsPatch({ digests: args.enabled }));
    const now = Date.now();
    const nextAt = enabled ? nextDigestAt(now, schedule, profile.timeZone) : undefined;
    const fields = { ...schedule, contextWorkspaceId, nextAt, updatedAt: now };
    if (row) await ctx.db.replace(row._id, { ...row, ...fields, ...(args.scope && row.contextWorkspaceId !== contextWorkspaceId ? { lastAt: undefined, lastSkip: undefined } : {}) });
    else await ctx.db.insert("aiDigests", { profileId: profile._id, ...fields, createdAt: now });
    return { nextAt: nextAt ?? null };
  },
});

// ---------------------------------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------------------------------

/** Cron: starts the digests that are due, each moved on to its next time first (so it's never doubled). */
export const due = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("aiDigests")
      .withIndex("by_next", (q) => q.gte("nextAt", 0).lte("nextAt", now))
      .take(DUE_BATCH);
    let started = 0;
    for (const row of rows) {
      const profile = await ctx.db.get(row.profileId);
      if (!wantsDigests(profile)) {
        // Off: nothing more is scheduled until it's turned on again.
        await ctx.db.patch(row._id, { nextAt: undefined, updatedAt: now });
        continue;
      }
      await ctx.db.patch(row._id, { nextAt: nextDigestAt(now, row, profile.timeZone), updatedAt: now });
      await ctx.scheduler.runAfter(started * 2_000, internal.aiDigest.run, { digestId: row._id });
      started++;
    }
    if (rows.length === DUE_BATCH) await ctx.scheduler.runAfter(started * 2_000, internal.aiDigest.due, {});
    if (started) console.log(JSON.stringify({ event: "ai.digests_due", started }));
    return { started };
  },
});

// ---------------------------------------------------------------------------------------------------
// One digest
// ---------------------------------------------------------------------------------------------------

type Skip = "off" | "plan" | "credits" | "access" | "busy" | "error";

const SKIP_TITLES: Record<Exclude<Skip, "off" | "busy">, (f: string) => string> = {
  plan: (f) => `Your ${f} digest was skipped: AI isn't part of your plan.`,
  credits: (f) => `Your ${f} digest was skipped: you're out of AI credits.`,
  access: (f) => `Your ${f} digest was skipped: you can't add pages where it's saved anymore. Pick another place in Settings > AI.`,
  error: (f) => `Your ${f} digest couldn't be written this time. It will try again next time.`,
};

/** Records a skip, and tells the person once per reason (in the bell only). */
async function skip(ctx: MutationCtx, row: Doc<"aiDigests">, reason: Skip): Promise<{ status: "skipped"; reason: Skip }> {
  if (reason !== "off" && reason !== "busy" && row.lastSkip !== reason) {
    await ctx.db.insert("notifications", {
      profileId: row.profileId,
      ...(row.contextWorkspaceId ? { workspaceId: row.contextWorkspaceId } : {}),
      kind: "system",
      title: SKIP_TITLES[reason](frequencyLabel(row.frequency)),
      createdAt: Date.now(),
    });
  }
  await ctx.db.patch(row._id, { lastSkip: reason, updatedAt: Date.now() });
  console.log(JSON.stringify({ event: "ai.digest_skipped", reason }));
  return { status: "skipped", reason };
}

/** Where a digest is about and saved, if the person can still add pages there. */
async function placeOf(ctx: Ctx, profile: Doc<"profiles">, row: Doc<"aiDigests">): Promise<{ scope: Scope; scopeArg: ScopeArg } | null> {
  if (!row.contextWorkspaceId) return { scope: personalScope(profile._id), scopeArg: { kind: "personal" } };
  const ws = await ctx.db.get(row.contextWorkspaceId);
  if (!ws) return null;
  const scopeArg: ScopeArg = { kind: "workspace", workspaceId: ws.publicId };
  try {
    await resolveScope(ctx, profile, scopeArg, "edit");
  } catch {
    return null;
  }
  return { scope: workspaceScope(ws._id), scopeArg };
}

/** The person's Inbox page, or a digest note of theirs (both are kept out of the next digest). */
const isInboxOrDigest = (d: Doc<"documents">, profileId: Id<"profiles">) =>
  d.createdBy === profileId && (d.publicId.startsWith("inbox-") || (d.parentDocumentId !== undefined && /^(Daily|Weekly) digest\b/.test(d.title)));

/** What changed in a place since `since`, as the person can see it (a few of each kind). */
async function material(ctx: Ctx, profile: Doc<"profiles">, scope: Scope, since: number, now: number, weekly: boolean): Promise<DigestMaterial> {
  const today = localDay(now, profile.timeZone);
  const horizon = localDay(now, profile.timeZone, weekly ? 7 : 1);
  const readable = new Map<Id<"documents">, Doc<"documents"> | null>();
  const readDoc = async (id: Id<"documents">) => {
    if (!readable.has(id)) {
      const d = await ctx.db.get(id);
      readable.set(id, d && !d.inTrash && d.deletedAt === undefined && accessAtLeast(await documentAccess(ctx, profile, d), "read") ? d : null);
    }
    return readable.get(id)!;
  };

  // Notes edited (or made) since the last digest, latest first.
  const docs = await (
    scope.kind === "personal"
      ? ctx.db.query("documents").withIndex("by_owner_updated", (q) => q.eq("ownerProfileId", scope.profileId).gt("updatedAt", since))
      : ctx.db.query("documents").withIndex("by_workspace_updated", (q) => q.eq("workspaceId", scope.workspaceId).gt("updatedAt", since))
  )
    .order("desc")
    .take(80);
  const notes: DigestMaterial["notes"] = [];
  for (const d of docs) {
    if (notes.length >= DIGEST_LIMITS.notes) break;
    if (d.archivedAt || d.kind === "template" || isInboxOrDigest(d, profile._id)) continue;
    if (!(await readDoc(d._id))) continue;
    notes.push({ id: d.publicId, title: d.title || "Untitled", text: d.searchText.slice(0, DIGEST_LIMITS.noteChars), isNew: d.createdAt > since });
  }

  // Tasks: in a workspace only the person's own (assigned to them or made by them); in Personal, all.
  const mine = (t: Doc<"tasks">) => scope.kind === "personal" || t.assigneeId === profile._id || t.createdBy === profile._id;
  const open = await (
    scope.kind === "personal"
      ? ctx.db.query("tasks").withIndex("by_owner_status_due", (q) => q.eq("ownerProfileId", scope.profileId).eq("status", "open"))
      : ctx.db.query("tasks").withIndex("by_workspace_status_due", (q) => q.eq("workspaceId", scope.workspaceId).eq("status", "open"))
  )
    .order("desc")
    .take(300);
  const newTasks: DigestMaterial["newTasks"] = [];
  for (const t of open) {
    if (newTasks.length >= DIGEST_LIMITS.newTasks) break;
    if (t._creationTime <= since || t.documentInTrash || !mine(t)) continue;
    const d = await readDoc(t.documentId);
    if (d) newTasks.push({ title: t.title.slice(0, 200), due: t.dueDate ?? null, note: d.title || "Untitled" });
  }
  const dueSoon = await (
    scope.kind === "personal"
      ? ctx.db.query("tasks").withIndex("by_owner_status_due", (q) => q.eq("ownerProfileId", scope.profileId).eq("status", "open").gte("dueDate", "").lte("dueDate", horizon))
      : ctx.db.query("tasks").withIndex("by_workspace_status_due", (q) => q.eq("workspaceId", scope.workspaceId).eq("status", "open").gte("dueDate", "").lte("dueDate", horizon))
  ).take(60);
  const dueTasks: DigestMaterial["dueTasks"] = [];
  for (const t of dueSoon) {
    if (dueTasks.length >= DIGEST_LIMITS.dueTasks) break;
    if (!t.dueDate || t.documentInTrash || !mine(t)) continue;
    const d = await readDoc(t.documentId);
    if (d) dueTasks.push({ title: t.title.slice(0, 200), due: t.dueDate, note: d.title || "Untitled", overdue: t.dueDate < today });
  }

  // Other people's comments since then.
  const recent = await (
    scope.kind === "personal"
      ? ctx.db.query("comments").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("comments").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
  )
    .order("desc")
    .take(80);
  const comments: DigestMaterial["comments"] = [];
  const names = new Map<Id<"profiles">, string>();
  for (const c of recent) {
    if (c.createdAt <= since) break;
    if (comments.length >= DIGEST_LIMITS.comments) break;
    if (c.deletedAt !== undefined || c.authorId === profile._id) continue;
    const d = await readDoc(c.documentId);
    if (!d) continue;
    if (!names.has(c.authorId)) {
      const a = await ctx.db.get(c.authorId);
      names.set(c.authorId, a && a.status !== "deleted" ? a.displayName : "Someone");
    }
    const text = plainText((Array.isArray(c.body) ? c.body : []) as InlineNode[]).replace(/\s+/g, " ").trim();
    if (text) comments.push({ note: d.title || "Untitled", author: names.get(c.authorId)!, text: text.slice(0, DIGEST_LIMITS.commentChars) });
  }
  return { today, notes, newTasks, dueTasks, comments };
}

type Started =
  | { status: "skipped"; reason: Skip | "empty" }
  | { status: "go"; holdId: Id<"aiCreditHolds">; frequency: "daily" | "weekly"; since: number; until: number; material: DigestMaterial };

/**
 * Everything before the model call: the checks, what changed (read as the person), and the credit hold.
 * Refusals are skips, never thrown.
 */
export const start = internalMutation({
  args: { digestId: v.id("aiDigests") },
  handler: async (ctx, args): Promise<Started> => {
    const row = await ctx.db.get(args.digestId);
    if (!row) return { status: "skipped", reason: "off" };
    const profile = await ctx.db.get(row.profileId);
    if (!wantsDigests(profile)) return { status: "skipped", reason: "off" };
    const place = await placeOf(ctx, profile, row);
    if (!place) return await skip(ctx, row, "access");
    // No AI on the plan here: nothing is read or sent.
    if (!(await aiAccountFor(ctx, profile, place.scope)).allowed) return await skip(ctx, row, "plan");
    const until = Date.now();
    const period = periodMs(row.frequency);
    const since = Math.max(row.lastAt ?? until - period, until - MAX_LOOKBACK_PERIODS * period);
    const found = await material(ctx, profile, place.scope, since, until, row.frequency === "weekly");
    if (digestEmpty(found)) {
      // Nothing changed: no digest, nothing spent.
      await ctx.db.patch(row._id, { lastAt: until, lastSkip: undefined, updatedAt: until });
      return { status: "skipped", reason: "empty" };
    }
    let holdId: Id<"aiCreditHolds">;
    try {
      holdId = await holdFor(ctx, profile, place.scope, DIGEST_PLAN);
    } catch (e) {
      const code = storedError(e).code;
      return await skip(ctx, row, code === "out_of_credits" ? "credits" : code === "rate_limited" ? "busy" : "plan");
    }
    return { status: "go", holdId, frequency: row.frequency, since, until, material: found };
  },
});

/** Saves a written digest as a note under the person's Inbox page, with a notification linking to it. */
export const deliver = internalMutation({
  args: { digestId: v.id("aiDigests"), since: v.number(), until: v.number(), markdown: v.string(), noteIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ status: "delivered"; documentId: string } | { status: "skipped"; reason: Skip }> => {
    const row = await ctx.db.get(args.digestId);
    if (!row) return { status: "skipped", reason: "off" };
    const profile = await ctx.db.get(row.profileId);
    if (!wantsDigests(profile)) return { status: "skipped", reason: "off" };
    const place = await placeOf(ctx, profile, row);
    if (!place) return await skip(ctx, row, "access");
    const inboxId = await ensureInbox(ctx, profile, place.scope, place.scopeArg);
    const inbox = (await getDocumentByPublicId(ctx, inboxId))!;

    // The digest, then links to the notes it covered (the ones the person can still open).
    const { blocks } = markdownToBlocks(unfence(args.markdown).trim(), { titleFromHeading: false });
    const body: WireBlock[] = blocks.slice(0, MAX_DIGEST_BLOCKS);
    const links: Doc<"documents">[] = [];
    for (const id of args.noteIds.slice(0, DIGEST_LIMITS.notes)) {
      const d = await getDocumentByPublicId(ctx, id);
      if (d && !d.inTrash && accessAtLeast(await documentAccess(ctx, profile, d), "read")) links.push(d);
    }
    if (links.length) {
      const last = body.filter((b) => b.parentId === null).reduce<string | null>((max, b) => (max === null || b.rank > max ? b.rank : max), null);
      const ranks = rankSequence(links.length + 1, last, null);
      body.push({ id: ulid(), type: "heading", parentId: null, rank: ranks[0]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Notes" }], props: { level: 2 } });
      links.forEach((d, i) => body.push({ id: ulid(), type: "bulleted", parentId: null, rank: ranks[i + 1]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "pageLink", documentId: d.publicId, label: d.title || "Untitled" }], props: {} }));
    }
    const title = digestTitle(row.frequency, args.since, args.until, profile.timeZone, profile.locale);
    const doc = await createDocument(ctx, {
      scope: place.scope,
      actor: profile,
      title,
      parentDocumentId: inbox._id,
      blocks: body,
      // In a workspace it's theirs alone (it may name pages only they can open).
      ...(place.scope.kind === "workspace" ? { accessMode: "restricted" as const } : {}),
    });
    // A card for it at the end of the Inbox page.
    const roots = (await liveBlocks(ctx, inbox._id)).filter((b) => b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const card: WireBlock = {
      id: ulid(),
      type: "page",
      parentId: null,
      rank: rankBetween(roots[roots.length - 1]?.rank ?? null, null),
      schemaVersion: SCHEMA_VERSION,
      text: [],
      props: { documentId: doc.publicId, display: "card", titleCache: doc.title, ...(doc.icon ? { iconCache: doc.icon } : {}) },
    };
    await new SyncEngine(ctx, profile, "server").applyAll(place.scopeArg, [{ opId: ulid(), kind: "block.upsert", documentId: inbox.publicId, block: card, baseRevision: null, fields: ["content", "position"] }]);
    await ctx.db.insert("notifications", {
      profileId: profile._id,
      ...(place.scope.kind === "workspace" ? { workspaceId: place.scope.workspaceId } : {}),
      kind: "system",
      documentId: doc._id,
      title: `Your ${frequencyLabel(row.frequency)} digest is ready.`,
      createdAt: Date.now(),
    });
    await ctx.db.patch(row._id, { lastAt: args.until, lastDocumentId: doc._id, lastSkip: undefined, updatedAt: Date.now() });
    return { status: "delivered", documentId: doc.publicId };
  },
});

/** A digest the model couldn't write: told once, and the next one covers this stretch too. */
export const failed = internalMutation({
  args: { digestId: v.id("aiDigests") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digestId);
    return row ? await skip(ctx, row, "error") : null;
  },
});

/** The job for one person's digest (started by `due`). */
export const run = internalAction({
  args: { digestId: v.id("aiDigests") },
  handler: async (ctx, args): Promise<{ status: string; reason?: string; documentId?: string }> => {
    const started = await ctx.runMutation(internal.aiDigest.start, { digestId: args.digestId });
    if (started.status !== "go") return started;
    let markdown = "";
    try {
      markdown = await metered(ctx, started.holdId, async (meter) => (await provider().generate(digestRequest(started.frequency, started.material), meter)).text);
    } catch (e) {
      console.warn(JSON.stringify({ event: "ai.digest_failed", code: storedError(e).code }));
    }
    if (!markdown.trim()) return await ctx.runMutation(internal.aiDigest.failed, { digestId: args.digestId }).then((r) => r ?? { status: "skipped", reason: "off" });
    return await ctx.runMutation(internal.aiDigest.deliver, { digestId: args.digestId, since: started.since, until: started.until, markdown, noteIds: started.material.notes.map((n) => n.id) });
  },
});

