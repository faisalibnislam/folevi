// The server's clock, for things every viewer must agree on to the second (the sticky notes workshop timer):
// each client asks once per session, times the round trip, and works out how far its own clock is off.
// A mutation, not a query: query results are cached, so their time could be stale.
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireIdentity } from "./lib/auth";

/** The server's time now (epoch ms). Signed in only; it reads and writes nothing. */
export const now = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireIdentity(ctx);
    return Date.now();
  },
});
