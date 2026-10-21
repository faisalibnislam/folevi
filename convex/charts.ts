// What the chart block needs from the server besides the note itself: the collections in a place it can
// take its rows from (the rows themselves come from collections.get, live). The chart's Foli AI actions
// are in chartAi.ts.
import { query } from "./_generated/server";
import { accessAtLeast, documentAccess, requireProfile, resolveScope } from "./lib/auth";
import { inScope, vScopeArg } from "./lib/scope";
import { isSealed } from "./lib/e2ee/state";

const MAX_LISTED = 60;

/** Collections in this place whose page the person can open, most recently changed first. */
export const collections = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args): Promise<{ id: string; name: string; note: string; noteId: string }[]> => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const rows = await (scope.kind === "personal"
      ? ctx.db.query("collections").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("collections").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
    ).take(400);
    const out: { id: string; name: string; note: string; noteId: string; updatedAt: number }[] = [];
    for (const c of rows.sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (out.length >= MAX_LISTED) break;
      if (c.deletedAt || !inScope(c, scope)) continue;
      const host = await ctx.db.get(c.documentId);
      // A sealed note's collections are sealed records the device lists (docs/E2EE_DESIGN.md §5.7).
      if (!host || host.inTrash || isSealed(host)) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, host), "read")) continue;
      out.push({ id: c.publicId, name: c.name || "Collection", note: host.title || "Untitled", noteId: host.publicId, updatedAt: c.updatedAt });
    }
    return out.map(({ id, name, note, noteId }) => ({ id, name, note, noteId }));
  },
});
