// Home's stats strip (the owner, 28 November 2026): how much is in this Personal or workspace, as this person can
// see it. Notes, words (and the reading time they make), images, folders, tasks done, and the notes made in each of
// the last 7 days for a small bar chart. Counts stop at STATS_CAP rows a table (`capped` says so), so a very large
// library costs the same as a big one.
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { PageReader, requireProfile, resolveScope } from "./lib/auth";
import { vScopeArg } from "./lib/scope";
import { v } from "convex/values";

/** Rows read per table, at most. */
export const STATS_CAP = 5000;
const DAY = 24 * 60 * 60 * 1000;

export type HomeStats = {
  notes: number;
  words: number;
  images: number;
  folders: number;
  tasksDone: number;
  tasksOpen: number;
  /** Notes made on each of the last 7 days, oldest first; the last is today. */
  week: number[];
  capped: boolean;
};

/** The 7 day buckets (oldest first) a time falls in, counted back from the start of `today`. */
export function weekBuckets(times: number[], todayStart: number): number[] {
  const week = Array.from({ length: 7 }, () => 0);
  for (const t of times) {
    const back = t >= todayStart ? 0 : Math.ceil((todayStart - t) / DAY);
    if (back <= 6) week[6 - back]! += 1;
  }
  return week;
}

export const get = query({
  args: { scope: vScopeArg, todayStart: v.optional(v.number()) },
  handler: async (ctx, args): Promise<HomeStats> => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    const personal = scope.kind === "personal";
    const docsQ = personal
      ? ctx.db.query("documents").withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", scope.profileId).eq("inTrash", false))
      : ctx.db.query("documents").withIndex("by_workspace_trash", (q) => q.eq("workspaceId", scope.workspaceId).eq("inTrash", false));
    const raw = await docsQ.take(STATS_CAP + 1);
    let capped = raw.length > STATS_CAP;
    const pages = raw.slice(0, STATS_CAP).filter((d) => d.kind === "document" || d.kind === "daily");
    // In a workspace, only the notes this person may open count.
    const docs: Doc<"documents">[] = personal ? pages : await new PageReader(ctx, profile, standing).filter(pages);
    const seen = new Set<Id<"documents">>(docs.map((d) => d._id));

    const filesQ = personal
      ? ctx.db.query("files").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("files").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId));
    const files = await filesQ.take(STATS_CAP + 1);
    capped ||= files.length > STATS_CAP;
    const images = files.slice(0, STATS_CAP).filter((f) => f.kind === "image" && f.status === "ready" && !f.sharesBlob && f.documentId !== undefined && seen.has(f.documentId)).length;

    const folders = personal
      ? await ctx.db.query("folders").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId)).take(STATS_CAP)
      : await ctx.db.query("folders").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId)).take(STATS_CAP);
    const liveFolders = folders.filter((f) => f.deletedAt === undefined).length;

    const tasksOf = async (status: "done" | "open") =>
      (personal
        ? await ctx.db.query("tasks").withIndex("by_owner_status_due", (q) => q.eq("ownerProfileId", scope.profileId).eq("status", status)).take(STATS_CAP)
        : await ctx.db.query("tasks").withIndex("by_workspace_status_due", (q) => q.eq("workspaceId", scope.workspaceId).eq("status", status)).take(STATS_CAP)
      ).filter((t) => !t.documentInTrash && seen.has(t.documentId)).length;

    const todayStart = args.todayStart ?? Date.now() - (Date.now() % DAY);
    return {
      notes: docs.length,
      words: docs.reduce((n, d) => n + (d.wordCount || 0), 0),
      images,
      folders: liveFolders,
      tasksDone: await tasksOf("done"),
      tasksOpen: await tasksOf("open"),
      week: weekBuckets(
        docs.map((d) => d.createdAt),
        todayStart,
      ),
      capped,
    };
  },
});
