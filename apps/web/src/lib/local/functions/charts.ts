// charts.collections in local mode (convex/charts.ts): the collections a chart block can take its rows from,
// most recently changed first. The rows themselves come from collections.get, live.
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";
import { checkScope, requireProfile } from "./shared";

const MAX_LISTED = 60;

defineLocal(api.charts.collections, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const all = (await ctx.db.list("collections")).sort((a, b) => b.updatedAt - a.updatedAt || a.ordinal - b.ordinal);
  const out: { id: string; name: string; note: string; noteId: string }[] = [];
  for (const c of all) {
    if (out.length >= MAX_LISTED) break;
    if (c.deletedAt !== null) continue;
    const host = await ctx.db.get("documents", c.documentId);
    if (!host || host.inTrash) continue;
    out.push({ id: c.id, name: c.name || "Collection", note: host.title || "Untitled", noteId: host.id });
  }
  return out;
});
