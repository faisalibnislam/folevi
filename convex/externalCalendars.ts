// Read-only calendar subscriptions: a person pastes an iCalendar (ICS) link and its events show in their
// Calendar beside their tasks. Nothing is ever written back.
//
// Storage: each fetch parses the calendar (lib/icsParse.ts) into one `externalEvents` row per instance,
// repeats expanded, from 60 days back to 180 ahead (at most MAX_EVENTS). Rows are written in chunks under
// a new generation number and the calendar switches to it in one step once all are in, so a reader never
// sees half a calendar; older generations are deleted after. A failed fetch keeps the events from before
// and records why, in plain words.
//
// Refreshing: on add, on Refresh, when the Calendar is opened and the copy is over an hour old, and every
// 30 minutes (crons.ts) for calendars their owner looked at in the last 14 days. ETag / Last-Modified make
// an unchanged calendar cheap; unchanged text is still read again twice a day because the window moves.
//
// Safety: the fetch (lib/icsFetch.ts) only goes to public http(s) addresses, checks DNS answers and every
// redirect, stops at 10 seconds and 5 MB. Up to MAX_CALENDARS per person.
import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertWritable, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { sha256Hex } from "./lib/crypto";
import { parseIcs } from "./lib/icsParse";
import { calendarUrlProblem, downloadCalendar, normalizeCalendarUrl } from "./lib/icsFetch";

export const MAX_CALENDARS = 20;
const MAX_EVENTS = 1500;
const DAY_MS = 86_400_000;
const WINDOW_BACK_MS = 60 * DAY_MS;
const WINDOW_AHEAD_MS = 180 * DAY_MS;
/** Refreshed this often while someone looks at their Calendar. */
const STALE_MS = 55 * 60_000;
/** Only calendars viewed this recently are refreshed on a schedule. */
const ACTIVE_MS = 14 * DAY_MS;
/** Unchanged text is parsed again after this (the window moves on). */
const REPARSE_MS = 12 * 3600_000;
/** A fetch in flight holds the calendar this long. */
const LEASE_MS = 60_000;
/** Events per write. */
const CHUNK = 250;
/** Multi-day events starting this long before a range are still looked at. */
const LONGEST_EVENT_MS = 31 * DAY_MS;

export const COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"] as const;
const vColor = v.union(...COLORS.map((c) => v.literal(c)));

const vOutcome = v.union(
  v.object({
    kind: v.literal("parsed"),
    etag: v.union(v.string(), v.null()),
    lastModified: v.union(v.string(), v.null()),
    contentHash: v.string(),
    eventCount: v.number(),
    truncated: v.boolean(),
    name: v.union(v.string(), v.null()),
  }),
  v.object({ kind: v.literal("unchanged") }),
  v.object({ kind: v.literal("error"), message: v.string() }),
);
type Outcome = Infer<typeof vOutcome>;

async function ownCalendar(ctx: QueryCtx | MutationCtx, profile: Doc<"profiles">, calendarId: string) {
  const id = ctx.db.normalizeId("externalCalendars", calendarId);
  const cal = id ? await ctx.db.get(id) : null;
  if (!cal || cal.profileId !== profile._id) fail("not_found", "Calendar not found.");
  return cal;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Your subscribed calendars, oldest first, with how the last fetch went. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const cals = await ctx.db
      .query("externalCalendars")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_CALENDARS + 5);
    return cals
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({
        id: c._id as string,
        name: c.name,
        url: c.url,
        color: c.color,
        lastFetchedAt: c.lastFetchedAt ?? null,
        lastError: c.lastError ?? null,
        eventCount: c.eventCount ?? null,
        truncated: c.truncated ?? false,
        loading: c.lastFetchedAt === undefined || (c.fetchStartedAt !== undefined && Date.now() - c.fetchStartedAt < LEASE_MS),
      }));
  },
});

/** Events from your calendars overlapping [from, to) (UTC ms). The client places them in its time zone. */
export const events = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!(args.to > args.from) || args.to - args.from > 400 * DAY_MS) fail("invalid_argument", "Pick a shorter range.");
    const cals = new Map(
      (
        await ctx.db
          .query("externalCalendars")
          .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
          .take(MAX_CALENDARS + 5)
      ).map((c) => [c._id as string, c]),
    );
    if (!cals.size) return [];
    const rows = await ctx.db
      .query("externalEvents")
      .withIndex("by_profile_start", (q) => q.eq("profileId", profile._id).gte("start", args.from - LONGEST_EVENT_MS).lt("start", args.to))
      .take(4000);
    const out = [];
    for (const e of rows) {
      const cal = cals.get(e.calendarId);
      if (!cal || e.generation !== cal.generation || Math.max(e.end, e.start + 1) <= args.from) continue;
      out.push({
        id: e._id as string,
        calendarId: cal._id as string,
        calendarName: cal.name,
        color: cal.color,
        title: e.title,
        location: e.location ?? "",
        description: e.description ?? "",
        start: e.start,
        end: e.end,
        allDay: e.allDay,
      });
    }
    return out;
  },
});

