// sidebarLayout.* in local mode (convex/sidebarLayout.ts): which sidebar items sit under More, and their order. One
// value in the library's meta ("sidebarLayout"), so it travels with the library to every device it syncs to.
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import { requireProfile } from "./shared";

const KEY = "sidebarLayout";
/** As the server (convex/sidebarLayout.ts SIDEBAR_LAYOUT_MAX). */
const MAX = 100;
const ITEM_ID = /^[a-z][a-z0-9-]{0,39}$/;

defineLocal(api.sidebarLayout.get, "query", async (ctx) => {
  await requireProfile(ctx);
  const saved = (await ctx.db.get("meta", KEY)) as { order: string[]; more: string[] } | null | undefined;
  return saved ? { order: saved.order, more: saved.more } : null;
});

defineLocal(api.sidebarLayout.set, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (args.layout === null) {
    ctx.db.put("meta", KEY, null);
    return null;
  }
  const { order, more } = args.layout;
  if (order.length > MAX || more.length > MAX) fail("invalid_argument", "Too many sidebar items.");
  if (![...order, ...more].every((id) => ITEM_ID.test(id))) fail("invalid_argument", "Invalid sidebar item.");
  ctx.db.put("meta", KEY, { order: [...new Set(order)], more: [...new Set(more)] });
  return null;
});
