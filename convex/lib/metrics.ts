import type { MutationCtx } from "../_generated/server";

export type MetricKey =
  | "users_total"
  | "users_verified"
  | "workspaces_total"
  | "documents_total"
  | "storage_bytes"
  | "signups"
  | "email_failed"
  | "email_accepted"
  | "sync_rejected"
  | "sync_conflicts"
  | "rate_limited";

/** Increments an aggregate counter and today's daily bucket. Aggregates never contain content. */
export async function bump(ctx: MutationCtx, key: MetricKey, delta = 1): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query("metrics")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) await ctx.db.patch(row._id, { value: row.value + delta, updatedAt: now });
  else await ctx.db.insert("metrics", { key, value: delta, updatedAt: now });
  const date = new Date(now).toISOString().slice(0, 10);
  const daily = await ctx.db
    .query("metricsDaily")
    .withIndex("by_key_date", (q) => q.eq("key", key).eq("date", date))
    .unique();
  if (daily) await ctx.db.patch(daily._id, { value: daily.value + delta });
  else await ctx.db.insert("metricsDaily", { key, date, value: delta });
}
