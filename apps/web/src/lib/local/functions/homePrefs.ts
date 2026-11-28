// homePrefs.* in local mode (convex/homePrefs.ts): Home's block order, hidden blocks and the pinned note. Two values in
// the library's meta ("homeLayout", "homePinnedNote"), so they travel with the library to every device it syncs to.
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import { requireProfile } from "./shared";

const LAYOUT = "homeLayout";
const PINNED = "homePinnedNote";
/** As the server (convex/homePrefs.ts HOME_LAYOUT_MAX, BLOCK_ID, NOTE_ID). */
const MAX = 50;
const BLOCK_ID = /^[a-z][a-z0-9-]{0,39}$/;
const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

defineLocal(api.homePrefs.get, "query", async (ctx) => {
  await requireProfile(ctx);
  const layout = (await ctx.db.get("meta", LAYOUT)) as { order: string[]; hidden: string[] } | null | undefined;
  const pinned = (await ctx.db.get("meta", PINNED)) as string | null | undefined;
  return { layout: layout ? { order: layout.order, hidden: layout.hidden } : null, pinnedNote: pinned ?? null };
});

defineLocal(api.homePrefs.setLayout, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (args.layout === null) {
    ctx.db.put("meta", LAYOUT, null);
    return null;
  }
  const { order, hidden } = args.layout;
  if (order.length > MAX || hidden.length > MAX) fail("invalid_argument", "Too many Home blocks.");
  if (![...order, ...hidden].every((id) => BLOCK_ID.test(id))) fail("invalid_argument", "Invalid Home block.");
  ctx.db.put("meta", LAYOUT, { order: [...new Set(order)], hidden: [...new Set(hidden)] });
  return null;
});

defineLocal(api.homePrefs.setPinnedNote, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (args.documentId !== null && !NOTE_ID.test(args.documentId)) fail("invalid_argument", "Invalid note.");
  ctx.db.put("meta", PINNED, args.documentId);
  return null;
});
