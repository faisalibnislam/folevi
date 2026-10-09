import type { MutationCtx } from "../_generated/server";
import { fail } from "./errors";
import { keyedHash } from "./crypto";

export interface RateRule {
  limit: number;
  windowMs: number;
}

/** Defaults; admins can override per rule via systemSettings key "rate_limits". */
export const DEFAULT_RATE_RULES = {
  bootstrap: { limit: 10, windowMs: 60 * 60_000 },
  invite: { limit: 30, windowMs: 60 * 60_000 },
  emailResend: { limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  publicLinkOpen: { limit: 120, windowMs: 60_000 },
  publicLinkPassword: { limit: 10, windowMs: 15 * 60_000 },
  syncBatch: { limit: 600, windowMs: 60_000 },
  /** Bulk note actions (move, star, archive, trash, restore, delete, empty Trash); each call is up to 50 notes. */
  bulk: { limit: 60, windowMs: 60_000 },
  upload: { limit: 120, windowMs: 60 * 60_000 },
  comment: { limit: 120, windowMs: 60_000 },
  export: { limit: 20, windowMs: 60 * 60_000 },
  search: { limit: 600, windowMs: 60_000 },
  deviceRegister: { limit: 60, windowMs: 60 * 60_000 },
  unsplash: { limit: 60, windowMs: 60 * 60_000 },
  /** Reading a bookmarked page's title, description and image. */
  bookmarkPreview: { limit: 120, windowMs: 60 * 60_000 },
  ai: { limit: 150, windowMs: 60 * 60_000 },
  /** The AI budget on plans with higher fair-use limits (Workspace Business). */
  aiHigh: { limit: 300, windowMs: 60 * 60_000 },
  /** Chunks embedded for semantic search per account (a Personal or a workspace); platform-paid. */
  aiIndex: { limit: 4_000, windowMs: 60 * 60_000 },
  /** Support requests from the support page or the app, per client (hashed IP). */
  supportSubmit: { limit: 10, windowMs: 60 * 60_000 },
  /** Support requests and in-app replies per requester address. */
  supportSubmitEmail: { limit: 5, windowMs: 60 * 60_000 },
  /** Inbound support email per sender address (beyond it, messages are dropped, not queued). */
  supportInbound: { limit: 20, windowMs: 60 * 60_000 },
} satisfies Record<string, RateRule>;

export type RateRuleName = keyof typeof DEFAULT_RATE_RULES;

export async function ruleFor(ctx: MutationCtx, name: RateRuleName): Promise<RateRule> {
  const setting = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (q) => q.eq("key", "rate_limits"))
    .unique();
  const override = (setting?.value as Record<string, RateRule> | undefined)?.[name];
  if (override && override.limit > 0 && override.windowMs > 0) return override;
  return DEFAULT_RATE_RULES[name];
}

/**
 * Fixed-window counter. Throws `rate_limited` (with retryAfterMs) once the window is exhausted.
 * A rejected mutation rolls back its writes, so the durable rate-limit event is recorded by the request
 * that *reaches* the limit (which commits); every rejection is also written to the structured log.
 */
export async function consume(ctx: MutationCtx, name: RateRuleName, subject: string, cost = 1): Promise<void> {
  const rule = await ruleFor(ctx, name);
  const now = Date.now();
  const windowStart = now - (now % rule.windowMs);
  const subjectHash = await keyedHash(subject, "rate");
  const bucket = `${name}:${subjectHash}`;
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
    .unique();
  if (!row || row.windowStart !== windowStart) {
    if (row) await ctx.db.patch(row._id, { windowStart, count: cost });
    else await ctx.db.insert("rateLimits", { bucket, windowStart, count: cost });
    return;
  }
  if (row.count + cost > rule.limit) {
    console.warn(JSON.stringify({ event: "rate_limited", rule: name, subject: subjectHash.slice(0, 12) }));
    fail("rate_limited", "Too many requests. Please wait a moment and try again.", {
      retryAfterMs: windowStart + rule.windowMs - now,
    });
  }
  await ctx.db.patch(row._id, { count: row.count + cost });
  if (row.count < rule.limit && row.count + cost >= rule.limit) {
    await ctx.db.insert("rateLimitEvents", { rule: name, subjectHash, createdAt: now });
  }
}