/** Subscribes to a calendar by its link and fetches it right away. */
export const add = mutation({
  args: { url: v.string(), name: v.optional(v.string()), color: v.optional(vColor) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const url = normalizeCalendarUrl(args.url);
    if (url.length > 2000) fail("invalid_argument", "That link is too long.");
    const problem = calendarUrlProblem(url);
    if (problem) fail("invalid_argument", problem);
    const mine = await ctx.db
      .query("externalCalendars")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_CALENDARS + 5);
    if (mine.length >= MAX_CALENDARS) fail("limit_exceeded", `You can subscribe to up to ${MAX_CALENDARS} calendars.`);
    if (mine.some((c) => c.url === url)) fail("invalid_argument", "You’ve already added this calendar.");
    const name = cleanName(args.name ?? "");
    const used = new Set(mine.map((c) => c.color));
    const now = Date.now();
    const id = await ctx.db.insert("externalCalendars", {
      profileId: profile._id,
      name: name || new URL(url).hostname.replace(/^www\./, ""),
      autoName: name ? undefined : true,
      url,
      color: args.color ?? COLORS.find((c) => !used.has(c)) ?? "moss",
      createdAt: now,
      lastViewedAt: now,
      generation: 0,
      lastGeneration: 0,
    });
    await ctx.scheduler.runAfter(0, internal.externalCalendars.fetchNow, { calendarId: id });
    return { id: id as string };
  },
});

export const update = mutation({
  args: { calendarId: v.string(), name: v.optional(v.string()), color: v.optional(vColor) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const cal = await ownCalendar(ctx, profile, args.calendarId);
    const patch: Partial<Doc<"externalCalendars">> = {};
    if (args.name !== undefined) {
      const name = cleanName(args.name);
      if (!name) fail("invalid_argument", "Give the calendar a name.");
      patch.name = name;
      patch.autoName = undefined;
    }
    if (args.color !== undefined) patch.color = args.color;
    await ctx.db.patch(cal._id, patch);
    return null;
  },
});

/** Unsubscribes: the calendar goes at once, its events right after. */
export const remove = mutation({
  args: { calendarId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const cal = await ownCalendar(ctx, profile, args.calendarId);
    await ctx.db.delete(cal._id);
    await ctx.scheduler.runAfter(0, internal.externalCalendars.purge, { calendarId: cal._id });
    return null;
  },
});

/** Fetches a calendar again now (unless a fetch is already under way). */
export const refresh = mutation({
  args: { calendarId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const cal = await ownCalendar(ctx, profile, args.calendarId);
    if (cal.fetchStartedAt !== undefined && Date.now() - cal.fetchStartedAt < LEASE_MS) return null;
    // A deliberate refresh reads the text again even when it hasn't changed.
    await ctx.db.patch(cal._id, { parsedAt: undefined });
    await ctx.scheduler.runAfter(0, internal.externalCalendars.fetchNow, { calendarId: cal._id });
    return null;
  },
});

/** The Calendar was opened: keeps these calendars on the refresh schedule, and refreshes stale ones now. */
export const viewed = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const now = Date.now();
    const cals = await ctx.db
      .query("externalCalendars")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_CALENDARS + 5);
    for (const c of cals) {
      if (now - c.lastViewedAt > 3600_000) await ctx.db.patch(c._id, { lastViewedAt: now });
      const inFlight = c.fetchStartedAt !== undefined && now - c.fetchStartedAt < LEASE_MS;
      if (!inFlight && now - (c.lastFetchedAt ?? 0) > STALE_MS) await ctx.scheduler.runAfter(0, internal.externalCalendars.fetchNow, { calendarId: c._id });
    }
    return null;
  },
});

/** Cron: refreshes the calendars looked at in the last 14 days whose copy is stale, spread over a few minutes. */
export const refreshDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("externalCalendars")
      .withIndex("by_viewed", (q) => q.gte("lastViewedAt", now - ACTIVE_MS))
      .take(2000);
    let scheduled = 0;
    for (const c of active) {
      if (scheduled >= 500) break;
      if (now - (c.lastFetchedAt ?? 0) < STALE_MS) continue;
      if (c.fetchStartedAt !== undefined && now - c.fetchStartedAt < LEASE_MS) continue;
      await ctx.scheduler.runAfter(Math.floor(Math.random() * 5 * 60_000), internal.externalCalendars.fetchNow, { calendarId: c._id });
      scheduled++;
    }
    return { scheduled };
  },
});

/** Starts a fetch: a new generation number, and the calendar held for a minute. Null when one is under way. */
export const claim = internalMutation({
  args: { calendarId: v.id("externalCalendars") },
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    const now = Date.now();
    if (!cal || (cal.fetchStartedAt !== undefined && now - cal.fetchStartedAt < LEASE_MS)) return null;
    const generation = cal.lastGeneration + 1;
    await ctx.db.patch(cal._id, { fetchStartedAt: now, lastGeneration: generation });
    return {
      url: cal.url,
      generation,
      etag: cal.etag,
      lastModified: cal.lastModified,
      contentHash: cal.contentHash,
      // Unchanged text is only skipped while what was read from it is fresh.
      fresh: cal.parsedAt !== undefined && now - cal.parsedAt < REPARSE_MS && !cal.lastError,
    };
  },
});

