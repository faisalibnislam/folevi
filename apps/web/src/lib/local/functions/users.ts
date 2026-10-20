// users.* in local mode (convex/users.ts). The library has one profile, made by setup.ts on first launch.
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";
import { getProfile } from "./shared";

defineLocal(api.users.me, "query", async (ctx) => {
  const profile = await getProfile(ctx.db);
  return profile ? { state: "ready" as const, profile } : { state: "needs_bootstrap" as const };
});
