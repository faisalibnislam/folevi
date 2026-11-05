// sidebarOrder.* in local mode (convex/sidebarOrder.ts): the person's own order of the library's folders in the
// sidebar, apart from their rank. A library is one person's and has only its Personal, so the order is one value
// in the library's meta ("sidebarOrder"), and travels with the library to every device it syncs to.
import { isValidId } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import { checkScope, requireProfile } from "./shared";

const ORDER_KEY = "sidebarOrder";
/** As the server (convex/sidebarOrder.ts SIDEBAR_ORDER_MAX). */
const ORDER_MAX = 5000;

defineLocal(api.sidebarOrder.get, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const order = (await ctx.db.get("meta", ORDER_KEY)) as string[] | null | undefined;
  return order ?? null;
});

defineLocal(api.sidebarOrder.set, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  if (args.folderIds === null) {
    ctx.db.put("meta", ORDER_KEY, null);
    return null;
  }
  if (args.folderIds.length > ORDER_MAX) fail("invalid_argument", "Too many folders in that order.");
  if (!args.folderIds.every(isValidId)) fail("invalid_argument", "Invalid folder id.");
  ctx.db.put("meta", ORDER_KEY, [...new Set(args.folderIds)]);
  return null;
});