export const insertEvents = internalMutation({
  args: {
    calendarId: v.id("externalCalendars"),
    generation: v.number(),
    events: v.array(v.object({ key: v.string(), start: v.number(), end: v.number(), allDay: v.boolean(), title: v.string(), location: v.string(), description: v.string() })),
  },
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    if (!cal) return false;
    for (const e of args.events) {
      await ctx.db.insert("externalEvents", {
        calendarId: cal._id,
        profileId: cal.profileId,
        generation: args.generation,
        key: e.key,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        title: e.title,
        location: e.location || undefined,
        description: e.description || undefined,
      });
    }
    return true;
  },
});

/** A fetch finished: shows its generation (if it's the newest), records how it went, clears out the rest. */
export const finish = internalMutation({
  args: {
    calendarId: v.id("externalCalendars"),
    generation: v.number(),
    outcome: vOutcome,
  },
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    if (!cal) {
      await ctx.scheduler.runAfter(0, internal.externalCalendars.purge, { calendarId: args.calendarId });
      return null;
    }
    const now = Date.now();
    const o = args.outcome;
    if (o.kind === "parsed" && args.generation > cal.generation) {
      const name = cal.autoName && o.name ? cleanName(o.name) : "";
      await ctx.db.patch(cal._id, {
        generation: args.generation,
        lastFetchedAt: now,
        lastError: undefined,
        etag: o.etag ?? undefined,
        lastModified: o.lastModified ?? undefined,
        contentHash: o.contentHash,
        parsedAt: now,
        eventCount: o.eventCount,
        truncated: o.truncated || undefined,
        fetchStartedAt: undefined,
        ...(name ? { name } : {}),
      });
    } else if (o.kind === "unchanged") {
      await ctx.db.patch(cal._id, { lastFetchedAt: now, lastError: undefined, fetchStartedAt: undefined });
    } else if (o.kind === "error") {
      await ctx.db.patch(cal._id, { lastFetchedAt: now, lastError: o.message.slice(0, 300), fetchStartedAt: undefined });
    } else {
      // An older fetch that finished after a newer one: nothing to show from it.
      await ctx.db.patch(cal._id, { fetchStartedAt: undefined });
    }
    await ctx.scheduler.runAfter(0, internal.externalCalendars.purge, { calendarId: cal._id });
    return null;
  },
});

/** Deletes a calendar's events older than the generation shown (all of them once it's removed), in batches. */
export const purge = internalMutation({
  args: { calendarId: v.id("externalCalendars") },
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    const rows = await ctx.db
      .query("externalEvents")
      .withIndex("by_calendar_generation", (q) => (cal ? q.eq("calendarId", args.calendarId).lt("generation", cal.generation) : q.eq("calendarId", args.calendarId)))
      .take(500);
    for (const r of rows) await ctx.db.delete(r._id);
    if (rows.length === 500) await ctx.scheduler.runAfter(0, internal.externalCalendars.purge, { calendarId: args.calendarId });
    return rows.length;
  },
});

/** Fetches and reads one calendar (see the top of this file). */
export const fetchNow = internalAction({
  args: { calendarId: v.id("externalCalendars") },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.runMutation(internal.externalCalendars.claim, { calendarId: args.calendarId });
    if (!job) return null;
    const done = (outcome: Outcome) => ctx.runMutation(internal.externalCalendars.finish, { calendarId: args.calendarId, generation: job.generation, outcome });
    const got = await downloadCalendar(job.url, job.fresh ? { etag: job.etag, lastModified: job.lastModified } : {});
    if (got.kind === "error") {
      await done({ kind: "error", message: got.message });
      return null;
    }
    if (got.kind === "notModified") {
      await done({ kind: "unchanged" });
      return null;
    }
    const contentHash = await sha256Hex(got.text);
    if (job.fresh && contentHash === job.contentHash) {
      await done({ kind: "unchanged" });
      return null;
    }
    const now = Date.now();
    const parsed = parseIcs(got.text, { from: now - WINDOW_BACK_MS, to: now + WINDOW_AHEAD_MS, maxEvents: MAX_EVENTS });
    for (let i = 0; i < parsed.events.length; i += CHUNK) {
      const chunk = parsed.events.slice(i, i + CHUNK).map((e) => ({ key: e.key, start: e.start, end: e.end, allDay: e.allDay, title: e.title, location: e.location, description: e.description }));
      const ok = await ctx.runMutation(internal.externalCalendars.insertEvents, { calendarId: args.calendarId, generation: job.generation, events: chunk });
      if (!ok) break;
    }
    await done({ kind: "parsed", etag: got.etag, lastModified: got.lastModified, contentHash, eventCount: parsed.events.length, truncated: parsed.truncated, name: parsed.name });
    return null;
  },
});
