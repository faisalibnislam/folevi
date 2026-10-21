// Your tasks in your calendar app: a private iCalendar link (/api/calendar/<token>.ics on the app host,
// served by the Convex route /ical/<token>.ics in http.ts) with every open task that has a due date, from
// your Personal and, if you choose, workspace tasks assigned to you. Read-only. The link is a secret: only
// its hash is stored, it's shown once, and making a new one ends the old one.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireProfile } from "./lib/auth";
import { randomToken, sha256Hex } from "./lib/crypto";
import { appUrl } from "./lib/notify";
import { buildCalendar, type FeedTask } from "./lib/ical";
import { addDays, localDate } from "@folevi/editor-schema";
import { isLocked, isSealed, spaceE2ee, switchesOf } from "./lib/e2ee/state";
import { personalScope } from "./lib/scope";

/** Tasks from this many days ago (overdue) to this many ahead. */
const PAST_DAYS = 30;
const AHEAD_DAYS = 400;
const MAX_TASKS = 1000;

export const status = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const feed = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .first();
    return feed ? { includeWorkspaces: feed.includeWorkspaces, createdAt: feed.createdAt, lastFetchedAt: feed.lastFetchedAt ?? null } : null;
  },
});

/** Makes a new link (ending any old one) and returns its token, once. */
export const create = mutation({
  args: { includeWorkspaces: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const old = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .collect();
    for (const f of old) await ctx.db.delete(f._id);
    const token = randomToken(24);
    await ctx.db.insert("calendarFeeds", { profileId: profile._id, tokenHash: await sha256Hex(token), includeWorkspaces: args.includeWorkspaces, createdAt: Date.now() });
    return { token };
  },
});

export const setIncludeWorkspaces = mutation({
  args: { includeWorkspaces: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const feed = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .first();
    if (feed) await ctx.db.patch(feed._id, { includeWorkspaces: args.includeWorkspaces });
    return null;
  },
});

export const remove = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const feeds = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .collect();
    for (const f of feeds) await ctx.db.delete(f._id);
    return null;
  },
});

/** The calendar for a link's token hash, or null when there's no such link (or the account can't be used). */
export const render = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<{ ics: string; feedId: string } | null> => {
    const feed = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_token", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!feed) return null;
    const profile = await ctx.db.get(feed.profileId);
    if (!profile || profile.status !== "active") return null;
    const today = localDate(Date.now(), profile.timeZone);
    const from = addDays(today, -PAST_DAYS);
    const to = addDays(today, AHEAD_DAYS);
    const rows: Doc<"tasks">[] = await ctx.db
      .query("tasks")
      .withIndex("by_owner_status_due", (q) => q.eq("ownerProfileId", profile._id).eq("status", "open").gte("dueDate", from).lte("dueDate", to))
      .take(MAX_TASKS);
    if (feed.includeWorkspaces) {
      const assigned = await ctx.db
        .query("tasks")
        .withIndex("by_assignee_status", (q) => q.eq("assigneeId", profile._id).eq("status", "open"))
        .take(MAX_TASKS);
      for (const t of assigned) if (t.workspaceId && t.dueDate && t.dueDate >= from && t.dueDate <= to) rows.push(t);
    }
    const tasks: FeedTask[] = [];
    const titles = new Map<string, { title: string; publicId: string } | null>();
    for (const t of rows) {
      if (t.documentInTrash || !t.dueDate) continue;
      let doc = titles.get(t.documentId);
      if (doc === undefined) {
        const d = await ctx.db.get(t.documentId);
        // A sealed note's to-dos come only from its apps copy below (docs/E2EE_DESIGN.md §5.7).
        doc = d && !d.inTrash && d.deletedAt === undefined && !isSealed(d) ? { title: d.title || "Untitled", publicId: d.publicId } : null;
        titles.set(t.documentId, doc);
      }
      if (!doc) continue;
      tasks.push({ uid: `${t.blockId}@folevi.com`, title: t.title || "Untitled task", dueDate: t.dueDate, ...(t.dueTime ? { dueTime: t.dueTime } : {}), url: `${appUrl()}/d/${doc.publicId}#block-${t.blockId}`, note: doc.title, updatedAt: t.updatedAt });
    }
    // An encrypted Personal with "Apps and integrations" on keeps a readable copy of each note for apps
    // (e2eeMirrors, purpose "apps"), with its to-dos: the feed shows the open ones with a due date. Locked
    // notes never have one. Workspace to-dos of sealed notes don't say who they're assigned to, so they stay out.
    const space = await spaceE2ee(ctx, personalScope(profile._id));
    if (space && space.level !== "standard" && switchesOf(space).apps) {
      const mirrors = await ctx.db
        .query("e2eeMirrors")
        .withIndex("by_scope_purpose", (q) => q.eq("workspaceId", undefined).eq("ownerProfileId", profile._id).eq("purpose", "apps"))
        .take(MAX_TASKS);
      for (const m of mirrors) {
        if (tasks.length >= MAX_TASKS) break;
        if (!m.tasks?.length) continue;
        const d = await ctx.db.get(m.documentId);
        if (!d || d.inTrash || d.deletedAt !== undefined || (await isLocked(ctx, d))) continue;
        for (const t of m.tasks) {
          if (t.done || !t.due || t.due < from || t.due > to) continue;
          tasks.push({ uid: `${t.blockId}@folevi.com`, title: t.text || "Untitled task", dueDate: t.due, ...(t.dueTime ? { dueTime: t.dueTime } : {}), url: `${appUrl()}/d/${d.publicId}#block-${t.blockId}`, note: m.title, updatedAt: m.updatedAt });
        }
      }
    }
    return { ics: buildCalendar(tasks, { name: "Folevi tasks", timeZone: profile.timeZone }), feedId: feed._id };
  },
});

/** When a calendar app last fetched the link (at most every 10 minutes, so polling doesn't keep writing). */
export const touch = internalMutation({
  args: { feedId: v.id("calendarFeeds") },
  handler: async (ctx, args) => {
    const feed = await ctx.db.get(args.feedId);
    if (feed && (!feed.lastFetchedAt || Date.now() - feed.lastFetchedAt > 10 * 60_000)) await ctx.db.patch(feed._id, { lastFetchedAt: Date.now() });
    return null;
  },
});
