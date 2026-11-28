// homeStats.get in local mode (convex/homeStats.ts): how much is in this library, for Home's stats strip.
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";
import { checkScope, requireProfile } from "./shared";
import { allTasks } from "./tasks";

const DAY = 24 * 60 * 60 * 1000;
/** As the server (convex/homeStats.ts STATS_CAP, weekBuckets). */
const STATS_CAP = 5000;
function weekBuckets(times: number[], todayStart: number): number[] {
  const week = Array.from({ length: 7 }, () => 0);
  for (const t of times) {
    const back = t >= todayStart ? 0 : Math.ceil((todayStart - t) / DAY);
    if (back <= 6) week[6 - back]! += 1;
  }
  return week;
}

defineLocal(api.homeStats.get, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const all = await ctx.db.list("documents");
  const docs = all.filter((d) => !d.inTrash && (d.kind === "document" || d.kind === "daily")).slice(0, STATS_CAP);
  const seen = new Set(docs.map((d) => d.id));
  const images = (await ctx.db.list("files")).filter((f) => f.kind === "image" && f.documentId !== null && seen.has(f.documentId)).length;
  const folders = (await ctx.db.list("folders")).filter((f) => f.deletedAt === null).length;
  const tasks = (await allTasks(ctx.db)).filter((r) => !r.doc.inTrash);
  const now = ctx.now();
  return {
    notes: docs.length,
    words: docs.reduce((n, d) => n + (d.wordCount || 0), 0),
    images,
    folders,
    tasksDone: tasks.filter((r) => r.task.status === "done").length,
    tasksOpen: tasks.filter((r) => r.task.status === "open").length,
    week: weekBuckets(
      docs.map((d) => d.createdAt),
      args.todayStart ?? now - (now % DAY),
    ),
    capped: all.length > STATS_CAP,
  };
});
